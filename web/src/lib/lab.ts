import type { LabItem } from '../types'

export function flag(item: LabItem, v: number): 'H' | 'L' | null {
  if (item.high !== undefined && v > item.high) return 'H'
  if (item.low !== undefined && v < item.low) return 'L'
  return null
}

export function fmtNum(v: number, dp: number): string {
  return dp === 0 ? Math.round(v).toLocaleString('en-US') : v.toFixed(dp)
}

export function xUln(item: LabItem, v: number): number | null {
  return item.high ? v / item.high : null
}

export function refRange(item: LabItem): string {
  if (item.low === undefined && item.high === undefined) return ''
  return `${fmtNum(item.low ?? 0, item.dp)}~${fmtNum(item.high ?? 0, item.dp)}`
}
