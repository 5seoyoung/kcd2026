// 질의응답 (RAG). EMR 화면의 의료진 질문에 답한다 (docs 0-7).
// 이 환자 질문은 기준 시각까지의 사례 자료와 에이전트 출력으로 여기서 계산하고,
// 지식 질문은 근거 위키 (wiki_kb) 를 검색해 답한다 (data/rag.ts). 둘을 섞지 않고 답마다 출처를 붙인다.
// 근거가 없으면 답하지 않고, 치료나 약 중단 결정은 답하지 않는다.
import type { AgentRun, CaseData, CauseCall, LabResult, QaAnswer, QaMsg, QaSource, Ref } from '../types'
import type { Sim } from '.'
import { CAUSE_WIKI, causeName } from './causes'
import { activeAt, isKnown, itemOf, K_RECOVER, recoveryAt, RULE_THRESHOLD, seriesAt, uln } from '../lib/events'
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
  notYet: string
  answer: (c: QaCtx) => QaAnswer
}

const DOCS = {
  spec: '프로젝트 명세서: 사건과 회복 정의',
}

const TAB_NAME: Record<Ref['tab'], string> = { lab: '검사결과', mar: '투약기록', vital: '활력징후', micro: '미생물', proc: '영상·처치' }
const VITAL_NAME: Record<string, string> = { map: 'MAP', hr: '심박수', spo2: 'SpO2', cvp: 'CVP', bt: '체온', rr: '호흡수', sbp: '수축기 혈압', dbp: '이완기 혈압' }
const PRESSOR_NAME: Record<string, string> = { Norepinephrine: '노르에피네프린', Vasopressin: '바소프레신', Epinephrine: '에피네프린', Dopamine: '도파민', Phenylephrine: '페닐에프린' }

const short = (name: string) => name.split(' (')[0]
const pct = (p: number) => `${Math.round(p * 100)}%`
const doc = (label: string): QaSource => ({ kind: 'doc', label })

/** 원자료 위치를 사람이 읽는 이름으로 */
function refLabel(cs: CaseData, ref: Ref): string {
  let what = ref.row
  if (ref.tab === 'lab') {
    const r = cs.labs.find(x => x.id === ref.col)
    what = `${short(itemOf(cs, ref.row).name)}${r ? ` ${mdhm(r.charttime)}` : ''}`
  } else if (ref.tab === 'mar') what = cs.mar.find(o => o.id === ref.row)?.drug ?? ref.row
  else if (ref.tab === 'vital') what = `${VITAL_NAME[ref.row] ?? ref.row}${ref.from ? ` ${mdhm(ref.from)}${ref.to && ref.to !== ref.from ? `~${hm(ref.to)}` : ''}` : ''}`
  else if (ref.tab === 'micro') {
    const m = cs.micro.find(x => x.id === ref.row)
    what = m ? `${m.test} (${m.specimen})` : ref.row
  } else what = cs.procs.find(p => p.id === ref.row)?.name ?? cs.missing.find(m => m.id === ref.row)?.name ?? ref.row
  return `${TAB_NAME[ref.tab]} · ${what}`
}

const caseSrc = (cs: CaseData, ref: Ref): QaSource => ({ kind: 'case', label: refLabel(cs, ref), ref })
const labSrc = (cs: CaseData, r: LabResult) => caseSrc(cs, { tab: 'lab', row: r.code, col: r.id })

const hits = (c: QaCtx): CauseCall[] =>
  (c.run?.calls ?? []).filter(x => x.score !== null && x.score >= RULE_THRESHOLD).sort((a, b) => b.score! - a.score!)

const pressors = (cs: CaseData) => cs.mar.filter(o => PRESSOR_NAME[o.drug])

