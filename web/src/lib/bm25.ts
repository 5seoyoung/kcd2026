// 위키 조각 키워드 검색 (BM25). wiki_kb 색인과 같은 설정: k1 1.5, b 0.75, 한글은 두 글자씩 끊음.
// 원래 색인 스크립트를 받지 못해 토큰 나누기는 manifest 설명 ("Korean bigrams") 에 맞춰 새로 짰다.

const K1 = 1.5
const B = 0.75

/** 끝에 붙는 조사. 떼어 낸 말도 함께 넣어 'R 비는' 이 'R 비' 와 맞게 함 */
const PARTICLE = /(에서|으로|에게|까지|부터|처럼|보다|[은는이가을를의에도로와과만])$/

function hangul(run: string, out: string[]) {
  if (run.length === 1) out.push(run)
  else for (let i = 0; i < run.length - 1; i++) out.push(run.slice(i, i + 2))
}

/** 소문자로 바꾸고 한글 덩어리는 두 글자씩, 영문과 숫자는 낱말 그대로 */
export function tokenize(s: string): string[] {
  const out: string[] = []
  for (const run of s.toLowerCase().normalize('NFC').match(/[가-힣]+|[a-z0-9]+(?:\.[0-9]+)?/g) ?? []) {
    if (/[가-힣]/.test(run)) {
      hangul(run, out)
      const stem = run.replace(PARTICLE, '')
      if (stem && stem !== run && stem.length === 1) out.push(stem)
    } else out.push(run)
  }
  return out
}

export interface Bm25Index {
  n: number
  avgLen: number
  df: Map<string, number>
  tf: Map<string, number>[]
  len: number[]
}

export function buildIndex(texts: string[]): Bm25Index {
  const df = new Map<string, number>()
  const tf: Map<string, number>[] = []
  const len: number[] = []
  for (const t of texts) {
    const toks = tokenize(t)
    const m = new Map<string, number>()
    for (const k of toks) m.set(k, (m.get(k) ?? 0) + 1)
    for (const k of m.keys()) df.set(k, (df.get(k) ?? 0) + 1)
    tf.push(m)
    len.push(toks.length)
  }
  return { n: texts.length, avgLen: len.reduce((a, b) => a + b, 0) / Math.max(1, texts.length), df, tf, len }
}

export interface Hit {
  i: number
  score: number
  /** 질문 낱말 중 이 조각에 있는 비율 (근거가 있는지 가늠) */
  coverage: number
}

/** noise 에 든 토큰 (질문 어미 등) 은 점수에도 비율에도 넣지 않음. 질문에 여러 번 나온 낱말은 그만큼 무겁게 */
export function search(ix: Bm25Index, query: string, k: number, noise: Set<string> = new Set()): Hit[] {
  const qtf = new Map<string, number>()
  for (const t of tokenize(query)) if (!noise.has(t)) qtf.set(t, (qtf.get(t) ?? 0) + 1)
  const qall = [...qtf.keys()]
  const q = qall.filter(t => ix.df.has(t))
  const all = qall.length || 1
  const idf = (t: string) => Math.log(1 + (ix.n - ix.df.get(t)! + 0.5) / (ix.df.get(t)! + 0.5))
  const hits: Hit[] = []
  for (let i = 0; i < ix.n; i++) {
    let score = 0
    let found = 0
    for (const t of q) {
      const f = ix.tf[i].get(t)
      if (!f) continue
      found++
      score += (qtf.get(t)! * idf(t) * f * (K1 + 1)) / (f + K1 * (1 - B + (B * ix.len[i]) / ix.avgLen))
    }
    if (score > 0) hits.push({ i, score, coverage: found / all })
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, k)
}
