import { useState } from 'react'
import type { AgentRun, CauseCall, Evidence, EvidenceItem, GuideLine, ModelOutputs, Ref } from '../../types'
import type { WikiAt } from '../WikiModal'
import { CAUSE_WIKI, causeName } from '../../data/causes'
import { RULE_THRESHOLD } from '../../lib/events'
import { cls } from '../../lib/ui'
import { tr } from '../../lib/i18n'

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
      <div className="ev-label">{tr('지침 근거 · 근거 위키', 'Guideline evidence · evidence wiki (in Korean)')}</div>
      {items.map(g => {
        const isGap = g.cite === '근거 공백'
        return (
          <button key={g.text} className={cls('ev jump', isGap && 'gap')} onClick={() => onWiki({ page: g.page, heading: g.heading })}>
            <span className="ev-mark" aria-hidden>{isGap ? '∅' : '§'}</span>
            <span className="ev-text">{g.text} <span className="ev-cite">{isGap ? tr('근거 공백', 'Evidence gap') : g.cite}</span></span>
            <span className="ev-go">{tr('위키 ›', 'Wiki ›')}</span>
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
            {ev.ref && <span className="ev-go">{tr('원자료 ›', 'Source ›')}</span>}
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

const ST_CLASS: Record<EvidenceItem['status'], string> = { 있음: 'have', '측정 없음': 'miss', '연결 안 됨': 'off', '자료에 없음': 'off', '이전 입원 없음': 'miss' }
/** 상태는 한국어 키. 보일 때만 영어로 */
const ST_EN: Record<EvidenceItem['status'], string> = { 있음: 'present', '측정 없음': 'not measured', '연결 안 됨': 'not linked', '자료에 없음': 'not in data', '이전 입원 없음': 'no prior admission' }

/** 이 범주 판단에 필요한 자료와 상태 (근거 자료 완성도) */
function NeedList({ c }: { c: CauseCall }) {
  if (!c.evidence) return null
  return (
    <div className="ev-group need">
      <div className="ev-label">{tr('판단에 필요한 자료', 'Data needed for the call')} {c.evidence.have}/{c.evidence.need}</div>
      {c.evidence.items.map(i => (
        <div key={i.name} className="ev">
          <span className={cls('need-st', ST_CLASS[i.status])}>{tr(i.status, ST_EN[i.status] ?? i.status)}</span>
          <span className="ev-text">{i.name}{i.detail && <span className="muted"> · {i.detail}</span>}</span>
        </div>
      ))}
    </div>
  )
}

function CallRow({ c, open, onToggle, onJump, onWiki }: { c: CauseCall; open: boolean; onToggle: () => void; onJump: (r: Ref) => void; onWiki: (at: WikiAt) => void }) {
  const hit = isHit(c)
  const na = c.score === null
  const w = na ? 0 : (Math.min(c.score!, SCORE_MAX) / SCORE_MAX) * 100
  return (
    <article className={cls('call', hit && 'hit', na && 'na', open && 'open')}>
      <button className="call-head" onClick={onToggle} aria-expanded={open}>
        <span className={cls('call-flag', hit ? 'hit' : na ? 'na' : 'no')}>{hit ? tr('해당', 'Flagged') : na ? tr('판단 불가', 'Not assessable') : '–'}</span>
        <span className="call-name">
          <strong>{causeName(c.cause)}</strong>
          {c.evidence && c.evidence.need > 0 && (
            <span className={cls('call-chip', c.evidence.have < c.evidence.need && 'part')} title={tr('판단에 필요한 자료 가운데 있는 것', 'Data needed for the call that are present')}>
              {tr('자료', 'Data')} {c.evidence.have}/{c.evidence.need}
            </span>
          )}
          {c.fragile && c.fragile.length > 0 && (
            <span className="call-chip fragile" title={tr('검사값 하나를 ±10% 바꾸면 판정이 바뀜', 'Changing one lab value by ±10% flips the call')}>{tr('판정 취약', 'Fragile call')}</span>
          )}
          {c.hold && <span className="call-chip hold" title={c.hold}>{tr('판단 보류', 'Withheld')}</span>}
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
          {c.rule && <div className="call-rule"><b>{tr('규칙', 'Rule')}</b> {c.rule}</div>}
          {c.hold && <div className="call-note hold"><b>{tr('판단 보류', 'Withheld')}</b> {c.hold}</div>}
          {c.fragile && c.fragile.length > 0 && (
            <div className="call-note fragile">
              <b>{tr('판정 취약', 'Fragile call')}</b> {tr('검사 오차 범위 (±10%) 안에서 판정이 바뀝니다:', 'The call flips within the lab error range (±10%):')} {c.fragile.join('; ')}
            </div>
          )}
          <EvList kind="support" label={tr('규칙이 찾은 근거', 'Evidence found by the rule')} items={c.support} onJump={onJump} />
          <EvList kind="against" label={tr('반대 근거와 한계', 'Against / limits')} items={c.against} onJump={onJump} />
          <EvList kind="missing" label={tr('판단하지 않는 이유', 'Why it is not judged')} items={c.missing} onJump={onJump} />
          <NeedList c={c} />
          {!c.support.length && !c.against.length && !c.missing.length && <div className="ev-empty muted">{tr('규칙 조건에 맞는 기록 없음', 'No records meet the rule conditions')}</div>}
          <GuideList items={c.guide} onWiki={onWiki} />
          <button className="link call-wiki" onClick={() => onWiki({ page: CAUSE_WIKI[c.cause].page })}>
            {tr('위키:', 'Wiki:')} {CAUSE_WIKI[c.cause].title} ›
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
  const nFragile = calls.filter(c => c.fragile?.length).length
  const nHold = calls.filter(c => c.hold).length

  return (
    <div className="result">
      <div className="res-summary">
        {run.abstain && <span className="conf c-판단" title={run.abstain}>{tr('판단 보류', 'Withheld')}</span>}
        <span className="res-tag">{tr('요약', 'Summary')}</span>
        {run.summary}
        {(nFragile > 0 || nHold > 0) && (
          <div className="conf-why">
            {nFragile > 0 && (
              <>{tr(`판정 취약 ${nFragile}개 범주 (검사값 ±10% 에서 판정이 바뀜). `,
                `Fragile call in ${nFragile} ${nFragile > 1 ? 'categories' : 'category'} (the call flips at ±10% lab values). `)}</>
            )}
            {nHold > 0 && <>{tr(`판단 보류 ${nHold}개 범주.`, `Withheld in ${nHold} ${nHold > 1 ? 'categories' : 'category'}.`)}</>}
          </div>
        )}
        {run.abstain && <div className="conf-why">{run.abstain}</div>}
      </div>

      <section className="calls" aria-label={tr('원인 범주 10개 규칙 판정', 'Rule calls for the 10 cause categories')}>
        <div className="calls-head">
          <b>{tr('원인 범주 10개', '10 cause categories')}</b>
          <span className="muted">
            {tr(`${nHit}개 해당 · 막대는 규칙 점수 (0~${SCORE_MAX}), 세로선은 기준 ${RULE_THRESHOLD.toFixed(1)} · 자료 a/b 는 판단에 필요한 자료 중 있는 것`,
              `${nHit} flagged · bar = rule score (0–${SCORE_MAX}), line = threshold ${RULE_THRESHOLD.toFixed(1)} · data a/b = needed data that are present`)}
          </span>
        </div>
        {calls.map(c => (
          <CallRow key={c.cause} c={c} open={open.has(c.cause)} onToggle={() => toggle(c.cause)} onJump={onJump} onWiki={onWiki} />
        ))}
      </section>

      <section className="sub-card">
        <h4>
          {tr('의심 약제', 'Suspect drugs')}{' '}
          <span className="h4-sub">{tr('48시간 안 투여된 간독성 목록의 약 · 규칙은 최근 두 약만 인용', 'Hepatotoxic-list drugs given within 48 h · the rule cites only the two most recent')}</span>
        </h4>
        {!run.suspectDrugs.length && <p className="note">{tr('48시간 안 간독성 목록의 약 투여 기록이 없습니다.', 'No hepatotoxic-list drugs were given within 48 h.')}</p>}
        {run.suspectDrugs.length > 1 && (
          <p className="note">{tr(`후보 약이 ${run.suspectDrugs.length}개라 어느 약인지는 판단 보류입니다.`, `With ${run.suspectDrugs.length} candidate drugs, the culprit is withheld.`)}</p>
        )}
        <table className="mini-grid">
          <thead>
            <tr>
              <th>{tr('약', 'Drug')}</th><th>{tr('첫 투여부터 사건 채혈까지', 'First dose to event draw')}</th>
              <th>{tr('48시간 안 마지막 투여', 'Last dose within 48 h')}</th><th>{tr('규칙 인용', 'Cited by rule')}</th>
            </tr>
          </thead>
          <tbody>
            {run.suspectDrugs.map(d => (
              <tr key={d.drug} className={d.ref ? 'clickable' : ''} onClick={() => d.ref && onJump(d.ref)}>
                <td>{d.drug}</td><td>{d.latency}</td><td className="mono">{d.last}</td><td>{d.cited ? tr('인용', 'Cited') : <span className="muted">{tr('빠짐', 'Not cited')}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="sub-card">
        <h4>{tr('확인하면 좋을 검사', 'Suggested tests')}</h4>
        <ul className="tests">
          {run.recommendedTests.map(t => (
            <li key={t.name}><b>{t.name}</b> <span className="muted">{t.why}</span></li>
          ))}
        </ul>
      </section>

      <section className={cls('verify', v.matched === v.total ? 'ok' : 'bad')}>
        <span className="vf-icon" aria-hidden>{v.matched === v.total ? '✓' : '!'}</span>
        <span>
          <b>{tr('원자료 대조', 'Source check')}</b>{' '}
          {tr(`출력 속 숫자와 시각 ${v.total}개 중 ${v.matched}개가 원자료와 일치`, `${v.matched} of ${v.total} numbers and times in the output match the source record`)}
        </span>
      </section>

      {models && (
        <section className="sub-card model">
          <h4>
            {tr('간 검사 이상 패턴', 'Liver-test pattern')}{' '}
            <span className="h4-sub">{tr('모델 1 · 보조 정보, 원인 판정에 쓰지 않음', 'Model 1 · supporting info, not used in the cause call')}</span>
          </h4>
          <div className="m1">
            <span className="m1-cluster">{models.model1.cluster}</span>
            <span>{tr('확신도', 'Confidence')} <b>{models.model1.confidence.toFixed(2)}</b></span>
            <span className="muted">{tr(`개발 사건의 ${Math.round(models.model1.share * 100)}%`, `${Math.round(models.model1.share * 100)}% of development events`)}</span>
          </div>
          <ul className="m1-feat">
            {models.model1.features.map(f => <li key={f}>{f}</li>)}
          </ul>
          <p className="note">
            {tr('군집은 원인 이름이 아닙니다. 개발 집단에서 간 검사 패턴이 비슷한 사건끼리 묶은 번호입니다.',
              'A cluster is not a cause. It is a number that groups development-cohort events with similar liver-test patterns.')}
          </p>
        </section>
      )}

      <p className="disclaimer">
        {tr('해당 범주는 확진이 아니고, 여러 범주가 함께 해당할 수 있습니다. 치료나 약 중단 결정은 출력하지 않습니다. 종료 상태 예측과 군집 정보는 원인 판정에 쓰지 않습니다.',
          'A flagged category is not a confirmed diagnosis, and several categories can be flagged together. No treatment or drug-stop decisions are output. The end-state prediction and cluster information are not used in the cause call.')}
      </p>
    </div>
  )
}
