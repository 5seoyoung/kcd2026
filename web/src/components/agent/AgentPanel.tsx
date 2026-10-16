import type { AgentRun, CaseData, LiverEvent, PanelView, Patient, QaMsg, Ref } from '../../types'
import type { Sim } from '../../data'
import { mdhm } from '../../lib/time'
import { AgentCards } from './AgentCards'
import { Agent1 } from './Agent1'
import { Agent2 } from './Agent2'
import { Agent3 } from './Agent3'
import { Agent4 } from './Agent4'
import { QnA } from './QnA'
import { Notices } from './Notices'
import type { RunState } from './state'
import type { RagServer } from '../../data/rag'
import type { WikiAt } from '../WikiModal'

interface Props {
  patient: Patient
  cs?: CaseData
  sim?: Sim
  clock: string
  events: LiverEvent[]
  selected: PanelView
  onSelect: (v: PanelView) => void
  run?: AgentRun
  state: RunState
  onRun: () => void
  onSkip: () => void
  speed: number
  onSpeed: (s: number) => void
  onJump: (ref: Ref) => void
  qa: QaMsg[]
  qaPending: string | null
  onAsk: (input: { id: string } | { text: string }) => void
  server: RagServer | null
  onWiki: (at: WikiAt) => void
}

const NAMES: Record<PanelView, string> = { 1: '발생 예측', 2: '종료 상태 예측', 3: '원인 추정', 4: '24시간 궤적 예측', qa: '질의응답' }

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
          <AgentCards cs={cs} sim={sim} clock={clock} selected={p.selected} onSelect={p.onSelect} run={p.run} runState={p.state} qaCount={p.qa.length} />
          <Notices cs={cs} sim={sim} clock={clock} />
          <div className="ad-title">
            <span className={p.selected === 'qa' ? 'agc-no ask' : 'agc-no'}>{p.selected === 'qa' ? '?' : p.selected}</span>
            {NAMES[p.selected]}
          </div>
          <div className={p.selected === 'qa' ? 'agent-body qa-body' : 'agent-body'} role="tabpanel">
            {p.selected === 1 && <Agent1 cs={cs} sim={sim} clock={clock} events={p.events} />}
            {p.selected === 2 && <Agent2 cs={cs} sim={sim} clock={clock} onJump={p.onJump} />}
            {p.selected === 3 && (
              <Agent3
                cs={cs} sim={sim} clock={clock} run={p.run} state={p.state}
                onRun={p.onRun} onSkip={p.onSkip} speed={p.speed} onSpeed={p.onSpeed} onJump={p.onJump} onWiki={p.onWiki}
              />
            )}
            {p.selected === 4 && <Agent4 cs={cs} sim={sim} clock={clock} events={p.events} />}
            {p.selected === 'qa' && (
              <QnA
                cs={cs} sim={sim} clock={clock} run={p.state.phase === 'done' ? p.run : undefined}
                msgs={p.qa} pending={p.qaPending} server={p.server} onAsk={p.onAsk} onJump={p.onJump} onWiki={p.onWiki}
              />
            )}
          </div>
        </>
      )}
    </section>
  )
}
