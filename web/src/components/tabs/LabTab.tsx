import { Fragment, useEffect, useRef } from 'react'
import type { CaseData, LiverEvent } from '../../types'
import { hm, md, mdhm, toMs } from '../../lib/time'
import { flag, fmtNum, refRange } from '../../lib/lab'
import { labsAt } from '../../lib/events'
import { cls, isCellHl, isRowHl, type Highlight } from '../../lib/ui'

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
  const evAt = new Map(events.map(e => [e.t0, e]))
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
        <strong>누적 결과</strong>
        <span className="muted">채혈 시각 순. 기준 시각까지 보고된 결과만 보입니다. 칸에 마우스를 올리면 보고 시각이 보입니다</span>
        <span className="spacer" />
        <span className="fl-h">H</span> 높음 <span className="fl-l">L</span> 낮음
      </div>
      <div className="grid-wrap" ref={wrap}>
        <table className="grid lab-grid">
          <thead>
            <tr>
              <th className="stk s1">검사명</th>
              <th className="stk s2">단위</th>
              <th className="stk s3">참고치</th>
              {cols.map(c => {
                const ev = evAt.get(c)
                return (
                  <th key={c} className={cls('tc', ev && 't0col')} title={ev ? `${ev.k}배 사건 t0 (채혈)` : undefined}>
                    <div className="th-d">{md(c)}</div>
                    <div>{hm(c)}</div>
                    {ev && <span className="t0tag">{ev.k}배</span>}
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
                  <td className="stk s1" colSpan={3}>{g}</td>
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
                          title={`채혈 ${mdhm(r.charttime)} · 보고 ${mdhm(r.storetime)}`}
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
