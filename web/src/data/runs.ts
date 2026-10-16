// 사례 1 의 에이전트 3 (원인 추정) 실행 기록 (손으로 쓴 예시). MIMIC 연구원의 원인 규칙과 코드를 받으면 같은 형식의 실행 결과로 바꾼다.
// 명세서 정의: 첫 이상 (2배) 시점에 한 번, 범주 10개마다 규칙 점수를 내고 1.0 이상이면 해당 (여러 범주 가능). 담낭염은 판단 불가.
import type { AgentRun, AgentStep, CauseCall, GuideLine, SuspectDrug } from '../types'
import { case01 } from './case01'
import { CAUSE_WIKI, causeName, EVIDENCE_MAP } from './causes'
import { firstEvent, K_FIRST, reported, RULE_THRESHOLD, sameDraw, rRatio, patternOf, uln, itemOf } from '../lib/events'
import { fmtNum } from '../lib/lab'
import { hm, hoursBetween, isAfter, mdhm } from '../lib/time'

// 첫 이상: t0 는 공개 시각, 에이전트는 t0 뒤 첫 정시에 돈다. 입력은 t0 까지 공개된 기록만
const ev = firstEvent(case01, K_FIRST)!
const { t0, drawn } = ev
const runAt = ev.detectAt

const before = (t: string) => !isAfter(t, t0)
const between = (t: string) => isAfter(t, t0) && !isAfter(t, runAt)
const admins = case01.mar.flatMap(o => o.admins)
const vitals = case01.vitals.filter(v => before(v.time))
const order = (id: string) => case01.mar.find(o => o.id === id)!
const lab = (code: string) => sameDraw(case01, ev, code)!
const x = (code: string, v: number) => (v / uln(case01, code)).toFixed(1)
const lag = (from: string) => {
  const h = hoursBetween(from, drawn)
  return h >= 24 ? `${(h / 24).toFixed(1)}일` : `${h.toFixed(1)}시간`
}

const nLab = case01.labs.filter(r => reported(r, t0)).length
const nLabCut = case01.labs.filter(r => !reported(r, t0) && reported(r, runAt)).length
const nAdmin = admins.filter(a => before(a.time)).length
const nAdminCut = admins.filter(a => between(a.time)).length
const nVitalCut = case01.vitals.filter(v => between(v.time)).length
const micro = case01.micro.filter(m => before(m.collected))
const nPending = micro.filter(m => isAfter(m.reported, t0)).length
const nDrug = case01.mar.filter(o => o.admins.some(a => a.status === 'given' && before(a.time))).length

const hypo = vitals.filter(v => v.map < 65)
const mapMin = Math.min(...hypo.map(v => v.map))
const neMax = Math.max(...order('NE').admins.filter(a => before(a.time)).map(a => a.rate ?? 0))
const lacs = case01.labs.filter(r => r.code === 'LAC' && reported(r, t0))
const lacMax = lacs.reduce((a, b) => (b.value > a.value ? b : a))
const spo2Min = vitals.reduce((a, b) => (b.spo2 < a.spo2 ? b : a))
const hrMax = vitals.reduce((a, b) => (b.hr > a.hr ? b : a))
const cvpMax = Math.max(...vitals.map(v => v.cvp ?? 0))

const alt = lab('ALT')
const ast = lab('AST')
const alp = lab('ALP')
const tb = lab('TB')
const db = lab('DB')
const ldh = lab('LDH')
const ck = lab('CK')
const hb = lab('HB')
const R = rRatio(case01, ev)!
const hbPrev = case01.labs.filter(r => r.code === 'HB' && r.charttime < drawn).at(-1)!


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

