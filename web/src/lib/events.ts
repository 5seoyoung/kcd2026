// 사건 정의와 '기준 시각에 보이는 기록' 계산. 정의는 docs/liver_agent_7site_summary.md C 장, 0-3 결정을 따른다.
import type { CaseData, EndState, LabItem, LabResult, LiverEvent, MarOrder } from '../types'
import { ceilHour, hoursBetween, isAfter, toMs } from './time'

/** 사건 항목 (묶음 A, OR) */
export const EVENT_CODES = ['ALT', 'ALP', 'TB']
/** 에이전트별 사건 배수 (10/16 결정): 1 발생 예측 5배, 2 종료 상태 2배, 3 원인 추정 5배 */
export const K_A1 = 5
export const K_A2 = 2
export const K_A3 = 5
/** 회복: 트리거 항목이 2 x ULN 미만으로 내려옴 (사건 배수와 상관없이) */
export const K_RECOVER = 2
/** 에이전트 1 경보 기준 */
export const A1_THRESHOLD = 0.3

export const END_STATES: { key: EndState; label: string }[] = [
  { key: 'rec-alive', label: '회복 · 생존' },
  { key: 'rec-dead', label: '회복 · 사망' },
  { key: 'norec-dead', label: '미회복 · 사망' },
  { key: 'norec-alive', label: '미회복 · 생존' },
]

const byChart = (a: LabResult, b: LabResult) => toMs(a.charttime) - toMs(b.charttime)

export const itemOf = (cs: CaseData, code: string): LabItem => cs.labItems.find(i => i.code === code)!
export const uln = (cs: CaseData, code: string) => itemOf(cs, code).high!
export const inIcu = (cs: CaseData, t: string) => !isAfter(cs.icuIn, t) && !isAfter(t, cs.icuOut)

/** 기준 시각에 결과가 나와 있는 검사 */
export const reported = (r: LabResult, t: string) => !isAfter(r.storetime, t)
export const labsAt = (cs: CaseData, t: string) => cs.labs.filter(r => reported(r, t))

/** 기준 시각까지 보고된 같은 항목 결과 (채혈 순) */
export const seriesAt = (cs: CaseData, code: string, t: string) =>
  cs.labs.filter(r => r.code === code && reported(r, t)).sort(byChart)

/** 그 시각에 투여 중인 약 (마지막 기록이 중단이 아님) */
export function activeAt(order: MarOrder | undefined, t: string): boolean {
  if (!order) return false
  const last = order.admins.filter(a => !isAfter(a.time, t)).at(-1)
  return !!last && last.status !== 'stopped'
}

/** 기준 시각에 이미 알게 된 사건인지 (결과 보고 뒤 첫 정시부터) */
export const isKnown = (ev: LiverEvent | undefined, clock: string): ev is LiverEvent => !!ev && !isAfter(ev.detectAt, clock)

export function firstEvent(cs: CaseData, k: number): LiverEvent | undefined {
  const hits = cs.labs
    .filter(r => EVENT_CODES.includes(r.code) && inIcu(cs, r.charttime) && r.value >= k * uln(cs, r.code))
    .sort((a, b) => byChart(a, b) || EVENT_CODES.indexOf(a.code) - EVENT_CODES.indexOf(b.code))
  const r = hits[0]
  if (!r) return undefined
  const item = itemOf(cs, r.code)
  const prev = cs.labs
    .filter(x => x.code === r.code && toMs(x.charttime) < toMs(r.charttime) && hoursBetween(x.charttime, r.charttime) <= 48)
    .sort(byChart)
    .at(-1)
  const group: LiverEvent['group'] =
    hoursBetween(cs.icuIn, r.charttime) <= 24 ? '입실 초기 이상' : prev && prev.value < k * item.high! ? '관찰 중 신규 이상' : '발생 시점 불명'
  return { k, result: r, item, t0: r.charttime, detectAt: ceilHour(r.storetime), group, prev }
}

/** 2배 사건 뒤 트리거 항목이 2 x ULN 미만으로 내려온 첫 결과 (ICU 퇴실 전) */
export function recoveryOf(cs: CaseData, ev: LiverEvent): LabResult | undefined {
  return cs.labs
    .filter(r => r.code === ev.result.code && isAfter(r.charttime, ev.t0) && inIcu(cs, r.charttime) && r.value < K_RECOVER * ev.item.high!)
    .sort(byChart)[0]
}

export function endStateOf(recovered: boolean, dead: boolean): EndState {
  return recovered ? (dead ? 'rec-dead' : 'rec-alive') : dead ? 'norec-dead' : 'norec-alive'
}

/** 같은 채혈의 동반 검사 */
export const sameDraw = (cs: CaseData, ev: LiverEvent, code: string) =>
  cs.labs.find(r => r.code === code && r.charttime === ev.t0)

export function patternOf(r: number) {
  return r >= 5 ? '간세포형' : r <= 2 ? '담즙정체형' : '혼합형'
}

/** R 비 = (ALT/ALT ULN) ÷ (ALP/ALP ULN), 같은 채혈 기준 */
export function rRatio(cs: CaseData, ev: LiverEvent): number | null {
  const alt = sameDraw(cs, ev, 'ALT')
  const alp = sameDraw(cs, ev, 'ALP')
  return alt && alp ? alt.value / uln(cs, 'ALT') / (alp.value / uln(cs, 'ALP')) : null
}
