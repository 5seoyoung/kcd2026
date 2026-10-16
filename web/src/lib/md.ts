// 위키 마크다운을 HTML 로. 위키가 쓰는 것만 다룬다: 제목, 문단, 목록, 표, 굵게, 코드, [[위키 링크]], [글](주소), 인용 '(약칭 p.N)'.
// 먼저 HTML 을 이스케이프하고 나서 바꾸므로 본문에 든 태그는 글자로 보인다.
import type { Wiki } from './wiki'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export interface MdOptions {
  wiki: Wiki
  /** 제목에 붙일 id 앞부분 (한 화면에 여러 개를 그릴 때 겹치지 않게) */
  idPrefix?: string
}

export function inline(raw: string, { wiki }: MdOptions): string {
  let s = esc(raw)
  // [[slug]] → 위키 페이지 링크
  s = s.replace(/\[\[([^\]|]+)\]\]/g, (_, slug: string) => {
    const p = wiki.bySlug(slug.trim())
    return p ? `<a class="wl" href="#" data-wiki="${esc(p.id)}">${esc(p.title)}</a>` : esc(slug)
  })
  // [글](주소) → 바깥 링크
  s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, (_, t: string, u: string) => `<a href="${u}" target="_blank" rel="noreferrer">${t}</a>`)
  // 인용 약칭 → 원문 요약 페이지 링크
  const names = Object.keys(wiki.kb.sources).sort((a, b) => b.length - a.length)
  const re = new RegExp(`(${names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})( p\\.\\d+(?:-\\d+)?(?:, p\\.\\d+(?:-\\d+)?)*)`, 'g')
  s = s.replace(re, (_, n: string, pg: string) => `<a class="cite" href="#" data-wiki="${esc(wiki.kb.sources[n])}">${n}${pg}</a>`)
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>')
  return s
}

/** 블록 단위로 나눠 HTML 로. 제목에는 순서대로 id 를 붙인다 */
export function render(md: string, opt: MdOptions): { html: string; headings: string[] } {
  const lines = md.replace(/\r/g, '').split('\n')
  const out: string[] = []
  const headings: string[] = []
  let para: string[] = []
  const flush = () => {
    if (para.length) out.push(`<p>${inline(para.join(' '), opt)}</p>`)
    para = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) {
      flush()
      continue
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/)
    if (h) {
      flush()
      const n = headings.push(h[2].trim()) - 1
      const lv = Math.min(4, h[1].length + 1)
      out.push(`<h${lv} id="${opt.idPrefix ?? 'h'}-${n}">${inline(h[2], opt)}</h${lv}>`)
      continue
    }
    if (/^\s*\|/.test(line)) {
      flush()
      const rows: string[] = []
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++])
      i--
      const cells = (r: string) => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim())
      const isSep = (r: string) => /^\s*\|?\s*:?-{2,}/.test(r)
      const head = rows.length > 1 && isSep(rows[1]) ? cells(rows[0]) : null
      const body = rows.slice(head ? 2 : 0).filter(r => !isSep(r))
      out.push(
        `<div class="md-table"><table>${head ? `<thead><tr>${head.map(c => `<th>${inline(c, opt)}</th>`).join('')}</tr></thead>` : ''}<tbody>${body
          .map(r => `<tr>${cells(r).map(c => `<td>${inline(c, opt)}</td>`).join('')}</tr>`)
          .join('')}</tbody></table></div>`,
      )
      continue
    }
    const li = line.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/)
    if (li) {
      flush()
      const ordered = /\d/.test(li[2])
      const items: string[] = []
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)([-*]|\d+\.)\s+(.*)$/)
        if (!m) break
        items.push(`<li${m[1].length >= 2 ? ' class="sub"' : ''}>${inline(m[3], opt)}</li>`)
        i++
      }
      i--
      out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`)
      continue
    }
    para.push(line.trim())
  }
  flush()
  return { html: out.join('\n'), headings }
}
