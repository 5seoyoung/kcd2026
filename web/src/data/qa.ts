// 질의응답 (RAG). EMR 화면의 의료진 질문에 답한다 (docs 0-7).
// 이 환자 질문은 기준 시각까지의 사례 자료와 에이전트 출력으로 여기서 계산하고,
// 지식 질문은 근거 위키 (wiki_kb) 를 검색해 답한다 (data/rag.ts). 둘을 섞지 않고 답마다 출처를 붙인다.
// 근거가 없으면 답하지 않고, 치료나 약 중단 결정은 답하지 않는다.
import type { AgentRun, CaseData, CauseCall, LabResult, QaAnswer, QaMsg, QaSource, Ref } from '../types'
import type { Sim } from '.'
import { CAUSE_WIKI, causeName } from './causes'
import { tx } from './cases/en'
import { activeAt, isKnown, itemOf, K_RECOVER, recoveryAt, RULE_THRESHOLD, seriesAt, uln } from '../lib/events'
import { bi, pick, tr, type Bi } from '../lib/i18n'
import { fmtNum } from '../lib/lab'
import { rateAt } from '../lib/ui'
import { hm, hoursBetween, isAfter, md, mdhm } from '../lib/time'

export interface QaCtx {
  cs: CaseData
  sim: Sim
  clock: string
  /** 원인 추정이 끝났을 때만 */
  run?: AgentRun
}

interface QaDef {
  id: string
  kind: '환자' | '지식'
  q: (c: QaCtx) => string
  /** 자유 질문을 이 질문으로 볼 낱말. 묶음마다 하나 이상 들어 있어야 함 (띄어쓰기 무시) */
  keys: string[][]
  when: (c: QaCtx) => boolean
  /** when 이 아닐 때 하는 말 */
  notYet: Bi
  answer: (c: QaCtx) => QaAnswer
}

const DOCS = {
  spec: bi('프로젝트 명세서: 사건과 회복 정의', 'Project spec: event and recovery definitions'),
}

const TAB_NAME: Record<Ref['tab'], Bi> = {
  lab: bi('검사결과', 'Labs'), mar: bi('투약기록', 'MAR'), vital: bi('활력징후', 'Vitals'), micro: bi('미생물', 'Microbiology'), proc: bi('영상·처치', 'Imaging & procedures'),
}
const VITAL_NAME: Record<string, Bi> = {
  map: bi('MAP', 'MAP'), hr: bi('심박수', 'Heart rate'), spo2: bi('SpO2', 'SpO2'), cvp: bi('CVP', 'CVP'), bt: bi('체온', 'Temperature'),
  rr: bi('호흡수', 'Respiratory rate'), sbp: bi('수축기 혈압', 'Systolic BP'), dbp: bi('이완기 혈압', 'Diastolic BP'),
}
const PRESSOR_NAME: Record<string, string> = { Norepinephrine: '노르에피네프린', Vasopressin: '바소프레신', Epinephrine: '에피네프린', Dopamine: '도파민', Phenylephrine: '페닐에프린' }
/** 화면에 쓰는 승압제 이름 (영어 화면은 투약기록의 약 이름 그대로) */
const pressorName = (drug: string) => tr(PRESSOR_NAME[drug], drug)

const short = (name: string) => name.split(' (')[0]
const pct = (p: number) => `${Math.round(p * 100)}%`
const doc = (label: string): QaSource => ({ kind: 'doc', label })

