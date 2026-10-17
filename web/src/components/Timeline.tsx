import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { AgentId, CaseData, Ref, TimelineEvent } from '../types'
import type { Sim } from '../data'
import { daysBetween, fromMs, hoursBetween, isAfter, md, mdhm, toMs } from '../lib/time'
import { fmtNum } from '../lib/lab'
import { cls, textWidth, useWidth } from '../lib/ui'
import { bi, pick, tr, type Bi } from '../lib/i18n'
import { tx } from '../data/cases/en'

type Lane = 'ai' | TimelineEvent['lane']

interface Item {
  id: string
  lane: Lane
  label: string
  start: string
  end?: string
  ref?: Ref
  agent?: AgentId
}

const LANES: { key: Lane; label: Bi }[] = [
  { key: 'ai', label: bi('AI 에이전트', 'AI agents') },
  { key: 'hemo', label: bi('혈역학', 'Hemodynamics') },
  { key: 'drug', label: bi('약물', 'Drugs') },
  { key: 'test', label: bi('검사·처치', 'Tests/procs') },
]

const ROW_H = 15
const PAD_L = 82
const PAD_R = 16
const TOP = 16
const FONT = 10.5
const HOUR = 3_600_000

interface Props {
  cs: CaseData
  sim: Sim
  clock: string
  onSeek: (t: string) => void
  onJump: (ref: Ref) => void
  onAgent: (a: AgentId) => void
}

/** 같은 갈래 안에서 시간이 겹치는 막대는 아랫줄로 내린다 */
function stack(items: Item[], endOf: (e: Item) => number) {
  const rows: number[] = []
  return items.map(e => {
    const s = toMs(e.start)
    let r = rows.findIndex(end => end < s)
    if (r === -1) r = rows.length
    rows[r] = endOf(e)
    return { e, row: r }
  })
}

const short = (name: string) => name.split(' (')[0].split(' ')[0]

