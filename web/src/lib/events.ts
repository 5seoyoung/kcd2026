// 사건 정의와 '기준 시각에 보이는 기록' 계산.
// 정의는 MIMIC 명세서를 따른다 (docs/liver_agent_7site_summary.md 0-6, 10/17 결정):
// 공개 시각 = max(채혈 시각, 보고 시각), ULN = 그 행의 기록 상한, ICU 입실 전 2배 이상인 환자는 제외.
import type { CaseData, EndState, LabItem, LabResult, LiverEvent, MarOrder } from '../types'
import { addHours, ceilHour, hoursBetween, isAfter, toMs } from './time'

/** 사건 항목 (ALT, ALP, 총빌리 중 하나, OR) */
export const EVENT_CODES = ['ALT', 'ALP', 'TB']
/** 첫 이상: 2 x ULN. 종료 상태 (에이전트 2) 와 원인 추정 (에이전트 3) 이 이때 한 번 돈다 */
export const K_FIRST = 2
/** 발생 예측 (에이전트 1) 의 목표: 24시간 안 5 x ULN */
export const K_TARGET = 5
/** 회복: ICU 퇴실 때 마지막 ALT, ALP, 총빌리가 모두 2 x ULN 미만 */
export const K_RECOVER = 2
/** 정상 구간: 세 항목을 모두 최근 24시간 안에 쟀고 모두 2 x ULN 미만 */
export const NORMAL_WINDOW_H = 24
/** 에이전트 1 경보 기준 */
export const A1_THRESHOLD = 0.3
/** 원인 규칙 점수가 이 값 이상이면 그 범주에 해당 (1) */
export const RULE_THRESHOLD = 1.0

export const END_STATES: { key: EndState; label: string }[] = [
  { key: 'rec-alive', label: '회복 · 생존' },
  { key: 'rec-dead', label: '회복 · 사망' },
  { key: 'norec-dead', label: '미회복 · 사망' },
  { key: 'norec-alive', label: '미회복 · 생존' },
]

const byChart = (a: LabResult, b: LabResult) => toMs(a.charttime) - toMs(b.charttime)

export const itemOf = (cs: CaseData, code: string): LabItem => cs.labItems.find(i => i.code === code)!
/** 그 행의 기록 상한. 이 가상 자료는 항목마다 상한이 하나라 항목 정보에서 읽는다 */
export const uln = (cs: CaseData, code: string) => itemOf(cs, code).high!
export const inIcu = (cs: CaseData, t: string) => !isAfter(cs.icuIn, t) && !isAfter(t, cs.icuOut)

/** 공개 시각 = max(채혈 시각, 보고 시각) */
export const publicAt = (r: LabResult) => (isAfter(r.charttime, r.storetime) ? r.charttime : r.storetime)
const byPublic = (a: LabResult, b: LabResult) => toMs(publicAt(a)) - toMs(publicAt(b)) || byChart(a, b)

/** 기준 시각에 공개된 검사 */
export const reported = (r: LabResult, t: string) => !isAfter(publicAt(r), t)
export const labsAt = (cs: CaseData, t: string) => cs.labs.filter(r => reported(r, t))

/** 기준 시각까지 공개된 같은 항목 결과 (채혈 순) */
export const seriesAt = (cs: CaseData, code: string, t: string) =>
  cs.labs.filter(r => r.code === code && reported(r, t)).sort(byChart)

/** 그 시각에 투여 중인 약 (마지막 기록이 중단이 아님) */
export function activeAt(order: MarOrder | undefined, t: string): boolean {
  if (!order) return false
  const last = order.admins.filter(a => !isAfter(a.time, t)).at(-1)
  return !!last && last.status !== 'stopped'
}

/** 기준 시각에 이미 알게 된 사건인지 (공개 뒤 첫 정시부터) */
export const isKnown = (ev: LiverEvent | undefined, clock: string): ev is LiverEvent => !!ev && !isAfter(ev.detectAt, clock)

/** ICU 입실 전 같은 입원에서 이미 2배 이상이던 환자는 분석 코호트에서 뺀다 */
export const preIcuAbnormal = (cs: CaseData) =>
  cs.labs.some(r => EVENT_CODES.includes(r.code) && isAfter(cs.icuIn, r.charttime) && r.value >= K_FIRST * uln(cs, r.code))