/** 원자료 위치를 사람이 읽는 이름으로 */
function refLabel(cs: CaseData, ref: Ref): string {
  let what = ref.row
  if (ref.tab === 'lab') {
    const r = cs.labs.find(x => x.id === ref.col)
    what = `${short(itemOf(cs, ref.row).name)}${r ? ` ${mdhm(r.charttime)}` : ''}`
  } else if (ref.tab === 'mar') what = tx(cs.mar.find(o => o.id === ref.row)?.drug) ?? ref.row
  else if (ref.tab === 'vital') {
    const v = VITAL_NAME[ref.row]
    what = `${v ? pick(v) : ref.row}${ref.from ? ` ${mdhm(ref.from)}${ref.to && ref.to !== ref.from ? `~${hm(ref.to)}` : ''}` : ''}`
  } else if (ref.tab === 'micro') {
    const m = cs.micro.find(x => x.id === ref.row)
    what = m ? `${tx(m.test)} (${tx(m.specimen)})` : ref.row
  } else what = tx(cs.procs.find(p => p.id === ref.row)?.name ?? cs.missing.find(m => m.id === ref.row)?.name) ?? ref.row
  return `${pick(TAB_NAME[ref.tab])} · ${what}`
}

const caseSrc = (cs: CaseData, ref: Ref): QaSource => ({ kind: 'case', label: refLabel(cs, ref), ref })
const labSrc = (cs: CaseData, r: LabResult) => caseSrc(cs, { tab: 'lab', row: r.code, col: r.id })
const agentSrc = (n: number, at: string): QaSource => ({ kind: 'agent', label: tr(`에이전트 ${n} 출력 · ${mdhm(at)}`, `Agent ${n} output · ${mdhm(at)}`) })

const hits = (c: QaCtx): CauseCall[] =>
  (c.run?.calls ?? []).filter(x => x.score !== null && x.score >= RULE_THRESHOLD).sort((a, b) => b.score! - a.score!)

const pressors = (cs: CaseData) => cs.mar.filter(o => PRESSOR_NAME[o.drug])

