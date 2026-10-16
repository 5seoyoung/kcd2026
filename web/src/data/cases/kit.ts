// 가상 사례를 짓는 공통 도구: 날짜 (D0 = ICU 입실일), 검사 묶음, 투약 기록, 매시간 활력징후.
// 모든 값은 손으로 만든 가상 값이다. K-MIMIC, MIMIC 원자료가 아니다.
import type { LabItem, LabResult, MarAdmin, VitalRow } from '../../types'
import { addHours, fromMs, hourly, hoursBetween, isAfter, toMs } from '../../lib/time'

/** D0 기준 날짜: T(1, '05:00') → D1 05:00 */
export const dayOf = (d0: string) => (day: number, hm: string) => fromMs(toMs(`${d0} ${hm}`) + day * 86_400_000)

// 참고치 상한은 그 행의 기록 상한으로 쓴다 (명세서). 사례 설계표의 ULN: ALT 40, AST 40, ALP 130, 총빌리 1.5, GGT 60, LDH 250, CK 200
export const LAB_ITEMS: LabItem[] = [
  { code: 'ALT', name: 'ALT (GPT)', unit: 'IU/L', low: 1, high: 40, group: '간 기능', dp: 0 },
  { code: 'AST', name: 'AST (GOT)', unit: 'IU/L', low: 1, high: 40, group: '간 기능', dp: 0 },
  { code: 'ALP', name: 'ALP', unit: 'IU/L', low: 30, high: 130, group: '간 기능', dp: 0 },
  { code: 'TB', name: 'T. Bilirubin', unit: 'mg/dL', low: 0.2, high: 1.5, group: '간 기능', dp: 1 },
  { code: 'DB', name: 'D. Bilirubin', unit: 'mg/dL', low: 0, high: 0.5, group: '간 기능', dp: 1 },
  { code: 'GGT', name: 'r-GT', unit: 'IU/L', low: 8, high: 60, group: '간 기능', dp: 0 },
  { code: 'INR', name: 'PT (INR)', unit: '', low: 0.8, high: 1.2, group: '간 기능', dp: 2 },
  { code: 'ALB', name: 'Albumin', unit: 'g/dL', low: 3.5, high: 5.2, group: '간 기능', dp: 1 },
  { code: 'CK', name: 'CK', unit: 'IU/L', low: 20, high: 200, group: '근육·용혈', dp: 0 },
  { code: 'LDH', name: 'LDH', unit: 'IU/L', low: 100, high: 250, group: '근육·용혈', dp: 0 },
  { code: 'CR', name: 'Creatinine', unit: 'mg/dL', low: 0.7, high: 1.3, group: '신장', dp: 1 },
  { code: 'BUN', name: 'BUN', unit: 'mg/dL', low: 6, high: 20, group: '신장', dp: 0 },
  { code: 'NA', name: 'Sodium', unit: 'mmol/L', low: 135, high: 145, group: '전해질·대사', dp: 0 },
  { code: 'GLU', name: 'Glucose', unit: 'mg/dL', low: 70, high: 140, group: '전해질·대사', dp: 0 },
  { code: 'HCO3', name: 'Bicarbonate', unit: 'mmol/L', low: 22, high: 29, group: '전해질·대사', dp: 0 },
  { code: 'LAC', name: 'Lactate', unit: 'mmol/L', low: 0.5, high: 2.0, group: '혈액가스', dp: 1 },
  { code: 'WBC', name: 'WBC', unit: '10³/µL', low: 4, high: 10, group: '혈액·염증', dp: 1 },
  { code: 'HB', name: 'Hb', unit: 'g/dL', low: 12, high: 17, group: '혈액·염증', dp: 1 },
  { code: 'PLT', name: 'Platelet', unit: '10³/µL', low: 130, high: 400, group: '혈액·염증', dp: 0 },
]

