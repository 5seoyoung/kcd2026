import type { ReactNode } from 'react'
import type { AgentRun, CaseData, PanelView } from '../../types'
import type { Sim } from '../../data'
import { causeName } from '../../data/causes'
import { END_STATES, itemOf, RULE_THRESHOLD, uln } from '../../lib/events'
import { fmtNum } from '../../lib/lab'
import { hm, isAfter, mdhm } from '../../lib/time'
import { cls } from '../../lib/ui'
import { a1Now, a1Verdict, a4Now, crossing, firstKnown, pct, type RunState } from './state'

interface Props {
  cs: CaseData
  sim: Sim
  clock: string
  selected: PanelView
  onSelect: (v: PanelView) => void
  run?: AgentRun
  runState: RunState
  qaCount: number
}

type Status = 'wait' | 'live' | 'run' | 'done' | 'off'

interface Card {
  id: 1 | 2 | 3 | 4
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

export function AgentCards({ cs, sim, clock, selected, onSelect, run, runState, qaCount }: Props) {
  const cards: Card[] = []

  // 1 발생 예측
  {
    const { point, unknown, started, ended } = a1Now(sim, clock)
    const base = { id: 1 as const, name: '발생 예측', when: '첫 이상 전 매시간' }
    const v = a1Verdict(sim, clock)
    if (sim.excluded) cards.push({ ...base, status: 'off', statusText: '대상 아님', main: '–', sub: 'ICU 입실 전 이미 2배 이상', stamp: 'na' })
    else if (!started) cards.push({ ...base, status: 'wait', statusText: '대기', main: '–', sub: '첫 간 검사 결과 대기', stamp: 'wait' })
    else if (v) {
      const main =
        v.pending ? <>첫 이상으로 멈춤</>
        : v.kind === 'hit' ? <>경보 적중{v.lead !== undefined && <> · 사건 <b>{Math.floor(v.lead)}시간</b> 전</>}</>
        : v.kind === 'miss' ? <>경보 없이 사건</>
        : v.kind === 'false' ? <>경보 뒤 사건 없음</>
        : <>경보 없음 · 사건 없음</>
      cards.push({
        ...base, status: 'off', statusText: '종료', stamp: v.pending ? 'stop' : v.kind,
        main,
        sub: v.pending ? `정답 확인 중 · ${mdhm(v.until)} 까지` : v.target ? `5배 사건 ${mdhm(v.target.t0)} 공개` : `${mdhm(v.until)} 까지 5배 사건 없음`,
      })
    } else if (ended) cards.push({ ...base, status: 'off', statusText: '종료', main: 'ICU 퇴실로 멈춤', sub: '첫 이상 없음', stamp: 'out' })
    else if (unknown) cards.push({ ...base, status: 'live', statusText: '매시간', main: <span className="agc-unk">판정 불가</span>, sub: unknown, stamp: `u-${clock}` })
    else if (!point) cards.push({ ...base, status: 'wait', statusText: '대기', main: '–', sub: '정상 구간 대기', stamp: 'wait' })
    else {
      const alarm = point.p >= sim.a1.threshold
      cards.push({
        ...base, status: 'live', statusText: '매시간', stamp: point.time, alarm,
        main: <><b className="agc-num">{pct(point.p)}</b>{alarm && <span className="agc-alarm">경보</span>}</>,
        sub: `24시간 안 5배 사건 · ${hm(point.time)} 실행`,
      })
    }
  }

  // 2 종료 상태
  {
    const base = { id: 2 as const, name: '종료 상태', when: '첫 이상 때 1회' }
    const out = sim.models?.agent2
    if (!firstKnown(sim, clock) || !out) cards.push({ ...base, status: 'wait', statusText: '대기', main: '–', sub: '첫 이상 (2배) 없음', stamp: 'wait' })
    else {
      const top = END_STATES.reduce((a, b) => (out.probs[b.key] > out.probs[a.key] ? b : a))
      const done = !isAfter(cs.icuOut, clock)
      const actual = END_STATES.find(s => s.key === sim.endState)
      cards.push({
        ...base, status: 'done', statusText: '완료', stamp: 'done',
        main: <>{top.label} <b className="agc-num">{pct(out.probs[top.key])}</b></>,
        sub: done ? (actual ? `실제 ${actual.label}` : '실제 판정 불가') : `ICU 퇴실 때 · ${mdhm(sim.first!.detectAt)} 실행`,
      })
    }
  }

  // 3 원인 추정
  {
    const base = { id: 3 as const, name: '원인 추정', when: '첫 이상 때 1회' }
    if (!firstKnown(sim, clock) || !run) cards.push({ ...base, status: 'wait', statusText: '대기', main: '–', sub: '첫 이상 (2배) 없음', stamp: 'wait' })
    else if (runState.phase === 'running') {
      cards.push({
        ...base, status: 'run', statusText: '실행 중', stamp: 'run',
        main: <>{runState.step + 1}/{run.steps.length} 단계</>, sub: run.steps[runState.step].title,
      })
    } else if (runState.phase === 'done') {
      const hits = run.calls.filter(c => c.score !== null && c.score >= RULE_THRESHOLD).sort((a, b) => b.score! - a.score!)
      cards.push({
        ...base, status: 'done', statusText: '완료', stamp: 'done',
        main: hits.length ? <><b>{causeName(hits[0].cause)}</b>{hits.length > 1 && <span className="muted"> 외 {hits.length - 1}</span>}</> : '해당 범주 없음',
        sub: `범주 10개 중 ${hits.length}개 해당 · ${mdhm(sim.first!.detectAt)} 실행`,
      })
    } else cards.push({ ...base, status: 'wait', statusText: '대기', main: '실행 전', sub: '원인 범주 10개 규칙 판정', stamp: 'idle' })
  }

  // 4 24시간 궤적: 마지막 값의 배수가 가장 큰 항목을 보여 줌
  {
    const base = { id: 4 as const, name: '24시간 궤적', when: '매시간' }
    const { at, ended, forecasts } = a4Now(cs, sim, clock)
    if (!at) cards.push({ ...base, status: 'wait', statusText: '대기', main: '–', sub: '첫 간 검사 결과 대기', stamp: 'wait' })
    else if (!forecasts.length) cards.push({ ...base, status: 'live', statusText: '매시간', main: <span className="agc-unk">예측 없음</span>, sub: '최근 24시간 안 간 검사 없음', stamp: `n-${at}` })
    else {
      const f = forecasts.reduce((a, b) => (b.last.value / uln(cs, b.code) > a.last.value / uln(cs, a.code) ? b : a))
      const it = itemOf(cs, f.code)
      const end = f.points.at(-1)!.v
      const ratio = end / f.last.value
      const arrow = ratio > 1.1 ? '↑' : ratio < 0.9 ? '↓' : '→'
      const k = crossing(cs, f)
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
      <button role="tab" aria-selected={selected === 'qa'} className={cls('ag-qa', selected === 'qa' && 'sel')} onClick={() => onSelect('qa')}>
        <span className="agc-no ask" aria-hidden>?</span>
        <b>질의응답</b>
        <span className="muted">이 환자 기록과 근거 위키로 답합니다</span>
        <span className="spacer" />
        {qaCount > 0 && <span className="agc-st off">{qaCount}건</span>}
      </button>
    </div>
  )
}
