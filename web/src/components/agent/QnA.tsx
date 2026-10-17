import { useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent } from 'react'
import type { AgentRun, CaseData, QaHit, QaMsg, Ref } from '../../types'
import type { Sim } from '../../data'
import type { RagServer } from '../../data/rag'
import { suggestions } from '../../data/qa'
import { lastHeading, useWiki, type Wiki } from '../../lib/wiki'
import { inline, render } from '../../lib/md'
import { mdhm } from '../../lib/time'
import { cls } from '../../lib/ui'
import { lang, tr } from '../../lib/i18n'
import type { WikiAt } from '../WikiModal'

interface Props {
  cs: CaseData
  sim: Sim
  clock: string
  run?: AgentRun
  msgs: QaMsg[]
  /** 답을 기다리는 질문 */
  pending: string | null
  server: RagServer | null
  onAsk: (input: { id: string } | { text: string }) => void
  onJump: (ref: Ref) => void
  onWiki: (at: WikiAt) => void
}

/**
 * 질의응답. 이 환자 질문은 기준 시각까지의 사례 자료로, 지식 질문은 근거 위키 검색으로 답한다.
 * 답 생성 서버가 켜져 있으면 찾은 조각으로 LLM 이 답을 쓰고 인용을 확인한다.
 */
export function QnA({ cs, sim, clock, run, msgs, pending, server, onAsk, onJump, onWiki }: Props) {
  const [text, setText] = useState('')
  const end = useRef<HTMLDivElement>(null)
  const { wiki, error } = useWiki()
  const sug = suggestions({ cs, sim, clock, run })

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [msgs.length, pending])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!text.trim() || pending) return
    onAsk({ text })
    setText('')
  }

  return (
    <div className="qa">
      <div className="qa-scope">
        {lang() === 'en' ? (
          <div>
            Patient questions are answered only from the record and agent outputs up to <b className="mono">{mdhm(clock)}</b>, knowledge questions only from the evidence wiki. Treatment decisions are not answered. The evidence wiki is in Korean.
          </div>
        ) : (
          <div>
            이 환자 질문은 <b className="mono">{mdhm(clock)}</b> 까지의 기록과 에이전트 출력으로, 지식 질문은 근거 위키로만 답합니다. 치료 결정은 답하지 않습니다.
          </div>
        )}
        <div className="qa-kb">
          {wiki ? (
            <button className="link" onClick={() => onWiki({ page: 'index' })}>
              {tr(
                `근거 위키 ${wiki.kb.meta.pages}쪽 · 원문 ${wiki.kb.meta.sources}편 · 갱신 ${wiki.kb.meta.updated ?? ''}`,
                `Evidence wiki ${wiki.kb.meta.pages} pages · ${wiki.kb.meta.sources} sources · updated ${wiki.kb.meta.updated ?? ''}`,
              )}
            </button>
          ) : (
            <span className="muted">{error ?? tr('근거 위키 읽는 중', 'Loading the evidence wiki')}</span>
          )}
          <span className="sep">|</span>
          {server ? <span className="qa-gen on">{tr('답 생성', 'Answers by')} {server.model}</span> : <span className="qa-gen">{tr('위키 검색 결과로 답함', 'Answers from wiki search')}</span>}
        </div>
      </div>
      <div className="qa-msgs" aria-live="polite">
        {!msgs.length && !pending && <div className="muted qa-empty">{tr('아래 질문을 누르거나 직접 입력하세요.', 'Click a question below or type your own.')}</div>}
        {msgs.map(m => <Msg key={m.id} m={m} wiki={wiki} onJump={onJump} onWiki={onWiki} />)}
        {pending && (
          <>
            <div className="qa-q">{pending}</div>
            <div className="qa-a pending"><span className="qa-spin" aria-hidden />{tr('근거를 찾는 중', 'Searching for evidence')}</div>
          </>
        )}
        <div ref={end} />
      </div>
      <div className="qa-sug">
        {(['환자', '지식'] as const).map(k => {
          const list = sug.filter(s => s.kind === k)
          if (!list.length) return null
          return (
            <div key={k} className="qa-sug-row">
              <span className="qa-sug-k">{k === '환자' ? tr('이 환자', 'This patient') : tr('지식', 'Knowledge')}</span>
              {list.map(s => (
                <button key={s.id} className="qa-chip" disabled={!!pending} onClick={() => onAsk({ id: s.id })}>{s.q}</button>
              ))}
            </div>
          )
        })}
      </div>
      <form className="qa-input" onSubmit={submit}>
        <input value={text} onChange={e => setText(e.target.value)} placeholder={tr('질문 입력', 'Type a question')} aria-label={tr('질문', 'Question')} />
        <button className="btn" disabled={!text.trim() || !!pending}>{tr('보내기', 'Send')}</button>
      </form>
    </div>
  )
}

/** 위키 링크와 인용을 누르면 위키를 엶 */
function useWikiClicks(onWiki: (at: WikiAt) => void) {
  return (e: MouseEvent) => {
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[data-wiki]')
    if (!a) return
    e.preventDefault()
    onWiki({ page: a.dataset.wiki! })
  }
}

