import type { A1Point, A4Forecast, AgentRun, CaseData, Condition, EndState, LabResult, LiverEvent, ModelOutputs } from '../types'
import { case01 } from './case01'
import { runs } from './runs'
import { modelOutputs } from './models'
import { agent1At, agent4At } from './standin'
import { A1_THRESHOLD, endStateOf, EVENT_CODES, firstEvent, inIcu, K_A1, K_A2, K_A3, recoveryOf, uln } from '../lib/events'
import { ceilHour, hourly, toMs } from '../lib/time'

const cases: CaseData[] = [case01]

export const getCase = (id: string): CaseData | undefined => cases.find(c => c.id === id)
export const getRun = (caseId: string, condition: Condition): AgentRun | undefined =>
  runs.find(r => r.caseId === caseId && r.condition === condition)
export const getModels = (caseId: string): ModelOutputs | undefined => modelOutputs.find(m => m.caseId === caseId)

/** 한 사례를 시간순으로 재생할 때 필요한 것: 정시 목록, 사건, 에이전트별 실행 구간과 출력 */
export interface Sim {
  ticks: string[]
  /** 2배 사건 (에이전트 2) */
  e2?: LiverEvent
  /** 5배 사건 (에이전트 1 의 정답, 에이전트 3 의 실행 시점) */
  e5?: LiverEvent
  /** 2배 사건 뒤 트리거 항목이 2 x ULN 미만으로 내려온 결과 */
  recovery?: LabResult
  /** 실제 종료 상태 (ICU 퇴실 때 알 수 있음) */
  endState?: EndState
  a1: {
    /** ICU 첫 채혈이 5배 미만이어야 대상 */
    eligible: boolean
    start?: string
    /** 이 시각부터 멈춤 (5배 사건을 안 시각 또는 퇴실) */
    stop?: string
    threshold: number
    points: A1Point[]
    firstAlarm?: string
  }
  a4: { start?: string; at: (t: string) => A4Forecast[] }
  models?: ModelOutputs
}

const sims = new Map<string, Sim>()

export function getSim(cs: CaseData): Sim {
  const hit = sims.get(cs.id)
  if (hit) return hit

  const ticks = hourly(ceilHour(cs.icuIn), ceilHour(cs.icuOut))
  const e2 = firstEvent(cs, K_A2)
  const e5 = firstEvent(cs, K_A3)
  const recovery = e2 && recoveryOf(cs, e2)
  const dead = cs.outcome.icuDeath || cs.outcome.death1y

  // 에이전트 1, 4 는 ICU 에서 첫 간 검사 결과가 나온 뒤부터 돈다
  const liver = cs.labs.filter(r => EVENT_CODES.includes(r.code) && inIcu(cs, r.charttime)).sort((a, b) => toMs(a.charttime) - toMs(b.charttime))
  const firstDraw = liver.filter(r => r.charttime === liver[0]?.charttime)
  const start = firstDraw.length ? ceilHour(firstDraw.map(r => r.storetime).sort((a, b) => toMs(a) - toMs(b)).at(-1)!) : undefined
  const eligible = firstDraw.length > 0 && firstDraw.every(r => r.value < K_A1 * uln(cs, r.code))
  const stop = e5 ? e5.detectAt : ticks.at(-1)
  const points = eligible && start ? ticks.filter(t => toMs(t) >= toMs(start) && toMs(t) < toMs(stop!)).map(t => agent1At(cs, t)) : []

  const sim: Sim = {
    ticks,
    e2,
    e5,
    recovery,
    endState: e2 ? endStateOf(!!recovery, dead) : undefined,
    a1: { eligible, start, stop, threshold: A1_THRESHOLD, points, firstAlarm: points.find(p => p.p >= A1_THRESHOLD)?.time },
    a4: { start, at: t => agent4At(cs, t) },
    models: getModels(cs.id),
  }
  sims.set(cs.id, sim)
  return sim
}