/** 입실부터 퇴실까지의 시간선. 빈 곳을 누르거나 끌면 기준 시각이 바뀐다 */
export function Timeline({ cs, sim, clock, onSeek, onJump, onAgent }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<string | null>(null)
  const dragging = useRef(false)
  const W = Math.max(width, 400)
  const x0 = toMs(cs.icuIn)
  const x1 = toMs(cs.icuOut)
  const plotW = W - PAD_L - PAD_R
  const sx = (t: string) => PAD_L + ((Math.max(x0, Math.min(toMs(t), x1)) - x0) / (x1 - x0)) * plotW
  const pxPerMs = plotW / (x1 - x0)
  const now = toMs(clock)
  const known = (t?: string) => !!t && !isAfter(t, clock)

  // 사건과 에이전트 실행은 기준 시각에 알게 된 것만
  const items: Item[] = cs.events.filter(e => known(e.start)).map(e => ({ ...e, label: tx(e.label) }))
  // 첫 이상과 5배 사건이 같은 결과면 한 표시로
  const same = sim.first && sim.target && sim.first.result.id === sim.target.result.id
  for (const ev of same ? [sim.target] : [sim.first, sim.target]) {
    if (!ev || !known(ev.detectAt)) continue
    items.push({
      id: `ev${ev.k}`, lane: 'test', start: ev.t0,
      label: `${short(ev.item.name)} ${fmtNum(ev.result.value, ev.item.dp)} · ${same ? tr('2배, 5배', '2×, 5×') : tr(`${ev.k}배`, `${ev.k}×`)}`,
      ref: { tab: 'lab', row: ev.result.code, col: ev.result.id },
    })
  }
  // 발생 예측 경보: 경보 기준 이상인 시간을 이어 붙인 막대
  const thr = sim.a1.threshold
  let alarm: Item | undefined
  for (const p of sim.a1.points) {
    if (isAfter(p.time, clock)) break
    const end = fromMs(Math.min(toMs(p.time) + HOUR, now))
    if (p.p >= thr) {
      if (alarm) alarm.end = end
      else alarm = { id: `a1-${p.time}`, lane: 'ai', label: tr('발생 예측 경보', 'Early-warning alarm'), start: p.time, end, agent: 1 }
    } else if (alarm) {
      items.push(alarm)
      alarm = undefined
    }
  }
  if (alarm) items.push(alarm)
  // 5배 사건 때 종료 상태 예측과 원인 추정이 함께 돈다
  if (sim.target && known(sim.target.detectAt)) {
    items.push({ id: 'a3', lane: 'ai', label: tr('원인 추정', 'Cause assessment'), start: sim.target.detectAt, agent: 3 })
    items.push({ id: 'a2', lane: 'ai', label: tr('종료 상태 예측', 'End-state prediction'), start: sim.target.detectAt, agent: 2 })
  }
  items.sort((a, b) => toMs(a.start) - toMs(b.start))

  const endOf = (e: Item) =>
    e.end ? Math.max(Math.min(toMs(e.end), now), toMs(e.start) + (textWidth(e.label, FONT) + 22) / pxPerMs) : toMs(e.start) + (textWidth(e.label, FONT) + 22) / pxPerMs

  let y = TOP
  const lanes = LANES.map(l => {
    const st = stack(items.filter(e => e.lane === l.key), endOf)
    const rows = Math.max(1, ...st.map(i => i.row + 1))
    const lane = { ...l, label: pick(l.label), y, rows, items: st }
    y += rows * ROW_H + 4
    return lane
  })
  const axisY = y
  const H = axisY + 18
  const midnights = daysBetween(cs.icuIn, cs.icuOut).slice(1)
  const cx = sx(clock)

  const timeAt = (clientX: number, box: DOMRect) => {
    const ms = x0 + ((clientX - box.left - PAD_L) / plotW) * (x1 - x0)
    const ticks = sim.ticks
    const i = Math.round((ms - toMs(ticks[0])) / HOUR)
    return ticks[Math.max(0, Math.min(ticks.length - 1, i))]
  }
  const svgBox = (e: PointerEvent<SVGRectElement>) => e.currentTarget.ownerSVGElement!.getBoundingClientRect()
  const onDown = (e: PointerEvent<SVGRectElement>) => {
    dragging.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
    onSeek(timeAt(e.clientX, svgBox(e)))
  }
  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const t = timeAt(e.clientX, svgBox(e))
    setHover(t)
    if (dragging.current && t !== clock) onSeek(t)
  }
  const onKey = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 24 : 1
    const i = sim.ticks.indexOf(clock)
    if (e.key === 'ArrowRight') onSeek(sim.ticks[Math.min(sim.ticks.length - 1, i + step)])
    else if (e.key === 'ArrowLeft') onSeek(sim.ticks[Math.max(0, i - step)])
    else return
    e.preventDefault()
  }

  const marks = [sim.first, sim.target].filter(ev => ev && known(ev.detectAt))
  const hx = hover ? sx(hover) : 0

  return (
    <div className="timeline">
      <div className="tl-head">
        <strong>{tr('경과 시간선', 'Course timeline')}</strong>
        <span className="muted">
          {tr(
            `ICU 입실 ${mdhm(cs.icuIn)} · 기준 시각까지 ${hoursBetween(cs.icuIn, clock).toFixed(1)}시간`,
            `ICU admission ${mdhm(cs.icuIn)} · ${hoursBetween(cs.icuIn, clock).toFixed(1)} h to the as-of time`,
          )}
          {!isAfter(cs.icuOut, clock) && tr(` · ICU 퇴실 ${mdhm(cs.icuOut)}`, ` · ICU discharge ${mdhm(cs.icuOut)}`)}
        </span>
        <span className="spacer" />
        <span className="muted tl-hint">
          {hover && hover !== clock
            ? tr(`${mdhm(hover)} 로 옮기기`, `Move to ${mdhm(hover)}`)
            : tr('빈 곳을 누르거나 끌면 기준 시각이 바뀝니다', 'Click or drag an empty spot to change the as-of time')}
        </span>
      </div>
      <div ref={ref} className="tl-plot">
        <svg width={W} height={H} tabIndex={0} onKeyDown={onKey} role="slider" aria-label={tr('기준 시각', 'As-of time')} aria-valuetext={clock}
          aria-valuemin={0} aria-valuemax={sim.ticks.length - 1} aria-valuenow={sim.ticks.indexOf(clock)}>
          <defs>
            <pattern id="tl-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" className="tl-hatch-line" />
            </pattern>
          </defs>
          {midnights.map(d => (
            <g key={d}>
              <line x1={sx(`${d} 00:00`)} x2={sx(`${d} 00:00`)} y1={TOP - 2} y2={axisY} className="tl-grid" />
              <text x={sx(`${d} 00:00`)} y={axisY + 13} textAnchor="middle" className="tl-tick">{md(d)}</text>
            </g>
          ))}
          {cx < W - PAD_R && <rect x={cx} y={TOP - 2} width={W - PAD_R - cx} height={axisY - TOP + 2} fill="url(#tl-hatch)" className="tl-future" />}
          {/* 빈 곳: 기준 시각 바꾸기 (사건 막대보다 아래에 깔아 막대 클릭을 막지 않음) */}
          <rect
            x={PAD_L} y={0} width={plotW} height={H} fill="transparent" className="tl-seek"
            onPointerDown={onDown} onPointerMove={onMove}
            onPointerUp={() => (dragging.current = false)} onPointerLeave={() => setHover(null)}
          />
          {lanes.map(l => (
            <g key={l.key}>
              <text x={8} y={l.y + 11} className={cls('tl-lane', l.key === 'ai' && 'ai')}>{l.label}</text>
              <line x1={PAD_L} x2={W - PAD_R} y1={l.y + l.rows * ROW_H + 1} y2={l.y + l.rows * ROW_H + 1} className="tl-base" />
              {l.items.map(({ e, row }) => {
                const ex = sx(e.start)
                const ey = l.y + row * ROW_H
                const go = () => (e.agent ? onAgent(e.agent) : e.ref && onJump(e.ref))
                const common = {
                  role: 'button' as const,
                  tabIndex: 0,
                  onClick: go,
                  onKeyDown: (ev: KeyboardEvent) => ev.key === 'Enter' && go(),
                  className: cls('tl-ev', l.key, e.id.startsWith('ev') && 'liver'),
                }
                if (e.end) {
                  const w = Math.max(4, sx(fromMs(Math.min(toMs(e.end), now))) - ex)
                  const fits = textWidth(e.label, FONT) + 10 < w
                  return (
                    <g key={e.id} {...common}>
                      <title>{`${e.label} ${mdhm(e.start)} ~ ${mdhm(e.end)}`}</title>
                      <rect x={ex} y={ey + 2} width={w} height={ROW_H - 3} rx={2} className="tl-bar" />
                      <text x={fits ? ex + 5 : ex + w + 4} y={ey + 11} className="tl-label">{e.label}</text>
                    </g>
                  )
                }
                return (
                  <g key={e.id} {...common}>
                    <title>{`${e.label} ${mdhm(e.start)}`}</title>
                    <rect x={ex - 4} y={ey + 3.5} width={8} height={8} rx={1} transform={`rotate(45 ${ex} ${ey + 7.5})`} className="tl-dot" />
                    <text x={ex + 7} y={ey + 11} className="tl-label">{e.label}</text>
                  </g>
                )
              })}
            </g>
          ))}
          {marks.map(ev => (
            <g key={ev!.k} className="tl-evmark">
              <title>{tr(`${ev!.k}배 사건 · 공개 ${mdhm(ev!.t0)} (채혈 ${mdhm(ev!.drawn)})`, `${ev!.k}× event · released ${mdhm(ev!.t0)} (drawn ${mdhm(ev!.drawn)})`)}</title>
              <line x1={sx(ev!.t0)} x2={sx(ev!.t0)} y1={TOP - 2} y2={axisY} />
            </g>
          ))}
          {hover && hover !== clock && (
            <g className="tl-hover">
              <line x1={hx} x2={hx} y1={TOP - 2} y2={axisY} />
            </g>
          )}
          <g className="tl-clock">
            <line x1={cx} x2={cx} y1={TOP - 4} y2={axisY + 2} />
            <path d={`M${cx - 5},${TOP - 10} h10 l-5,6 z`} />
            <text x={cx > W - 90 ? cx - 8 : cx + 8} y={TOP - 4} textAnchor={cx > W - 90 ? 'end' : 'start'}>{mdhm(clock)}</text>
          </g>
        </svg>
      </div>
    </div>
  )
}
