import { useState } from 'react'
import type { AgentStep } from '../../types'
import { cls } from '../../lib/ui'
import { tr } from '../../lib/i18n'

interface Props {
  steps: AgentStep[]
  step: number
  running: boolean
  speed: number
  onSpeed: (s: number) => void
  onSkip: () => void
}

export function StepList({ steps, step, running, speed, onSpeed, onSkip }: Props) {
  const [open, setOpen] = useState(false)
  const total = steps.reduce((s, x) => s + x.ms, 0) / 1000
  const show = running || open
  return (
    <div className="steps">
      <div className="steps-head">
        <strong>{tr('도구 호출', 'Tool calls')}</strong>
        <span className="muted">
          {Math.min(step, steps.length)}/{steps.length}{tr('단계', ' steps')}{!running && tr(` · ${total.toFixed(1)}초`, ` · ${total.toFixed(1)} s`)}
        </span>
        <span className="spacer" />
        {running ? (
          <>
            <span className="muted">{tr('속도', 'Speed')}</span>
            {[1, 2, 4].map(s => (
              <button key={s} className={cls('btn mini', speed === s && 'on')} onClick={() => onSpeed(s)}>{s}×</button>
            ))}
            <button className="btn mini" onClick={onSkip}>{tr('건너뛰기', 'Skip')}</button>
          </>
        ) : (
          <button className="link" onClick={() => setOpen(o => !o)}>{open ? tr('접기', 'Collapse') : tr('단계 펼치기', 'Show steps')}</button>
        )}
      </div>
      {show && (
        <ol className="step-list">
          {steps.map((s, i) => {
            const state = i < step ? 'done' : i === step && running ? 'cur' : 'todo'
            return (
              <li key={s.id} className={`st ${state}`}>
                <span className="st-icon" aria-label={state === 'done' ? tr('완료', 'done') : state === 'cur' ? tr('실행 중', 'running') : tr('대기', 'waiting')} />
                <div className="st-body">
                  <div className="st-title">
                    <code>{s.tool}</code> {s.title}
                    {s.tool === 'query_model1' && <span className="b-only">{tr('보조 · 판정에 안 씀', 'Supporting · not used in the call')}</span>}
                  </div>
                  {state === 'done' && <div className="st-sum">{s.summary}</div>}
                  {state === 'done' && s.details?.map(d => <div key={d} className="st-detail">{d}</div>)}
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
