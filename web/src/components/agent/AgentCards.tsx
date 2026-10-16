import type { ReactNode } from 'react'
import type { AgentId, AgentRun, CaseData, Condition } from '../../types'
import type { Sim } from '../../data'
import { causeName } from '../../data/causes'
import { forecastAt } from '../../data/standin'
import { END_STATES, itemOf, uln } from '../../lib/events'
import { fmtNum } from '../../lib/lab'
import { addHours, hm, hoursBetween, isAfter, mdhm } from '../../lib/time'
import { cls } from '../../lib/ui'
import { a1Now, a4Now, crossing, e2Known, e5Known, pct, type RunState } from './state'

interface Props {
  cs: CaseData
  sim: Sim
  clock: string
  selected: AgentId
  onSelect: (a: AgentId) => void
  run?: AgentRun
  runState: RunState
  condition: Condition
}

type Status = 'wait' | 'live' | 'run' | 'done' | 'off'

interface Card {
  id: AgentId
  name: string
  when: string
  status: Status
  statusText: string
  main: ReactNode
  sub: string
  /** 출력이 바뀔 때마다 바뀌는 값 (바뀌면 잠깐 강조) */
  stamp: string
  alarm?: boolean
}

const short = (name: string) => name.split(' (')[0]

export function AgentCards({ cs, sim, clock, selected, onSelect, run, runState, condition }: Props) {
  const cards: Card[] = []

  // 1 발생 예측
  {
    const { point, started, ended } = a1Now(sim, clock)
    const base = { id: 1 as const, name: '발생 예측', when: '매시간' }
    if (!sim.a1.eligible) cards.push({ ...base, status: 'off', statusText: '대상 아님', main: '–', sub: 'ICU 첫 채혈부터 5배 이상', stamp: 'na' })
    else if (!started || !point) cards.push({ ...base, status: 'wait', statusText: '대기', main: '–', sub: '첫 간 검사 결과 대기', stamp: 'wait' })
    else if (ended && sim.e5) {
      const lead = sim.a1.firstAlarm ? hoursBetween(sim.a1.firstAlarm, sim.e5.t0) : null
      cards.push({
        ...base, status: 'off', statusText: '종료', stamp: 'end',
        main: lead !== null ? <>사건 <b>{Math.floor(lead)}시간</b> 전 경보</> : '경보 없이 사건',
        sub: `5배 사건으로 멈춤 · ${mdhm(sim.e5.t0)} 채혈`,
      })
    } else {
      const alarm = point.p >= sim.a1.threshold
      cards.push({
        ...base, status: 'live', statusText: ended ? '종료' : '매시간', stamp: point.time, alarm,
        main: <><b className="agc-num">{pct(point.p)}</b>{alarm && <span className="agc-alarm">경보</span>}</>,
        sub: `24시간 안 5배 사건 · ${hm(point.time)} 실행`,
      })
    }
  }

  // 2 종료 상태
  {
    const base = { id: 2 as const, name: '종료 상태', when: '2배 사건 때 1회' }
    const out = sim.models?.agent2
    if (!e2Known(sim, clock) || !out) cards.push({ ...base, status: 'wait', statusText: '대기', main: '–', sub: '2배 사건 없음', stamp: 'wait' })
    else {
      const top = END_STATES.reduce((a, b) => (out.probs[b.key] > out.probs[a.key] ? b : a))
      const done = !isAfter(cs.icuOut, clock)
      const actual = END_STATES.find(s => s.key === sim.endState)
      cards.push({
        ...base, status: 'done', statusText: '완료', stamp: 'done',
        main: <>{top.label} <b className="agc-num">{pct(out.probs[top.key])}</b></>,
        sub: done && actual ? `실제 ${actual.label}` : `ICU 퇴실 때 · ${mdhm(sim.e2!.detectAt)} 실행`,
      })
    }
  }

  // 3 원인 추정
  {
    const base = { id: 3 as const, name: '원인 추정', when: '5배 사건 때 1회' }
    if (!e5Known(sim, clock) || !run) cards.push({ ...base, status: 'wait', statusText: '대기', main: '–', sub: '5배 사건 없음', stamp: 'wait' })
    else if (runState.phase === 'running') {
      cards.push({
        ...base, status: 'run', statusText: '실행 중', stamp: 'run',
        main: <>{runState.step + 1}/{run.steps.length} 단계</>, sub: run.steps[runState.step].title,
      })
    } else if (runState.phase === 'done') {
      cards.push({
        ...base, status: 'done', statusText: '완료', stamp: `done-${condition}`,
        main: <>1순위 <b>{causeName(run.candidates[0].cause)}</b></>,
        sub: `${condition} 조건 · ${mdhm(sim.e5!.detectAt)} 실행`,
      })
    } else cards.push({ ...base, status: 'wait', statusText: '대기', main: '실행 전', sub: `${condition} 조건`, stamp: 'idle' })
  }

  // 4 24시간 궤적: 마지막 값의 배수가 가장 큰 항목을 보여 줌
  {
    const base = { id: 4 as const, name: '24시간 궤적', when: '매시간' }
    const { at, ended, forecasts } = a4Now(cs, sim, clock)
    if (!at || !forecasts.length) cards.push({ ...base, status: 'wait', statusText: '대기', main: '–', sub: '첫 간 검사 결과 대기', stamp: 'wait' })
    else {
      const f = forecasts.reduce((a, b) => (b.last.value / uln(cs, b.code) > a.last.value / uln(cs, a.code) ? b : a))
      const it = itemOf(cs, f.code)
      const end = forecastAt(f, addHours(at, 24)).v
      const ratio = end / f.last.value
      const arrow = ratio > 1.1 ? '↑' : ratio < 0.9 ? '↓' : '→'
      const k = crossing(cs, f, at)
      cards.push({
        ...base, status: ended ? 'off' : 'live', statusText: ended ? '종료' : '매시간', stamp: at, alarm: k === 5,
        main: <>{short(it.name)} {fmtNum(f.last.value, it.dp)} → <b className="agc-num">{fmtNum(end, it.dp)}</b> {arrow}</>,
        sub: ended ? 'ICU 퇴실로 멈춤' : k ? `24시간 안 ${k}배 넘을 것으로 예측` : `24시간 뒤 예측 · ${hm(at)} 실행`,
      })
    }
  }

  return (
    <div className="ag-cards" role="tablist" aria-label="에이전트">
      {cards.map(c => (
        <button
          key={c.id}
          role="tab"
          aria-selected={selected === c.id}
          className={cls('ag-card', c.status, selected === c.id && 'sel', c.alarm && 'alarm')}
          onClick={() => onSelect(c.id)}
        >
          <span className="agc-top">
            <span className="agc-no">{c.id}</span>
            <b>{c.name}</b>
            <span className="agc-when">{c.when}</span>
            <span className="spacer" />
            <span className={`agc-st ${c.status}`}>{c.statusText}</span>
          </span>
          <span key={c.stamp} className="agc-main">{c.main}</span>
          <span className="agc-sub">{c.sub}</span>
        </button>
      ))}
    </div>
  )
}
