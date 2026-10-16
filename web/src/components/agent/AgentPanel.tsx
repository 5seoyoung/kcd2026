import type { AgentId, AgentRun, CaseData, Condition, LiverEvent, Patient, Ref } from '../../types'
import type { Sim } from '../../data'
import { mdhm } from '../../lib/time'
import { AgentCards } from './AgentCards'
import { Agent1 } from './Agent1'
import { Agent2 } from './Agent2'
import { Agent3 } from './Agent3'
import { Agent4 } from './Agent4'
import type { RunState } from './state'

interface Props {
  patient: Patient
  cs?: CaseData
  sim?: Sim
  clock: string
  events: LiverEvent[]
  selected: AgentId
  onSelect: (a: AgentId) => void
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

const NAMES: Record<AgentId, string> = { 1: '발생 예측', 2: '종료 상태 예측', 3: '원인 추정', 4: '24시간 궤적 예측' }

export function AgentPanel(p: Props) {
  const { cs, sim, clock } = p
  return (
    <section className="panel agent" aria-label="간 검사 이상 에이전트">
      <div className="panel-head agent-head">
        <span className="ai-mark" aria-hidden>AI</span>
        간 검사 이상 에이전트
        <span className="spacer" />
        {sim && <span className="head-sub mono">{mdhm(clock)} 기준</span>}
      </div>
      {!cs || !sim ? (
        <div className="agent-empty">
          <div className="muted">{p.patient.liverAlert ? '아직 분석 결과가 없습니다.' : '간 검사 이상 알림이 없습니다.'}</div>
        </div>
      ) : (
        <>
          <AgentCards cs={cs} sim={sim} clock={clock} selected={p.selected} onSelect={p.onSelect} run={p.run} runState={p.state} condition={p.condition} />
          <div className="ad-title">
            <span className="agc-no">{p.selected}</span>
            {NAMES[p.selected]}
          </div>
          <div className="agent-body" role="tabpanel">
            {p.selected === 1 && <Agent1 sim={sim} clock={clock} events={p.events} />}
            {p.selected === 2 && <Agent2 cs={cs} sim={sim} clock={clock} onJump={p.onJump} />}
            {p.selected === 3 && (
              <Agent3
                cs={cs} sim={sim} clock={clock} run={p.run} other={p.other} state={p.state}
                condition={p.condition} onCondition={p.onCondition} onRun={p.onRun} onSkip={p.onSkip}
                speed={p.speed} onSpeed={p.onSpeed} onJump={p.onJump}
              />
            )}
            {p.selected === 4 && <Agent4 cs={cs} sim={sim} clock={clock} events={p.events} />}
          </div>
        </>
      )}
    </section>
  )
}
