import { useState, type KeyboardEvent, type MouseEvent } from 'react'
import type { A1Point, LiverEvent } from '../../types'
import type { Sim } from '../../data'
import { fmtNum } from '../../lib/lab'
import { addHours, daysBetween, hm, hoursBetween, isAfter, md, mdhm, toMs } from '../../lib/time'
import { cls, useWidth } from '../../lib/ui'
import { a1Now, pct } from './state'
import { FactorList } from './FactorList'

interface Props {
  sim: Sim
  clock: string
  events: LiverEvent[]
}

const short = (name: string) => name.split(' (')[0]

export function Agent1({ sim, clock, events }: Props) {
  const a1 = sim.a1
  const { point, started, ended } = a1Now(sim, clock)
  if (!a1.eligible) {
    return <div className="ad-wait">ICU 첫 채혈부터 5배 이상이라 발생 예측 대상이 아닙니다.</div>
  }
  if (!started || !point) {
    return <div className="ad-wait">ICU 에서 첫 간 검사 결과가 나오면 매시간 실행합니다.</div>
  }
  const shown = a1.points.filter(p => !isAfter(p.time, clock))
  const alarm = point.p >= a1.threshold
  const e5 = sim.e5
  const stopped = ended && !!e5

  return (
    <div className="ad">
      <div className="ad-head">
        <span className={cls('ad-big', alarm && 'alarm')}>{pct(point.p)}</span>
        <span className="ad-what">
          <b>24시간 안 5배 사건 확률</b>
          <span className="muted">{mdhm(point.time)} 실행{stopped ? ' · 마지막' : ''} · 경보 기준 {pct(a1.threshold)}</span>
        </span>
        <span className="spacer" />
        {alarm ? <span className="flag alarm">경보</span> : <span className="flag">기준 미만</span>}
      </div>

      <RiskChart points={shown} threshold={a1.threshold} start={a1.start!} end={stopped ? a1.stop! : clock} events={events} firstAlarm={a1.firstAlarm} />

      {stopped && (
        <div className="ad-box">
          <b>5배 사건으로 멈춤.</b> {short(e5.item.name)} {fmtNum(e5.result.value, e5.item.dp)} ({mdhm(e5.t0)} 채혈).{' '}
          {a1.firstAlarm
            ? <>첫 경보 {mdhm(a1.firstAlarm)}, 사건 채혈 <b>{hoursBetween(a1.firstAlarm, e5.t0).toFixed(1)}시간</b> 전.</>
            : '사건 전에 경보가 없었습니다.'}
        </div>
      )}
      {!stopped && a1.firstAlarm && !isAfter(a1.firstAlarm, clock) && (
        <div className="ad-box">첫 경보 {mdhm(a1.firstAlarm)}. 사건이 생기면 이 에이전트는 멈추고 원인 추정이 돕니다.</div>
      )}

      <section className="sub-card">
        <h4>이 시각의 입력 <span className="h4-sub">{mdhm(point.time)} · 위험에 많이 기여한 순</span></h4>
        <FactorList factors={point.factors} up="위험 높임" down="영향 적음" />
      </section>
      <p className="note">
        대상: ICU 첫 채혈이 5배 미만인 환자. 사건: ALT, ALP, 총빌리 중 하나가 5 x ULN 이상. 기준 시각까지 결과가 나온 기록만 씁니다.
      </p>
    </div>
  )
}

const PAD_L = 34
const PAD_R = 12
const TOP = 10
const PH = 92
const H = TOP + PH + 20

interface ChartProps {
  points: A1Point[]
  threshold: number
  start: string
  end: string
  events: LiverEvent[]
  firstAlarm?: string
}

