// 'YYYY-MM-DD HH:MM' 문자열을 다루는 함수들. 시간대 영향을 받지 않도록 UTC 로 계산한다.

const HOUR = 3_600_000

export function toMs(s: string): number {
  const [d, t = '00:00'] = s.split(' ')
  const [y, mo, da] = d.split('-').map(Number)
  const [h, mi] = t.split(':').map(Number)
  return Date.UTC(y, mo - 1, da, h, mi)
}

const pad = (n: number) => String(n).padStart(2, '0')

export function fromMs(v: number): string {
  const d = new Date(v)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

export const md = (s: string) => s.slice(5, 10)
export const hm = (s: string) => s.slice(11, 16)
export const mdhm = (s: string) => s.slice(5, 16)
export const ymd = (s: string) => s.slice(0, 10)

export const addHours = (s: string, h: number) => fromMs(toMs(s) + h * HOUR)
export const hoursBetween = (a: string, b: string) => (toMs(b) - toMs(a)) / HOUR
export const isAfter = (a: string, b: string) => toMs(a) > toMs(b)
export const inRange = (s: string, from: string, to: string) => toMs(s) >= toMs(from) && toMs(s) <= toMs(to)

/** 기준 시각이 속한 날을 D+0 으로 셈 */
export function dayIndex(base: string, s: string): number {
  return Math.round((toMs(ymd(s)) - toMs(ymd(base))) / (24 * HOUR))
}

export function daysBetween(from: string, to: string): string[] {
  const out: string[] = []
  for (let v = toMs(ymd(from)); v <= toMs(ymd(to)); v += 24 * HOUR) out.push(fromMs(v).slice(0, 10))
  return out
}

/** 정시로 올림 (이미 정시면 그대로) */
export function ceilHour(s: string): string {
  return s.endsWith(':00') ? s : addHours(`${s.slice(0, 13)}:00`, 1)
}

/** 정시로 내림 */
export const floorHour = (s: string) => `${s.slice(0, 13)}:00`

/** from 부터 to 까지 한 시간 간격 */
export function hourly(from: string, to: string): string[] {
  const out: string[] = []
  for (let v = toMs(from); v <= toMs(to); v += HOUR) out.push(fromMs(v))
  return out
}
