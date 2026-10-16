// wiki_kb (llm_wiki 형식) 를 화면에서 쓰는 파일 하나로 바꾼다: 위키 페이지, 검색 조각, 원문 약칭.
// 원문 PDF (raw/) 는 넣지 않는다. 위키 페이지와 조각은 원문을 요약한 한국어 글이다.
// 사용: node scripts/build-wiki.mjs [wiki_kb 폴더] [출력 파일]
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

const root = process.argv[2] ?? '../wiki_kb'
const out = process.argv[3] ?? 'public/wiki/kb.json'

// 본문 인용 '(약칭 p.N)' 의 약칭과 원문 요약 페이지
const SOURCES = {
  'AASLD DILI': 'sources/aasld-dili-guidance',
  'ACG 2017': 'sources/kwo-2017-acg-abnormal-liver-chemistries',
  'SSC 2026': 'sources/prescott-2026-ssc-sepsis-guidelines',
  'HH review': 'sources/waseem-chen-hypoxic-hepatitis-review',
  'Horvatits 2019': 'sources/horvatits-2019-liver-injury-critical-illness',
  'EASL ALF 2017': 'sources/easl-2017-acute-liver-failure',
  'Jenniskens 2016': 'sources/jenniskens-2016-cholestatic-dysfunction-sepsis',
  'Aithal 2011': 'sources/aithal-2011-dili-case-definition',
  'Fuhrmann 2011': 'sources/fuhrmann-2011-hypoxic-hepatitis-icu-mortality',
  'Henrion 2007': 'sources/henrion-2007-hypoxic-hepatitis-clinician',
  'Lemmer 2017': 'sources/lemmer-2017-congestive-hepatopathy',
  'Waseem NIS 2018': 'sources/waseem-2018-acute-liver-injury-shock-nationwide',
  'Xu 2025': 'sources/xu-2025-liver-injury-in-sepsis',
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]))
}

/** 위키 머리말 (key: value, 목록은 [a, b]) */
function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!m) return { meta: {}, body: text }
  const meta = {}
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':')
    if (i < 0) continue
    const key = line.slice(0, i).trim()
    const raw = line.slice(i + 1).trim()
    const unq = s => s.trim().replace(/^["']|["']$/g, '')
    meta[key] = raw.startsWith('[') ? raw.slice(1, -1).split(',').map(unq).filter(Boolean) : unq(raw)
  }
  return { meta, body: text.slice(m[0].length) }
}

const wikiDir = join(root, 'wiki')
const pages = walk(wikiDir)
  .filter(f => f.endsWith('.md') && !f.endsWith('/log.md'))
  .sort()
  .map(f => {
    const { meta, body } = frontmatter(readFileSync(f, 'utf8'))
    const id = relative(wikiDir, f).replace(/\.md$/, '')
    return {
      id,
      type: meta.type,
      title: meta.title,
      updated: meta.updated,
      ...(meta.type === 'source' ? { authors: meta.authors, year: meta.year, venue: meta.venue, url: meta.url } : {}),
      body: body.trim(),
    }
  })

const ids = new Set(pages.map(p => p.id))
for (const [abbr, id] of Object.entries(SOURCES)) if (!ids.has(id)) throw new Error(`원문 페이지 없음: ${abbr} → ${id}`)

const chunks = readFileSync(join(root, 'index/chunks.jsonl'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map(line => {
    const c = JSON.parse(line)
    if (!ids.has(c.page_id)) throw new Error(`조각의 페이지가 위키에 없음: ${c.page_id}`)
    return { id: c.chunk_id, page: c.page_id, heading: c.heading_path, text: c.chunk_text }
  })

const manifest = JSON.parse(readFileSync(join(root, 'index/index_manifest.json'), 'utf8'))
const kb = {
  meta: {
    wikiSha256: manifest.wiki_sha256,
    chunking: manifest.chunking,
    lexical: manifest.lexical,
    pages: pages.length,
    chunks: chunks.length,
    sources: Object.keys(SOURCES).length,
    updated: pages.map(p => p.updated).filter(Boolean).sort().at(-1),
  },
  sources: SOURCES,
  pages,
  chunks,
}

mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify(kb))
console.log(`${out}: 페이지 ${pages.length}, 조각 ${chunks.length}, 원문 ${kb.meta.sources}, ${(JSON.stringify(kb).length / 1024).toFixed(0)} KB`)
