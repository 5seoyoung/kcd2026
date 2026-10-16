// 답 생성 서버. 화면이 근거 위키에서 찾은 조각과 질문을 보내면, LLM 이 그 조각 안에서만 답을 쓰고
// 서버가 인용을 확인해 돌려준다. 검색은 화면 (브라우저) 이 하고, 이 서버는 LLM 호출과 확인만 한다.
// LLM 은 OpenAI 호환 주소면 무엇이든 쓴다 (기관 승인 무보존 엔드포인트, Ollama, vLLM 등). 키는 환경 변수로만 받는다.
//
//   LLM_BASE_URL=http://localhost:11434/v1 LLM_MODEL=qwen2.5:7b node server/rag-server.mjs
//   화면: http://localhost:5173/?rag=http://localhost:8787  (한 번 열면 기억함, ?rag=off 로 끔)
//
// 환경 변수: LLM_BASE_URL, LLM_MODEL (필수), LLM_API_KEY, PORT (8787), HOST (127.0.0.1), ALLOW_ORIGINS (쉼표로)
import { createServer } from 'node:http'

const PORT = Number(process.env.PORT ?? 8787)
const HOST = process.env.HOST ?? '127.0.0.1'
const BASE = process.env.LLM_BASE_URL?.replace(/\/$/, '')
const MODEL = process.env.LLM_MODEL
const KEY = process.env.LLM_API_KEY ?? ''
const ORIGINS = (process.env.ALLOW_ORIGINS ?? 'https://5seoyoung.github.io').split(',').map(s => s.trim())

if (!BASE || !MODEL) {
  console.error('LLM_BASE_URL 과 LLM_MODEL 을 정해 주세요. 예: LLM_BASE_URL=http://localhost:11434/v1 LLM_MODEL=qwen2.5:7b')
  process.exit(1)
}

const NOT_FOUND = '근거 위키에 이 질문의 근거가 없습니다.'
const REFUSE = '치료 결정은 답하지 않습니다.'

const SYSTEM = `당신은 ICU 간 검사 이상 근거 위키의 조각만 보고 의료진의 지식 질문에 답합니다.
규칙:
1. 아래 [조각] 에 적힌 내용만 씁니다. 조각에 없는 지식, 추측, 일반론을 더하지 않습니다.
2. 문장마다 근거가 된 조각 번호를 [1], [2] 처럼 문장 끝에 붙입니다.
3. 수치 (배수, 시간, 퍼센트, 절단값) 는 조각에 적힌 그대로 씁니다.
4. 조각에 답이 없으면 "${NOT_FOUND}" 한 문장만 씁니다.
5. 치료, 약 중단, 용량을 정하라는 질문이면 "${REFUSE}" 라고 쓰고 관련 근거만 정리합니다.
6. 특정 환자를 판단하지 않습니다. 한국어로 2~5문장으로 쓰고, 의학 용어는 조각의 표기를 따릅니다.`

const prompt = (question, chunks) =>
  `[조각]\n${chunks.map(c => `[${c.n}] ${c.heading}\n${c.text}`).join('\n\n')}\n\n[질문]\n${question}`

async function callLlm(question, chunks) {
  const r = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(KEY ? { authorization: `Bearer ${KEY}` } : {}) },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      max_tokens: 700,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: prompt(question, chunks) },
      ],
    }),
    signal: AbortSignal.timeout(80_000),
  })
  if (!r.ok) throw new Error(`LLM ${r.status}: ${(await r.text()).slice(0, 200)}`)
  const j = await r.json()
  return (j.choices?.[0]?.message?.content ?? '').trim()
}

const flat = s => s.replace(/,/g, '').replace(/\s+/g, ' ')

/** 인용 확인: 문장마다 조각 번호가 있는지, 없는 번호를 쓰지 않았는지, 숫자가 인용한 조각에 그대로 있는지 */
function check(answer, chunks) {
  const status = answer.includes(NOT_FOUND) ? 'notFound' : answer.includes(REFUSE) ? 'refused' : undefined
  const sentences = answer.split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(s => s.length > 3)
  const cited = new Set()
  const badRefs = new Set()
  const unsupported = []
  let uncited = 0
  let numbers = 0
  for (const s of sentences) {
    const refs = [...s.matchAll(/\[(\d+)\]/g)].map(m => Number(m[1]))
    const ok = refs.filter(k => k >= 1 && k <= chunks.length)
    refs.filter(k => !ok.includes(k)).forEach(k => badRefs.add(k))
    ok.forEach(k => cited.add(k))
    if (!refs.length && !status) uncited++
    // 인용한 조각에서 숫자를 찾음 (인용이 없으면 모든 조각에서)
    const pool = flat((ok.length ? ok.map(k => chunks[k - 1]) : chunks).map(c => c.text).join(' '))
    for (const num of s.replace(/\[\d+\]/g, '').match(/\d+(?:[.,]\d+)*/g) ?? []) {
      const v = num.replace(/,/g, '')
      if (v.length < 2) continue
      numbers++
      if (!pool.includes(v)) unsupported.push(num)
    }
  }
  return { status, cited: [...cited].sort((a, b) => a - b), checks: { sentences: sentences.length, uncited, numbers, unsupported, badRefs: [...badRefs] } }
}

function readBody(req, limit = 64_000) {
  return new Promise((resolve, reject) => {
    let size = 0
    const parts = []
    req.on('data', d => {
      size += d.length
      if (size > limit) reject(new Error('본문이 너무 큽니다'))
      else parts.push(d)
    })
    req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')))
    req.on('error', reject)
  })
}

function cors(req, res) {
  const o = req.headers.origin
  if (o && (ORIGINS.includes(o) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o))) {
    res.setHeader('access-control-allow-origin', o)
    res.setHeader('vary', 'origin')
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS')
    res.setHeader('access-control-allow-headers', 'content-type')
    // 공개 사이트 (GitHub Pages) 에서 이 컴퓨터의 서버를 부를 때 크롬이 묻는 허용
    res.setHeader('access-control-allow-private-network', 'true')
  }
}

const send = (res, code, obj) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(obj))
}

const server = createServer(async (req, res) => {
  cors(req, res)
  if (req.method === 'OPTIONS') return res.writeHead(204).end()
  if (req.method === 'GET' && req.url === '/health') return send(res, 200, { model: MODEL })
  if (req.method !== 'POST' || req.url !== '/answer') return send(res, 404, { error: '없는 주소' })
  try {
    const { question, chunks } = JSON.parse(await readBody(req))
    if (typeof question !== 'string' || !question.trim() || question.length > 500) return send(res, 400, { error: '질문이 비었거나 깁니다' })
    if (!Array.isArray(chunks) || !chunks.length || chunks.length > 6) return send(res, 400, { error: '조각은 1~6개' })
    const cs = chunks.map((c, i) => ({ n: i + 1, heading: String(c.heading ?? '').slice(0, 300), text: String(c.text ?? '').slice(0, 4000) }))
    const t = Date.now()
    const answer = await callLlm(question.trim(), cs)
    const c = check(answer, cs)
    console.log(`${new Date().toISOString()} answer ${Date.now() - t}ms, 조각 ${cs.length}, 인용 ${c.cited.join(',') || '-'}, 근거 없는 숫자 ${c.checks.unsupported.length}`)
    send(res, 200, { answer, model: MODEL, ...c })
  } catch (e) {
    console.error(e)
    send(res, 502, { error: e instanceof Error ? e.message : String(e) })
  }
})

server.listen(PORT, HOST, () => console.log(`답 생성 서버 http://${HOST}:${PORT} (모델 ${MODEL}, ${BASE})`))
