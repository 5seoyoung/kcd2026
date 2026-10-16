// 에이전트 3 (원인 추정) 실행 기록. 모델 패키지의 원인 규칙 (rule_agent.py, 학습 없음) 을 첫 이상 시점의
// 48시간 스냅숏에 적용한 출력 (model-bridge → model/<사례>.json) 을 화면 형식으로 바꾸고, 범주마다 근거 위키의 지침 근거를 붙인다.
// 점수와 인용 근거는 규칙 모델 출력 그대로이고, 여기서 바꾸지 않는다. 도구 호출 단계 문장, 의심 약제 표, 확신 표시는 자료에서 계산한다.
import type { AgentRun, AgentStep, CaseData, CauseCall, Evidence, GuideLine, SuspectDrug } from '../types'
import { CASES } from './cases'
import { CAUSE_WIKI, causeName, EVIDENCE_MAP } from './causes'
import { CAUSE_NO, evidenceOf, model1Of, modelRun } from './modelrun'
import { firstEvent, K_FIRST, reported, RULE_THRESHOLD, rRatio, sameDraw, uln } from '../lib/events'
import { fmtNum } from '../lib/lab'
import { addHours, hm, hoursBetween, isAfter, mdhm } from '../lib/time'

/** rule_agent.py 의 간독성 약 목록 (이름에 들어 있으면 해당) */
const HEPATOTOXIC = ['acetaminophen', 'ceftriaxone', 'amoxicillin', 'clavulanate', 'piperacillin', 'isoniazid', 'rifampin',
  'valpro', 'phenytoin', 'amiodarone', 'azithromycin', 'fluconazole', 'voriconazole', 'ketoconazole',
  'methotrexate', 'atorvastatin', 'simvastatin', 'allopurinol', 'carbamazepine', 'nitrofurantoin',
  'sulfamethoxazole', 'trimethoprim', 'oxacillin', 'nafcillin', 'tmp', 'linezolid', 'propofol']
const PRESSORS = ['norepinephrine', 'epinephrine', 'vasopressin', 'phenylephrine', 'dopamine']
const KO: Record<string, string> = { norepinephrine: '노르에피네프린', epinephrine: '에피네프린', vasopressin: '바소프레신', phenylephrine: '페닐에프린', dopamine: '도파민' }