const QA: QaDef[] = [
  {
    id: 'amio-stop', kind: '환자',
    q: () => '아미오다론을 끊어야 하나요?',
    keys: [['아미오다론', 'amiodarone'], ['끊', '중단', '바꿔', '써야', '줄여', '계속']],
    when: c => !isAfter(c.cs.mar.find(o => o.id === 'AMIO')?.start ?? '9999-12-31 00:00', c.clock),
    notYet: '투약기록에 아미오다론 투여가 아직 없습니다.',
    answer: c => {
      const o = c.cs.mar.find(x => x.id === 'AMIO')!
      const on = activeAt(o, c.clock)
      const stop = o.admins.find(a => a.status === 'stopped' && !isAfter(a.time, c.clock))
      const dili = c.run?.calls.find(x => x.cause === 4)
      return {
        status: 'refused',
        text: [
          '치료나 약 중단 결정은 답하지 않습니다. 판단에 쓸 근거만 정리합니다.',
          `아미오다론: ${mdhm(o.start)} 정맥 부하 뒤 지속 주입, 지금 ${on ? '투여 중' : stop ? `${mdhm(stop.time)} 중단` : '투여 기록 없음'}.`,
          dili && dili.score !== null
            ? `원인 추정 결과 DILI: 규칙 점수 ${dili.score.toFixed(1)}, ${dili.score >= RULE_THRESHOLD ? '기준 이상이라 해당' : '기준 미만이라 해당 없음'}. 반대 근거: ${dili.against.map(e => e.text).join('; ')}.`
            : '원인 추정은 아직 실행 전입니다.',
          '아미오다론의 간독성은 지식 질문으로 근거 위키에서 찾아볼 수 있습니다.',
        ],
        sources: [caseSrc(c.cs, { tab: 'mar', row: 'AMIO' }), ...(dili ? [{ kind: 'agent' as const, label: `에이전트 3 출력 · ${mdhm(c.sim.first!.detectAt)}` }] : [])],
      }
    },
  },
  {
    id: 'alt', kind: '환자',
    q: () => 'ALT 가 어떻게 변해 왔나요?',
    keys: [['alt', 'gpt', '간수치'], ['추이', '경과', '변화', '변해', '흐름']],
    when: c => seriesAt(c.cs, 'ALT', c.clock).length > 0,
    notYet: '아직 공개된 ALT 결과가 없습니다.',
    answer: c => {
      const rs = seriesAt(c.cs, 'ALT', c.clock)
      const u = uln(c.cs, 'ALT')
      const show = rs.slice(-5)
      const last = rs.at(-1)!
      const prev = rs.at(-2)
      let tail = `가장 최근 값: ${fmtNum(last.value, 0)} (기록 상한 ${u} 의 ${(last.value / u).toFixed(1)}배).`
      if (prev) {
        const ratio = last.value / prev.value
        const dir = ratio >= 1.05 ? `${ratio.toFixed(1)}배로 올랐습니다` : ratio <= 0.95 ? `${Math.round((1 - ratio) * 100)}% 내렸습니다` : '거의 같습니다'
        tail += ` 직전 값보다 ${dir} (${Math.round(hoursBetween(prev.charttime, last.charttime))}시간 간격).`
      }
      return {
        text: [
          `${mdhm(c.clock)} 까지 공개된 ALT 는 ${rs.length}건입니다.${rs.length > show.length ? ` 최근 ${show.length}건:` : ''}`,
          show.map(r => `${mdhm(r.charttime)} ${fmtNum(r.value, 0)}${r.value >= 2 * u ? ` (${(r.value / u).toFixed(1)}배)` : ''}`).join(' → '),
          tail,
        ],
        sources: rs.slice(-3).map(r => labSrc(c.cs, r)),
      }
    },
  },
  {
    id: 'pressor', kind: '환자',
    q: () => '지금 쓰고 있는 승압제는?',
    keys: [['승압제', '노르에피', '바소프레신', 'norepinephrine', 'vasopressin', '혈압약'], ['지금', '쓰고', '쓰는', '투여', '현재', '환자']],
    when: () => true,
    notYet: '',
    answer: c => {
      const started = pressors(c.cs).filter(o => !isAfter(o.start, c.clock))
      const on = started.filter(o => activeAt(o, c.clock))
      const off = started.filter(o => !activeAt(o, c.clock))
      const vit = c.cs.vitals.filter(v => !isAfter(v.time, c.clock)).at(-1)
      const text: string[] = []
      if (!started.length) text.push('투약기록에 승압제 투여가 없습니다.')
      else if (on.length)
        text.push(`투여 중: ${on.map(o => {
          const r = rateAt(o, c.clock)
          return `${PRESSOR_NAME[o.drug]} ${r ? `${r.toFixed(2)} ${o.freq}` : o.dose} (${mdhm(o.start)} 시작)`
        }).join(', ')}.`)
      else text.push('지금 투여 중인 승압제는 없습니다.')
      if (off.length) text.push(`중단: ${off.map(o => `${PRESSOR_NAME[o.drug]} ${mdhm(o.admins.filter(a => a.status === 'stopped' && !isAfter(a.time, c.clock)).at(-1)!.time)}`).join(', ')}.`)
      if (vit) text.push(`최근 MAP ${vit.map} mmHg (${mdhm(vit.time)}).`)
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
    q: () => '발생 예측 확률은 왜 이렇게 나왔나요?',
    keys: [['발생예측', '확률', '경보']],
    when: c => c.sim.a1.points.some(p => !isAfter(p.time, c.clock)),
    notYet: '발생 예측 출력이 아직 없습니다. 첫 간 검사 결과가 공개되고 정상 구간이면 매시간 실행합니다.',
    answer: c => {
      const p = c.sim.a1.points.filter(x => !isAfter(x.time, c.clock)).at(-1)!
      const stopped = !!c.sim.a1.stop && !isAfter(c.sim.a1.stop, c.clock) && !!c.sim.first
      return {
        text: [
          `${mdhm(p.time)} 실행 결과, 24시간 안 5배 사건 확률은 ${pct(p.p)} 입니다 (경보 기준 ${pct(c.sim.a1.threshold)}).${stopped ? ' 첫 이상이 공개되어 에이전트가 멈췄고, 이것이 마지막 출력입니다.' : ''}`,
          `많이 기여한 입력: ${p.factors.slice(0, 3).map(f => `${f.name} ${f.value}`).join(', ')}.`,
          '확률은 원인이나 진단이 아닙니다.',
        ],
        sources: [{ kind: 'agent', label: `에이전트 1 출력 · ${mdhm(p.time)}` }],
      }
    },
  },
  {
    id: 'cause', kind: '환자',
    q: c => `왜 ${causeName(hits(c)[0]?.cause ?? 1)} 에 해당하나요?`,
    keys: [['왜', '이유'], ['해당', '원인', '범주', 'hypoxic', '허혈', 'congestive', '울혈']],
    when: c => hits(c).length > 0,
    notYet: '아직 원인 추정 결과가 없습니다. 첫 이상 (2배 사건) 이 공개되면 한 번 실행합니다.',
    answer: c => {
      const [h, ...others] = hits(c)
      return {
        text: [
          `원인 추정 (${mdhm(c.sim.first!.detectAt)} 실행) 결과 ${causeName(h.cause)}: 규칙 점수 ${h.score!.toFixed(1)}, 기준 ${RULE_THRESHOLD.toFixed(1)} 이상이라 해당.`,
          ...(h.temporal ? [`${h.temporal}.`] : []),
          `지지 근거: ${h.support.map(e => e.text).join('; ')}.`,
          ...(h.against.length ? [`반대 근거: ${h.against.map(e => e.text).join('; ')}.`] : []),
          ...(h.missing.length ? [`없는 근거: ${h.missing.map(e => e.text).join('; ')}.`] : []),
          ...(others.length ? [`함께 해당한 범주: ${others.map(o => `${causeName(o.cause)} (${o.score!.toFixed(1)})`).join(', ')}.`] : []),
          ...(h.guide.filter(g => g.cite !== '근거 공백').slice(0, 1).map(g => `근거 위키의 진단 기준: ${g.text} (${g.cite}).`)),
        ],
        sources: [
          { kind: 'agent', label: `에이전트 3 출력 · ${mdhm(c.sim.first!.detectAt)}` },
          ...h.support.filter(e => e.ref).slice(0, 4).map(e => caseSrc(c.cs, e.ref!)),
          { kind: 'doc', label: `근거 위키 · ${CAUSE_WIKI[h.cause].title}`, wiki: CAUSE_WIKI[h.cause].page },
        ],
      }
    },
  },
  {
    id: 'recover', kind: '환자',
    q: c => (isAfter(c.cs.icuOut, c.clock) ? '지금 퇴실하면 회복으로 볼 수 있나요?' : '퇴실 때 회복으로 판정됐나요?'),
    keys: [['회복', '미회복'], ['환자', '지금', '퇴실', '판정']],
    when: c => isKnown(c.sim.first, c.clock),
    notYet: '첫 이상 (2배 사건) 이 없어 회복을 판정할 대상이 아닙니다.',
    answer: c => {
      const out = !isAfter(c.cs.icuOut, c.clock)
      const at = out ? c.cs.icuOut : c.clock
      const { judged, last, notRemeasured } = recoveryAt(c.cs, c.sim.first!, at)
      const over = last.filter(r => r.value >= K_RECOVER * uln(c.cs, r.code))
      const name = (r: LabResult) => short(itemOf(c.cs, r.code).name)
      const verdict = !judged
        ? `첫 이상 뒤 다시 재지 않은 항목: ${notRemeasured.map(code => short(itemOf(c.cs, code).name)).join(', ')}. ${out ? '판정 불가입니다' : '이대로 퇴실하면 판정 불가입니다'}.`
        : over.length
          ? `아직 2배 이상인 항목: ${over.map(name).join(', ')}. ${out ? '미회복으로 판정했습니다' : '지금 퇴실하면 미회복입니다'}.`
          : `세 항목 모두 2배 미만이라 ${out ? '회복으로 판정했습니다' : '지금 퇴실하면 회복입니다'}.`
      return {
        text: [
          '회복은 ICU 퇴실 때 마지막 ALT, ALP, 총빌리가 모두 기록 상한의 2배 미만인 경우입니다. 첫 이상 뒤 세 항목 중 다시 재지 않은 항목이 있으면 판정 불가입니다.',
          `${out ? '퇴실 때' : '지금'} 마지막 값: ${last.map(r => `${name(r)} ${fmtNum(r.value, itemOf(c.cs, r.code).dp)} (${(r.value / uln(c.cs, r.code)).toFixed(1)}배, ${md(r.charttime)})`).join(', ')}.`,
          verdict,
        ],
        sources: [doc(DOCS.spec), ...last.map(r => labSrc(c.cs, r))],
      }
    },
  },
]

/** 치료 결정을 묻는 낱말 (정해 둔 질문에 없을 때) */
const DECISION = ['끊어야', '중단해야', '투여해야', '써야', '줘야', '올려야', '줄여야', '바꿔야', '처방']

/** 근거 위키로 답하는 지식 질문 (누르면 그대로 검색) */
export const KNOWLEDGE = [
  'R 비는 어떻게 해석하나요?',
  'Hypoxic hepatitis 는 어떻게 판단하나요?',
  '패혈증 담즙정체는 어떤 기준으로 보나요?',
  'DILI 는 어떤 기준으로 정의하나요?',
  '담낭염 진단 근거가 위키에 있나요?',
]

/** 이 환자를 묻는 말. 정해 둔 환자 질문에 맞지 않으면 위키로 보내지 않고 답할 수 있는 것을 알려 줌 */
const PATIENT = ['이환자', '이사람', '지금', '현재']

/** 지금 물을 수 있는 질문: 이 환자 (정해 둔 것 중 지금 답할 수 있는 것) 와 지식 */
export function suggestions(c: QaCtx) {
  return [
    ...QA.filter(d => d.when(c)).map(d => ({ id: d.id, kind: d.kind, q: d.q(c) })),
    ...KNOWLEDGE.map((q, i) => ({ id: `wiki:${i}`, kind: '지식' as const, q })),
  ]
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '')

export type Route = { type: 'case'; msg: Omit<QaMsg, 'id'> } | { type: 'wiki'; q: string }

/**
 * 질문이 어디서 답할 것인지 고른다. 이 환자 질문은 여기서 바로 답을 만들고 (case),
 * 지식 질문은 위키 검색으로 보낸다 (wiki). id 는 제안 질문을 누른 경우.
 */
export function route(c: QaCtx, input: { id: string } | { text: string }): Route {
  const base = { clock: c.clock }
  if ('id' in input) {
    if (input.id.startsWith('wiki:')) return { type: 'wiki', q: KNOWLEDGE[Number(input.id.slice(5))] }
    const d = QA.find(x => x.id === input.id)!
    return { type: 'case', msg: { ...base, q: d.q(c), kind: d.kind, answer: { ...d.answer(c), mode: 'case' } } }
  }
  const q = input.text.trim()
  const t = norm(q)
  const d = QA.find(x => x.keys.every(group => group.some(k => t.includes(norm(k)))))
  if (d) {
    const answer: QaAnswer = d.when(c) ? { ...d.answer(c), mode: 'case' } : { text: [d.notYet], sources: [], status: 'notFound', mode: 'case' }
    return { type: 'case', msg: { ...base, q, kind: d.kind, answer } }
  }
  if (DECISION.some(k => t.includes(k))) {
    return {
      type: 'case',
      msg: {
        ...base, q, kind: null,
        answer: { status: 'refused', sources: [], text: ['치료나 약 결정은 답하지 않습니다. 관련 근거는 에이전트 결과와 원자료 탭에서 확인할 수 있습니다.'] },
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
          text: ['이 환자 질문은 사례 자료로 계산할 수 있는 것만 답합니다. 근거 없이 답하지 않습니다.', `지금 답할 수 있는 질문: ${can.join(' / ')}`],
        },
      },
    }
  }
  return { type: 'wiki', q }
}
