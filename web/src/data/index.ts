import type { A1Point, A4Forecast, AgentRun, CaseData, EndState, LabResult, LiverEvent, ModelOutputs } from '../types'
import { CASES } from './cases'
import { runs } from './runs'
import { modelOutputs } from './models'
import { agent1At, agent4At } from './standin'
import { a1Points, a4From, modelRun, type ModelRun } from './modelrun'
import { A1_THRESHOLD, dischargeOf, endStateOf, EVENT_CODES, firstEvent, K_FIRST, K_TARGET, normalAt, preIcuAbnormal, publicAt } from '../lib/events'
import { ceilHour, hourly, isAfter, toMs } from '../lib/time'
import { siteNotices } from '../lib/uncertainty'

/**
 * 조기 예측 대상 아님 사유 (정상 구간이 한 번도 없음): ICU 에서 처음 잰 사건 항목이 이미 2배 이상이면 '입실 때 이미 이상',
 * 아니면 세 항목을 24시간 안에 함께 잰 적이 없음.
 */
function notEligibleWhy(cs: CaseData, first?: LiverEvent): string {
  const icu = cs.labs.filter(r => EVENT_CODES.includes(r.code) && !isAfter(cs.icuIn, r.charttime)).sort((a, b) => toMs(a.charttime) - toMs(b.charttime))
  return first && icu[0]?.charttime === first.drawn ? '입실 때 이미 이상' : '세 항목 24시간 안 측정 없음'
}

const cases: CaseData[] = CASES

export const getCase = (id: string): CaseData | undefined => cases.find(c => c.id === id)
export const getRun = (caseId: string): AgentRun | undefined => runs.find(r => r.caseId === caseId)
export const getModels = (caseId: string): ModelOutputs | undefined => modelOutputs.find(m => m.caseId === caseId)

/** 한 사례를 시간순으로 재생할 때 필요한 것: 정시 목록, 사건, 에이전트별 실행 구간과 출력 */
export interface Sim {
  ticks: string[]
  /** ICU 입실 전 같은 입원에서 이미 2배 이상이면 분석 코호트에서 빠짐 */
  excluded: boolean
  /** 첫 이상 (2배 사건). 에이전트 2, 3 이 이때 한 번 돈다 */
  first?: LiverEvent
  /** 5배 사건. 에이전트 1 의 정답 */
  target?: LiverEvent
  /** ICU 퇴실 때 판정 (회복 여부, 판정 가능 여부, 퇴실 때 마지막 값) */
  discharge?: { judged: boolean; recovered: boolean; last: LabResult[]; notRemeasured: string[] }
  /** 실제 종료 상태 (ICU 퇴실 때 알 수 있음). 판정 불가면 없음 */
  endState?: EndState
  a1: {
    start?: string
    /** 이 시각부터 멈춤 (첫 이상을 안 시각 또는 퇴실) */
    stop?: string
    threshold: number
    /** 정상 구간의 출력 */
    points: A1Point[]
    /** 정상 구간이 아니라 판정하지 않은 시각과 이유 */
    unknown: { time: string; why: string }[]
    firstAlarm?: string
    /** 대상 아님 사유: 정상 구간이 한 번도 없음 ('입실 때 이미 이상' 또는 '세 항목 24시간 안 측정 없음') */
    notEligible?: string
  }
  a4: { start?: string; at: (t: string) => A4Forecast[] }
  models?: ModelOutputs
  /** 모델 패키지를 적용한 출력. 없으면 에이전트 1, 4 는 대체 계산 (standin.ts) */
  run?: ModelRun
  /** 병원 공지: 이 병원 자료 전체에 해당하는 한계 */
  notices: string[]
}

const sims = new Map<string, Sim>()

export function getSim(cs: CaseData): Sim {
  const hit = sims.get(cs.id)
  if (hit) return hit

  const ticks = hourly(ceilHour(cs.icuIn), ceilHour(cs.icuOut))
  const excluded = preIcuAbnormal(cs)
  const first = excluded ? undefined : firstEvent(cs, K_FIRST)
  const target = excluded ? undefined : firstEvent(cs, K_TARGET)
  const discharge = first && dischargeOf(cs, first)
  const dead = cs.outcome.icuDeath

  // 에이전트 1, 4 는 ICU 입실부터 돈다. 같은 입원의 입실 전 응급실·병동 검사도 입력에 들어가므로 (MODEL_CARD),
  // 첫 간 검사 결과가 입실 전에 공개되었으면 입실 시각부터, 아니면 첫 결과가 공개된 뒤 첫 정시부터
  const firstPublic = cs.labs
    .filter(r => EVENT_CODES.includes(r.code))
    .map(publicAt)
    .sort((a, b) => toMs(a) - toMs(b))[0]
  const start = !excluded && firstPublic ? (isAfter(ceilHour(firstPublic), ticks[0]) ? ceilHour(firstPublic) : ticks[0]) : undefined
  const stop = first ? first.detectAt : ticks.at(-1)
  const run = modelRun(cs.id)
  const fromModel = run ? new Map(a1Points(run).map(p => [p.time, p])) : null
  const points: A1Point[] = []
  const unknown: Sim['a1']['unknown'] = []
  if (start) {
    for (const t of ticks.filter(t => toMs(t) >= toMs(start) && toMs(t) < toMs(stop!))) {
      const n = normalAt(cs, t)
      const p = n.ok ? (fromModel ? fromModel.get(t) : agent1At(cs, t)) : undefined
      if (p) points.push(p)
      else unknown.push({ time: t, why: n.why ?? '모델 출력 없음' })
    }
  }

  const sim: Sim = {
    ticks,
    excluded,
    first,
    target,
    discharge,
    endState: discharge?.judged ? endStateOf(discharge.recovered, dead) : undefined,
    a1: {
      start, stop, threshold: A1_THRESHOLD, points, unknown, firstAlarm: points.find(p => p.p >= A1_THRESHOLD)?.time,
      notEligible: !points.length && (first || start) ? notEligibleWhy(cs, first) : undefined,
    },
    a4: { start, at: t => (run ? a4From(run, cs, t) : agent4At(cs, t)) },
    models: getModels(cs.id),
    run,
    notices: siteNotices(run?.meta.connected),
  }
  sims.set(cs.id, sim)
  return sim
}
