import type { AgentRun, Candidate, Condition, Evidence, ModelOutputs, Ref } from '../../types'
import { causeName } from '../../data/causes'
import { cls } from '../../lib/ui'

interface Props {
  run: AgentRun
  other?: AgentRun
  condition: Condition
  models?: ModelOutputs
  onJump: (ref: Ref) => void
}

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

function CandidateCard({ c, rank, change, onJump }: { c: Candidate; rank: number; change: number; onJump: (r: Ref) => void }) {
  return (
    <article className={`cand r${rank}`}>
      <header>
        <span className="rank">{rank}</span>
        <strong>{causeName(c.cause)}</strong>
        <span className="code">범주 {c.cause}</span>
        {change !== 0 && <span className="chg">{change > 0 ? `▲${change}` : `▼${-change}`} A 대비</span>}
        <span className="spacer" />
        <span className={`unc u${c.uncertainty}`}>불확실성 {c.uncertainty}</span>
      </header>
      {c.temporal && <div className="temporal"><span className="tm-icon" aria-hidden>⏱</span>{c.temporal}</div>}
      <EvList kind="support" label="지지 근거" items={c.support} onJump={onJump} />
      <EvList kind="against" label="반대 근거" items={c.against} onJump={onJump} />
      <EvList kind="missing" label="누락 근거" items={c.missing} onJump={onJump} />
    </article>
  )
}

export function Result({ run, other, condition, models, onJump }: Props) {
  const a = condition === 'A' ? run : other
  const b = condition === 'B' ? run : other
  const changeOf = (cause: number, i: number) => {
    if (condition !== 'B' || !a) return 0
    const j = a.candidates.findIndex(c => c.cause === cause)
    return j === -1 ? 0 : j - i
  }
  const v = run.verification

  return (
    <div className="result">
      <div className="res-summary">
        <span className="res-tag">요약</span>
        {run.summary}
      </div>

      {run.candidates.map((c, i) => (
        <CandidateCard key={c.cause} c={c} rank={i + 1} change={changeOf(c.cause, i)} onJump={onJump} />
      ))}

      {a && b && (
        <section className="sub-card">
          <h4>A 와 B 순위 비교</h4>
          <table className="mini-grid">
            <thead><tr><th>순위</th><th>A 기본</th><th>B 군집 정보 추가</th></tr></thead>
            <tbody>
              {[0, 1, 2].map(i => {
                const ca = a.candidates[i]
                const cb = b.candidates[i]
                return (
                  <tr key={i} className={cls(ca?.cause !== cb?.cause && 'diff')}>
                    <td>{i + 1}</td>
                    <td>{ca ? causeName(ca.cause) : '–'}</td>
                    <td>{cb ? causeName(cb.cause) : '–'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>
      )}

      <section className="sub-card">
        <h4>의심 약제 순위 <span className="h4-sub">DILI 보조 출력 · 잠복기 → 간독성 → 패턴</span></h4>
        <table className="mini-grid">
          <thead><tr><th>약</th><th>잠복기</th><th>간독성</th><th>패턴</th></tr></thead>
          <tbody>
            {run.suspectDrugs.map(d => (
              <tr key={d.drug} className={d.ref ? 'clickable' : ''} onClick={() => d.ref && onJump(d.ref)}>
                <td>{d.drug}</td><td>{d.latency}</td><td>{d.hepatotox}</td><td>{d.pattern}</td>
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

      {condition === 'B' && models && (
        <section className="sub-card model">
          <h4>
            간 검사 이상 패턴 <span className="h4-sub">모델 1 · B 조건에만 제공</span>
          </h4>
          <div className="m1">
            <span className="m1-cluster">{models.model1.cluster}</span>
            <span>확신도 <b>{models.model1.confidence.toFixed(2)}</b></span>
            <span className="muted">개발 집단 {models.model1.devN.toLocaleString('en-US')}건</span>
          </div>
          <ul className="m1-feat">
            {models.model1.features.map(f => <li key={f}>{f}</li>)}
          </ul>
          <p className="note">군집은 원인 이름이 아닙니다. 개발 집단에서 간 검사 패턴이 비슷한 사건끼리 묶은 번호입니다.</p>
        </section>
      )}

      <p className="disclaimer">
        원인 후보는 확진이 아닙니다. 치료나 약 중단 결정은 출력하지 않습니다. 종료 상태 예측 (에이전트 2) 은 원인 판단에 쓰지 않습니다.
      </p>
    </div>
  )
}
