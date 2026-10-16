import { useState } from 'react'
import type { AgentRun, CauseCall, Evidence, GuideLine, ModelOutputs, Ref } from '../../types'
import type { WikiAt } from '../WikiModal'
import { CAUSE_WIKI, causeName } from '../../data/causes'
import { RULE_THRESHOLD } from '../../lib/events'
import { cls } from '../../lib/ui'

interface Props {
  run: AgentRun
  models?: ModelOutputs
  onJump: (ref: Ref) => void
  onWiki: (at: WikiAt) => void
}

/** 근거 위키에서 가져온 진단 기준과 근거 공백 */
function GuideList({ items, onWiki }: { items: GuideLine[]; onWiki: (at: WikiAt) => void }) {
  if (!items.length) return null
  return (
    <div className="ev-group guide">
      <div className="ev-label">지침 근거 · 근거 위키</div>
      {items.map(g => {
        const isGap = g.cite === '근거 공백'
        return (
          <button key={g.text} className={cls('ev jump', isGap && 'gap')} onClick={() => onWiki({ page: g.page, heading: g.heading })}>
            <span className="ev-mark" aria-hidden>{isGap ? '∅' : '§'}</span>
            <span className="ev-text">{g.text} <span className="ev-cite">{g.cite}</span></span>
            <span className="ev-go">위키 ›</span>
          </button>
        )
      })}
    </div>
  )
}

/** 점수 막대의 오른쪽 끝 */
const SCORE_MAX = 3

function EvList({ kind, label, items, onJump }: { kind: 'support' | 'against' | 'missing'; label: string; items: Evidence[]; onJump: (r: Ref) => void }) {
  if (!items.length) return null
  const mark = kind === 'support' ? '+' : kind === 'against' ? '−' : '?'
  return (
    <div className={`ev-group ${kind}`}>
      <div className="ev-label">{label}</div>
      {items.map(ev => {
        const body = (
          <>
            <span className="ev-mark" aria-hidden>{mark}</span>
            <span className="ev-text">{ev.text}</span>
            {ev.time && <span className="ev-time">{ev.time}</span>}
            {ev.ref && <span className="ev-go">원자료 ›</span>}
          </>
        )
        return ev.ref ? (
          <button key={ev.text} className="ev jump" onClick={() => onJump(ev.ref!)}>{body}</button>
        ) : (
          <div key={ev.text} className="ev">{body}</div>
        )
      })}
    </div>
  )
}

const isHit = (c: CauseCall) => c.score !== null && c.score >= RULE_THRESHOLD

function CallRow({ c, open, onToggle, onJump, onWiki }: { c: CauseCall; open: boolean; onToggle: () => void; onJump: (r: Ref) => void; onWiki: (at: WikiAt) => void }) {
  const hit = isHit(c)
  const na = c.score === null
  const w = na ? 0 : (Math.min(c.score!, SCORE_MAX) / SCORE_MAX) * 100
  return (
    <article className={cls('call', hit && 'hit', na && 'na', open && 'open')}>
      <button className="call-head" onClick={onToggle} aria-expanded={open}>
        <span className={cls('call-flag', hit ? 'hit' : na ? 'na' : 'no')}>{hit ? '해당' : na ? '판단 불가' : '–'}</span>
        <span className="call-name">
          <strong>{causeName(c.cause)}</strong>
          <span className="code">범주 {c.cause}</span>
        </span>
        <span className="call-bar" aria-hidden>
          {!na && <span className="call-fill" style={{ width: `${w}%` }} />}
          <span className="call-thr" style={{ left: `${(RULE_THRESHOLD / SCORE_MAX) * 100}%` }} />
        </span>
        <span className="call-score">{na ? '–' : c.score!.toFixed(1)}</span>
        <span className="call-caret" aria-hidden>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="call-body">
          {c.temporal && <div className="temporal"><span className="tm-icon" aria-hidden>⏱</span>{c.temporal}</div>}
          {c.rule && <div className="call-rule"><b>규칙</b> {c.rule}</div>}
          <EvList kind="support" label="규칙이 찾은 근거" items={c.support} onJump={onJump} />
          <EvList kind="against" label="반대 근거와 한계" items={c.against} onJump={onJump} />
          <EvList kind="missing" label="판단하지 않는 이유" items={c.missing} onJump={onJump} />
          {!c.support.length && !c.against.length && !c.missing.length && <div className="ev muted">규칙 조건에 맞는 기록 없음</div>}
          <GuideList items={c.guide} onWiki={onWiki} />
          <button className="link call-wiki" onClick={() => onWiki({ page: CAUSE_WIKI[c.cause].page })}>
            위키: {CAUSE_WIKI[c.cause].title} ›
          </button>
        </div>
      )}
    </article>
  )
}

