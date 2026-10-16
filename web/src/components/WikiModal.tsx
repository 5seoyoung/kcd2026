import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { useWiki } from '../lib/wiki'
import { render } from '../lib/md'

export interface WikiAt {
  page: string
  /** 이 절로 바로 내려감 */
  heading?: string
}

const TYPE_NAME: Record<string, string> = {
  entity: '항목', concept: '개념', source: '원문 요약', query: '원문 간 불일치', comparison: '감별 비교', synthesis: '근거 지도', overview: '개요',
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim()

/** 근거 위키 보기. 본문 속 위키 링크와 인용을 누르면 그 페이지로 넘어가고, 뒤로 가기로 돌아옴 */
export function WikiModal({ at, onClose }: { at: WikiAt; onClose: () => void }) {
  const { wiki, error } = useWiki()
  const [stack, setStack] = useState<WikiAt[]>([at])
  const cur = stack.at(-1)!
  const page = wiki?.page(cur.page)
  const doc = useMemo(() => (wiki && page ? render(page.body, { wiki, idPrefix: 'wk' }) : null), [wiki, page])
  const body = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // 고른 절로 내려가고 잠깐 강조
  useEffect(() => {
    const el = body.current
    if (!el || !doc) return
    const i = cur.heading ? doc.headings.findIndex(h => norm(h) === norm(cur.heading!)) : -1
    const target = i >= 0 ? el.querySelector<HTMLElement>(`#wk-${i}`) : null
    if (target) {
      el.scrollTop = target.offsetTop - 8
      target.classList.add('flash')
    } else el.scrollTop = 0
  }, [doc, cur])

  const onClick = (e: MouseEvent) => {
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[data-wiki]')
    if (!a) return
    e.preventDefault()
    setStack(s => [...s, { page: a.dataset.wiki! }])
  }

  const meta = wiki?.kb.meta
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal wide wiki-modal" role="dialog" aria-modal="true" aria-label="근거 위키" onClick={e => e.stopPropagation()}>
        <div className="panel-head">
          근거 위키
          {stack.length > 1 && <button className="btn mini" onClick={() => setStack(s => s.slice(0, -1))}>‹ 뒤로</button>}
          <button className="btn mini" onClick={() => setStack(s => [...s, { page: 'index' }])}>목차</button>
          <button className="btn mini" onClick={() => setStack(s => [...s, { page: 'synthesis/icu-liver-cause-evidence-map' }])}>원인 10개 근거 지도</button>
          <span className="spacer" />
          <button className="btn x" onClick={onClose} aria-label="닫기">✕</button>
        </div>
        {error && <div className="modal-body">{error}</div>}
        {wiki && !page && <div className="modal-body">이 페이지가 위키에 없습니다: {cur.page}</div>}
        {page && doc && (
          <>
            <div className="wiki-head">
              <span className="wiki-type">{TYPE_NAME[page.type] ?? page.type}</span>
              <b>{page.title}</b>
              {page.type === 'source' && (
                <span className="muted">
                  {[page.authors, page.venue, page.year].filter(Boolean).join(' · ')}
                  {page.url && <> · <a href={page.url} target="_blank" rel="noreferrer">원문 링크</a></>}
                </span>
              )}
            </div>
            <div ref={body} className="modal-body wiki-body md" onClick={onClick} dangerouslySetInnerHTML={{ __html: doc.html }} />
            <div className="wiki-foot">
              wiki_kb · 페이지 {meta?.pages} · 원문 {meta?.sources}편 · 갱신 {meta?.updated} · 인용 쪽수는 PDF 쪽 번호
            </div>
          </>
        )}
      </div>
    </div>
  )
}
