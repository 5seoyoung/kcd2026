// 근거 위키 (wiki_kb) 읽기와 검색. 파일은 scripts/build-wiki.mjs 가 public/wiki/kb.json 으로 만든다.
import { useEffect, useState } from 'react'
import { buildIndex, search, type Bm25Index } from './bm25'

export interface WikiPage {
  id: string
  type: 'entity' | 'concept' | 'source' | 'query' | 'comparison' | 'synthesis' | 'overview'
  title: string
  updated?: string
  authors?: string
  year?: string
  venue?: string
  url?: string
  body: string
}

export interface WikiChunk {
  id: string
  page: string
  /** '페이지 제목 > 소제목' */
  heading: string
  text: string
}

export interface WikiKb {
  meta: { wikiSha256: string; chunking: { chars: number; overlap: number }; lexical: string; pages: number; chunks: number; sources: number; updated?: string }
  /** 본문 인용 약칭 → 원문 요약 페이지 */
  sources: Record<string, string>
  pages: WikiPage[]
  chunks: WikiChunk[]
}

export interface Wiki {
  kb: WikiKb
  page: (id: string) => WikiPage | undefined
  /** [[slug]] 의 slug → 페이지 id */
  bySlug: (slug: string) => WikiPage | undefined
  index: Bm25Index
}

let loading: Promise<Wiki> | undefined

export function loadWiki(): Promise<Wiki> {
  loading ??= fetch('./wiki/kb.json')
    .then(r => {
      if (!r.ok) throw new Error(`근거 위키를 읽지 못했습니다 (${r.status})`)
      return r.json() as Promise<WikiKb>
    })
    .then(kb => {
      const byId = new Map(kb.pages.map(p => [p.id, p]))
      const slugs = new Map(kb.pages.map(p => [p.id.split('/').at(-1)!, p]))
      // 제목과 소제목을 본문보다 무겁게
      const index = buildIndex(kb.chunks.map(c => `${byId.get(c.page)?.title ?? ''} ${c.heading} ${c.heading} ${c.text}`))
      return { kb, page: id => byId.get(id), bySlug: s => slugs.get(s), index }
    })
  loading.catch(() => (loading = undefined))
  return loading
}

/** 한국어 질문 낱말을 위키가 쓰는 말 (영문 약물명, 정식 병명) 로 넓힘 */
const GLOSSARY: [RegExp, string][] = [
  [/허혈성\s*간|허혈\s*간|쇼크\s*간|저산소\s*간|저산소성\s*간/, '저산소성 간염 hypoxic hepatitis shock liver'],
  [/울혈/, '울혈성 간병증 congestive hepatopathy'],
  [/담즙\s*정체/, '담즙정체 cholestasis'],
  [/패혈/, '패혈증 sepsis'],
  [/약물\s*(유발|간|성)|약인성|dili/i, 'DILI 약물 유발 간손상'],
  [/정맥\s*영양|tpn/i, '정맥영양 PN parenteral nutrition'],
  [/담관염/, '담관염 cholangitis'],
  [/담낭염/, '담낭염 cholecystitis'],
  [/용혈/, '용혈 hemolysis'],
  [/바이러스/, '바이러스 간염 viral hepatitis'],
  [/간\s*부전/, '급성 간부전 ALF acute liver failure'],
  [/횡문근/, '횡문근융해 rhabdomyolysis CPK'],
  [/아미오다론/, 'amiodarone amiodarone amiodarone'],
  [/아세트아미노펜|타이레놀|파라세타몰/, 'acetaminophen acetaminophen paracetamol'],
  [/노르에피|노르에피네프린/, 'norepinephrine'],
  [/바소프레신/, 'vasopressin'],
  [/피페라실린|타조박탐/, 'piperacillin piperacillin tazobactam'],
  [/반코마이신/, 'vancomycin vancomycin'],
  [/빌리루빈/, 'bilirubin'],
  [/젖산/, 'lactate 젖산'],
  [/승압제/, '승압제 vasopressor'],
  [/정상\s*상한/, 'ULN 정상 상한'],
  [/r\s*비|r\s*ratio|r\s*값/i, 'R ratio R 비'],
  [/hypoxic|ischemic hepatitis|shock liver/i, '저산소성 간염'],
  [/congestive/i, '울혈성 간병증'],
  [/cholestasis/i, '담즙정체'],
  // 기준을 묻는 질문이면 '진단 기준', '정의' 절이 먼저 오게
  [/판단|진단|기준|정의|어떻게\s*봐|어떻게\s*보/, '진단 기준 정의'],
  // 경과를 묻는 질문
  [/회복|내려가|떨어지|얼마나\s*빨리|경과/, '경과 정점 하강 정상화'],
]

