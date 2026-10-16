import { useLayoutEffect, useRef, useState } from 'react'
import type { MarOrder, Ref, TabId } from '../types'
import { inRange, isAfter } from './time'

export type Highlight = { ref: Ref; n: number } | null

/** 확률. 작은 확률은 소수 한 자리까지 */
export const pct = (p: number) => (p < 0.001 ? '<0.1%' : p < 0.1 ? `${(p * 100).toFixed(1)}%` : `${Math.round(p * 100)}%`)

export const cls = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(' ')

export const isRowHl = (hl: Highlight, tab: TabId, row: string) =>
  !!hl && hl.ref.tab === tab && hl.ref.row === row && !hl.ref.col && !hl.ref.from

export const isCellHl = (hl: Highlight, tab: TabId, row: string, col: string) =>
  !!hl && hl.ref.tab === tab && hl.ref.row === row && hl.ref.col === col

export const isTimeHl = (hl: Highlight, tab: TabId, row: string, time: string) =>
  !!hl && hl.ref.tab === tab && hl.ref.row === row && !!hl.ref.from && inRange(time, hl.ref.from, hl.ref.to ?? hl.ref.from)

/** 지속 주입 약의 그 시각 주입 속도 (중단 뒤나 시작 전은 undefined) */
export function rateAt(order: MarOrder | undefined, time: string): number | undefined {
  if (!order) return undefined
  let rate: number | undefined
  for (const a of order.admins) {
    if (isAfter(a.time, time)) break
    if (a.rate !== undefined) rate = a.rate
  }
  return rate ? rate : undefined
}

export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setW(el.getBoundingClientRect().width)
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

/** SVG 글자 폭 어림값 (한글은 글자 크기만큼, 나머지는 0.6배) */
export function textWidth(s: string, size: number): number {
  let w = 0
  for (const ch of s) w += /[ㄱ-힝]/.test(ch) ? size : size * 0.6
  return w
}