/** 한 번 채혈한 검사 묶음. store 로 항목별 보고 시각을 따로 줄 수 있음 */
export function panel(id: string, charttime: string, storetime: string, values: Record<string, number>, store: Record<string, string> = {}): LabResult[] {
  return Object.entries(values).map(([code, value]) => ({ id: `${id}-${code}`, code, value, charttime, storetime: store[code] ?? storetime }))
}

/** from 부터 to 까지 every 시간마다 (to 포함) */
export function every(from: string, to: string, hours: number): string[] {
  return hourly(from, to).filter(t => Math.round(hoursBetween(from, t)) % hours === 0)
}

/** 정해진 시각에 투여 */
export const doses = (times: string[], text?: string): MarAdmin[] => times.map(time => ({ time, status: 'given', ...(text ? { text } : {}) }))

/** 지속 주입: [시각, 속도] 를 차례로, stop 이 있으면 그 시각에 끔 */
export function infusion(steps: [string, number | null, string?][], stop?: string, stopText = '중단'): MarAdmin[] {
  const out: MarAdmin[] = steps.map(([time, rate, text], i) => {
    const prev = i ? steps[i - 1][1] : null
    const auto = rate === null ? '시작' : i === 0 ? `${rate} 시작` : `${rate !== null && prev !== null && rate < prev ? '↓' : '↑'}${rate}`
    return { time, status: 'given', text: text ?? auto, ...(rate !== null ? { rate } : {}) }
  })
  if (stop) out.push({ time: stop, status: 'stopped', text: stopText, rate: 0 })
  return out
}

type Range = [number, number]
/** 이 시각부터 다음 구간 전까지의 범위 */
export interface VitalSeg {
  from: string
  map: Range
  hr: Range
  rr: Range
  spo2: Range
  bt: Range
  cvp?: Range
}

/**
 * 매시간 활력징후. 구간마다 범위 안에서 조금씩 움직이고 (이전 값 쪽으로 끌림), fixed 로 특정 시각 값을 지정한다.
 * fixed 에 정시가 아닌 시각을 넣으면 그 시각 행이 하나 더 생긴다 (예: 최저 MAP 를 잰 시각).
 */
export function makeVitals(o: { from: string; to: string; seed: number; segs: VitalSeg[]; fixed?: Record<string, Partial<VitalRow>> }): VitalRow[] {
  let seed = o.seed
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }
  const segAt = (t: string) => [...o.segs].reverse().find(s => !isAfter(s.from, t)) ?? o.segs[0]
  const prev: Partial<Record<keyof VitalSeg, number>> = {}
  const pick = (k: 'map' | 'hr' | 'rr' | 'spo2' | 'bt' | 'cvp', r: Range, dp = 0) => {
    const target = r[0] + rand() * (r[1] - r[0])
    const p = prev[k]
    let v = p === undefined || p < r[0] - 3 || p > r[1] + 3 ? target : p + (target - p) * 0.6
    v = Math.min(r[1], Math.max(r[0], v))
    prev[k] = v
    const f = 10 ** dp
    return Math.round(v * f) / f
  }
  const times = [...new Set([...hourly(o.from, o.to), ...Object.keys(o.fixed ?? {})])].sort((a, b) => toMs(a) - toMs(b))
  return times.map(time => {
    const s = segAt(time)
    const f = o.fixed?.[time] ?? {}
    const map = f.map ?? pick('map', s.map)
    // 맥압을 3의 배수로 두어 MAP = (SBP + 2 x DBP) / 3 이 정수로 맞게 함
    const pp = 3 * (13 + Math.floor(rand() * 4))
    return {
      time,
      sbp: f.sbp ?? map + (2 * pp) / 3,
      dbp: f.dbp ?? map - pp / 3,
      map,
      hr: f.hr ?? pick('hr', s.hr),
      rr: f.rr ?? pick('rr', s.rr),
      bt: f.bt ?? pick('bt', s.bt, 1),
      spo2: f.spo2 ?? pick('spo2', s.spo2),
      cvp: f.cvp ?? (s.cvp ? pick('cvp', s.cvp) : undefined),
    }
  })
}

export { addHours }
