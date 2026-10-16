// 에이전트 1 (발생 예측), 4 (24시간 궤적) 의 대체 계산. 팀 모델을 받으면 같은 형식 (A1Point, A4Forecast) 의 출력으로 바꾼다.
// 둘 다 기준 시각까지 결과가 나온 기록만 쓴다.
import type { A1Point, A4Forecast, CaseData, Factor } from '../types'
import { activeAt, EVENT_CODES, itemOf, seriesAt, uln } from '../lib/events'
import { fmtNum } from '../lib/lab'
import { rateAt } from '../lib/ui'
import { addHours, ceilHour, hourly, hoursBetween, isAfter } from '../lib/time'

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x))
const short = (name: string) => name.split(' (')[0]

/**
 * 에이전트 1 대체 모델: 24시간 안 5배 사건 확률.
 * 간 검사 마지막 배수와 상승 속도 (선행 연구의 평균, 기울기 특징) 에 혈역학 특징을 더한 로지스틱 식.
 */
export function agent1At(cs: CaseData, t: string): A1Point {
  // 사건 항목 중 마지막 값의 배수가 가장 큰 것
  let top: { code: string; x: number; value: number; time: string; slope: number } | undefined
  for (const code of EVENT_CODES) {
    const rs = seriesAt(cs, code, t)
    const last = rs.at(-1)
    if (!last) continue
    const x = last.value / uln(cs, code)
    const prev = rs.at(-2)
    const slope = prev ? ((x - prev.value / uln(cs, code)) / hoursBetween(prev.charttime, last.charttime)) * 24 : 0
    if (!top || x > top.x) top = { code, x, value: last.value, time: last.charttime, slope }
  }

  const from = addHours(t, -12)
  const recent = (time: string) => isAfter(time, from) && !isAfter(time, t)
  const hypoH = cs.vitals.filter(v => recent(v.time) && v.map < 65).length
  const ne = rateAt(cs.mar.find(o => o.id === 'NE'), t) ?? 0
  const vaso = activeAt(cs.mar.find(o => o.id === 'VP'), t)
  const lacs = seriesAt(cs, 'LAC', t).filter(r => recent(r.charttime))
  const lac = lacs.length ? Math.max(...lacs.map(r => r.value)) : undefined

  const c = {
    liver: top ? 1.2 * Math.log(Math.max(top.x, 0.3)) : 0,
    slope: top ? Math.min(1, 0.25 * Math.max(0, top.slope)) : 0,
    hypo: 0.3 * hypoH,
    ne: 2.6 * ne + (vaso ? 0.6 : 0),
    lac: lac !== undefined ? 0.25 * Math.max(0, lac - 2) : 0,
  }
  const p = sigmoid(-3.9 + c.liver + c.slope + c.hypo + c.ne + c.lac)

  const factors: { f: Factor; w: number }[] = []
  if (top) {
    const it = itemOf(cs, top.code)
    factors.push({ f: { name: `${short(it.name)} 마지막 값`, value: `${fmtNum(top.value, it.dp)} (${top.x.toFixed(1)}배)`, dir: c.liver > 0.3 ? '+' : '-' }, w: Math.abs(c.liver) })
    factors.push({ f: { name: `${short(it.name)} 상승 속도`, value: `${top.slope >= 0 ? '+' : ''}${top.slope.toFixed(1)}배/일`, dir: c.slope > 0.2 ? '+' : '-' }, w: c.slope })
  }
  factors.push({ f: { name: 'MAP 65 미만 (지난 12시간)', value: `${hypoH}시간`, dir: hypoH ? '+' : '-' }, w: c.hypo })
  factors.push({ f: { name: '승압제', value: ne ? `노르에피네프린 ${ne.toFixed(2)}${vaso ? ' + 바소프레신' : ''}` : '없음', dir: c.ne ? '+' : '-' }, w: c.ne })
  factors.push({ f: { name: '젖산 최고 (지난 12시간)', value: lac !== undefined ? `${lac.toFixed(1)} mmol/L` : '측정 없음', dir: c.lac > 0.2 ? '+' : '-' }, w: c.lac })
  factors.sort((a, b) => b.w - a.w)

  return { time: t, p, factors: factors.map(x => x.f) }
}

/** 감쇠 시간 (시간). 추세는 이만큼 지나면 거의 멈춘다고 봄 */
const TAU = 12
/** 로그 기울기 상한 (시간당) */
const MAX_SLOPE = 0.035

/**
 * 에이전트 4 대체 모델: 실행안의 기준 모델 '선형 추세' 를 로그 값에서 감쇠시켜 씀.
 * 마지막 두 값 (6시간 이상 간격) 의 기울기로 앞으로 24시간을 그리고, 멀어질수록 범위를 넓힌다.
 */
export function agent4At(cs: CaseData, t: string): A4Forecast[] {
  const out: A4Forecast[] = []
  for (const code of EVENT_CODES) {
    const rs = seriesAt(cs, code, t)
    const last = rs.at(-1)
    if (!last) continue
    const prev = rs.filter(r => hoursBetween(r.charttime, last.charttime) >= 6).at(-1)
    const raw = prev ? Math.log(last.value / prev.value) / hoursBetween(prev.charttime, last.charttime) : 0
    const s = Math.max(-MAX_SLOPE, Math.min(MAX_SLOPE, raw))
    const end = addHours(t, 24)
    const times = [last.charttime, ...hourly(ceilHour(addHours(last.charttime, 1 / 60)), end)]
    const points = times.map(time => {
      const d = hoursBetween(last.charttime, time)
      const v = last.value * Math.exp(s * TAU * (1 - Math.exp(-d / TAU)))
      const sd = 0.06 + 0.011 * d
      return { time, v, lo: v * Math.exp(-sd), hi: v * Math.exp(sd) }
    })
    out.push({ code, last: { time: last.charttime, value: last.value }, points })
  }
  return out
}

/** 예측선에서 그 시각의 값 */
export function forecastAt(f: A4Forecast, t: string) {
  return f.points.find(p => p.time === t) ?? f.points.at(-1)!
}