function Msg({ m, wiki, onJump, onWiki }: { m: QaMsg; wiki: Wiki | null; onJump: (ref: Ref) => void; onWiki: (at: WikiAt) => void }) {
  const a = m.answer
  const box = useRef<HTMLDivElement>(null)
  const clickWiki = useWikiClicks(onWiki)
  // LLM 답 속 [n] 을 누르면 그 조각으로 내려가 강조
  const onClick = (e: MouseEvent) => {
    const ref = (e.target as HTMLElement).closest<HTMLElement>('[data-hit]')
    if (ref) {
      e.preventDefault()
      const el = box.current?.querySelector<HTMLElement>(`.qa-hit[data-n="${ref.dataset.hit}"]`)
      if (el) {
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
        el.classList.remove('flash')
        void el.offsetWidth
        el.classList.add('flash')
      }
      return
    }
    clickWiki(e)
  }
  const llmHtml = useMemo(() => {
    if (a.mode !== 'llm' || !wiki) return null
    return a.text.map(t => inline(t, { wiki }).replace(/\[(\d+)\]/g, '<a href="#" class="hitref" data-hit="$1">$1</a>'))
  }, [a, wiki])
  const ck = a.llm?.checks

  return (
    <>
      <div className="qa-q">{m.q}</div>
      <div ref={box} className={cls('qa-a', a.status)} onClick={onClick}>
        <div className="qa-a-head">
          {m.kind && <span className={cls('qa-kind', m.kind === '지식' && 'doc')}>{m.kind === '환자' ? tr('이 환자', 'This patient') : tr('지식', 'Knowledge')}</span>}
          {a.mode === 'wiki' && <span className="qa-kind gray">{tr('위키 검색', 'Wiki search')}</span>}
          {a.mode === 'llm' && <span className="qa-kind doc">{tr('위키 근거로 생성', 'Generated from wiki')}</span>}
          {a.status === 'refused' && <span className="qa-kind warn">{tr('결정 질문', 'Decision question')}</span>}
          {a.status === 'notFound' && <span className="qa-kind gray">{tr('근거 없음', 'No evidence')}</span>}
          {a.status === 'weak' && <span className="qa-kind warn">{tr('근거 약함', 'Weak evidence')}</span>}
          <span className="spacer" />
          <span className="mono muted">{tr(`${mdhm(m.clock)} 기준`, `as of ${mdhm(m.clock)}`)}</span>
        </div>
        {llmHtml ? llmHtml.map((h, i) => <p key={i} className="md" dangerouslySetInnerHTML={{ __html: h }} />) : a.text.map((t, i) => <p key={i}>{t}</p>)}
        {ck && (
          <div className={cls('qa-check', (ck.unsupported.length > 0 || ck.uncited > 0 || ck.badRefs.length > 0) && 'bad')}>
            {tr(
              `인용 확인: 문장 ${ck.sentences}개 중 근거 번호 없음 ${ck.uncited}개 · 숫자 ${ck.numbers}개 중 근거 조각에 없는 것 ${ck.unsupported.length}개`,
              `Citation check: ${ck.uncited} of ${ck.sentences} sentences uncited · ${ck.unsupported.length} of ${ck.numbers} numbers not in the passages`,
            )}
            {ck.unsupported.length > 0 && <> ({ck.unsupported.join(', ')})</>}
            {ck.badRefs.length > 0 && <> · {tr('없는 조각 번호', 'invalid passage numbers')} {ck.badRefs.join(', ')}</>}
            <span className="muted"> · {a.llm!.model}</span>
          </div>
        )}
        {a.hits && wiki && (
          <div className="qa-hits">
            {a.hits.map((h, i) => (
              <Hit key={h.heading + i} n={i + 1} h={h} wiki={wiki} cited={!a.llm || a.llm.cited.includes(i + 1)} onWiki={onWiki} />
            ))}
          </div>
        )}
        {a.sources.length > 0 && (
          <div className="qa-src">
            <span className="qa-src-k">{tr('출처', 'Sources')}</span>
            {a.sources.map(s =>
              s.ref ? (
                <button key={s.label} className="qa-s case" onClick={() => onJump(s.ref!)} title={tr('원자료에서 보기', 'View in the source record')}>
                  {s.label} <span className="ev-go">›</span>
                </button>
              ) : s.wiki ? (
                <button key={s.label} className="qa-s doc link-s" onClick={() => onWiki({ page: s.wiki! })} title={tr('근거 위키에서 보기', 'View in the evidence wiki')}>
                  {s.kind === 'doc' && !s.label.startsWith('근거 위키') && !s.label.startsWith('Evidence wiki') ? tr('원문 · ', 'Source · ') : ''}{s.label} <span className="ev-go">›</span>
                </button>
              ) : (
                <span key={s.label} className={cls('qa-s', s.kind)}>{s.kind === 'doc' ? tr('문서 · ', 'Doc · ') : ''}{s.label}</span>
              ),
            )}
          </div>
        )}
      </div>
    </>
  )
}

/** 찾은 위키 조각 하나. 길면 접어 둠 */
function Hit({ n, h, wiki, cited, onWiki }: { n: number; h: QaHit; wiki: Wiki; cited: boolean; onWiki: (at: WikiAt) => void }) {
  const [open, setOpen] = useState(false)
  const html = useMemo(() => render(h.text, { wiki, idPrefix: `hit${n}` }).html, [h, wiki, n])
  const sec = lastHeading(h.heading)
  const long = h.text.length > 360
  return (
    <div className={cls('qa-hit', !cited && 'dim')} data-n={n}>
      <button className="qa-hit-head" onClick={() => onWiki({ page: h.page, heading: sec })} title={tr('근거 위키에서 이 절 보기', 'View this section in the evidence wiki')}>
        <span className="qa-hit-n">{n}</span>
        <span className="qa-hit-path">{h.title}{sec && <> › {sec}</>}</span>
        <span className="ev-go">{tr('위키 ›', 'Wiki ›')}</span>
      </button>
      <div className={cls('qa-hit-body md', long && !open && 'clamp')} dangerouslySetInnerHTML={{ __html: html }} />
      {long && <button className="link qa-more" onClick={() => setOpen(o => !o)}>{open ? tr('접기', 'Show less') : tr('더 보기', 'Show more')}</button>}
    </div>
  )
}