const QA: QaDef[] = [
  {
    id: 'amio-stop', kind: '환자',
    q: () => tr('아미오다론을 끊어야 하나요?', 'Should amiodarone be stopped?'),
    keys: [['아미오다론', 'amiodarone'], ['끊', '중단', '바꿔', '써야', '줄여', '계속', 'stop', 'discontinu', 'hold', 'switch', 'change', 'reduce', 'continu']],
    when: c => !isAfter(c.cs.mar.find(o => o.id === 'AMIO')?.start ?? '9999-12-31 00:00', c.clock),
    notYet: bi('투약기록에 아미오다론 투여가 아직 없습니다.', 'The MAR has no amiodarone administration yet.'),
    answer: c => {
      const o = c.cs.mar.find(x => x.id === 'AMIO')!
      const on = activeAt(o, c.clock)
      const stop = o.admins.find(a => a.status === 'stopped' && !isAfter(a.time, c.clock))
      const dili = c.run?.calls.find(x => x.cause === 4)
      return {
        status: 'refused',
        text: [
          tr('치료나 약 중단 결정은 답하지 않습니다. 판단에 쓸 근거만 정리합니다.', 'Treatment and drug-discontinuation decisions are not answered. Only the evidence for the decision is summarized.'),
          tr(
            `아미오다론: ${mdhm(o.start)} 정맥 부하 뒤 지속 주입, 지금 ${on ? '투여 중' : stop ? `${mdhm(stop.time)} 중단` : '투여 기록 없음'}.`,
            `Amiodarone: IV load at ${mdhm(o.start)}, then continuous infusion; now ${on ? 'running' : stop ? `stopped at ${mdhm(stop.time)}` : 'no administration record'}.`,
          ),
          dili && dili.score !== null
            ? tr(
                `원인 추정 결과 DILI: 규칙 점수 ${dili.score.toFixed(1)}, ${dili.score >= RULE_THRESHOLD ? '기준 이상이라 해당' : '기준 미만이라 해당 없음'}. 반대 근거: ${dili.against.map(e => e.text).join('; ')}.`,
                `Cause assessment, DILI: rule score ${dili.score.toFixed(1)}, ${dili.score >= RULE_THRESHOLD ? 'at or above the threshold, so flagged' : 'below the threshold, so not flagged'}. Against: ${dili.against.map(e => e.text).join('; ')}.`,
              )
            : tr('원인 추정은 아직 실행 전입니다.', 'Cause assessment has not run yet.'),
          tr('아미오다론의 간독성은 지식 질문으로 근거 위키에서 찾아볼 수 있습니다.', 'Amiodarone hepatotoxicity can be looked up in the evidence wiki as a knowledge question.'),
        ],
        sources: [caseSrc(c.cs, { tab: 'mar', row: 'AMIO' }), ...(dili ? [agentSrc(3, c.sim.target!.detectAt)] : [])],
      }
    },
  },
  {
    id: 'alt', kind: '환자',
    q: () => tr('ALT 가 어떻게 변해 왔나요?', 'How has ALT trended?'),
    keys: [['alt', 'gpt', '간수치', 'liverenzyme'], ['추이', '경과', '변화', '변해', '흐름', 'trend', 'chang', 'course', 'trajector', 'overtime']],
    when: c => seriesAt(c.cs, 'ALT', c.clock).length > 0,
    notYet: bi('아직 공개된 ALT 결과가 없습니다.', 'No ALT result has been released yet.'),
    answer: c => {
      const rs = seriesAt(c.cs, 'ALT', c.clock)
      const u = uln(c.cs, 'ALT')
      const show = rs.slice(-5)
      const last = rs.at(-1)!
      const prev = rs.at(-2)
      let tail = tr(
        `가장 최근 값: ${fmtNum(last.value, 0)} (기록 상한 ${u} 의 ${(last.value / u).toFixed(1)}배).`,
        `Latest value: ${fmtNum(last.value, 0)} (${(last.value / u).toFixed(1)}× the recorded ULN of ${u}).`,
      )
      if (prev) {
        const ratio = last.value / prev.value
        const gap = Math.round(hoursBetween(prev.charttime, last.charttime))
        const dir = ratio >= 1.05 ? `${ratio.toFixed(1)}배로 올랐습니다` : ratio <= 0.95 ? `${Math.round((1 - ratio) * 100)}% 내렸습니다` : '거의 같습니다'
        const dirEn = ratio >= 1.05 ? `Up ${ratio.toFixed(1)}× from the previous value` : ratio <= 0.95 ? `Down ${Math.round((1 - ratio) * 100)}% from the previous value` : 'About the same as the previous value'
        tail += tr(` 직전 값보다 ${dir} (${gap}시간 간격).`, ` ${dirEn} (${gap} h apart).`)
      }
      return {
        text: [
          tr(
            `${mdhm(c.clock)} 까지 공개된 ALT 는 ${rs.length}건입니다.${rs.length > show.length ? ` 최근 ${show.length}건:` : ''}`,
            `${rs.length} ALT ${rs.length === 1 ? 'result' : 'results'} released up to ${mdhm(c.clock)}.${rs.length > show.length ? ` Latest ${show.length}:` : ''}`,
          ),
          show.map(r => `${mdhm(r.charttime)} ${fmtNum(r.value, 0)}${r.value >= 2 * u ? ` (${(r.value / u).toFixed(1)}${tr('배', '×')})` : ''}`).join(' → '),
          tail,
        ],
        sources: rs.slice(-3).map(r => labSrc(c.cs, r)),
      }
    },
  },
  {
    id: 'pressor', kind: '환자',
    q: () => tr('지금 쓰고 있는 승압제는?', 'Which vasopressors are running now?'),
    keys: [
      ['승압제', '노르에피', '바소프레신', 'norepinephrine', 'vasopressin', '혈압약', 'pressor'],
      ['지금', '쓰고', '쓰는', '투여', '현재', '환자', 'now', 'current', 'running', 'using', 'patient', 'which'],
    ],
    when: () => true,
    notYet: bi('', ''),
    answer: c => {
      const started = pressors(c.cs).filter(o => !isAfter(o.start, c.clock))
      const on = started.filter(o => activeAt(o, c.clock))
      const off = started.filter(o => !activeAt(o, c.clock))
      const vit = c.cs.vitals.filter(v => !isAfter(v.time, c.clock)).at(-1)
      const text: string[] = []
      if (!started.length) text.push(tr('투약기록에 승압제 투여가 없습니다.', 'The MAR has no vasopressor administration.'))
      else if (on.length) {
        const list = on.map(o => {
          const r = rateAt(o, c.clock)
          const amount = r ? `${r.toFixed(2)} ${tx(o.freq)}` : tx(o.dose)
          return tr(`${pressorName(o.drug)} ${amount} (${mdhm(o.start)} 시작)`, `${pressorName(o.drug)} ${amount} (started ${mdhm(o.start)})`)
        }).join(', ')
        text.push(tr(`투여 중: ${list}.`, `Running: ${list}.`))
      } else text.push(tr('지금 투여 중인 승압제는 없습니다.', 'No vasopressor is running now.'))
      if (off.length) {
        const stopAt = (o: (typeof off)[number]) => mdhm(o.admins.filter(a => a.status === 'stopped' && !isAfter(a.time, c.clock)).at(-1)!.time)
        text.push(tr(
          `중단: ${off.map(o => `${pressorName(o.drug)} ${stopAt(o)}`).join(', ')}.`,
          `Stopped: ${off.map(o => `${pressorName(o.drug)} at ${stopAt(o)}`).join(', ')}.`,
        ))
      }
      if (vit) text.push(tr(`최근 MAP ${vit.map} mmHg (${mdhm(vit.time)}).`, `Latest MAP ${vit.map} mmHg (${mdhm(vit.time)}).`))
      return {
        text,
        sources: [
          ...started.map(o => caseSrc(c.cs, { tab: 'mar', row: o.id })),
          ...(vit ? [caseSrc(c.cs, { tab: 'vital', row: 'map', from: vit.time, to: vit.time })] : []),
        ],
      }
    },
  },
  {
    id: 'a1', kind: '환자',
    q: () => tr('발생 예측 확률은 왜 이렇게 나왔나요?', 'Why this early-warning probability?'),
    keys: [['발생예측', '확률', '경보', 'earlywarning', 'probability', 'alarm']],
    when: c => c.sim.a1.points.some(p => !isAfter(p.time, c.clock)),
    notYet: bi(
      '발생 예측 출력이 아직 없습니다. 첫 간 검사 결과가 공개되고 정상 구간이면 매시간 실행합니다.',
      'No early-warning output yet. It runs hourly once the first liver test is released, while the patient is in a normal window.',
    ),
    answer: c => {
      const p = c.sim.a1.points.filter(x => !isAfter(x.time, c.clock)).at(-1)!
      const stopped = !!c.sim.a1.stop && !isAfter(c.sim.a1.stop, c.clock) && !!c.sim.first
      const factors = p.factors.slice(0, 3).map(f => `${f.name} ${f.value}`).join(', ')
      return {
        text: [
          tr(
            `${mdhm(p.time)} 실행 결과, 24시간 안 5배 사건 확률은 ${pct(p.p)} 입니다 (경보 기준 ${pct(c.sim.a1.threshold)}).${stopped ? ' 첫 이상이 공개되어 에이전트가 멈췄고, 이것이 마지막 출력입니다.' : ''}`,
            `Run at ${mdhm(p.time)}: probability of a 5× event within 24 h is ${pct(p.p)} (alarm threshold ${pct(c.sim.a1.threshold)}).${stopped ? ' The first abnormality was released, so the agent stopped; this is its last output.' : ''}`,
          ),
          tr(`많이 기여한 입력: ${factors}.`, `Top contributing inputs: ${factors}.`),
          tr('확률은 원인이나 진단이 아닙니다.', 'The probability is not a cause or a diagnosis.'),
        ],
        sources: [agentSrc(1, p.time)],
      }
    },
  },
  {
    id: 'cause', kind: '환자',
    q: c => tr(`왜 ${causeName(hits(c)[0]?.cause ?? 1)} 에 해당하나요?`, `Why is ${causeName(hits(c)[0]?.cause ?? 1)} flagged?`),
    keys: [['왜', '이유', 'why', 'reason'], ['해당', '원인', '범주', 'hypoxic', '허혈', 'congestive', '울혈', 'flag', 'cause', 'categor', 'ischemi']],
    when: c => hits(c).length > 0,
    notYet: bi('아직 원인 추정 결과가 없습니다. 5배 사건이 공개되면 한 번 실행합니다.', 'No cause assessment yet. It runs once when a 5× event is released.'),
    answer: c => {
      const [h, ...others] = hits(c)
      const at = mdhm(c.sim.target!.detectAt)
      const join = (es: { text: string }[]) => es.map(e => e.text).join('; ')
      return {
        text: [
          tr(
            `원인 추정 (${at} 실행) 결과 ${causeName(h.cause)}: 규칙 점수 ${h.score!.toFixed(1)}, 기준 ${RULE_THRESHOLD.toFixed(1)} 이상이라 해당.`,
            `Cause assessment (run ${at}), ${causeName(h.cause)}: rule score ${h.score!.toFixed(1)}, at or above the threshold ${RULE_THRESHOLD.toFixed(1)}, so flagged.`,
          ),
          ...(h.temporal ? [`${h.temporal}.`] : []),
          tr(`지지 근거: ${join(h.support)}.`, `Supporting evidence: ${join(h.support)}.`),
          ...(h.against.length ? [tr(`반대 근거: ${join(h.against)}.`, `Against: ${join(h.against)}.`)] : []),
          ...(h.missing.length ? [tr(`없는 근거: ${join(h.missing)}.`, `Missing evidence: ${join(h.missing)}.`)] : []),
          ...(others.length
            ? [tr(
                `함께 해당한 범주: ${others.map(o => `${causeName(o.cause)} (${o.score!.toFixed(1)})`).join(', ')}.`,
                `Also flagged: ${others.map(o => `${causeName(o.cause)} (${o.score!.toFixed(1)})`).join(', ')}.`,
              )]
            : []),
          ...(h.guide.filter(g => g.cite !== '근거 공백').slice(0, 1).map(g => tr(`근거 위키의 진단 기준: ${g.text} (${g.cite}).`, `Diagnostic criteria in the evidence wiki: ${g.text} (${g.cite}).`))),
        ],
        sources: [
          agentSrc(3, c.sim.target!.detectAt),
          ...h.support.filter(e => e.ref).slice(0, 4).map(e => caseSrc(c.cs, e.ref!)),
          { kind: 'doc', label: tr(`근거 위키 · ${CAUSE_WIKI[h.cause].title}`, `Evidence wiki · ${CAUSE_WIKI[h.cause].title}`), wiki: CAUSE_WIKI[h.cause].page },
        ],
      }
    },
  },
  {
    id: 'recover', kind: '환자',
    q: c => (isAfter(c.cs.icuOut, c.clock)
      ? tr('지금 퇴실하면 회복으로 볼 수 있나요?', 'If discharged now, would this count as recovered?')
      : tr('퇴실 때 회복으로 판정됐나요?', 'Was this called recovered at ICU discharge?')),
    keys: [['회복', '미회복', 'recover'], ['환자', '지금', '퇴실', '판정', 'patient', 'discharg', 'call', 'judg']],
    when: c => isKnown(c.sim.target, c.clock),
    notYet: bi('5배 사건이 없어 회복을 판정할 대상이 아닙니다.', 'No 5× event, so the patient is not eligible for a recovery call.'),
    answer: c => {
      const out = !isAfter(c.cs.icuOut, c.clock)
      const at = out ? c.cs.icuOut : c.clock
      const { judged, last, notRemeasured } = recoveryAt(c.cs, c.sim.target!, at)
      const over = last.filter(r => r.value >= K_RECOVER * uln(c.cs, r.code))
      const name = (r: LabResult) => short(itemOf(c.cs, r.code).name)
      const notRe = notRemeasured.map(code => short(itemOf(c.cs, code).name)).join(', ')
      const verdict = !judged
        ? tr(
            `5배 사건 뒤 다시 재지 않은 항목: ${notRe}. ${out ? '판정 불가입니다' : '이대로 퇴실하면 판정 불가입니다'}.`,
            `Not re-measured after the 5× event: ${notRe}. ${out ? 'Not assessable' : 'If discharged as is, not assessable'}.`,
          )
        : over.length
          ? tr(
              `아직 2배 이상인 항목: ${over.map(name).join(', ')}. ${out ? '미회복으로 판정했습니다' : '지금 퇴실하면 미회복입니다'}.`,
              `Still at or above 2×: ${over.map(name).join(', ')}. ${out ? 'Called not recovered' : 'If discharged now, not recovered'}.`,
            )
          : tr(
              `세 항목 모두 2배 미만이라 ${out ? '회복으로 판정했습니다' : '지금 퇴실하면 회복입니다'}.`,
              `All three are below 2×, so ${out ? 'called recovered' : 'discharge now would count as recovered'}.`,
            )
      const lastList = last.map(r => `${name(r)} ${fmtNum(r.value, itemOf(c.cs, r.code).dp)} (${(r.value / uln(c.cs, r.code)).toFixed(1)}${tr('배', '×')}, ${md(r.charttime)})`).join(', ')
      return {
        text: [
          tr(
            '회복은 ICU 퇴실 때 마지막 ALT, ALP, 총빌리가 모두 기록 상한의 2배 미만인 경우입니다. 5배 사건 뒤 세 항목 중 다시 재지 않은 항목이 있으면 판정 불가입니다.',
            'Recovered means the last ALT, ALP and total bilirubin at ICU discharge are all below 2× the recorded ULN. If any of the three was not re-measured after the 5× event, the call is not assessable.',
          ),
          tr(`${out ? '퇴실 때' : '지금'} 마지막 값: ${lastList}.`, `Last values ${out ? 'at ICU discharge' : 'now'}: ${lastList}.`),
          verdict,
        ],
        sources: [doc(pick(DOCS.spec)), ...last.map(r => labSrc(c.cs, r))],
      }
    },
  },
]

