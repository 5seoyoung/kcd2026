import { useState, type KeyboardEvent, type MouseEvent } from 'react'
import type { A4Forecast, CaseData, LiverEvent } from '../../types'
import type { Sim } from '../../data'
import { HORIZONS } from '../../data/standin'
import { itemOf, seriesAt, uln } from '../../lib/events'
import { fmtNum } from '../../lib/lab'
import { addHours, daysBetween, floorHour, isAfter, md, mdhm, toMs } from '../../lib/time'
import { useWidth } from '../../lib/ui'
import { a4Now, crossing } from './state'

interface Props {
  cs: CaseData
  sim: Sim
  clock: string
  events: LiverEvent[]
}

const short = (name: string) => name.split(' (')[0]

export function Agent4({ cs, sim, clock, events }: Props) {
  const { at, ended, forecasts } = a4Now(cs, sim, clock)
  if (!at || !forecasts.length) {
    return <div className="ad-wait">간 검사 결과가 나오면 ICU 퇴실까지 매시간 실행합니다.</div>
  }
  return (
    <div className="ad">
      <div className="ad-head">
        <span className="ad-what">
          <b>앞으로 24시간 ALT, ALP, 총빌리</b>
          <span className="muted">{mdhm(at)} 실행 · {ended ? 'ICU 퇴실로 멈춤' : '매시간'}</span>
        </span>
        <span className="spacer" />
        <span className="legend">
          <span className="lg measured" />측정 <span className="lg forecast" />예측 중앙값 <span className="lg band" />10~90%
        </span>
      </div>
      <TrajChart cs={cs} at={at} forecasts={forecasts} events={events} />
      <table className="mini-grid traj-table">
        <thead>
          <tr>
            <th>항목</th>
            <th>마지막 측정</th>
            {HORIZONS.map(h => <th key={h} className="r">+{h}시간</th>)}
            <th>24시간 안</th>
          </tr>
        </thead>
        <tbody>
          {forecasts.map(f => {
            const it = itemOf(cs, f.code)
            const k = crossing(cs, f)
            return (
              <tr key={f.code}>
                <td><b>{short(it.name)}</b></td>
                <td>{fmtNum(f.last.value, it.dp)} <span className="mono muted">{mdhm(f.last.time)}</span></td>
                {f.points.map(p => (
                  <td key={p.h} className="r" title={`10~90% ${fmtNum(p.lo, it.dp)}~${fmtNum(p.hi, it.dp)}`}>
                    {fmtNum(p.v, it.dp)}
                  </td>
                ))}
                <td>{k ? <span className="cross">{k}배 넘음</span> : <span className="muted">–</span>}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="note">
        실선은 측정값, 점선은 6, 12, 18, 24시간 뒤 예측 중앙값, 띠는 10~90% 범위입니다. 간 검사는 하루 1~2번이라 실제로는 다음 채혈 값을 예측하는 셈입니다. 칸에 마우스를 올리면 범위가 보입니다.
      </p>
    </div>
  )
}

const PAD_L = 84
const PAD_R = 40
const LANE_H = 62
const GAP = 14
const TOP = 12
const AXIS = 16

interface ChartProps {
  cs: CaseData
  at: string
  forecasts: A4Forecast[]
  events: LiverEvent[]
}

/** 항목마다 축 하나씩. 지난 72시간 측정값과 앞으로 24시간 예측 */
function TrajChart({ cs, at, forecasts, events }: ChartProps) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<string | null>(null)
  const W = Math.max(width, 320)
  const back = addHours(at, -72)
  const from = isAfter(cs.icuIn, back) ? cs.icuIn : back
  const to = addHours(at, 24)
  const x0 = toMs(from)
  const x1 = toMs(to)
  const sx = (t: string) => PAD_L + ((toMs(t) - x0) / (x1 - x0)) * (W - PAD_L - PAD_R)
  const laneY = (i: number) => TOP + i * (LANE_H + GAP)
  const plotBottom = laneY(forecasts.length) - GAP + 4
  const H = plotBottom + AXIS
  const midnights = daysBetween(from, to).slice(1)
  const ax = sx(at)

  const lanes = forecasts.map((f, i) => {
    const it = itemOf(cs, f.code)
    const u = uln(cs, f.code)
    // 측정값: 창 안의 값과 창 바로 앞의 값 하나 (선이 왼쪽 끝에서 이어지게)
    const all = seriesAt(cs, f.code, at)
    const firstIn = all.findIndex(r => !isAfter(from, r.charttime))
    const measured = firstIn === -1 ? all.slice(-1) : all.slice(Math.max(0, firstIn - 1))
    const pts = f.points
    // 축은 측정값과 예측 중앙값에 맞춤 (범위 띠는 위에서 잘릴 수 있음)
    const peak = Math.max(...measured.filter(r => !isAfter(from, r.charttime)).map(r => r.value), ...pts.map(p => p.v), 2 * u)
    const yMax = niceCeil(peak * 1.08)
    const y = laneY(i)
    const sy = (v: number) => y + LANE_H - (Math.min(v, yMax) / yMax) * LANE_H
    return { f, it, u, measured, pts, yMax, y, sy }
  })

  // 마우스가 멈출 수 있는 시각: 측정한 시각 (정시로 내림) 과 예측 범위 6, 12, 18, 24시간
  const stops = [...new Set([
    ...lanes.flatMap(l => l.measured.filter(r => !isAfter(from, r.charttime)).map(r => floorHour(r.charttime))),
    ...HORIZONS.map(h => addHours(at, h)),
  ])].sort((a, b) => toMs(a) - toMs(b))
  const pick = (e: MouseEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    const ms = x0 + ((e.clientX - box.left) / (box.width || 1)) * (x1 - x0)
    setHover(stops.reduce((a, b) => (Math.abs(toMs(b) - ms) < Math.abs(toMs(a) - ms) ? b : a)))
  }
  const onKey = (e: KeyboardEvent) => {
    const i = hover ? stops.indexOf(hover) : stops.length
    if (e.key === 'ArrowRight') setHover(stops[Math.min(stops.length - 1, i + 1)])
    if (e.key === 'ArrowLeft') setHover(stops[Math.max(0, i - 1)])
  }

  // 마우스 위치의 값: 그 시간에 잰 값이 있으면 측정, 예측 범위 시각이면 예측
  const tip = hover
    ? lanes.map(l => {
        const m = l.measured.find(r => floorHour(r.charttime) === hover)
        if (m) return { l, kind: '측정' as const, text: fmtNum(m.value, l.it.dp) }
        const p = l.pts.find(q => q.time === hover)
        return p
          ? { l, kind: `+${p.h}시간` as string, text: `${fmtNum(p.v, l.it.dp)} (${fmtNum(p.lo, l.it.dp)}~${fmtNum(p.hi, l.it.dp)})` }
          : { l, kind: '–' as string, text: '' }
      })
    : null
  const hx = hover ? sx(hover) : 0

  return (
    <div className="mchart traj" ref={ref}>
      <svg width={W} height={H} tabIndex={0} onKeyDown={onKey} onBlur={() => setHover(null)} role="img"
        aria-label="ALT, ALP, 총빌리의 지난 72시간 측정값과 앞으로 24시간 예측. 아래 표에 같은 예측값이 있습니다">
        <defs>
          <clipPath id="traj-clip"><rect x={PAD_L} y={0} width={W - PAD_L - PAD_R} height={H} /></clipPath>
        </defs>
        <rect x={ax} y={TOP - 6} width={W - PAD_R - ax} height={plotBottom - TOP + 6} className="tj-future" />
        {midnights.map(d => (
          <g key={d}>
            <line x1={sx(`${d} 00:00`)} x2={sx(`${d} 00:00`)} y1={TOP - 4} y2={plotBottom} className="mc-grid" />
            <text x={sx(`${d} 00:00`)} y={H - 3} textAnchor="middle" className="mc-tick">{md(d)}</text>
          </g>
        ))}
        {lanes.map(l => {
          const { y, sy } = l
          const k5 = 5 * l.u
          // 예측선과 범위는 마지막 측정값에서 시작
          const o = { x: sx(l.f.last.time), y: sy(l.f.last.value) }
          const band = [`${o.x},${o.y}`, ...l.pts.map(p => `${sx(p.time)},${sy(p.hi)}`), ...[...l.pts].reverse().map(p => `${sx(p.time)},${sy(p.lo)}`)].join(' ')
          const fpath = `M${o.x},${o.y} ` + l.pts.map(p => `L${sx(p.time)},${sy(p.v)}`).join(' ')
          const mpath = l.measured.map((r, j) => `${j ? 'L' : 'M'}${sx(r.charttime)},${sy(r.value)}`).join(' ')
          const end = l.pts.at(-1)!
          return (
            <g key={l.f.code}>
              <text x={6} y={y + 13} className="vc-label">{short(l.it.name)}</text>
              <text x={6} y={y + 26} className="vc-unit">{l.it.unit}</text>
              <text x={PAD_L - 5} y={y + 8} textAnchor="end" className="mc-tick">{fmtNum(l.yMax, l.it.dp)}</text>
              <text x={PAD_L - 5} y={y + LANE_H} textAnchor="end" className="mc-tick">0</text>
              <line x1={PAD_L} x2={W - PAD_R} y1={y + LANE_H} y2={y + LANE_H} className="mc-base" />
              {[2, 5].map(k => {
                if (k * l.u > l.yMax) return null
                // 두 기준선이 가까우면 5배 이름표를 옆으로 비킴
                const close = k === 5 && sy(2 * l.u) - sy(5 * l.u) < 12
                return (
                  <g key={k}>
                    <line x1={PAD_L} x2={W - PAD_R} y1={sy(k * l.u)} y2={sy(k * l.u)} className="mc-thr" />
                    <text x={PAD_L + 3 + (close ? 52 : 0)} y={sy(k * l.u) - 2.5} className="mc-thr-label">{k}배 {fmtNum(k * l.u, l.it.dp)}</text>
                  </g>
                )
              })}
              <g clipPath="url(#traj-clip)">
                <polygon points={band} className="tj-band" />
                <path d={fpath} className="tj-fc" />
                <path d={mpath} className="tj-ms" />
                {l.measured.map(r => (
                  <circle key={r.id} cx={sx(r.charttime)} cy={sy(r.value)} r={3} className={r.value >= k5 ? 'tj-dot hi' : 'tj-dot'} />
                ))}
                {l.pts.map(p => <circle key={p.h} cx={sx(p.time)} cy={sy(p.v)} r={2.5} className="tj-fdot" />)}
              </g>
              <text x={W - PAD_R + 4} y={sy(end.v) + 4} className="tj-end">{fmtNum(end.v, l.it.dp)}</text>
            </g>
          )
        })}
        {events.filter(e => !isAfter(from, e.t0)).map(e => (
          <g key={e.k} className="mc-ev">
            <line x1={sx(e.t0)} x2={sx(e.t0)} y1={TOP - 4} y2={plotBottom} />
          </g>
        ))}
        <line x1={ax} x2={ax} y1={TOP - 6} y2={plotBottom} className="tj-now" />
        <text x={ax + 4} y={TOP - 1} className="tj-now-label">기준 → 24시간</text>
        {hover && <line x1={hx} x2={hx} y1={TOP - 4} y2={plotBottom} className="mc-cross" pointerEvents="none" />}
        <rect x={PAD_L} y={0} width={W - PAD_L - PAD_R} height={H} fill="transparent" onMouseMove={pick} onMouseLeave={() => setHover(null)} />
      </svg>
      {tip && hover && (
        <div className="mc-tip wide" style={{ left: hx + 200 > W ? hx - 194 : hx + 10 }}>
          <div className="mono">{mdhm(hover)}</div>
          {tip.map(t => (
            <div key={t.l.f.code} className="vc-tip-row">
              <span>{short(t.l.it.name)}</span>
              <b>{t.text || '–'}</b>
              <span className="muted">{t.kind === '–' ? '' : t.kind}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** 1, 1.5, 2, 2.5, 5 x 10^n 단위로 올림 */
function niceCeil(v: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  for (const m of [1, 1.5, 2, 2.5, 5, 10]) if (v <= m * p) return m * p
  return 10 * p
}
