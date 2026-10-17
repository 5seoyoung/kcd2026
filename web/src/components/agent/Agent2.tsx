import type { CaseData, Ref } from '../../types'
import type { Sim } from '../../data'
import { END_STATES, EVENT_CODES, inIcu, isKnown, itemOf, K_RECOVER, lastAt, recoveryAt, sameDraw, seriesAt, uln } from '../../lib/events'
import { fmtNum } from '../../lib/lab'
import { hoursBetween, isAfter, md, mdhm } from '../../lib/time'
import { cls } from '../../lib/ui'
import { EventCard } from './EventCard'
import { FactorList } from './FactorList'
import { confLabel, pct } from './state'
import { labLabel, PATH_COVERAGE_MIMIC, PATH_MIN_PROB } from '../../lib/uncertainty'
import { lang, tr } from '../../lib/i18n'
import { tx } from '../../data/cases/en'

interface Props {
  cs: CaseData
  sim: Sim
  clock: string
  onJump: (ref: Ref) => void
}

const short = (name: string) => name.split(' (')[0]

/** 사건 전: 지금 가장 높은 사건 항목 값 */
export function TopValue({ cs, clock }: { cs: CaseData; clock: string }) {
  const last = EVENT_CODES.map(code => seriesAt(cs, code, clock).at(-1)).filter(r => !!r)
  if (!last.length) return null
  const top = last.reduce((a, b) => (b.value / uln(cs, b.code) > a.value / uln(cs, a.code) ? b : a))
  const it = itemOf(cs, top.code)
  return (
    <div className="muted">
      {tr(
        `지금 가장 높은 값: ${short(it.name)} ${fmtNum(top.value, it.dp)} (${(top.value / it.high!).toFixed(1)}배, ${mdhm(top.charttime)} 채혈)`,
        `Highest value now: ${short(it.name)} ${fmtNum(top.value, it.dp)} (${(top.value / it.high!).toFixed(1)}×, drawn ${mdhm(top.charttime)})`,
      )}
    </div>
  )
}

