// 화면 언어 (한국어, 영어). 문구는 쓰는 자리에서 tr('한국어', 'English') 로 고른다.
// 모듈 맨 위 상수처럼 한 번만 계산되는 문구는 bi() 로 두 언어를 함께 두고 쓸 때 pick() 으로 고른다.
// 언어를 바꾸면 App 전체가 다시 그려지고, 언어별로 계산해 두는 자료 (실행 기록, 재생 자료) 는 언어마다 따로 만든다.
import { useSyncExternalStore } from 'react'

export type Lang = 'ko' | 'en'
export type Bi = { ko: string; en: string }

const KEY = 'kcd-lang'

function initial(): Lang {
  try {
    const q = new URLSearchParams(window.location.search).get('lang')
    if (q === 'en' || q === 'ko') return q
    const s = window.localStorage.getItem(KEY)
    if (s === 'en' || s === 'ko') return s
  } catch {
    // 저장소를 못 쓰면 한국어
  }
  return 'ko'
}

let current: Lang = initial()
const listeners = new Set<() => void>()

export const lang = (): Lang => current

export function setLang(l: Lang) {
  if (l === current) return
  current = l
  try {
    window.localStorage.setItem(KEY, l)
  } catch {
    // 저장하지 못해도 이번 화면에서는 바뀜
  }
  document.documentElement.lang = l
  listeners.forEach(f => f())
}

/** 언어가 바뀌면 다시 그림 */
export function useLang(): Lang {
  return useSyncExternalStore(
    f => {
      listeners.add(f)
      return () => listeners.delete(f)
    },
    () => current,
  )
}

/** 지금 언어의 문구 */
export const tr = (ko: string, en: string): string => (current === 'en' ? en : ko)

/** 두 언어 문구 (모듈 상수용). pick() 으로 고름 */
export const bi = (ko: string, en: string): Bi => ({ ko, en })
export const pick = (b: Bi | string): string => (typeof b === 'string' ? b : b[current])

if (typeof document !== 'undefined') document.documentElement.lang = current