/** 시간별 발생 확률 한 줄. 축은 하나 (0~100%), 경보 기준은 점선 */
function RiskChart({ points, threshold, start, end, events, firstAlarm }: ChartProps) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const W = Math.max(width, 300)
  const minEnd = addHours(start, 24)
  const xEnd = isAfter(end, minEnd) ? end : minEnd
  const x0 = toMs(start)
  const x1 = toMs(xEnd)
  const sx = (t: string) => PAD_L + ((toMs(t) - x0) / (x1 - x0)) * (W - PAD_L - PAD_R)
  const sy = (p: number) => TOP + PH - p * PH
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${sx(p.time)},${sy(p.p)}`).join(' ')
  const midnights = daysBetween(start, xEnd).slice(1)
  const fa = firstAlarm ? points.find(p => p.time === firstAlarm) : undefined
  const evs = events.filter(e => !isAfter(start, e.t0) && !isAfter(e.t0, xEnd))

  const pick = (e: MouseEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - box.left + PAD_L
    let best = 0
    points.forEach((p, i) => {
      if (Math.abs(sx(p.time) - x) < Math.abs(sx(points[best].time) - x)) best = i
    })
    setHover(best)
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') setHover(h => Math.min(points.length - 1, (h ?? points.length - 2) + 1))
    if (e.key === 'ArrowLeft') setHover(h => Math.max(0, (h ?? points.length) - 1))
  }
  const hp = hover !== null ? points[hover] : null
  const hx = hp ? sx(hp.time) : 0

  return (
    <div className="mchart" ref={ref}>
      <svg width={W} height={H} tabIndex={0} onKeyDown={onKey} onBlur={() => setHover(null)} role="img"
        aria-label="시간별 24시간 안 5배 사건 확률. 좌우 화살표로 시각을 옮길 수 있습니다">
        {[0, 0.5, 1].map(v => (
          <g key={v}>
            <line x1={PAD_L} x2={W - PAD_R} y1={sy(v)} y2={sy(v)} className={v === 0 ? 'mc-base' : 'mc-grid'} />
            <text x={PAD_L - 5} y={sy(v) + 3.5} textAnchor="end" className="mc-tick">{v * 100}%</text>
          </g>
        ))}
        {midnights.map(d => (
          <g key={d}>
            <line x1={sx(`${d} 00:00`)} x2={sx(`${d} 00:00`)} y1={TOP} y2={TOP + PH} className="mc-grid" />
            <text x={sx(`${d} 00:00`)} y={H - 5} textAnchor="middle" className="mc-tick">{md(d)}</text>
          </g>
        ))}
        <line x1={PAD_L} x2={W - PAD_R} y1={sy(threshold)} y2={sy(threshold)} className="mc-thr" />
        <text x={PAD_L + 4} y={sy(threshold) - 3} className="mc-thr-label">경보 {threshold * 100}%</text>
        {evs.map(e => (
          <g key={e.k} className="mc-ev">
            <line x1={sx(e.t0)} x2={sx(e.t0)} y1={TOP} y2={TOP + PH} />
            <text x={sx(e.t0) + 3} y={TOP + 9}>{e.k}배</text>
          </g>
        ))}
        <path d={path} className="mc-line" />
        {fa && (
          <g>
            <circle cx={sx(fa.time)} cy={sy(fa.p)} r={4} className="mc-alarm" />
            <text x={sx(fa.time) - 6} y={sy(fa.p) - 7} textAnchor="end" className="mc-note">첫 경보 {hm(fa.time)}</text>
          </g>
        )}
        {points.length > 0 && <circle cx={sx(points.at(-1)!.time)} cy={sy(points.at(-1)!.p)} r={3} className="mc-end" />}
        {hp && (
          <g pointerEvents="none">
            <line x1={hx} x2={hx} y1={TOP} y2={TOP + PH} className="mc-cross" />
            <circle cx={hx} cy={sy(hp.p)} r={3.5} className="mc-hover-dot" />
          </g>
        )}
        <rect x={PAD_L} y={0} width={W - PAD_L - PAD_R} height={H} fill="transparent" onMouseMove={pick} onMouseLeave={() => setHover(null)} />
      </svg>
      {hp && (
        <div className="mc-tip" style={{ left: hx + 140 > W ? hx - 132 : hx + 10 }}>
          <div className="mono">{mdhm(hp.time)}</div>
          <b>{pct(hp.p)}</b> <span className="muted">{hp.p >= threshold ? '경보' : '기준 미만'}</span>
        </div>
      )}
    </div>
  )
}
