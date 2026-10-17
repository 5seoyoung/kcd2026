// 화면의 자료 형식. 사례 자료, 에이전트 출력이 모두 이 형식을 따른다.
// 시각은 모두 'YYYY-MM-DD HH:MM' (가상 날짜, 시간대 없음).

export type TabId = 'lab' | 'mar' | 'vital' | 'micro' | 'proc'
/** 1 발생 예측, 2 종료 상태, 3 원인 추정, 4 24시간 궤적 */
export type AgentId = 1 | 2 | 3 | 4
/** 오른쪽 패널에서 보는 화면: 에이전트 하나 또는 질의응답 */
export type PanelView = AgentId | 'qa'

/** 에이전트 근거가 가리키는 원자료 위치. 누르면 해당 탭의 행이나 칸으로 이동한다. */
export interface Ref {
  tab: TabId
  row: string
  col?: string
  from?: string
  to?: string
}

export interface Patient {
  id: string
  bed: string
  name: string
  sex: 'M' | 'F'
  age: number
  stayDay: number
  dx: string
  dept: string
  liverAlert: boolean
  caseId?: string
  plannedScenario?: string
}

export interface LabItem {
  code: string
  name: string
  unit: string
  low?: number
  high?: number
  group: string
  dp: number
}

export interface LabResult {
  id: string
  code: string
  value: number
  charttime: string
  storetime: string
}

export interface MarAdmin {
  time: string
  status: 'given' | 'held' | 'stopped'
  text?: string
  rate?: number
}

export interface MarOrder {
  id: string
  category: string
  drug: string
  dose: string
  route: string
  freq: string
  start: string
  admins: MarAdmin[]
  /** 지속 주입 (모델 자료의 주입 기록). 아니면 투여 기록 */
  infusion?: boolean
}

export interface VitalRow {
  time: string
  sbp: number
  dbp: number
  map: number
  hr: number
  rr: number
  bt: number
  spo2: number
  cvp?: number
}

export interface MicroResult {
  id: string
  collected: string
  specimen: string
  test: string
  result: string
  reported: string
  prelim?: { time: string; result: string }
}

export interface ProcRecord {
  id: string
  time: string
  kind: '영상' | '처치' | '검사'
  name: string
  note?: string
}

/** 이 병원 자료에 없는 기록. 에이전트 출력의 누락 근거로 쓰인다. */
export interface MissingRecord {
  id: string
  name: string
  reason: string
}

export interface TimelineEvent {
  id: string
  lane: 'hemo' | 'drug' | 'test'
  label: string
  start: string
  end?: string
  ref?: Ref
}

export interface CaseData {
  id: string
  patientId: string
  admitDate: string
  /** 병원 입원 시각 (모델 입력: 입원부터 ICU 입실까지 시간) */
  admitTime?: string
  icuIn: string
  icuOut: string
  height: number
  weight: number
  /** from, to 가 있으면 그 사이에만 보인다 */
  badges: { label: string; tone: 'red' | 'blue' | 'gray'; from?: string; to?: string }[]
  outcome: {
    /** ICU 사망 (ICU 퇴실 뒤 24시간 안 사망 포함) */
    icuDeath: boolean
    /** 사망 시각 (있으면). ICU 안 사망이면 ICU 퇴실 시각과 같음 */
    deathTime?: string
    /** 보조: 원내사망 또는 퇴원 뒤 1년 안 사망 */
    death1y: boolean
    dischargeTo: string
  }
  /** 이전 입원 (과거력 모델 입력). 이번 ICU 입실 전에 퇴원한 입원의 진단 코드 */
  history?: { admitted: string; discharged: string; codes: { code: string; version: 9 | 10; name: string }[] }[]
  /** 간염 혈청 검사 (원인 규칙 9 입력). 이름과 결과 문자열 그대로 */
  serology?: { id: string; label: string; value: string; time: string; reported: string }[]
  labItems: LabItem[]
  labs: LabResult[]
  mar: MarOrder[]
  vitals: VitalRow[]
  micro: MicroResult[]
  procs: ProcRecord[]
  missing: MissingRecord[]
  events: TimelineEvent[]
}