/** 치료 결정을 묻는 낱말 (정해 둔 질문에 없을 때) */
const DECISION = ['끊어야', '중단해야', '투여해야', '써야', '줘야', '올려야', '줄여야', '바꿔야', '처방']
/**
 * 영어로 치료 결정을 묻는 말 (띄어쓰기를 살린 소문자 질문에서 찾음). 'When did … start?' 같은 사실 질문은 걸리지 않게
 * 행동 낱말은 질문 첫머리 (명령) 나 'can we / is it safe to' 뒤에 올 때만 결정 질문으로 봄
 */
const ACT = '(stop|discontinue|start|give|increase|decrease|titrate|wean|hold|prescribe|switch|change)'
const DECISION_EN = new RegExp(
  `\\bshould (i|we|you|the patient)\\b|\\b(do|does) (i|we|he|she|the patient) need\\b|^(please )?${ACT}\\b|\\b(can|could|may) (i|we) ${ACT}\\b|\\bis it (ok|okay|safe|necessary) to\\b|\\bwhat dose should\\b`,
)

/** 근거 위키로 답하는 지식 질문 (누르면 그대로 검색). 위키와 검색이 한국어라 검색은 한국어 질문으로 함 */
const KNOWLEDGE_BI: Bi[] = [
  bi('R 비는 어떻게 해석하나요?', 'How is the R ratio interpreted?'),
  bi('Hypoxic hepatitis 는 어떻게 판단하나요?', 'How is hypoxic hepatitis diagnosed?'),
  bi('패혈증 담즙정체는 어떤 기준으로 보나요?', 'What defines sepsis-associated cholestasis?'),
  bi('DILI 는 어떤 기준으로 정의하나요?', 'How is DILI defined?'),
  bi('담낭염 진단 근거가 위키에 있나요?', 'Does the wiki cover cholecystitis diagnosis?'),
]
export const KNOWLEDGE = KNOWLEDGE_BI.map(b => b.ko)

