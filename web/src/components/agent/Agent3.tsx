import type { AgentRun, CaseData, Ref } from '../../types'
import type { Sim } from '../../data'
import { isKnown, RULE_THRESHOLD } from '../../lib/events'
import { mdhm } from '../../lib/time'
import { EventCard } from './EventCard'
import { StepList } from './StepList'
import { Result } from './Result'
import { TopValue } from './Agent2'
import type { RunState } from './state'
import type { WikiAt } from '../WikiModal'

interface Props {
  cs: CaseData
  sim: Sim
  clock: string
  run?: AgentRun
  state: RunState
  onRun: () => void
  onSkip: () => void
  speed: number
  onSpeed: (s: number) => void
  onJump: (ref: Ref) => void
  onWiki: (at: WikiAt) => void
}

export function Agent3(p: Props) {
  const { cs, sim, clock, run, state } = p
  const ev = sim.first
  if (!isKnown(ev, clock) || !run) {
    return (
      <div className="ad-wait">
        <div>첫 이상 (ALT, ALP, 총빌리 중 하나가 2 x ULN 이상) 이 공개되면 그 시점에 한 번 실행합니다.</div>
        <TopValue cs={cs} clock={clock} />
      </div>
    )
  }
  const running = state.phase === 'running'
  return (
    <div className="ad">
      <div className="agent-cond">
        <span className="muted">
          원인 범주 10개 · 규칙 점수 {RULE_THRESHOLD.toFixed(1)} 이상이면 해당 · {mdhm(ev.detectAt)} 실행
        </span>
        <span className="spacer" />
        {state.phase === 'done' && <button className="btn" onClick={p.onRun}>다시 실행</button>}
      </div>
      <EventCard cs={cs} ev={ev} compact={state.phase !== 'idle'} onJump={p.onJump} />
      {state.phase === 'idle' && (
        <div className="run-box">
          <button className="btn agent-run" onClick={p.onRun}>▶ 원인 분석 실행</button>
          <p className="muted">t0 까지 공개된 기록으로 원인 범주 10개의 규칙 점수와 근거를 계산하고, 범주마다 근거 위키의 진단 기준을 붙입니다. 여러 범주가 함께 해당할 수 있습니다.</p>
        </div>
      )}
      {state.phase !== 'idle' && (
        <StepList steps={run.steps} step={state.step} running={running} speed={p.speed} onSpeed={p.onSpeed} onSkip={p.onSkip} />
      )}
      {state.phase === 'done' && <Result run={run} models={sim.models} onJump={p.onJump} onWiki={p.onWiki} />}
    </div>
  )
}
