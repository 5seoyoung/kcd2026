import { useState, type KeyboardEvent, type MouseEvent } from 'react'
import type { A1Point, CaseData, LiverEvent } from '../../types'
import type { Sim } from '../../data'
import { fmtNum } from '../../lib/lab'
import { addHours, daysBetween, hm, hoursBetween, isAfter, md, mdhm, toMs } from '../../lib/time'
import { cls, useWidth } from '../../lib/ui'
import { a1Now, a1Verdict, pct } from './state'
import { FactorList } from './FactorList'

interface Props {
  cs: CaseData
  sim: Sim
  clock: string
  events: LiverEvent[]
}

const short = (name: string) => name.split(' (')[0]
const HOUR = 3_600_000

export function Agent1({ cs, sim, clock, events }: Props) {
  const a1 = sim.a1
  const { point, unknown, started, ended } = a1Now(sim, clock)
  if (sim.excluded) {
    return <div className="ad-wait">ICU 입실 전 같은 입원에서 이미 2배 이상이라 분석 대상이 아닙니다.</div>
  }
  if (a1.notEligible && sim.first && !isAfter(sim.first.detectAt, clock)) {
    return (
      <div className="ad-wait">
        <b>대상 아님</b>
        <div>{a1.notEligible}. 첫 이상 {mdhm(sim.first.t0)} 공개 (ICU 입실 뒤 {Math.round(hoursBetween(cs.icuIn, sim.first.t0))}시간). 발생 예측은 정상 구간에서만 돕니다.</div>
      </div>
    )
  }
  if (!started) {
    return <div className="ad-wait">ICU 에서 첫 간 검사 결과가 공개되면 첫 이상 전까지 매시간 실행합니다.</div>
  }
  const shown = a1.points.filter(p => !isAfter(p.time, clock))
  const gaps = a1.unknown.filter(u => !isAfter(u.time, clock)).map(u => u.time)
  const v = a1Verdict(sim, clock)
  const first = sim.first
  const stopped = ended && !!first
  // 멈춘 뒤에는 마지막 출력의 24시간 정답 확인 구간까지 보여 줌
  const end = stopped && shown.length ? (isAfter(clock, addHours(shown.at(-1)!.time, 24)) ? addHours(shown.at(-1)!.time, 24) : clock) : clock
  const alarm = !!point && !unknown && point.p >= a1.threshold
  const model = sim.run?.meta.agent1_internal

  return (
    <div className="ad">
      <div className="ad-head">
        {unknown ? (
          <>
            <span className="ad-big unk">판정 불가</span>
            <span className="ad-what">
              <b>이번 시각은 정상 구간이 아님</b>
              <span className="muted">{mdhm(clock)} · {unknown}</span>
            </span>
          </>
        ) : point ? (
          <>
            <span className={cls('ad-big', alarm && 'alarm')}>{pct(point.p)}</span>
            <span className="ad-what">
              <b>24시간 안 5배 사건 확률</b>
              <span className="muted">{mdhm(point.time)} 실행{stopped ? ' · 마지막' : ''} · 경보 기준 {pct(a1.threshold)}</span>
              {point.confidence && (
                <span className={cls('conf-line', point.confidence.level === '낮음' && 'low')}>
                  확신 {point.confidence.level}{point.confidence.why ? ` · ${point.confidence.why}` : ''}
                </span>
              )}
            </span>
          </>
        ) : (
          <span className="ad-what"><b>정상 구간 대기</b></span>
        )}
        <span className="spacer" />
        {point && !unknown && (alarm ? <span className="flag alarm">경보</span> : <span className="flag">기준 미만</span>)}
      </div>

      {shown.length > 0 && (
        <RiskChart points={shown} gaps={gaps} threshold={a1.threshold} start={a1.start!} end={end} events={events} firstAlarm={a1.firstAlarm} verifyFrom={stopped ? shown.at(-1)!.time : undefined}
          lowConf={shown.filter(p => p.confidence?.level === '낮음').map(p => p.time)} />
      )}

      {stopped && (
        <div className="ad-box">
          <b>첫 이상으로 멈춤.</b> {short(first.item.name)} {fmtNum(first.result.value, first.item.dp)} ({first.k}배, {mdhm(first.t0)} 공개).
          {v && (v.pending
            ? <> 마지막 출력 ({hm(v.last.time)}, {pct(v.last.p)}) 의 정답은 {mdhm(v.until)} 까지 5배 사건이 생기는지로 확인합니다.</>
            : v.kind === 'hit'
              ? <> 5배 사건 {mdhm(v.target!.t0)} 공개 ({short(v.target!.item.name)} {fmtNum(v.target!.result.value, v.target!.item.dp)}). 첫 경보 {mdhm(a1.firstAlarm!)}, 사건 <b>{v.lead!.toFixed(1)}시간</b> 전 → <b className="ok-ink">적중</b>.</>
              : v.kind === 'miss'
                ? <> 경보 없이 5배 사건이 생겼습니다 ({mdhm(v.target!.t0)} 공개) → 놓침.</>
                : v.kind === 'false'
                  ? <> 경보했지만 {mdhm(v.until)} 까지 5배 사건이 없었습니다 → 오경보.</>
                  : <> 경보 없이 {mdhm(v.until)} 까지 5배 사건이 없었습니다.</>)}
        </div>
      )}
      {!stopped && a1.firstAlarm && !isAfter(a1.firstAlarm, clock) && (
        <div className="ad-box">첫 경보 {mdhm(a1.firstAlarm)}. 첫 이상 (2배) 이 공개되면 이 에이전트는 멈추고 종료 상태 예측과 원인 추정이 돕니다.</div>
      )}

      {point && (
        <section className="sub-card">
          <h4>
            {unknown ? '마지막 출력의 요인' : '이 시각의 요인'}
            <span className="h4-sub">
              {mdhm(point.time)} · {point.base !== undefined ? `설명 기준값 ${pct(point.base)} 에서 변수 묶음마다 올리고 내린 양 (그룹 Shapley)` : '위험에 많이 기여한 순'}
            </span>
          </h4>
          <FactorList factors={point.factors} up="위험 높임" down="위험 낮춤" />
        </section>
      )}
      <p className="note">
        {model && <>MIMIC-IV 로 학습한 그래디언트 부스팅 (변수 88개{model.auroc ? `, 내부 검증 AUROC ${model.auroc.toFixed(2)}, AUPRC ${model.auprc.toFixed(2)}` : ''}). </>}
        정상 구간 (ALT, ALP, 총빌리를 모두 최근 24시간 안에 쟀고 모두 2 x ULN 미만) 에서만 예측하고, 아니면 판정 불가로 둡니다. 첫 이상 (2배) 전까지만 돌고, 목표는 24시간 안 5 x ULN 사건입니다. 경보 기준 {pct(a1.threshold)} 와 확신 (젖산, INR 이 24시간 안에 있는지) 은 화면 설정입니다.
      </p>
    </div>
  )
}