const calls: CauseCall[] = ([
  {
    cause: 1, score: 2.8,
    temporal: `저혈압 시작 (${mdhm(hypo[0].time)}) 이 사건 채혈 (${hm(drawn)}) 보다 ${hoursBetween(hypo[0].time, drawn).toFixed(1)}시간 앞섬`,
    support: [
      { text: `MAP 65 미만 ${hypo.length}시간, 최저 ${mapMin}`, time: `${mdhm(hypo[0].time)}~${hm(hypo.at(-1)!.time).slice(0, 2)}:59`, ref: { tab: 'vital', row: 'map', from: hypo[0].time, to: hypo.at(-1)!.time } },
      { text: `노르에피네프린 시작, 최대 ${neMax} mcg/kg/min`, time: mdhm(order('NE').start), ref: { tab: 'mar', row: 'NE' } },
      { text: '바소프레신 추가', time: mdhm(order('VP').start), ref: { tab: 'mar', row: 'VP' } },
      { text: `젖산 최고 ${fmtNum(lacMax.value, 1)} mmol/L`, time: mdhm(lacMax.charttime), ref: { tab: 'lab', row: 'LAC', col: lacMax.id } },
      { text: `SpO2 최저 ${spo2Min.spo2}%`, time: mdhm(spo2Min.time), ref: { tab: 'vital', row: 'spo2', from: spo2Min.time, to: spo2Min.time } },
      { text: `AST ${ast.value} 가 ALT ${alt.value} 보다 높고 LDH ${fmtNum(ldh.value, 0)} (${x('LDH', ldh.value)}배) 로 함께 오름`, time: mdhm(drawn), ref: { tab: 'lab', row: 'AST', col: ast.id } },
    ],
    against: [
      { text: `ALT ${x('ALT', alt.value)}배로 아직 크게 오르지 않음 (허혈성은 흔히 20배 이상)`, ref: { tab: 'lab', row: 'ALT', col: alt.id } },
    ],
    missing: [{ text: '심초음파 없음 → 심장 원인과 울혈이 함께 있는지 모름', ref: { tab: 'proc', row: 'miss-echo' } }],
  },
  {
    cause: 2, score: 1.2,
    support: [
      { text: `신속 심방세동, 심박 최고 ${hrMax.hr}`, time: mdhm(hrMax.time), ref: { tab: 'vital', row: 'hr', from: '2026-03-10 16:00', to: '2026-03-10 18:00' } },
      { text: `CVP ${cvpMax} mmHg 로 오름`, time: '03-10 19:00~21:00', ref: { tab: 'vital', row: 'cvp', from: '2026-03-10 19:00', to: '2026-03-10 21:00' } },
    ],
    against: [{ text: `총빌리 ${fmtNum(tb.value, 1)} 로 정상 범위`, ref: { tab: 'lab', row: 'TB', col: tb.id } }],
    missing: [
      { text: '심초음파 없음', ref: { tab: 'proc', row: 'miss-echo' } },
      { text: 'BNP 측정 없음', ref: { tab: 'proc', row: 'miss-bnp' } },
    ],
  },
  {
    cause: 3, score: 0.4,
    support: [{ text: '기관 흡인물 배양 S. pneumoniae (폐렴)', time: mdhm(case01.micro.find(m => m.id === 'M3')!.reported), ref: { tab: 'micro', row: 'M3' } }],
    against: [{ text: `총빌리 ${fmtNum(tb.value, 1)}, 직접빌리 ${fmtNum(db.value, 1)} 로 실무 기준 (총빌리 >2 mg/dL) 아래`, ref: { tab: 'lab', row: 'TB', col: tb.id } }],
    missing: [{ text: `${mdhm(case01.micro.find(m => m.id === 'M6')!.collected)} 혈액배양은 t0 에 배양 중`, ref: { tab: 'micro', row: 'M6' } }],
  },
  {
    cause: 4, score: 0.6,
    temporal: `아미오다론 시작이 사건 채혈보다 ${lag(order('AMIO').start)} 앞섬`,
    support: [
      { text: '아미오다론 정맥 부하 뒤 지속 주입', time: mdhm(order('AMIO').start), ref: { tab: 'mar', row: 'AMIO' } },
      { text: `피페라실린/타조박탐 투여 ${lag(order('PIP').start)}째`, time: `${mdhm(order('PIP').start)}~`, ref: { tab: 'mar', row: 'PIP' } },
    ],
    against: [
      { text: `ALT ${x('ALT', alt.value)}배로 생화학 기준 (AST/ALT >5×ULN) 에 못 미침`, ref: { tab: 'lab', row: 'ALT', col: alt.id } },
      { text: '같은 시점의 쇼크로 충분히 설명됨' },
      { text: '피페라실린/타조박탐은 대개 담즙정체형이라 패턴이 맞지 않음' },
    ],
    missing: [{ text: '약을 끊은 뒤 반응은 t0 뒤 정보라 판단에 쓰지 않음' }],
  },
  {
    cause: 5, score: 0,
    support: [],
    against: [{ text: '투약기록에 정맥영양 없음' }],
    missing: [],
  },
  {
    cause: 6, score: 0.1,
    support: [],
    against: [{ text: `ALP ${alp.value} (${x('ALP', alp.value)}배), 직접빌리 ${fmtNum(db.value, 1)} 로 담즙정체 없음`, ref: { tab: 'lab', row: 'ALP', col: alp.id } }],
    missing: [{ text: 't0 전 복부 영상 없음' }],
  },
  {
    cause: 7, score: null,
    support: [],
    against: [],
    missing: [{ text: '영상 판독문이 없어 규칙상 판단하지 않음', ref: { tab: 'proc', row: 'miss-read' } }],
  },
  {
    cause: 8, score: 0.3,
    support: [{ text: `LDH ${fmtNum(ldh.value, 0)} (${x('LDH', ldh.value)}배)`, time: mdhm(drawn), ref: { tab: 'lab', row: 'LDH', col: ldh.id } }],
    against: [{ text: `Hb ${fmtNum(hbPrev.value, 1)} → ${fmtNum(hb.value, 1)} 로 거의 그대로, 총빌리 정상`, ref: { tab: 'lab', row: 'HB', col: hb.id } }],
    missing: [{ text: 'haptoglobin, 말초혈액 도말 없음', ref: { tab: 'proc', row: 'miss-smear' } }],
  },
  {
    cause: 9, score: 0,
    support: [],
    against: [],
    missing: [{ text: '간염 바이러스 표지자 측정 없음', ref: { tab: 'proc', row: 'miss-virus' } }],
  },
  {
    cause: 10, score: 0.2,
    support: [],
    against: [
      { text: `CK ${ck.value} (${x('CK', ck.value)}배) 로 근육 기원 아님`, ref: { tab: 'lab', row: 'CK', col: ck.id } },
      { text: '기저 간질환, 간이식, 알코올 기록 없음' },
    ],
    missing: [],
  },
] as Omit<CauseCall, 'guide'>[]).map(c => ({ ...c, guide: GUIDE[c.cause] }))