/** 질문 어미처럼 내용이 없는 두 글자 */
const NOISE = new Set(['어떻', '떻게', '하나', '나요', '인가', '가요', '있나', '되나', '까요', '무엇', '엇인', '얼마', '마나', '일으', '으키', '키나', '는지', '은지', '해야', '려면', '알려', '려줘', '주세', '세요', '뭐야', '건가', '을까', '할까', '대해', '해서', '어요', '나는', '판단', '단하', '단은'])

export function expandQuery(q: string): string {
  const extra = GLOSSARY.filter(([re]) => re.test(q)).map(([, s]) => s)
  return [q, ...extra].join(' ')
}

/** 다른 페이지로 안내만 하는 절 */
const NAV = /이 위키에서 쓰는 곳|관련 페이지|ICU 원인 판단과의 관계$/

export interface WikiHit {
  chunk: WikiChunk
  page: WikiPage
  score: number
  coverage: number
}

/** 질문에 맞는 조각. 한 페이지에서 두 개까지 */
export function searchWiki(w: Wiki, q: string, k = 3): WikiHit[] {
  const query = expandQuery(q)
  const askGap = /공백|없|있나|있는지/.test(q)
  const hits = search(w.index, query, 40, NOISE)
    .map(h => {
      const chunk = w.kb.chunks[h.i]
      // 질문이 근거 공백을 묻지 않으면 '근거 공백' 절은 조금 낮추고, 다른 페이지 안내만 있는 절과 목차는 더 낮춤
      const gap = !askGap && chunk.heading.includes('근거 공백')
      const nav = NAV.test(chunk.heading) || chunk.page === 'index' || chunk.page === 'overview'
      return { chunk, page: w.page(chunk.page)!, score: h.score * (gap ? 0.7 : 1) * (nav ? 0.5 : 1), coverage: h.coverage }
    })
    .sort((a, b) => b.score - a.score)
  const per = new Map<string, number>()
  const out: WikiHit[] = []
  for (const h of hits) {
    const n = per.get(h.page.id) ?? 0
    if (n >= 2) continue
    per.set(h.page.id, n + 1)
    out.push(h)
    if (out.length >= k) break
  }
  return out
}

/** 본문 인용 '(ACG 2017 p.5)' 에서 약칭 찾기 */
export function citedSources(w: Wiki, text: string): string[] {
  const names = Object.keys(w.kb.sources).sort((a, b) => b.length - a.length)
  const re = new RegExp(`(${names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')}) p\\.`, 'g')
  return [...new Set([...text.matchAll(re)].map(m => m[1]))]
}

/** 화면에서 위키가 필요할 때 읽어 옴 (한 번만 받음) */
export function useWiki(enabled = true): { wiki: Wiki | null; error: string | null } {
  const [wiki, setWiki] = useState<Wiki | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!enabled) return
    let on = true
    loadWiki().then(
      w => on && setWiki(w),
      e => on && setError(e instanceof Error ? e.message : String(e)),
    )
    return () => {
      on = false
    }
  }, [enabled])
  return { wiki, error }
}

/** 조각의 소제목 경로 '제목 > 절 > 소절' 에서 마지막 절 */
export const lastHeading = (path: string) => path.split(' > ').slice(1).at(-1)