const PAD_L = 38
const PAD_R = 12
const TOP = 10
const PH = 92
const H = TOP + PH + 20

interface ChartProps {
  points: A1Point[]
  /** 판정 불가 시각 */
  gaps: string[]
  threshold: number
  start: string
  end: string
  events: LiverEvent[]
  firstAlarm?: string
  /** 멈춘 뒤 정답 확인 구간의 시작 (마지막 출력 시각) */
  verifyFrom?: string
  /** 확신 낮음 (젖산, INR 이 24시간 안에 없음) 시각 */
  lowConf: string[]
}

/** 시간별 발생 확률 한 줄. 축은 하나 (0~100%), 경보 기준은 점선, 판정 불가 시각은 선을 끊고 아래에 회색 칸 */
function RiskChart({ points, gaps, threshold, start, end, events, firstAlarm, verifyFrom, lowConf }: ChartProps) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const W = Math.max(width, 300)
  const minEnd = addHours(start, 24)
  const xEnd = isAfter(end, minEnd) ? end : minEnd
  const x0 = toMs(start)
  const x1 = toMs(xEnd)
  const sx = (t: string) => PAD_L + ((toMs(t) - x0) / (x1 - x0)) * (W - PAD_L - PAD_R)
  // 확률이 작으면 축을 자료에 맞춤. 경보 기준이 축 밖이면 표시만 함
  const top = Math.max(0.02, ...points.map(p => p.p * 1.25))
  const yMax = [0.02, 0.05, 0.1, 0.2, 0.5, 1].find(v => top <= v) ?? 1
  const sy = (p: number) => TOP + PH - (Math.min(p, yMax) / yMax) * PH
  const thrIn = threshold <= yMax
  // 한 시간보다 벌어지면 선을 끊음
  const path = points
    .map((p, i) => `${i && toMs(p.time) - toMs(points[i - 1].time) <= HOUR ? 'L' : 'M'}${sx(p.time)},${sy(p.p)}`)
    .join(' ')
  const midnights = daysBetween(start, xEnd).slice(1)
  const fa = firstAlarm ? points.find(p => p.time === firstAlarm) : undefined
  const evs = events.filter(e => !isAfter(start, e.t0) && !isAfter(e.t0, xEnd))
  const hourW = (W - PAD_L - PAD_R) * (HOUR / (x1 - x0))
  const vx = verifyFrom ? sx(verifyFrom) : 0
  const vEnd = verifyFrom ? Math.min(sx(addHours(verifyFrom, 24)), W - PAD_R) : 0

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
        <defs>
          <pattern id="a1-hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="4" className="mc-gap-line" />
          </pattern>
        </defs>
        {verifyFrom && (
          <g>
            <rect x={vx} y={TOP} width={Math.max(0, vEnd - vx)} height={PH} className="mc-verify" />
            <text x={vx + 4} y={TOP + PH - 4} className="mc-verify-label">정답 확인 24시간</text>
          </g>
        )}
        {[0, yMax / 2, yMax].map(v => (
          <g key={v}>
            <line x1={PAD_L} x2={W - PAD_R} y1={sy(v)} y2={sy(v)} className={v === 0 ? 'mc-base' : 'mc-grid'} />
            <text x={PAD_L - 5} y={sy(v) + 3.5} textAnchor="end" className="mc-tick">{+(v * 100).toFixed(1)}%</text>
          </g>
        ))}
        {midnights.map(d => (
          <g key={d}>
            <line x1={sx(`${d} 00:00`)} x2={sx(`${d} 00:00`)} y1={TOP} y2={TOP + PH} className="mc-grid" />
            <text x={sx(`${d} 00:00`)} y={H - 5} textAnchor="middle" className="mc-tick">{md(d)}</text>
          </g>
        ))}
        {lowConf.map(t => (
          <rect key={`lc-${t}`} x={sx(t) - hourW / 2} y={TOP + PH - 4} width={Math.max(2, hourW)} height={4} className="mc-lowconf">
            <title>{`${mdhm(t)} 확신 낮음`}</title>
          </rect>
        ))}
        {gaps.map(t => (
          <rect key={t} x={sx(t) - hourW / 2} y={TOP + PH - 7} width={Math.max(2, hourW)} height={7} fill="url(#a1-hatch)" className="mc-gap">
            <title>{`${mdhm(t)} 판정 불가`}</title>
          </rect>
        ))}
        {thrIn ? (
          <>
            <line x1={PAD_L} x2={W - PAD_R} y1={sy(threshold)} y2={sy(threshold)} className="mc-thr" />
            <text x={PAD_L + 4} y={sy(threshold) - 3} className="mc-thr-label">경보 {threshold * 100}%</text>
          </>
        ) : (
          <text x={PAD_L + 4} y={TOP + 9} className="mc-thr-label">↑ 경보 기준 {threshold * 100}% 는 축 위</text>
        )}
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
            {sx(fa.time) - PAD_L > 70
              ? <text x={sx(fa.time) - 6} y={sy(fa.p) - 7} textAnchor="end" className="mc-note">첫 경보 {hm(fa.time)}</text>
              : <text x={sx(fa.time) + 6} y={sy(fa.p) - 7} className="mc-note">첫 경보 {hm(fa.time)}</text>}
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
      {(gaps.length > 0 || lowConf.length > 0) && (
        <div className="mc-legend">
          {gaps.length > 0 && <><span className="lg gap" /> 판정 불가 {gaps.length}시간 (정상 구간 아님)</>}
          {lowConf.length > 0 && <><span className="lg lowconf" /> 확신 낮음 {lowConf.length}시간 (젖산·INR 24시간 안 없음)</>}
        </div>
      )}
    </div>
  )
}

