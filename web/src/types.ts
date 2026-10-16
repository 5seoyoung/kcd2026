// 화면의 자료 형식. 사례 자료, 에이전트 출력이 모두 이 형식을 따른다.
// 시각은 모두 'YYYY-MM-DD HH:MM' (가상 날짜, 시간대 없음).

export type TabId = 'lab' | 'mar' | 'vital' | 'micro' | 'proc'
export type Condition = 'A' | 'B'
/** 1 발생 예측, 2 종료 상태, 3 원인 추정, 4 24시간 궤적 */
export type AgentId = 1 | 2 | 3 | 4

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
  icuIn: string
  icuOut: string
  height: number
  weight: number
  /** from, to 가 있으면 그 사이에만 보인다 */
  badges: { label: string; tone: 'red' | 'blue' | 'gray'; from?: string; to?: string }[]
  outcome: {
    icuDeath: boolean
    /** 원내사망 또는 퇴원 뒤 1년 안 사망 */
    death1y: boolean
    dischargeTo: string
  }
  labItems: LabItem[]
  labs: LabResult[]
  mar: MarOrder[]
  vitals: VitalRow[]
  micro: MicroResult[]
  procs: ProcRecord[]
  missing: MissingRecord[]
  events: TimelineEvent[]
}

/** 사건: ALT, ALP, 총빌리 중 하나가 k x ULN 이상인 첫 결과 (ICU 재원 중) */
export interface LiverEvent {
  k: number
  result: LabResult
  item: LabItem
  /** 채혈 시각 */
  t0: string
  /** 결과 보고 뒤 첫 정시. 에이전트가 사건을 알고 도는 시각 */
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

export interface Candidate {
  /** 원인 범주 1~10 (data/causes.ts) */
  cause: number
  uncertainty: '낮음' | '중간' | '높음'
  temporal?: string
  support: Evidence[]
  against: Evidence[]
  missing: Evidence[]
}

export interface SuspectDrug {
  drug: string
  latency: string
  hepatotox: string
  pattern: string
  ref?: Ref
}

export interface AgentRun {
  caseId: string
  condition: Condition
  handwritten: boolean
  llm: string
  promptVersion: string
  steps: AgentStep[]
  summary: string
  abstain: boolean
  candidates: Candidate[]
  suspectDrugs: SuspectDrug[]
  recommendedTests: { name: string; why: string }[]
  verification: { total: number; matched: number; issues: { text: string; detail: string }[] }
}

// ───────── 에이전트 1, 2, 4 와 모델 1 출력 (다른 곳에서 만든 모델이 들어올 자리) ─────────

export interface Factor {
  name: string
  /** '+' 는 위험을 높이거나 회복을 어렵게 하는 쪽 */
  dir: '+' | '-'
  value?: string
}

/** 에이전트 1: 매시간 24시간 안 5배 사건 확률 */
export interface A1Point {
  time: string
  p: number
  factors: Factor[]
}

export type EndState = 'rec-alive' | 'rec-dead' | 'norec-dead' | 'norec-alive'

/** 에이전트 2: 2배 사건 시점에 한 번, ICU 퇴실 때 종료 상태 확률 */
export interface A2Output {
  probs: Record<EndState, number>
  factors: Factor[]
}

/** 에이전트 4: 매시간 앞으로 24시간 수치 예측 */
export interface A4Forecast {
  code: string
  last: { time: string; value: number }
  points: { time: string; v: number; lo: number; hi: number }[]
}

export interface ModelOutputs {
  caseId: string
  placeholder: boolean
  /** 에이전트 3 의 B 조건에만 주는 군집 정보 */
  model1: {
    cluster: string
    confidence: number
    assignable: boolean
    devN: number
    features: string[]
  }
  agent2: A2Output
}
