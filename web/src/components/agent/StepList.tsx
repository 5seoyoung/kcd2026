import { useState } from 'react'
import type { AgentStep } from '../../types'
import { cls } from '../../lib/ui'

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
        <strong>도구 호출</strong>
        <span className="muted">{Math.min(step, steps.length)}/{steps.length}단계{!running && ` · ${total.toFixed(1)}초`}</span>
        <span className="spacer" />
        {running ? (
          <>
            <span className="muted">속도</span>
            {[1, 2, 4].map(s => (
              <button key={s} className={cls('btn mini', speed === s && 'on')} onClick={() => onSpeed(s)}>{s}×</button>
            ))}
            <button className="btn mini" onClick={onSkip}>건너뛰기</button>
          </>
        ) : (
          <button className="link" onClick={() => setOpen(o => !o)}>{open ? '접기' : '단계 펼치기'}</button>
        )}
      </div>
      {show && (
        <ol className="step-list">
          {steps.map((s, i) => {
            const state = i < step ? 'done' : i === step && running ? 'cur' : 'todo'
            return (
              <li key={s.id} className={`st ${state}`}>
                <span className="st-icon" aria-label={state === 'done' ? '완료' : state === 'cur' ? '실행 중' : '대기'} />
                <div className="st-body">
                  <div className="st-title">
                    <code>{s.tool}</code> {s.title}
                    {s.tool === 'query_model1' && <span className="b-only">B 조건만</span>}
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