/** 위키 검색에 보낼 질문. 정해 둔 지식 질문의 영어 문구는 한국어 질문으로 되돌림 */
export function wikiQuery(q: string): string {
  return KNOWLEDGE_BI.find(b => b.en === q.trim())?.ko ?? q
}

/** 이 환자를 묻는 말. 정해 둔 환자 질문에 맞지 않으면 위키로 보내지 않고 답할 수 있는 것을 알려 줌 */
const PATIENT = ['이환자', '이사람', '지금', '현재', 'thispatient', 'thepatient', 'rightnow', 'currently']

/** 지금 물을 수 있는 질문: 이 환자 (정해 둔 것 중 지금 답할 수 있는 것) 와 지식 */
export function suggestions(c: QaCtx) {
  return [
    ...QA.filter(d => d.when(c)).map(d => ({ id: d.id, kind: d.kind, q: d.q(c) })),
    ...KNOWLEDGE_BI.map((q, i) => ({ id: `wiki:${i}`, kind: '지식' as const, q: pick(q) })),
  ]
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '')

export type Route = { type: 'case'; msg: Omit<QaMsg, 'id'> } | { type: 'wiki'; q: string }

/**
 * 질문이 어디서 답할 것인지 고른다. 이 환자 질문은 여기서 바로 답을 만들고 (case),
 * 지식 질문은 위키 검색으로 보낸다 (wiki). id 는 제안 질문을 누른 경우.
 * 지식 질문의 q 는 화면에 보이는 문구이고, 검색은 wikiQuery(q) 로 한국어 질문을 씀 (data/rag.ts).
 */
