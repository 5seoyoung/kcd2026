// 기준 시각에서 각 에이전트가 어디까지 왔는지 계산한다. 카드, 상세 화면, 상태 줄이 같이 쓴다.
import type { A1Point, A4Forecast, CaseData } from '../../types'
import type { Sim } from '../../data'
import { forecastAt } from '../../data/standin'
import { isKnown, uln } from '../../lib/events'
import { addHours, isAfter } from '../../lib/time'

export type RunState = { phase: 'idle' | 'running' | 'done'; step: number }

export const pct = (p: number) => `${Math.round(p * 100)}%`

/** 에이전트 1: 기준 시각의 마지막 출력, 멈췄는지 */
export function a1Now(sim: Sim, clock: string): { point?: A1Point; started: boolean; ended: boolean } {
  const started = !!sim.a1.start && !isAfter(sim.a1.start, clock)
  const ended = !!sim.a1.stop && !isAfter(sim.a1.stop, clock)
  const point = sim.a1.points.filter(p => !isAfter(p.time, clock)).at(-1)
  return { point, started, ended }
}

/** 에이전트 4: 실행 시각 (퇴실 뒤에는 퇴실 시각) 과 그때의 예측 */
export function a4Now(cs: CaseData, sim: Sim, clock: string): { at?: string; ended: boolean; forecasts: A4Forecast[] } {
  if (!sim.a4.start || isAfter(sim.a4.start, clock)) return { ended: false, forecasts: [] }
  const ended = !isAfter(cs.icuOut, clock)
  const at = ended ? sim.ticks.at(-1)! : clock
  return { at, ended, forecasts: sim.a4.at(at) }
}

/** 예측이 24시간 안에 넘을 것으로 보는 기준 배수 (2 또는 5) */
export function crossing(cs: CaseData, f: A4Forecast, at: string): number | null {
  const u = uln(cs, f.code)
  const end = forecastAt(f, addHours(at, 24)).v
  for (const k of [5, 2]) if (f.last.value < k * u && end >= k * u) return k
  return null
}

export const e2Known = (sim: Sim, clock: string) => isKnown(sim.e2, clock)
export const e5Known = (sim: Sim, clock: string) => isKnown(sim.e5, clock)