/** 사건: ALT, ALP, 총빌리 중 하나가 k x ULN 이상인 첫 결과 (ICU 재원 중, 공개 시각 순) */
export interface LiverEvent {
  k: number
  result: LabResult
  item: LabItem
  /** 공개 시각 = max(채혈 시각, 보고 시각) */
  t0: string
  /** 채혈 시각 */
  drawn: string
  /** t0 뒤 첫 정시. 에이전트가 사건을 알고 도는 시각 */
  detectAt: string
  group: '입실 초기 이상' | '관찰 중 신규 이상' | '발생 시점 불명'
  /** 같은 항목의 직전 48시간 안 마지막 값 */
  prev?: LabResult
}

// ───────── 에이전트 3 (원인 추정) 실행 기록 ─────────

export interface AgentStep {
  id: string
  tool: string
  title: string
  summary: string
  details?: string[]
  ms: number
}

export interface Evidence {
  text: string
  time?: string
  ref?: Ref
}

/** 근거 위키에서 가져온 지침 근거 한 줄 */
export interface GuideLine {
  text: string
  /** 원문 약칭과 PDF 쪽 '(HH review p.3)' */
  cite: string
  /** 위키 페이지 id 와 절 */
  page: string
  heading?: string
}

/** 원인 범주 하나의 규칙 판정 */
export interface CauseCall {
  /** 원인 범주 1~10 (data/causes.ts) */
  cause: number
  /** 규칙 점수. RULE_THRESHOLD 이상이면 해당. null 은 판단 불가 (담낭염은 규칙상 항상 판단 불가) */
  score: number | null
  /** 규칙이 이 범주를 보는 조건 */
  rule?: string
  temporal?: string
  support: Evidence[]
  against: Evidence[]
  missing: Evidence[]
  /** 근거 위키의 진단 기준과 근거 공백 */
  guide: GuideLine[]
  /** 근거 자료 완성도: 이 범주 판단에 필요한 자료 가운데 있는 것 */
  evidence?: { have: number; need: number; items: EvidenceItem[] }
  /** 판정 취약: 규칙이 읽은 검사값 하나를 검사 오차 범위만큼 바꾸면 0/1 이 바뀜 (바뀌는 경우 목록) */
  fragile?: string[]
  /** 판단 보류 사유 (해당이나 해당 아님으로 정하기 어려움) */
  hold?: string
}

/** 근거 자료의 상태. 연결 안 됨 (연결부가 넘기지 않음) 과 측정 없음 (넘기지만 이 환자에게 없음) 을 구분 */
export type EvidenceStatus = '있음' | '측정 없음' | '연결 안 됨' | '자료에 없음' | '이전 입원 없음'
export interface EvidenceItem {
  name: string
  status: EvidenceStatus
  detail?: string
}

export interface SuspectDrug {
  drug: string
  /** 첫 투여부터 사건 채혈까지 */
  latency: string
  /** t0 전 48시간 안 마지막 투여 */
  last: string
  /** 원인 규칙이 DILI 근거로 인용했는지 (규칙은 최근 두 약만 인용) */
  cited: boolean
  ref?: Ref
}

export interface AgentRun {
  caseId: string
  handwritten: boolean
  ruleVersion: string
  llm: string
  steps: AgentStep[]
  summary: string
  /** 범주 10개 모두 (여러 범주가 함께 해당할 수 있음) */
  calls: CauseCall[]
  suspectDrugs: SuspectDrug[]
  recommendedTests: { name: string; why: string }[]
  verification: { total: number; matched: number; issues: { text: string; detail: string }[] }
  /** 원인 규칙의 판단 보류 (가장 높은 점수가 약하거나 해당 범주가 없음) */
  abstain?: string
}

// ───────── 에이전트 1, 2, 4 와 모델 1 출력 (다른 곳에서 만든 모델이 들어올 자리) ─────────

/** 확신 규칙 (불확실성 구현 명세 10/17, 미리 고정). 1~5 는 발생 예측, 6 은 예후 */
export interface ConfReason {
  rule: 1 | 2 | 3 | 4 | 5 | 6
  text: string
}
export interface Confidence {
  level: '높음' | '낮음'
  reasons: ConfReason[]
}

export interface Factor {
  name: string
  /** '+' 는 위험을 높이거나 회복을 어렵게 하는 쪽. 없으면 방향 없이 모델 입력값만 보여 줌 */
  dir?: '+' | '-'
  value?: string
}

