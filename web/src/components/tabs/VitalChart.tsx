import { useState, type KeyboardEvent, type MouseEvent } from 'react'
import type { CaseData, LiverEvent, MarOrder, VitalRow } from '../../types'
import { addHours, daysBetween, isAfter, md, mdhm, toMs } from '../../lib/time'
import { rateAt, useWidth, type Highlight } from '../../lib/ui'
import { tr } from '../../lib/i18n'

interface Lane {
  key: string
  label: string
  unit: string
  dom: [number, number]
  dp: number
  thr?: { v: number; below: boolean }
  get: (r: VitalRow) => number | undefined
}

interface Props {
  cs: CaseData
  rows: VitalRow[]
  clock: string
  events: LiverEvent[]
  hl: Highlight
}

const PAD_L = 118
const PAD_R = 52
const LANE_H = 44
const GAP = 10
const TOP = 16

// 한 그래프에 한 항목, 축도 하나씩. 아래 표가 같은 값을 담은 표 보기다.
export function VitalChart({ cs, rows, clock, events, hl }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const ne: MarOrder | undefined = cs.mar.find(o => o.id === 'NE')

  const lanes: Lane[] = [
    { key: 'map', label: 'MAP', unit: 'mmHg', dom: [40, 110], dp: 0, thr: { v: 65, below: true }, get: r => r.map },
    { key: 'spo2', label: 'SpO2', unit: '%', dom: [80, 100], dp: 0, thr: { v: 90, below: true }, get: r => r.spo2 },
    { key: 'hr', label: tr('심박수', 'Heart rate'), unit: tr('/분', '/min'), dom: [60, 170], dp: 0, thr: { v: 130, below: false }, get: r => r.hr },
    { key: 'ne', label: tr('노르에피네프린', 'Norepinephrine'), unit: 'mcg/kg/min', dom: [0, 0.4], dp: 2, get: r => rateAt(ne, r.time) },
  ]

  const W = Math.max(width, 480)
  // 입실부터 기준 시각까지 (처음 하루는 하루 폭으로)
  const minEnd = addHours(cs.icuIn, 24)
  const xEnd = isAfter(clock, minEnd) ? clock : minEnd
  const x0 = toMs(cs.icuIn)
  const x1 = toMs(xEnd)
  const sx = (t: string) => PAD_L + ((toMs(t) - x0) / (x1 - x0)) * (W - PAD_L - PAD_R)
  const laneY = (i: number) => TOP + i * (LANE_H + GAP)
  const sy = (l: Lane, i: number, v: number) => {
    const c = Math.max(l.dom[0], Math.min(l.dom[1], v))
    return laneY(i) + LANE_H - ((c - l.dom[0]) / (l.dom[1] - l.dom[0])) * LANE_H
  }
  const H = laneY(lanes.length) + 8
  const midnights = daysBetween(cs.icuIn, xEnd).slice(1)
  const fmt = (l: Lane, v: number | undefined) => (v === undefined ? '–' : v.toFixed(l.dp))

  // 노르에피네프린은 MAR 의 속도 변경 시각 그대로 계단으로 그린다
  const neChanges = (ne?.admins ?? []).filter(a => a.rate !== undefined && !isAfter(a.time, clock))
  const nePath = (i: number) => {
    const l = lanes[3]
    let d = `M${PAD_L},${sy(l, i, 0)}`
    for (const a of neChanges) d += ` H${sx(a.time)} V${sy(l, i, a.rate!)}`
    return d + ` H${sx(rows[rows.length - 1].time)}`
  }

  const pick = (e: MouseEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - box.left + PAD_L
    let best = 0
    rows.forEach((r, i) => {
      if (Math.abs(sx(r.time) - x) < Math.abs(sx(rows[best].time) - x)) best = i
    })
    setHover(best)
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') setHover(h => Math.min(rows.length - 1, (h ?? rows.length - 2) + 1))
    if (e.key === 'ArrowLeft') setHover(h => Math.max(0, (h ?? rows.length) - 1))
  }

  const hr = hover !== null ? rows[hover] : null
  const hx = hr ? sx(hr.time) : 0
  const hlBand = hl && hl.ref.tab === 'vital' && hl.ref.from ? hl.ref : null

  return (
    <div className="vchart" ref={ref}>
      <svg
        width={W}
        height={H}
        tabIndex={0}
        onKeyDown={onKey}
        onBlur={() => setHover(null)}
        role="img"
        aria-label={tr(
          '활력징후 추이. 아래 표에 같은 값이 있습니다. 좌우 화살표로 시각을 옮길 수 있습니다',
          'Vital-sign trends. The table below has the same values. Use the left and right arrow keys to move the time',
        )}
      >
        {midnights.map(d => (
          <g key={d}>
            <line x1={sx(`${d} 00:00`)} x2={sx(`${d} 00:00`)} y1={TOP - 4} y2={H - 8} className="tl-grid" />
            <text x={sx(`${d} 00:00`) + 3} y={TOP - 5} className="tl-tick">{md(d)}</text>
          </g>
        ))}
        {lanes.map((l, i) => {
          const y = laneY(i)
          const pts = rows.map(r => ({ r, v: l.get(r) })).filter(p => p.v !== undefined) as { r: VitalRow; v: number }[]
          const last = pts[pts.length - 1]
          const band = hlBand && hlBand.row === l.key ? hlBand : null
          return (
            <g key={l.key}>
              {band && (
                <rect x={sx(band.from!) - 6} y={y - 2} width={sx(band.to ?? band.from!) - sx(band.from!) + 12} height={LANE_H + 4} className="vc-hl" />
              )}
              <text x={8} y={y + 16} className="vc-label">{l.label}</text>
              <text x={8} y={y + 29} className="vc-unit">{l.unit}</text>
              <text x={PAD_L - 6} y={y + 8} textAnchor="end" className="vc-tick">{l.dom[1]}</text>
              <text x={PAD_L - 6} y={y + LANE_H} textAnchor="end" className="vc-tick">{l.dom[0]}</text>
              <line x1={PAD_L} x2={W - PAD_R} y1={y + LANE_H} y2={y + LANE_H} className="vc-base" />
              {l.thr && (
                <g>
                  <line x1={PAD_L} x2={W - PAD_R} y1={sy(l, i, l.thr.v)} y2={sy(l, i, l.thr.v)} className="vc-thr" />
                  <text x={PAD_L + 4} y={sy(l, i, l.thr.v) - 3} className="vc-thr-label">{l.thr.v}</text>
                </g>
              )}
              {l.key === 'ne' ? (
                <path d={nePath(i)} className="vc-line" />
              ) : (
                <path d={pts.map((p, k) => `${k ? 'L' : 'M'}${sx(p.r.time)},${sy(l, i, p.v)}`).join(' ')} className="vc-line" />
              )}
              {l.thr &&
                pts
                  .filter(p => (l.thr!.below ? p.v < l.thr!.v : p.v > l.thr!.v))
                  .map(p => <circle key={p.r.time} cx={sx(p.r.time)} cy={sy(l, i, p.v)} r={3.5} className="vc-alarm" />)}
              {last && (
                <text x={W - PAD_R + 6} y={sy(l, i, last.v) + 4} className="vc-end">{fmt(l, last.v)}</text>
              )}
              {hr && <circle cx={hx} cy={sy(l, i, l.get(hr) ?? l.dom[0])} r={3} className="vc-hover-dot" />}
            </g>
          )
        })}
        {events.map(ev => (
          <g key={ev.k} className="vc-ev">
            <line x1={sx(ev.t0)} x2={sx(ev.t0)} y1={TOP - 6} y2={H - 6} />
            <text x={sx(ev.t0) + 4} y={H - 1}>{tr(`${ev.k}배`, `${ev.k}×`)}</text>
          </g>
        ))}
        {hr && <line x1={hx} x2={hx} y1={TOP - 4} y2={H - 8} className="vc-cross" />}
        <rect
          x={PAD_L}
          y={0}
          width={W - PAD_L - PAD_R}
          height={H}
          fill="transparent"
          onMouseMove={pick}
          onMouseLeave={() => setHover(null)}
        />
      </svg>
      {hr && (
        <div className="vc-tip" style={{ left: hx + 180 > W ? hx - 172 : hx + 12 }}>
          <div className="vc-tip-time">{mdhm(hr.time)}</div>
          {lanes.map(l => (
            <div key={l.key} className="vc-tip-row">
              <span>{l.label}</span>
              <b>{fmt(l, l.get(hr))}</b>
              <span className="muted">{l.unit}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
