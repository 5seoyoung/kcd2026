import type { CaseData, Ref } from '../../types'
import type { Sim } from '../../data'
import { END_STATES, EVENT_CODES, inIcu, isKnown, itemOf, K_RECOVER, reported, seriesAt, uln } from '../../lib/events'
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
  const e2 = sim.e2
  const out = sim.models?.agent2
  if (!isKnown(e2, clock) || !out) {
    return (
      <div className="ad-wait">
        <div>2배 사건 (ALT, ALP, 총빌리 중 하나가 2 x ULN 이상) 이 생기면 그 시점에 한 번 실행합니다.</div>
        <TopValue cs={cs} clock={clock} />
      </div>
    )
  }

  const top = END_STATES.reduce((a, b) => (out.probs[b.key] > out.probs[a.key] ? b : a))
  const done = !isAfter(cs.icuOut, clock)
  const actual = done ? sim.endState : undefined
  const it = e2.item
  const limit = K_RECOVER * it.high!
  const course = seriesAt(cs, e2.result.code, clock).filter(r => !isAfter(e2.t0, r.charttime) && inIcu(cs, r.charttime))
  const rec = sim.recovery && reported(sim.recovery, clock) ? sim.recovery : undefined
  const latest = course.at(-1)!

  return (
    <div className="ad">
      <EventCard cs={cs} ev={e2} compact onJump={onJump} />

      <section className="sub-card">
        <h4>ICU 퇴실 때 종료 상태 <span className="h4-sub">{mdhm(e2.detectAt)} 실행 · 사건 시점에 1회</span></h4>
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
        <p className="note">
          회복: {short(it.name)} 이 ICU 퇴실 전 2 x ULN ({fmtNum(limit, it.dp)}) 미만으로 내려옴. 사망: 원내사망 또는 퇴원 뒤 1년 안 사망.
        </p>
      </section>

      <section className="sub-card">
        <h4>경과 <span className="h4-sub">{short(it.name)} · 기준 시각까지</span></h4>
        <div className="course">
          {course.map((r, i) => (
            <span key={r.id} className="course-item">
              {i > 0 && <span className="course-arrow" aria-hidden>→</span>}
              <button
                className={cls('course-val', r.value >= limit ? 'over' : 'under', r.id === rec?.id && 'rec')}
                onClick={() => onJump({ tab: 'lab', row: r.code, col: r.id })}
                title={`${mdhm(r.charttime)} 채혈 · 검사결과에서 보기`}
              >
                <b>{fmtNum(r.value, it.dp)}</b>
                <span>{md(r.charttime)}</span>
              </button>
            </span>
          ))}
        </div>
        <ul className="track">
          {rec ? (
            <li className="ok">회복 확인 · {mdhm(rec.charttime)} 채혈 {fmtNum(rec.value, it.dp)} (기준 {fmtNum(limit, it.dp)} 미만)</li>
          ) : (
            <li>아직 회복 기준 이상 · 최근 {fmtNum(latest.value, it.dp)} ({mdhm(latest.charttime)})</li>
          )}
          {done && <li>ICU 퇴실 {mdhm(cs.icuOut)} · {cs.outcome.icuDeath ? 'ICU 사망' : `생존 퇴실 (${cs.outcome.dischargeTo})`}</li>}
          {done && actual && (
            <li className="final">
              실제 종료 상태 <b>{END_STATES.find(s => s.key === actual)!.label}</b>
              <span className="muted"> · 퇴원 뒤 1년 사망 기록 {cs.outcome.death1y ? '있음' : '없음'}</span>
            </li>
          )}
        </ul>
      </section>

      <section className="sub-card">
        <h4>예측에 쓴 특징 <span className="h4-sub">t0 {mdhm(e2.t0)} 까지의 기록</span></h4>
        <FactorList factors={out.factors} up="불리" down="유리" />
      </section>
      <p className="note">이 예측은 원인 추정 (에이전트 3) 의 판단에 넣지 않고 따로 보여 줍니다.</p>
    </div>
  )
}