export function firstEvent(cs: CaseData, k: number): LiverEvent | undefined {
  const r = cs.labs
    .filter(x => EVENT_CODES.includes(x.code) && inIcu(cs, publicAt(x)) && x.value >= k * uln(cs, x.code))
    .sort((a, b) => byPublic(a, b) || EVENT_CODES.indexOf(a.code) - EVENT_CODES.indexOf(b.code))[0]
  if (!r) return undefined
  const item = itemOf(cs, r.code)
  const t0 = publicAt(r)
  const prev = cs.labs
    .filter(x => x.code === r.code && toMs(x.charttime) < toMs(r.charttime) && hoursBetween(x.charttime, r.charttime) <= 48 && reported(x, t0))
    .sort(byChart)
    .at(-1)
  const group: LiverEvent['group'] =
    hoursBetween(cs.icuIn, t0) <= 24 ? '입실 초기 이상' : prev && prev.value < k * item.high! ? '관찰 중 신규 이상' : '발생 시점 불명'
  return { k, result: r, item, t0, drawn: r.charttime, detectAt: ceilHour(t0), group, prev }
}

/** 기준 시각에 공개된 항목별 마지막 값 */
export const lastAt = (cs: CaseData, code: string, t: string) => seriesAt(cs, code, t).at(-1)

/**
 * 정상 구간인지: 세 항목을 모두 최근 24시간 안에 쟀고 (공개된 결과) 모두 2배 미만.
 * 아니면 발생 예측은 판정 불가.
 */
export function normalAt(cs: CaseData, t: string): { ok: boolean; why?: string } {
  const from = addHours(t, -NORMAL_WINDOW_H)
  const stale: string[] = []
  const high: string[] = []
  for (const code of EVENT_CODES) {
    const r = lastAt(cs, code, t)
    if (!r || isAfter(from, r.charttime)) stale.push(code)
    else if (r.value >= K_FIRST * uln(cs, code)) high.push(code)
  }
  const name = (c: string) => itemOf(cs, c).name.split(' (')[0]
  if (high.length) return { ok: false, why: `${high.map(name).join(', ')} 2배 이상` }
  if (stale.length) return { ok: false, why: `최근 24시간 안 ${stale.map(name).join(', ')} 측정 없음` }
  return { ok: true }
}

/**
 * ICU 퇴실 때 판정: 사건 뒤 다시 잰 값이 있어야 판정할 수 있고 (없으면 판정 불가),
 * 퇴실 때 마지막 ALT, ALP, 총빌리가 모두 2배 미만이면 회복.
 */
export function dischargeOf(cs: CaseData, ev: LiverEvent): { judged: boolean; recovered: boolean; last: LabResult[] } {
  const last = EVENT_CODES.map(code => lastAt(cs, code, cs.icuOut)).filter((r): r is LabResult => !!r)
  const judged = last.some(r => isAfter(r.charttime, ev.drawn))
  const recovered = judged && last.every(r => r.value < K_RECOVER * uln(cs, r.code))
  return { judged, recovered, last }
}

export function endStateOf(recovered: boolean, dead: boolean): EndState {
  return recovered ? (dead ? 'rec-dead' : 'rec-alive') : dead ? 'norec-dead' : 'norec-alive'
}

/** 같은 채혈의 동반 검사 */
export const sameDraw = (cs: CaseData, ev: LiverEvent, code: string) =>
  cs.labs.find(r => r.code === code && r.charttime === ev.drawn)

export function patternOf(r: number) {
  return r >= 5 ? '간세포형' : r <= 2 ? '담즙정체형' : '혼합형'
}

/** R 비 = (ALT/ALT ULN) ÷ (ALP/ALP ULN), 같은 채혈 기준 */
export function rRatio(cs: CaseData, ev: LiverEvent): number | null {
  const alt = sameDraw(cs, ev, 'ALT')
  const alp = sameDraw(cs, ev, 'ALP')
  return alt && alp ? alt.value / uln(cs, 'ALT') / (alp.value / uln(cs, 'ALP')) : null
}
