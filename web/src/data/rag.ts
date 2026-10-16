// 지식 질문의 답: 근거 위키를 검색하고 (브라우저에서, 서버 없이), 답 생성 서버가 켜져 있으면 찾은 조각으로 LLM 이 답을 쓴다.
// 서버가 없거나 실패하면 찾은 조각을 그대로 보여 준다. 서버 코드는 server/rag-server.mjs.
import type { QaAnswer, QaHit, QaSource } from '../types'
import { citedSources, loadWiki, searchWiki, type Wiki } from '../lib/wiki'

/** 이 점수와 비율을 넘어야 질문에 맞는 근거로 봄. 못 넘으면 '꼭 맞는 근거가 아닐 수 있음' */
const STRONG_SCORE = 12
const STRONG_COVERAGE = 0.5
const TOP_K = 3
const STORE_KEY = 'kcd-rag-url'

export interface RagServer {
  url: string
  model: string
}

/** 답 생성 서버 주소: 주소창 ?rag=... (기억해 둠), 빌드 때 VITE_RAG_URL, 전에 기억한 값 순 */
export function ragUrl(): string | null {
  const fromQuery = new URLSearchParams(location.search).get('rag')
  try {
    if (fromQuery === '' || fromQuery === 'off') localStorage.removeItem(STORE_KEY)
    else if (fromQuery) localStorage.setItem(STORE_KEY, fromQuery)
  } catch {
    // 저장소를 못 쓰는 창에서는 주소창 값만 씀
  }
  if (fromQuery === '' || fromQuery === 'off') return null
  let saved: string | null = null
  try {
    saved = localStorage.getItem(STORE_KEY)
  } catch {
    saved = null
  }
  return (fromQuery || import.meta.env.VITE_RAG_URL || saved || null)?.replace(/\/$/, '') ?? null
}

/** 서버가 켜져 있는지와 모델 이름 */
export async function probeRag(): Promise<RagServer | null> {
  const url = ragUrl()
  if (!url) return null
  try {
    const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2000) })
    if (!r.ok) return null
    const j = (await r.json()) as { model?: string }
    return { url, model: j.model ?? 'LLM' }
  } catch {
    return null
  }
}

const toHit = (h: ReturnType<typeof searchWiki>[number]): QaHit => ({
  page: h.page.id, title: h.page.title, heading: h.chunk.heading, text: h.chunk.text, score: h.score,
})

function sourcesOf(w: Wiki, hits: QaHit[]): QaSource[] {
  const names = [...new Set(hits.flatMap(h => citedSources(w, h.text)))]
  return names.map(n => ({ kind: 'doc', label: n, wiki: w.kb.sources[n] }))
}

interface ServerAnswer {
  answer: string
  status?: 'notFound' | 'refused'
  model: string
  cited: number[]
  checks: NonNullable<QaAnswer['llm']>['checks']
}

export async function answerWiki(q: string, server: RagServer | null): Promise<QaAnswer> {
  const w = await loadWiki()
  const found = searchWiki(w, q, TOP_K)
  if (!found.length) {
    return { mode: 'wiki', status: 'notFound', sources: [], text: ['근거 위키에서 이 질문의 근거를 찾지 못했습니다. 근거 없이 답하지 않습니다.'] }
  }
  const hits = found.map(toHit)
  const strong = found[0].score >= STRONG_SCORE && found[0].coverage >= STRONG_COVERAGE

  if (server) {
    try {
      const r = await fetch(`${server.url}/answer`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: q, chunks: hits.map((h, i) => ({ n: i + 1, title: h.title, heading: h.heading, text: h.text })) }),
        signal: AbortSignal.timeout(90_000),
      })
      if (!r.ok) throw new Error(String(r.status))
      const a = (await r.json()) as ServerAnswer
      const cited = a.cited.map(n => hits[n - 1]).filter(Boolean)
      return {
        mode: 'llm',
        status: a.status,
        text: [a.answer],
        hits,
        llm: { model: a.model, cited: a.cited, checks: a.checks },
        sources: sourcesOf(w, cited.length ? cited : hits),
      }
    } catch {
      return {
        mode: 'wiki',
        status: strong ? undefined : 'weak',
        text: ['답 생성 서버에 연결하지 못해 근거 위키에서 찾은 조각만 보여 줍니다.'],
        hits,
        sources: sourcesOf(w, hits),
      }
    }
  }

  return {
    mode: 'wiki',
    status: strong ? undefined : 'weak',
    text: [
      strong
        ? `근거 위키에서 찾은 조각 ${hits.length}개입니다. 원문과 PDF 쪽수는 조각 안에 있습니다.`
        : '질문과 꼭 맞는 근거가 위키에 없을 수 있습니다. 가장 가까운 조각을 보여 줍니다.',
    ],
    hits,
    sources: sourcesOf(w, hits),
  }
}