// 근거 위키 (wiki_kb) 의 '원인 10개 근거 지도' 에서 범주마다 옮긴 지침 근거와 근거 공백. 문장과 인용은 위키 그대로
const g = (cause: number, text: string, cite: string): GuideLine => ({ text, cite, page: EVIDENCE_MAP, heading: CAUSE_WIKI[cause].section })
const gap = (cause: number, text: string): GuideLine => g(cause, text, '근거 공백')
const GUIDE: Record<number, GuideLine[]> = {
  1: [
    g(1, '진단 세 기준: 심장·순환·호흡 부전의 임상 상황, 현저하지만 일시적인 aminotransferase 상승, 바이러스·약물 원인 배제', 'HH review p.3'),
    g(1, '기준값은 연구마다 다릅니다. Henrion은 20×ULN, 다른 연구는 2.5-10×ULN을 썼습니다', 'HH review p.1'),
    g(1, 'aminotransferase는 손상 사건 12-24시간 뒤 오르고, 24시간 안에 정점에 이르며 24-72시간에 절반 정도로 떨어집니다', 'Fuhrmann 2011 p.6; HH review p.2-3'),
  ],
  2: [
    g(2, '급성 심부전은 ALP, GGT, ALT, AST, 빌리루빈 모두의 혼합형 이상을 일으킬 수 있고, 가장 중요한 결정 인자는 높은 중심정맥압과 간 관류 감소입니다', 'Jenniskens 2016 p.2'),
    gap(2, '진단 기준(점수나 필수 소견 조합), BNP·NT-proBNP 역치, 중심정맥압 같은 혈역학 역치는 위키에 없습니다'),
  ],
  3: [
    g(3, '통일된 정의는 없지만 실무 기준은 총빌리루빈 >2 mg/dL 또는 >2-3 mg/dl이고, 다른 연구는 ALP·GGT 2-3배 상승을 씁니다', 'Horvatits 2019 p.2-3; Jenniskens 2016 p.2'),
    g(3, '패혈증 담즙정체에서 빌리루빈은 주로 직접형이고 AST·ALT는 대개 정상입니다', 'Xu 2025 p.2'),
  ],
  4: [
    g(4, '생화학 기준: AST/ALT >5×ULN 또는 ALP >2×ULN을 24시간 이상 간격으로 두 번, 또는 빌리루빈 >2.5 mg/dl·INR >1.5와 효소 상승', 'AASLD DILI p.5, p.9'),
    g(4, 'ICU의 DILI 발생률 자료는 없고, HLI와 중증 질환 담즙정체 같은 더 흔한 원인을 먼저 배제해야 합니다', 'Horvatits 2019 p.6'),
  ],
  5: [
    g(5, '장관영양 부재와 PN 지질 투여가 중증 질환 담즙정체에 기여한다고 여겨지며, TPN은 신규 담즙정체의 전형적 위험인자입니다', 'Jenniskens 2016 p.6; Horvatits 2019 p.4'),
    gap(5, 'PN 노출 기간·용량 기준과 PN 관련 간 기능 이상의 진단 기준은 위키에 없습니다'),
  ],
  6: [
    g(6, '우상복부 초음파로 담관 확장을 보고, 확장되었거나 담관염 병력이 있으면 MRCP·ERCP로 진행합니다', 'ACG 2017 p.14, p.16'),
    gap(6, '영상 없이 쓸 수 있는 급성 담관염 진단 기준과 중증도 기준(TG18)은 위키에 없습니다'),
  ],
  7: [
    g(7, '우상복부 압통과 Murphy 징후 양성이 시사할 수 있다', 'ACG 2017 p.11'),
    gap(7, '급성 담낭염 진단 기준(TG18), 무결석 담낭염 진단 기준, 구조화 자료(검사·활력징후)만으로 판단할 근거가 위키에 없습니다'),
  ],
  8: [
    g(8, '비포합형 빌리루빈 상승의 원인이며 합토글로빈 감소, 망상적혈구·LDH 증가를 볼 수 있습니다', 'ACG 2017 p.15'),
    g(8, '용혈과 수혈은 ICU 빌리루빈 해석을 흐립니다', 'Jenniskens 2016 p.2'),
  ],
  9: [
    g(9, 'ACG 권고: anti-HCV와 HCV RNA, HBsAg와 IgM anti-HBc, IgM HAV, IgM HEV', 'ACG 2017 p.2'),
    g(9, 'HH 진단 전 특히 HSV 감염을 배제해야 합니다', 'Henrion 2007 p.1'),
  ],
  10: [
    g(10, '횡문근융해와 열사병은 심한 AST 상승을 일으킬 수 있습니다', 'ACG 2017 p.12'),
    g(10, 'AASLD는 CPK로 횡문근융해를 감별합니다', 'AASLD DILI p.8'),
  ],
}

/** 규칙이 그 범주를 보는 조건 (rule_agent.py 그대로 요약). 점수가 없을 때 왜 없는지 읽을 수 있게 */
const RULE: Record<number, string> = {
  1: 'AST·ALT 최고가 5×ULN 이상일 때만 셈: 배수 (10× 이상 1, 5× 이상 0.5) + MAP 65 미만 1 + 젖산 (4 이상 1, 2 이상 0.5) + 승압제 주입 1',
  2: '간 검사 상승 (2× 이상) 과 함께 심부전 과거력 1.2 또는 NT-proBNP 가 나이별 기준 이상 1',
  3: '담즙정체 패턴 (총빌리 2× 이상, 또는 ALP 2× 이상이고 R 2 이하) 일 때 0.5 + 전신 염증 (WBC, 발열) 각 0.5 + 혈소판 100 미만 0.5 + 승압제 0.5',
  4: '48시간 안 간독성 목록의 약 투여 기록, 최근 두 가지까지 각 0.9',
  5: '정맥영양 노출 일수 (7일 이상 1, 3일 이상 0.5) + 담즙정체·혼합 패턴 0.5',
  6: 'TG18 의심 수준: 담즙정체 (총빌리 2 mg/dL 이상 또는 ALP·GGT·AST·ALT 1.5× 초과) 와 전신 염증이 함께 있으면 0.5씩',
  7: '국소 소견과 영상이 필요해 구조화 자료로는 판단하지 않음 (TG18)',
  8: '총빌리 1.5 mg/dL 이상일 때 간접 우세 1, 합토글로빈 30 미만 1, LDH 1.5× 이상 0.5, 혈색소 2 이상 감소 0.5',
  9: '간염 혈청 검사 양성 (활동성 1.5) 또는 만성 바이러스 간염 과거력 0.5',
  10: '근육 기원 (CK 5× 이상, AST ≥ 0.8×ALT) 1.5, 기저 간질환 과거력 1, 설명되지 않는 간세포형 1',
}