export function Result({ run, models, onJump, onWiki }: Props) {
  // 해당 범주 (점수 높은 순) → 해당 없음 (점수 높은 순) → 판단 불가
  const rank = (c: CauseCall) => (c.score === null ? -1 : c.score)
  const calls = [...run.calls].sort((a, b) => Number(isHit(b)) - Number(isHit(a)) || rank(b) - rank(a))
  const [open, setOpen] = useState<Set<number>>(() => new Set(calls.filter(isHit).map(c => c.cause)))
  const toggle = (id: number) => setOpen(s => {
    const n = new Set(s)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    return n
  })
  const v = run.verification
  const nHit = calls.filter(isHit).length

  return (
    <div className="result">
      <div className="res-summary">
        {run.confidence && (
          <span className={cls('conf', `c-${run.confidence.level}`)} title={`${run.confidence.why}. 규칙 결과로 정한 화면 표시입니다`}>
            확신 {run.confidence.level}
          </span>
        )}
        <span className="res-tag">요약</span>
        {run.summary}
        {run.confidence && <div className="conf-why">{run.confidence.why}</div>}
      </div>

      <section className="calls" aria-label="원인 범주 10개 규칙 판정">
        <div className="calls-head">
          <b>원인 범주 10개</b>
          <span className="muted">{nHit}개 해당 · 막대는 규칙 점수 (0~{SCORE_MAX}), 세로선은 기준 {RULE_THRESHOLD.toFixed(1)}</span>
        </div>
        {calls.map(c => (
          <CallRow key={c.cause} c={c} open={open.has(c.cause)} onToggle={() => toggle(c.cause)} onJump={onJump} onWiki={onWiki} />
        ))}
      </section>

      <section className="sub-card">
        <h4>의심 약제 <span className="h4-sub">48시간 안 투여된 간독성 목록의 약 · 규칙은 최근 두 약만 인용</span></h4>
        {!run.suspectDrugs.length && <p className="note">48시간 안 간독성 목록의 약 투여 기록이 없습니다.</p>}
        {run.suspectDrugs.length > 1 && <p className="note">후보 약이 {run.suspectDrugs.length}개라 어느 약인지는 판단 보류입니다.</p>}
        <table className="mini-grid">
          <thead><tr><th>약</th><th>첫 투여부터 사건 채혈까지</th><th>48시간 안 마지막 투여</th><th>규칙 인용</th></tr></thead>
          <tbody>
            {run.suspectDrugs.map(d => (
              <tr key={d.drug} className={d.ref ? 'clickable' : ''} onClick={() => d.ref && onJump(d.ref)}>
                <td>{d.drug}</td><td>{d.latency}</td><td className="mono">{d.last}</td><td>{d.cited ? '인용' : <span className="muted">빠짐</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="sub-card">
        <h4>확인하면 좋을 검사</h4>
        <ul className="tests">
          {run.recommendedTests.map(t => (
            <li key={t.name}><b>{t.name}</b> <span className="muted">{t.why}</span></li>
          ))}
        </ul>
      </section>

      <section className={cls('verify', v.matched === v.total ? 'ok' : 'bad')}>
        <span className="vf-icon" aria-hidden>{v.matched === v.total ? '✓' : '!'}</span>
        <span>
          <b>원자료 대조</b> 출력 속 숫자와 시각 {v.total}개 중 {v.matched}개가 원자료와 일치
        </span>
      </section>

      {models && (
        <section className="sub-card model">
          <h4>
            간 검사 이상 패턴 <span className="h4-sub">모델 1 · 보조 정보, 원인 판정에 쓰지 않음</span>
          </h4>
          <div className="m1">
            <span className="m1-cluster">{models.model1.cluster}</span>
            <span>확신도 <b>{models.model1.confidence.toFixed(2)}</b></span>
            <span className="muted">개발 사건의 {Math.round(models.model1.share * 100)}%</span>
          </div>
          <ul className="m1-feat">
            {models.model1.features.map(f => <li key={f}>{f}</li>)}
          </ul>
          <p className="note">군집은 원인 이름이 아닙니다. 개발 집단에서 간 검사 패턴이 비슷한 사건끼리 묶은 번호입니다.</p>
        </section>
      )}

      <p className="disclaimer">
        해당 범주는 확진이 아니고, 여러 범주가 함께 해당할 수 있습니다. 치료나 약 중단 결정은 출력하지 않습니다. 종료 상태 예측과 군집 정보는 원인 판정에 쓰지 않습니다.
      </p>
    </div>
  )
}
