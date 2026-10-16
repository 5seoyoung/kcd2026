import type { AgentRun, CaseData, Condition, Ref } from '../../types'
import type { Sim } from '../../data'
import { isKnown } from '../../lib/events'
import { cls } from '../../lib/ui'
import { EventCard } from './EventCard'
import { StepList } from './StepList'
import { Result } from './Result'
import { TopValue } from './Agent2'
import type { RunState } from './state'

interface Props {
  cs: CaseData
  sim: Sim
  clock: string
  run?: AgentRun
  other?: AgentRun
  state: RunState
  condition: Condition
  onCondition: (c: Condition) => void
  onRun: () => void
  onSkip: () => void
  speed: number
  onSpeed: (s: number) => void
  onJump: (ref: Ref) => void
}

export function Agent3(p: Props) {
  const { cs, sim, clock, run, state } = p
  const e5 = sim.e5
  if (!isKnown(e5, clock) || !run) {
    return (
      <div className="ad-wait">
        <div>5배 사건 (ALT, ALP, 총빌리 중 하나가 5 x ULN 이상) 이 생기면 그 시점에 한 번 실행합니다.</div>
        <TopValue cs={cs} clock={clock} />
      </div>
    )
  }
  const running = state.phase === 'running'
  return (
    <div className="ad">
      <div className="agent-cond">
        <span className="muted">조건</span>
        <div className="seg-group" role="radiogroup" aria-label="실행 조건">
          {(['A', 'B'] as const).map(c => (
            <button
              key={c}
              role="radio"
              aria-checked={p.condition === c}
              className={cls('seg-btn', p.condition === c && 'on')}
              onClick={() => p.onCondition(c)}
              disabled={running}
            >
              {c === 'A' ? 'A 기본' : 'B 군집 정보 추가'}
            </button>
          ))}
        </div>
        <span className="spacer" />
        {state.phase === 'done' && <button className="btn" onClick={p.onRun}>다시 실행</button>}
      </div>
      <EventCard cs={cs} ev={e5} compact={state.phase !== 'idle'} onJump={p.onJump} />
      {state.phase === 'idle' && (
        <div className="run-box">
          <button className="btn agent-run" onClick={p.onRun}>▶ {p.condition} 조건으로 원인 분석 실행</button>
          <p className="muted">
            t0 까지의 기록으로 원인 후보를 3순위까지 찾고 근거를 붙입니다.
            {p.condition === 'B' && ' B 조건은 모델 1 의 군집 정보를 함께 씁니다.'}
          </p>
        </div>
      )}
      {state.phase !== 'idle' && (
        <StepList steps={run.steps} step={state.step} running={running} speed={p.speed} onSpeed={p.onSpeed} onSkip={p.onSkip} />
      )}
      {state.phase === 'done' && <Result run={run} other={p.other} condition={p.condition} models={sim.models} onJump={p.onJump} />}
    </div>
  )
}