function buildRun(cs: CaseData): AgentRun | undefined {
  const run = modelRun(cs.id)
  const a3 = run?.a3
  const ev = firstEvent(cs, K_FIRST)
  if (!run || !a3 || !ev) return undefined
  if (run.first_event?.t0 !== ev.t0) {
    console.error(`${cs.id}: 모델 출력의 첫 이상 (${run.first_event?.t0}) 과 화면 정의 (${ev.t0}) 가 다릅니다. npm run models 로 다시 만드세요`)
    return undefined
  }
  const { t0, drawn } = ev
  const from48 = addHours(t0, -48)
  const inWin = (t: string) => !isAfter(t, t0) && !isAfter(from48, t)
  const x = (code: string) => {
    const r = sameDraw(cs, ev, code)
    return r ? r.value / uln(cs, code) : null
  }
  const f1 = (v: number | null) => (v === null ? '–' : v.toFixed(1))
  const R = rRatio(cs, ev)
  const amino = Math.max(x('ALT') ?? 0, x('AST') ?? 0)
  const vit = cs.vitals.filter(v => inWin(v.time))
  const mapMin = vit.length ? Math.min(...vit.map(v => v.map)) : null
  const lacs = cs.labs.filter(r => r.code === 'LAC' && reported(r, t0) && inWin(r.charttime))
  const lacMax = lacs.length ? Math.max(...lacs.map(r => r.value)) : null
  const pressors = cs.mar
    .filter(o => PRESSORS.some(p => o.drug.toLowerCase() === p) && o.admins.some(a => a.status === 'given' && inWin(a.time)))
    .map(o => {
      const rates = o.admins.filter(a => !isAfter(a.time, t0) && a.rate).map(a => a.rate!)
      return `${KO[o.drug.toLowerCase()]}${rates.length ? ` 최대 ${Math.max(...rates)}` : ''}`
    })
  // 간독성 목록의 약 가운데 48시간 안 투여 기록 (지속 주입은 규칙이 보지 않음)
  const hepato = cs.mar.filter(o => !o.infusion && HEPATOTOXIC.some(h => o.drug.toLowerCase().includes(h)))
    .map(o => ({ o, given: o.admins.filter(a => a.status === 'given' && inWin(a.time)) }))
    .filter(d => d.given.length)

  const calls: CauseCall[] = Object.entries(a3.flags)
    .map(([code, f]) => {
      const cause = CAUSE_NO[code]
      return {
        cause,
        score: f.assessable ? f.score : null,
        rule: RULE[cause],
        support: f.support.map(s => evidenceOf(cs, s)),
        against: (f.assessable ? f.against : []).map<Evidence>(text => ({ text })),
        missing: f.assessable ? [] : f.against.map<Evidence>(text => ({ text })),
        guide: GUIDE[cause],
      }
    })
    .sort((a, b) => a.cause - b.cause)
  const hits = calls.filter(c => c.score !== null && c.score >= RULE_THRESHOLD).sort((a, b) => b.score! - a.score!)
  const score = (cause: number) => calls.find(c => c.cause === cause)!.score
  // 과거력 근거 (이전 입원 진단) 는 이번 입원 원자료 탭에 없으므로 대조에서 따로 셈
  const rawSupports = Object.values(a3.flags).flatMap(f => f.support)
  const histN = rawSupports.filter(s => (s.analyte_or_label ?? '').startsWith('history_')).length
  const supports = calls.flatMap(c => c.support).filter(s => !/이전 입원/.test(s.text))
  const matched = supports.filter(s => s.ref).length
  const m1 = model1Of(run)
  const missingCore = /최근 측정 없음/.test(a3.uncertainty)
  const diliCited = new Set(a3.flags.dili?.support.map(s => (s.analyte_or_label ?? '').toLowerCase()) ?? [])

  const steps: AgentStep[] = [
    {
      id: 's1', tool: 'build_snapshot', title: '사례 자료 만들기 (48시간 스냅숏)', ms: 900,
      summary: `t0 = ${mdhm(t0)} (${ev.item.name.split(' (')[0]} 공개 시각, 채혈 ${hm(drawn)}). t0 까지 공개된 기록만, 48시간 창`,
      details: [`검사 ${a3.snapshot.labs}종 (항목별 마지막 값), 활력징후·주입·투약 기록 ${a3.snapshot.context}건 (최근 150건까지)`],
    },
    {
      id: 's2', tool: 'detect_event', title: '사건 확인', ms: 600,
      summary: `${ev.item.name.split(' (')[0]} ${fmtNum(ev.result.value, ev.item.dp)} ${ev.item.unit}, 기록 상한 ${ev.item.high} 의 ${f1(ev.result.value / ev.item.high!)}배 (첫 이상) → ${ev.group}`,
      details: [ev.prev ? `직전 값 ${fmtNum(ev.prev.value, ev.item.dp)} (${mdhm(ev.prev.charttime)})` : '직전 48시간 안 같은 항목 값 없음', 'ICU 입실 전 같은 입원에서 2배 이상인 기록 없음 → 분석 대상'],
    },
    {
      id: 's3', tool: 'injury_pattern', title: '손상 패턴 (ACG 2017 R 비)', ms: 500,
      summary: `R 비 ${R === null ? '계산 불가' : R.toFixed(1)} → ${a3.pattern ?? '분류 불가'}. ALT ${f1(x('ALT'))}×, AST ${f1(x('AST'))}×, ALP ${f1(x('ALP'))}×, 총빌리 ${f1(x('TB'))}×ULN`,
    },
    {
      id: 's4', tool: 'snapshot_context', title: '스냅숏 속 혈역학·투약', ms: 800,
      summary: [
        mapMin !== null ? `MAP 최저 ${mapMin}` : 'MAP 기록 없음',
        pressors.length ? pressors.join(', ') : '승압제 없음',
        lacMax !== null ? `젖산 최고 ${fmtNum(lacMax, 1)}` : '젖산 측정 없음',
        hepato.length ? `간독성 목록의 약 ${hepato.map(d => d.o.drug).join(', ')}` : '간독성 목록의 약 없음',
      ].join('. '),
    },
    {
      id: 's5', tool: 'rule_agent', title: `원인 규칙 (${a3.model})`, ms: 1000,
      summary: `${RULE_THRESHOLD.toFixed(1)} 이상 ${hits.length}개: ${hits.map(c => `${causeName(c.cause)} ${c.score!.toFixed(1)}`).join(', ') || '없음'}. 담낭염은 판단 불가${a3.abstain ? '. 판단 보류' : ''}`,
      details: score(1) === 0 && amino < 5 ? [`Hypoxic hepatitis 0: 규칙은 AST·ALT 5×ULN 부터 보는데 첫 이상 때 최고 ${amino.toFixed(1)}×ULN`] : undefined,
    },
    {
      id: 's6', tool: 'query_wiki', title: '근거 위키 조회', ms: 900,
      summary: `범주마다 진단 기준과 근거 공백을 원인 10개 근거 지도에서 가져옴 (${Object.values(GUIDE).flat().length}줄, 원문 13편). 담낭염 진단 기준 (TG18) 은 위키에 없음`,
    },
    {
      id: 's7', tool: 'query_model1', title: '간 검사 이상 패턴 군집 (모델 1)', ms: 700,
      summary: m1 ? `${m1.cluster}, 확신도 ${m1.confidence.toFixed(2)}, 개발 사건의 ${Math.round(m1.share * 100)}%. 원인 판정에는 넣지 않음` : '군집 출력 없음',
    },
    {
      id: 's8', tool: 'verify_source', title: '원자료 대조', ms: 600,
      summary: `규칙이 인용한 근거 ${supports.length}개 중 ${matched}개가 원자료 기록과 바로 이어짐${histN ? `, 과거력 ${histN}개는 이전 입원 진단` : ''}`,
    },
  ]

  const suspectDrugs: SuspectDrug[] = hepato.map(({ o, given }) => {
    const first = o.admins.find(a => a.status === 'given')!
    const h = hoursBetween(first.time, drawn)
    return {
      drug: `${o.drug} (${o.route})`,
      latency: h >= 24 ? `${(h / 24).toFixed(1)}일` : `${Math.max(0, h).toFixed(1)}시간`,
      last: mdhm(given.at(-1)!.time),
      cited: diliCited.has(o.drug.toLowerCase()),
      ref: { tab: 'mar', row: o.id },
    }
  })

  // 확인하면 좋을 검사: 규칙 결과에서 비었거나 '의심' 에 머문 범주를 따라
  const tests: { name: string; why: string }[] = []
  if (score(1) === 0 && amino >= 3 && amino < 5 && mapMin !== null && mapMin < 65) tests.push({ name: '12~24시간 뒤 AST, ALT, LDH 재측정', why: `저관류 (MAP 최저 ${mapMin}) 뒤 5×ULN 을 넘는지. 규칙은 5×ULN 부터 Hypoxic hepatitis 를 봄` })
  if (hits.some(c => c.cause === 6)) tests.push({ name: '복부 초음파 판독', why: 'TG18 C (담관 확장) 영상 소견이 없어 담관염은 의심 수준까지만' })
  if (hits.some(c => c.cause === 4)) tests.push({ name: '투약 시작일과 잠복기 확인 (RUCAM)', why: suspectDrugs.length > 1 ? `후보 약이 ${suspectDrugs.length}개라 어느 약인지는 판단 보류. 규칙은 최근 두 약만 인용` : '규칙은 48시간 안 투약 기록만 보고 잠복기는 보지 않음' })
  if (score(2) === 0 && !cs.labs.some(r => r.code === 'BNP')) tests.push({ name: 'NT-proBNP, 심초음파 판독', why: '울혈성 간병증 규칙에 필요한 심부전 근거가 자료에 없음' })
  if ((score(8) ?? 0) > 0 && !cs.labs.some(r => r.code === 'HAPTO')) tests.push({ name: '합토글로빈, 말초혈액 도말', why: '용혈 점수 일부를 받았지만 합토글로빈이 없음' })

  // 화면 표시 확신: 규칙의 판단 보류, 핵심 검사 누락, 함께 해당한 범주 수로 정함 (규칙 모델의 출력은 아님)
  const confidence: AgentRun['confidence'] = a3.abstain
    ? { level: '판단 보류', why: '규칙 점수가 약하거나 해당 범주가 없음' }
    : missingCore
      ? { level: '낮음', why: '첫 이상 때 ALT, ALP, 총빌리 중 최근 측정이 빠진 항목이 있음' }
      : hits.length >= 2
        ? { level: '낮음', why: `${hits.length}개 범주가 함께 해당 (과다 판정일 수 있음)` }
        : hits[0] && hits[0].score! >= 2
          ? { level: '높음', why: '한 범주만 해당하고 점수가 높으며 핵심 검사가 있음' }
          : { level: '중간', why: '한 범주만 해당하지만 점수가 기준 근처' }

  return {
    caseId: cs.id, handwritten: false, ruleVersion: a3.model, llm: '없음 (규칙 기준 모델)',
    steps,
    summary: [
      `원인 규칙 (${a3.model}) 결과 ${hits.map(c => `${causeName(c.cause)} ${c.score!.toFixed(1)}`).join(', ') || '해당 범주 없음'}.`,
      R !== null ? `R 비 ${R.toFixed(1)} (${a3.pattern}).` : '',
      score(1) === 0 && amino < 5 && amino >= 3 ? `Hypoxic hepatitis 는 규칙이 AST·ALT 5×ULN 부터 보는데 첫 이상 때 최고 ${amino.toFixed(1)}×ULN 이라 점수가 없습니다.` : '',
    ].filter(Boolean).join(' '),
    calls,
    suspectDrugs,
    recommendedTests: tests,
    verification: { total: supports.length, matched, issues: supports.filter(s => !s.ref).map(s => ({ text: s.text, detail: '원자료 위치를 찾지 못함' })) },
    confidence,
  }
}

export const runs: AgentRun[] = CASES.map(buildRun).filter((r): r is AgentRun => !!r)