export function route(c: QaCtx, input: { id: string } | { text: string }): Route {
  const base = { clock: c.clock }
  if ('id' in input) {
    if (input.id.startsWith('wiki:')) return { type: 'wiki', q: pick(KNOWLEDGE_BI[Number(input.id.slice(5))]) }
    const d = QA.find(x => x.id === input.id)!
    return { type: 'case', msg: { ...base, q: d.q(c), kind: d.kind, answer: { ...d.answer(c), mode: 'case' } } }
  }
  const q = input.text.trim()
  const t = norm(q)
  const d = QA.find(x => x.keys.every(group => group.some(k => t.includes(norm(k)))))
  if (d) {
    const answer: QaAnswer = d.when(c) ? { ...d.answer(c), mode: 'case' } : { text: [pick(d.notYet)], sources: [], status: 'notFound', mode: 'case' }
    return { type: 'case', msg: { ...base, q, kind: d.kind, answer } }
  }
  if (DECISION.some(k => t.includes(k)) || DECISION_EN.test(q.toLowerCase())) {
    return {
      type: 'case',
      msg: {
        ...base, q, kind: null,
        answer: {
          status: 'refused', sources: [],
          text: [tr('치료나 약 결정은 답하지 않습니다. 관련 근거는 에이전트 결과와 원자료 탭에서 확인할 수 있습니다.', 'Treatment and drug decisions are not answered. The relevant evidence is in the agent results and the source-record tabs.')],
        },
      },
    }
  }
  if (PATIENT.some(k => t.includes(k))) {
    const can = QA.filter(x => x.when(c)).map(x => x.q(c))
    return {
      type: 'case',
      msg: {
        ...base, q, kind: '환자',
        answer: {
          status: 'notFound', sources: [], mode: 'case',
          text: [
            tr('이 환자 질문은 사례 자료로 계산할 수 있는 것만 답합니다. 근거 없이 답하지 않습니다.', 'Patient questions are answered only when they can be computed from the case record. No answer is given without evidence.'),
            tr(`지금 답할 수 있는 질문: ${can.join(' / ')}`, `Questions answerable now: ${can.join(' / ')}`),
          ],
        },
      },
    }
  }
  return { type: 'wiki', q }
}