const hits = calls.filter(c => c.score !== null && c.score >= RULE_THRESHOLD).sort((a, b) => b.score! - a.score!)

const steps: AgentStep[] = [
  {
    id: 's1', tool: 'build_case', title: '사례 자료 만들기', ms: 900,
    summary: `t0 = ${mdhm(t0)} (ALT 공개 시각, 채혈 ${hm(drawn)}). 입실부터 t0 까지 공개된 기록만 씀`,
    details: [
      `검사 결과 ${nLab}건, 투약 기록 ${nAdmin}건, 활력징후 ${vitals.length}시간, 배양 ${micro.length}건 (그중 ${nPending}건은 결과 전)`,
      `t0 뒤 실행 시각 (${hm(runAt)}) 까지 생긴 기록은 뺌: 검사 ${nLabCut}건, 투약 ${nAdminCut}건, 활력징후 ${nVitalCut}시간`,
    ],
  },
  {
    id: 's2', tool: 'detect_event', title: '사건 확인', ms: 600,
    summary: `ALT ${alt.value} IU/L, 기록 상한 ${ev.item.high} 의 ${x('ALT', alt.value)}배 (첫 이상). 직전 값 ${ev.prev!.value} (${mdhm(ev.prev!.charttime)}) 는 2배 미만 → ${ev.group}`,
    details: ['ICU 입실 전 같은 입원에서 2배 이상인 기록 없음 → 분석 대상'],
  },
  {
    id: 's3', tool: 'injury_pattern', title: '손상 패턴 계산', ms: 500,
    summary: `R 비 ${R.toFixed(1)} → ${patternOf(R)}. AST/ALT ${(ast.value / alt.value).toFixed(1)}, LDH ${fmtNum(ldh.value, 0)} (${x('LDH', ldh.value)}배)`,
  },
  {
    id: 's4', tool: 'query_evidence', title: '혈역학·산소화 근거', ms: 1100,
    summary: `MAP 65 미만 ${hypo.length}시간 (최저 ${mapMin}), 노르에피네프린 최대 ${neMax}, 바소프레신 추가, 젖산 최고 ${fmtNum(lacMax.value, 1)}, SpO2 최저 ${spo2Min.spo2}%`,
  },
  {
    id: 's5', tool: 'query_evidence', title: '약물 노출', ms: 1000,
    summary: `t0 전 투여 약 ${nDrug}종. 간독성 지식표에 있는 약: 아미오다론, 피페라실린/타조박탐, 아세트아미노펜`,
  },
  {
    id: 's6', tool: 'query_evidence', title: '감염 근거', ms: 800,
    summary: `기관 흡인물 배양 S. pneumoniae (03-10 14:00 보고). ${hm(case01.micro.find(m => m.id === 'M6')!.collected)} 혈액배양은 t0 에 배양 중`,
  },
  {
    id: 's7', tool: 'query_evidence', title: '심장·담도·비간성 근거', ms: 900,
    summary: `CVP 최고 ${cvpMax}. 심초음파, BNP, 복부 영상 없음. 정맥영양 없음. CK ${ck.value} (${x('CK', ck.value)}배). 용혈 검사 없음`,
  },
  {
    id: 's8', tool: 'lookup_knowledge', title: '지식표 조회', ms: 700,
    summary: '아미오다론 정맥: 투여 직후 급성 간세포형 손상 드물게 보고. 피페라실린/타조박탐: 드물고 주로 담즙정체형',
  },
  {
    id: 's9', tool: 'query_wiki', title: '근거 위키 조회', ms: 900,
    summary: `범주마다 진단 기준과 근거 공백을 원인 10개 근거 지도에서 가져옴 (${Object.values(GUIDE).flat().length}줄, 원문 13편). 담낭염 진단 기준 (TG18) 은 위키에 없음`,
  },
  {
    id: 's9b', tool: 'score_rules', title: '원인 범주 10개 규칙 점수', ms: 900,
    summary: `${RULE_THRESHOLD.toFixed(1)} 이상 ${hits.length}개: ${hits.map(c => `${causeName(c.cause)} ${c.score!.toFixed(1)}`).join(', ')}. 담낭염은 판단 불가`,
  },
  {
    id: 's10', tool: 'query_model1', title: '간 검사 이상 패턴 조회 (모델 1)', ms: 700,
    summary: '군집 3, 확신도 0.81. 보조 정보로만 보여 주고 원인 판정에는 넣지 않음',
  },
  { id: 's11', tool: 'write_summary', title: '요약 작성 (LLM)', ms: 1300, summary: '규칙 결과와 근거를 두 문장으로 요약. 규칙 점수는 바꾸지 않음' },
  { id: 's12', tool: 'verify_source', title: '원자료 대조', ms: 700, summary: '출력 속 숫자와 시각 18개 모두 원자료와 일치' },
]