export function Agent2({ cs, sim, clock, onJump }: Props) {
  const ev = sim.target
  const out = sim.models?.agent2
  if (!isKnown(ev, clock) || !out) {
    return (
      <div className="ad-wait">
        <div>{!sim.target && !isAfter(cs.icuOut, clock)
          ? tr('5배 사건 없이 퇴실해 종료 상태를 예측하지 않았습니다.', 'Discharged from the ICU without a 5× event, so the end state was not predicted.')
          : tr('5배 사건 (ALT, ALP, 총빌리 중 하나가 5 x ULN 이상) 이 공개되면 그 시점에 한 번 실행합니다.', 'Runs once when a 5× event (ALT, ALP or total bilirubin ≥ 5 x ULN) is released.')}</div>
        <TopValue cs={cs} clock={clock} />
      </div>
    )
  }

  const top = END_STATES.reduce((a, b) => (out.probs[b.key] > out.probs[a.key] ? b : a))
  const done = !isAfter(cs.icuOut, clock)
  const at = done ? cs.icuOut : clock
  const actual = done ? sim.endState : undefined
  const it = ev.item
  const limit = K_RECOVER * it.high!
  const course = seriesAt(cs, ev.result.code, at).filter(r => !isAfter(ev.drawn, r.charttime) && inIcu(cs, r.charttime))
  // 회복 판정: 세 항목의 마지막 값이 모두 2배 미만인지 (퇴실 때 확정)
  const rows = EVENT_CODES.map(code => {
    const item = itemOf(cs, code)
    const last = lastAt(cs, code, at)
    return { code, item, atEvent: sameDraw(cs, ev, code), last, lim: K_RECOVER * uln(cs, code) }
  })
  const rec = recoveryAt(cs, ev, at)
  const over = rows.filter(r => r.last && r.last.value >= r.lim)
  const dt = cs.outcome.deathTime
  const deathAfterOut = !!dt && isAfter(dt, cs.icuOut)
  const inSet = new Set(out.pathSet.keys)
  const notRe = rec.notRemeasured.map(c => labLabel(cs, c)).join(', ')
  const en = lang() === 'en'

  return (
    <div className="ad">
      <EventCard cs={cs} ev={ev} compact onJump={onJump} />

      <section className="sub-card">
        <h4>
          {tr('ICU 퇴실 때 종료 상태', 'End state at ICU discharge')}{' '}
          <span className="h4-sub">{tr(`${mdhm(ev.detectAt)} 실행 · 5배 사건 때 1회`, `Run ${mdhm(ev.detectAt)} · once at the 5× event`)}</span>
        </h4>
        <div className="es" role="table" aria-label={tr('종료 상태 확률', 'End-state probabilities')}>
          {END_STATES.map(s => (
            <div key={s.key} role="row" className={cls('es-row', s.key === top.key && 'top', actual === s.key && 'actual', inSet.has(s.key) && 'inset')}>
              <span role="cell" className="es-label">{s.label}</span>
              <span role="cell" className="es-track"><span className="es-fill" style={{ width: `${out.probs[s.key] * 100}%` }} /></span>
              <span role="cell" className="es-val">{pct(out.probs[s.key])}</span>
              <span role="cell" className="es-mark">{actual === s.key ? tr('실제', 'Actual') : ''}</span>
            </div>
          ))}
        </div>
        <div className="pathset">
          <span className={cls('conf', out.confidence.level === '낮음' ? 'c-낮음' : 'c-높음')}>{confLabel(out.confidence.level)}</span>
          <span>
            {tr('이 중 하나일 가능성이 높음:', 'Likely paths:')} <b>{END_STATES.filter(s => inSet.has(s.key)).map(s => s.label).join(', ')}</b>
            <span className="muted">{tr(` (합 ${pct(out.pathSet.mass)})`, ` (sum ${pct(out.pathSet.mass)})`)}</span>
          </span>
        </div>
        <p className="note">
          {tr(
            `경로 집합은 확률이 ${pct(PATH_MIN_PROB)} 이상인 경로입니다. MIMIC 평가 집단에서 실제 경로를 90% 담도록 정한 기준 (conformal) 이고, MIMIC 의 다른 절반에서는 ${Math.round(PATH_COVERAGE_MIMIC * 1000) / 10}% 를 담았습니다. 이 병원 자료에서 몇 % 를 담는지는 아직 확인하지 않았습니다. 경로가 둘 이상이면 확신 낮음 (규칙 6).`,
            `The path set is the paths with probability ≥ ${pct(PATH_MIN_PROB)}. The threshold (conformal) was set to contain the actual path 90% of the time in the MIMIC evaluation cohort; in the other half of MIMIC it contained ${Math.round(PATH_COVERAGE_MIMIC * 1000) / 10}%. Coverage on this site's data has not been checked yet. Two or more paths make confidence low (rule 6).`,
          )}
        </p>
        <div className="es-extra">
          <span>{tr('ICU 사망', 'ICU death')}</span>
          <b>{pct(out.icuDeath)}</b>
          <span className="muted">{tr('별도 모델 (재측정 없는 사건까지 넣어 학습)', 'Separate model (trained including events without re-measurement)')}</span>
        </div>
        <p className="note">
          {tr(
            '회복: ICU 퇴실 때 마지막 ALT, ALP, 총빌리가 모두 2 x ULN 미만. 사망: ICU 사망 (퇴실 뒤 24시간 안 포함). 5배 사건 뒤 다시 재지 않고 퇴실하면 판정 불가로 4경로에서 뺍니다.',
            'Recovered: last ALT, ALP and total bilirubin all below 2 x ULN at ICU discharge. Died: ICU death (including within 24 h after discharge). If not re-measured after the 5× event before discharge, the outcome is not assessable and is left out of the 4 paths.',
          )}
        </p>
      </section>

      <section className="sub-card">
        <h4>
          {tr('회복 판정', 'Recovery call')}{' '}
          <span className="h4-sub">{done ? tr('ICU 퇴실 때 마지막 값', 'Last values at ICU discharge') : tr(`${mdhm(clock)} 까지 공개된 마지막 값`, `Last values released by ${mdhm(clock)}`)}</span>
        </h4>
        <table className="mini-grid rec-table">
          <thead>
            <tr>
              <th>{tr('항목', 'Test')}</th>
              <th className="r">{tr('5배 사건 때', 'At 5× event')}</th>
              <th className="r">{tr('마지막', 'Last')}</th>
              <th className="r">{tr('2배 기준', '2× limit')}</th>
              <th>{tr('상태', 'Status')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.code} className={r.last ? 'clickable' : ''} onClick={() => r.last && onJump({ tab: 'lab', row: r.code, col: r.last.id })}>
                <td><b>{short(r.item.name)}</b></td>
                <td className="r">{r.atEvent ? fmtNum(r.atEvent.value, r.item.dp) : '–'}</td>
                <td className="r">{r.last ? <>{fmtNum(r.last.value, r.item.dp)} <span className="mono muted">{md(r.last.charttime)}</span></> : '–'}</td>
                <td className="r muted">{fmtNum(r.lim, r.item.dp)}</td>
                <td>
                  {!r.last
                    ? <span className="muted">{tr('측정 없음', 'Not measured')}</span>
                    : r.last.value >= r.lim ? <span className="st-over">{tr('2배 이상', '≥ 2×')}</span> : <span className="st-under">{tr('2배 미만', '< 2×')}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="course">
          {course.map((r, i) => (
            <span key={r.id} className="course-item">
              {i > 0 && <span className="course-arrow" aria-hidden>→</span>}
              <button
                className={cls('course-val', r.value >= limit ? 'over' : 'under')}
                onClick={() => onJump({ tab: 'lab', row: r.code, col: r.id })}
                title={tr(`${mdhm(r.charttime)} 채혈 · 검사결과에서 보기`, `Drawn ${mdhm(r.charttime)} · view in Labs`)}
              >
                <b>{fmtNum(r.value, it.dp)}</b>
                <span>{md(r.charttime)}</span>
              </button>
            </span>
          ))}
          <span className="muted course-name">{tr(`${short(it.name)} 경과`, `${short(it.name)} course`)}</span>
        </div>
        <ul className="track">
          {!rec.judged ? (
            done
              ? <li>{tr(`5배 사건 뒤 다시 재지 않고 퇴실한 항목이 있어 판정 불가: ${notRe}`, `Not assessable: ${notRe} not re-measured after the 5× event before discharge`)}</li>
              : en
                ? <li className="need-test"><b>Tests needed for the recovery call</b> Re-measure {notRe} before discharge (otherwise not assessable)</li>
                : <li className="need-test"><b>회복 판정에 필요한 검사</b> {notRe} 퇴실 전 재측정 필요 (없으면 판정 불가)</li>
          ) : over.length ? (
            <li>
              {tr('아직 2배 이상:', 'Still ≥ 2×:')} {over.map(r => short(r.item.name)).join(', ')} · {done ? tr('미회복', 'Not recovered') : tr('이대로 퇴실하면 미회복', 'Not recovered if discharged now')}
            </li>
          ) : (
            <li className="ok">{tr('세 항목 모두 2배 미만', 'All three below 2×')} · {done ? tr('회복', 'Recovered') : tr('이대로 퇴실하면 회복', 'Recovered if discharged now')}</li>
          )}
          {done && (
            <li>
              {cs.outcome.icuDeath && !deathAfterOut
                ? tr(`ICU 사망 ${mdhm(cs.icuOut)}`, `ICU death ${mdhm(cs.icuOut)}`)
                : tr(`ICU 퇴실 ${mdhm(cs.icuOut)} · 생존 퇴실 (${cs.outcome.dischargeTo})`, `ICU discharge ${mdhm(cs.icuOut)} · discharged alive (${tx(cs.outcome.dischargeTo)})`)}
              {deathAfterOut && tr(
                ` → ${mdhm(dt!)} 사망 (퇴실 뒤 ${Math.round(hoursBetween(cs.icuOut, dt!))}시간, ${cs.outcome.icuDeath ? 'ICU 사망으로 셈' : 'ICU 사망 아님'})`,
                ` → died ${mdhm(dt!)} (${Math.round(hoursBetween(cs.icuOut, dt!))} h after discharge, ${cs.outcome.icuDeath ? 'counted as ICU death' : 'not an ICU death'})`,
              )}
            </li>
          )}
          {done && (
            <li className="final">
              {tr('실제 종료 상태', 'Actual end state')} <b>{actual ? END_STATES.find(s => s.key === actual)!.label : tr('판정 불가', 'Not assessable')}</b>
              <span className="muted">
                {tr(
                  ` · 보조: 원내 또는 퇴원 뒤 1년 안 사망 기록 ${cs.outcome.death1y ? '있음' : '없음'}`,
                  ` · Secondary: death in hospital or within 1 year after discharge: ${cs.outcome.death1y ? 'yes' : 'no'}`,
                )}
              </span>
            </li>
          )}
        </ul>
      </section>

      <section className="sub-card">
        <h4>
          {tr('모델이 본 주요 입력', 'Key model inputs')}{' '}
          <span className="h4-sub">{tr(`t0 ${mdhm(ev.t0)} 까지 공개된 기록 · 변수 88개 중`, `Records released by t0 ${mdhm(ev.t0)} · of 88 variables`)}</span>
        </h4>
        <FactorList factors={out.factors} up={tr('불리', 'Unfavorable')} down={tr('유리', 'Favorable')} />
      </section>
      <p className="note">
        {sim.run
          ? tr(
            'MIMIC-IV 로 학습한 그래디언트 부스팅 (4경로, ICU 사망은 별도 모델). 모델은 첫 이상 (2배) 시점 자료로 학습했고, 여기서는 5배 사건 시점에 적용합니다 (학습한 시점과 다름). ',
            'Gradient boosting trained on MIMIC-IV (4 paths; ICU death is a separate model). The model was trained on data at the first abnormality (2×) and is applied here at the 5× event (a different time point). ',
          )
          : ''}
        {tr('이 예측은 원인 추정 (에이전트 3) 의 판단에 넣지 않고 따로 보여 줍니다.', 'This prediction is not used by the cause assessment (agent 3) and is shown separately.')}
      </p>
    </div>
  )
}
