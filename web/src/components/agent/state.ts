// 기준 시각에서 각 에이전트가 어디까지 왔는지 계산한다. 카드, 상세 화면, 상태 줄이 같이 쓴다.
import type { A1Point, A4Forecast, CaseData, Confidence, LiverEvent } from '../../types'
import type { Sim } from '../../data'
import { isKnown, uln } from '../../lib/events'
import { addHours, hoursBetween, isAfter } from '../../lib/time'
import { tr } from '../../lib/i18n'

export type RunState = { phase: 'idle' | 'running' | 'done'; step: number }

export { pct } from '../../lib/ui'

/** 확신 표시 ('확신 낮음'). level 값은 한국어 그대로 두고 화면에서만 바꿈 */
export const confLabel = (level: Confidence['level']) => tr(`확신 ${level}`, level === '낮음' ? 'Confidence low' : 'Confidence high')

/** 에이전트 1: 기준 시각의 마지막 출력, 이번 시각이 판정 불가인지, 멈췄는지 */
export function a1Now(sim: Sim, clock: string): { point?: A1Point; unknown?: string; started: boolean; ended: boolean } {
  const started = !!sim.a1.start && !isAfter(sim.a1.start, clock)
  const ended = !!sim.a1.stop && !isAfter(sim.a1.stop, clock)
  const point = sim.a1.points.filter(p => !isAfter(p.time, clock)).at(-1)
  const unknown = ended ? undefined : sim.a1.unknown.find(u => u.time === clock)?.why
  return { point, unknown, started, ended }
}

/**
 * 에이전트 1 의 정답 확인: 첫 이상으로 멈춘 뒤, 마지막 출력에서 24시간 안에 5배 사건이 생겼는지.
 * hit 경보 뒤 사건, miss 경보 없이 사건, false 경보했는데 사건 없음, quiet 경보 없고 사건 없음.
 */
export function a1Verdict(sim: Sim, clock: string):
  | { last: A1Point; until: string; pending: true }
  | { last: A1Point; until: string; pending: false; kind: 'hit' | 'miss' | 'false' | 'quiet'; target?: LiverEvent; lead?: number }
  | null {
  if (!sim.first || !sim.a1.stop || isAfter(sim.a1.stop, clock)) return null
  const last = sim.a1.points.at(-1)
  if (!last) return null
  const until = addHours(last.time, 24)
  const t = sim.target
  const occurred = !!t && !isAfter(t.t0, until) && isKnown(t, clock)
  if (!occurred && isAfter(until, clock)) return { last, until, pending: true }
  const alarm = last.p >= sim.a1.threshold
  const lead = occurred && sim.a1.firstAlarm ? hoursBetween(sim.a1.firstAlarm, t!.t0) : undefined
  return { last, until, pending: false, kind: occurred ? (alarm ? 'hit' : 'miss') : alarm ? 'false' : 'quiet', target: occurred ? t : undefined, lead }
}

/** 에이전트 4: 실행 시각 (퇴실 뒤에는 퇴실 시각) 과 그때의 예측 */
export function a4Now(cs: CaseData, sim: Sim, clock: string): { at?: string; ended: boolean; forecasts: A4Forecast[] } {
  if (!sim.a4.start || isAfter(sim.a4.start, clock)) return { ended: false, forecasts: [] }
  const ended = !isAfter(cs.icuOut, clock)
  const at = ended ? sim.ticks.at(-1)! : clock
  return { at, ended, forecasts: sim.a4.at(at) }
}

/** 예측이 24시간 안에 넘을 것으로 보는 기준 배수 (2 또는 5). 중앙값 기준 */
export function crossing(cs: CaseData, f: A4Forecast): number | null {
  const u = uln(cs, f.code)
  const top = Math.max(...f.points.map(p => p.v))
  for (const k of [5, 2]) if (f.last.value < k * u && top >= k * u) return k
  return null
}

/** 종료 상태와 원인 추정이 도는 5배 사건을 기준 시각에 알고 있는지 */
export const targetKnown = (sim: Sim, clock: string) => isKnown(sim.target, clock)