const suspectDrugs: SuspectDrug[] = [
  { drug: 'Amiodarone (IV)', latency: lag(order('AMIO').start), hepatotox: '정맥 투여 직후 급성 손상 보고 있음', pattern: '간세포형, 혼합형인 지금과 일부 맞음', ref: { tab: 'mar', row: 'AMIO' } },
  { drug: 'Piperacillin/Tazobactam', latency: lag(order('PIP').start), hepatotox: '드묾', pattern: '주로 담즙정체형, 안 맞음', ref: { tab: 'mar', row: 'PIP' } },
  { drug: 'Acetaminophen', latency: `${lag(order('APAP').start)} (2회)`, hepatotox: '용량 의존', pattern: '650 mg 2회로 용량이 낮음', ref: { tab: 'mar', row: 'APAP' } },
]

export const runs: AgentRun[] = [
  {
    caseId: 'c01', handwritten: true, ruleVersion: 'spec-1017', llm: '(연결 전)',
    steps,
    summary: `쇼크 (MAP ${mapMin}, 노르에피네프린 ${neMax}) 가 사건 채혈보다 ${hoursBetween(hypo[0].time, drawn).toFixed(1)}시간 앞서고 AST 우세와 LDH 상승이 있어 Hypoxic hepatitis 에 해당합니다. 신속 심방세동과 CVP ${cvpMax} 로 Congestive hepatopathy 도 기준을 넘었지만 심초음파와 BNP 가 없어 근거가 약합니다.`,
    calls,
    suspectDrugs,
    recommendedTests: [
      { name: '심초음파', why: 'Congestive hepatopathy 와 심기능 확인. 이 자료에 없음' },
      { name: '복부 초음파와 Doppler', why: '간 혈류와 담도 확인 (담도폐쇄, 담낭염 배제)' },
      { name: '12~24시간 뒤 AST, ALT, LDH 재측정', why: `허혈성이면 크게 오른 뒤 빠르게 내려감. 지금 ${itemOf(case01, 'ALT').name.split(' (')[0]} ${x('ALT', alt.value)}배` },
    ],
    verification: { total: 18, matched: 18, issues: [] },
  },
]
