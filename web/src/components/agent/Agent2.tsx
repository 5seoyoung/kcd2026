import type { CaseData, Ref } from '../../types'
import type { Sim } from '../../data'
import { END_STATES, EVENT_CODES, inIcu, isKnown, itemOf, K_RECOVER, lastAt, sameDraw, seriesAt, uln } from '../../lib/events'
import { fmtNum } from '../../lib/lab'
import { isAfter, md, mdhm } from '../../lib/time'
import { cls } from '../../lib/ui'
import { EventCard } from './EventCard'
import { FactorList } from './FactorList'
import { pct } from './state'

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
      지금 가장 높은 값: {short(it.name)} {fmtNum(top.value, it.dp)} ({(top.value / it.high!).toFixed(1)}배, {mdhm(top.charttime)} 채혈)
    </div>
  )
}

export function Agent2({ cs, sim, clock, onJump }: Props) {
  const ev = sim.first
  const out = sim.models?.agent2
  if (!isKnown(ev, clock) || !out) {
    return (
      <div className="ad-wait">
        <div>첫 이상 (ALT, ALP, 총빌리 중 하나가 2 x ULN 이상) 이 공개되면 그 시점에 한 번 실행합니다.</div>
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
  const again = rows.some(r => r.last && isAfter(r.last.charttime, ev.drawn))
  const over = rows.filter(r => r.last && r.last.value >= r.lim)

  return (
    <div className="ad">
      <EventCard cs={cs} ev={ev} compact onJump={onJump} />

      <section className="sub-card">
        <h4>ICU 퇴실 때 종료 상태 <span className="h4-sub">{mdhm(ev.detectAt)} 실행 · 첫 이상 때 1회</span></h4>
        <div className="es" role="table" aria-label="종료 상태 확률">
          {END_STATES.map(s => (
            <div key={s.key} role="row" className={cls('es-row', s.key === top.key && 'top', actual === s.key && 'actual')}>
              <span role="cell" className="es-label">{s.label}</span>
              <span role="cell" className="es-track"><span className="es-fill" style={{ width: `${out.probs[s.key] * 100}%` }} /></span>
              <span role="cell" className="es-val">{pct(out.probs[s.key])}</span>
              <span role="cell" className="es-mark">{actual === s.key ? '실제' : ''}</span>
            </div>
          ))}
        </div>
        <div className="es-extra">
          <span>ICU 사망</span>
          <b>{pct(out.icuDeath)}</b>
          <span className="muted">별도 모델 (재측정 없는 사건까지 넣어 학습)</span>
        </div>
        <p className="note">
          회복: ICU 퇴실 때 마지막 ALT, ALP, 총빌리가 모두 2 x ULN 미만. 사망: ICU 사망 (퇴실 뒤 24시간 안 포함). 첫 이상 뒤 다시 재지 않고 퇴실하면 판정 불가로 4경로에서 뺍니다.
        </p>
      </section>

      <section className="sub-card">
        <h4>회복 판정 <span className="h4-sub">{done ? 'ICU 퇴실 때 마지막 값' : `${mdhm(clock)} 까지 공개된 마지막 값`}</span></h4>
        <table className="mini-grid rec-table">
          <thead><tr><th>항목</th><th className="r">첫 이상 때</th><th className="r">마지막</th><th className="r">2배 기준</th><th>상태</th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.code} className={r.last ? 'clickable' : ''} onClick={() => r.last && onJump({ tab: 'lab', row: r.code, col: r.last.id })}>
                <td><b>{short(r.item.name)}</b></td>
                <td className="r">{r.atEvent ? fmtNum(r.atEvent.value, r.item.dp) : '–'}</td>
                <td className="r">{r.last ? <>{fmtNum(r.last.value, r.item.dp)} <span className="mono muted">{md(r.last.charttime)}</span></> : '–'}</td>
                <td className="r muted">{fmtNum(r.lim, r.item.dp)}</td>
                <td>{!r.last ? <span className="muted">측정 없음</span> : r.last.value >= r.lim ? <span className="st-over">2배 이상</span> : <span className="st-under">2배 미만</span>}</td>
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
                title={`${mdhm(r.charttime)} 채혈 · 검사결과에서 보기`}
              >
                <b>{fmtNum(r.value, it.dp)}</b>
                <span>{md(r.charttime)}</span>
              </button>
            </span>
          ))}
          <span className="muted course-name">{short(it.name)} 경과</span>
        </div>
        <ul className="track">
          {!again ? (
            <li>첫 이상 뒤 아직 다시 잰 값이 없음 · 이대로 퇴실하면 판정 불가</li>
          ) : over.length ? (
            <li>아직 2배 이상: {over.map(r => short(r.item.name)).join(', ')} · {done ? '미회복' : '이대로 퇴실하면 미회복'}</li>
          ) : (
            <li className="ok">세 항목 모두 2배 미만 · {done ? '회복' : '이대로 퇴실하면 회복'}</li>
          )}
          {done && <li>ICU 퇴실 {mdhm(cs.icuOut)} · {cs.outcome.icuDeath ? 'ICU 사망' : `생존 퇴실 (${cs.outcome.dischargeTo})`}</li>}
          {done && (
            <li className="final">
              실제 종료 상태 <b>{actual ? END_STATES.find(s => s.key === actual)!.label : '판정 불가'}</b>
              <span className="muted"> · 보조: 원내 또는 퇴원 뒤 1년 안 사망 기록 {cs.outcome.death1y ? '있음' : '없음'}</span>
            </li>
          )}
        </ul>
      </section>

      <section className="sub-card">
        <h4>예측에 쓴 특징 <span className="h4-sub">t0 {mdhm(ev.t0)} 까지 공개된 기록</span></h4>
        <FactorList factors={out.factors} up="불리" down="유리" />
      </section>
      <p className="note">이 예측은 원인 추정 (에이전트 3) 의 판단에 넣지 않고 따로 보여 줍니다.</p>
    </div>
  )
}