/** 에이전트 1: 정상 구간의 매시간, 24시간 안 5배 사건 확률 */
export interface A1Point {
  time: string
  p: number
  /** 설명의 기준값 (합성 기준 행에서의 평균 확률). 요인은 이 값에서 얼마나 올리고 내렸는지 */
  base?: number
  factors: Factor[]
  /** 위험을 올린 근거 상위 2개 (그룹 Shapley 가 양수인 묶음) */
  drivers?: Factor[]
  /** 심각도 사다리: 같은 입력으로 2, 3, 4, 5배 모델의 24시간 안 확률 */
  ladder?: { k: number; p: number }[]
  /** 24시간 안 측정 없는 핵심 입력 (간 검사 4개, INR, 젖산, 크레아티닌 중) */
  missingCore?: string[]
  /** 빠진 핵심 입력을 개발 집단 기준 행 10개로 바꿔 넣은 예측의 10~90%. 빠진 것이 없으면 없음 */
  interval?: { lo: number; hi: number }
  /** 재면 구간이 가장 줄어드는 검사와 잰 뒤 예상 구간 */
  nextTest?: { name: string; lo: number; hi: number }
  confidence?: Confidence
}

export type EndState = 'rec-alive' | 'rec-dead' | 'norec-dead' | 'norec-alive'

/** 에이전트 2: 5배 사건 때 한 번. 회복 여부 x ICU 사망 여부 4경로 확률 */
export interface A2Output {
  probs: Record<EndState, number>
  /** ICU 사망 확률 (판정 불가 사건까지 넣어 학습한 별도 모델) */
  icuDeath: number
  factors: Factor[]
  /** '이 중 하나일 가능성이 높음' 경로 (임시: 확률 큰 순으로 더해 0.9 까지, 보장 없음) */
  pathSet: { keys: EndState[]; mass: number }
  /** 규칙 6: 경로가 둘 이상이면 낮음 */
  confidence: Confidence
}

/** 에이전트 4: 매시간, 예측 범위 6, 12, 18, 24시간의 10%, 50%, 90% 값 (원래 단위) */
export interface A4Forecast {
  code: string
  last: { time: string; value: number }
  points: { h: number; time: string; v: number; lo: number; hi: number }[]
}

export interface ModelOutputs {
  caseId: string
  placeholder: boolean
  /** 간 검사 이상 패턴 군집. 보조 정보로만 보여 주고 원인 판정에는 쓰지 않음 */
  model1: {
    cluster: string
    confidence: number
    assignable: boolean
    /** 개발 사건 중 이 군집의 비율 */
    share: number
    features: string[]
  }
  agent2: A2Output
}

// ───────── 질의응답 (RAG) ─────────

export interface QaSource {
  /** case: 사례 자료의 값, agent: 에이전트 출력, doc: 근거 위키의 원문이나 프로젝트 문서 */
  kind: 'case' | 'agent' | 'doc'
  label: string
  ref?: Ref
  /** 근거 위키 페이지 id. 누르면 위키를 엶 */
  wiki?: string
}

/** 근거 위키에서 찾은 조각 */
export interface QaHit {
  page: string
  title: string
  heading: string
  text: string
  score: number
}

export interface QaAnswer {
  text: string[]
  sources: QaSource[]
  /** refused: 치료 결정 질문이라 근거만 정리함, notFound: 근거를 찾지 못해 답하지 않음, weak: 꼭 맞는 근거가 아닐 수 있음 */
  status?: 'refused' | 'notFound' | 'weak'
  /** case: 사례 자료로 계산, wiki: 위키 검색 조각, llm: 검색 조각으로 LLM 이 쓴 답 */
  mode?: 'case' | 'wiki' | 'llm'
  hits?: QaHit[]
  llm?: {
    model: string
    /** 답 문장이 인용한 조각 번호 (1부터) */
    cited: number[]
    checks: { sentences: number; uncited: number; numbers: number; unsupported: string[]; badRefs: number[] }
  }
}

export interface QaMsg {
  id: number
  q: string
  kind: '환자' | '지식' | null
  /** 질문한 기준 시각. 이 시각까지의 기록으로만 답함 */
  clock: string
  answer: QaAnswer
}
