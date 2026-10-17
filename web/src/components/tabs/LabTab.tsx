import { Fragment, useEffect, useRef } from 'react'
import type { CaseData, LiverEvent } from '../../types'
import { hm, md, mdhm, toMs } from '../../lib/time'
import { flag, fmtNum, refRange } from '../../lib/lab'
import { labsAt } from '../../lib/events'
import { cls, isCellHl, isRowHl, type Highlight } from '../../lib/ui'
import { tr } from '../../lib/i18n'
import { tx } from '../../data/cases/en'

interface Props {
  cs: CaseData
  clock: string
  /** 기준 시각에 알게 된 사건 */
  events: LiverEvent[]
  hl: Highlight
}

export function LabTab({ cs, clock, events, hl }: Props) {
  const wrap = useRef<HTMLDivElement>(null)
  const visible = labsAt(cs, clock)
  const cols = [...new Set(visible.map(r => r.charttime))].sort((a, b) => toMs(a) - toMs(b))
  const at = new Map(visible.map(r => [`${r.code}|${r.charttime}`, r]))
  const evAt = new Map(events.map(e => [e.drawn, e]))
  const triggers = new Set(events.map(e => e.result.id))
  const groups = [...new Set(cs.labItems.map(i => i.group))]

  // 새 결과가 나오면 가장 최근 열이 보이게
  useEffect(() => {
    const el = wrap.current
    if (el && !hl) el.scrollLeft = el.scrollWidth
  }, [cols.length, hl])

  return (
    <div className="tab-body">
      <div className="subbar">
        <strong>{tr('누적 결과', 'Cumulative results')}</strong>
        <span className="muted">
          {tr(
            '채혈 시각 순. 기준 시각까지 보고된 결과만 보입니다. 칸에 마우스를 올리면 보고 시각이 보입니다',
            'By draw time. Only results reported by the as-of time are shown. Hover over a cell to see its report time',
          )}
        </span>
        <span className="spacer" />
        <span className="fl-h">H</span> {tr('높음', 'High')} <span className="fl-l">L</span> {tr('낮음', 'Low')}
      </div>
      <div className="grid-wrap" ref={wrap}>
        <table className="grid lab-grid">
          <thead>
            <tr>
              <th className="stk s1">{tr('검사명', 'Test')}</th>
              <th className="stk s2">{tr('단위', 'Unit')}</th>
              <th className="stk s3">{tr('참고치', 'Reference')}</th>
              {cols.map(c => {
                const ev = evAt.get(c)
                return (
                  <th key={c} className={cls('tc', ev && 't0col')} title={ev ? tr(`${ev.k}배 사건 · 채혈 ${hm(ev.drawn)}, 공개 ${hm(ev.t0)}`, `${ev.k}× event · drawn ${hm(ev.drawn)}, released ${hm(ev.t0)}`) : undefined}>
                    <div className="th-d">{md(c)}</div>
                    <div>{hm(c)}</div>
                    {ev && <span className="t0tag">{tr(`${ev.k}배`, `${ev.k}×`)}</span>}
                  </th>
                )
              })}
              <th className="fill" />
            </tr>
          </thead>
          <tbody>
            {groups.map(g => (
              <Fragment key={g}>
                <tr className="grp">
                  <td className="stk s1" colSpan={3}>{tx(g)}</td>
                  <td colSpan={cols.length + 1} />
                </tr>
                {cs.labItems.filter(i => i.group === g).map(item => (
                  <tr key={item.code} className={cls(isRowHl(hl, 'lab', item.code) && 'is-hl')}>
                    <td className="stk s1 name">{item.name}</td>
                    <td className="stk s2 muted">{item.unit}</td>
                    <td className="stk s3 muted">{refRange(item)}</td>
                    {cols.map(c => {
                      const r = at.get(`${item.code}|${c}`)
                      const base = cls('num', evAt.has(c) && 't0col')
                      if (!r) return <td key={c} className={base} />
                      const f = flag(item, r.value)
                      return (
                        <td
                          key={c}
                          title={tr(`채혈 ${mdhm(r.charttime)} · 보고 ${mdhm(r.storetime)}`, `Drawn ${mdhm(r.charttime)} · reported ${mdhm(r.storetime)}`)}
                          className={cls(base, f === 'H' && 'hi', f === 'L' && 'lo', triggers.has(r.id) && 'trigger', isCellHl(hl, 'lab', item.code, r.id) && 'is-hl')}
                        >
                          {fmtNum(r.value, item.dp)}
                          {f && <span className="fl">{f}</span>}
                        </td>
                      )
                    })}
                    <td className="fill" />
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
