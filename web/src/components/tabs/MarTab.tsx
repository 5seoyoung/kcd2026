import { Fragment, useEffect, useRef } from 'react'
import type { CaseData } from '../../types'
import { daysBetween, hm, isAfter, md, mdhm, ymd } from '../../lib/time'
import { cls, isCellHl, isRowHl, type Highlight } from '../../lib/ui'

interface Props {
  cs: CaseData
  clock: string
  hl: Highlight
}

const MARK = { given: '✓', held: '–', stopped: '■' }

export function MarTab({ cs, clock, hl }: Props) {
  const wrap = useRef<HTMLDivElement>(null)
  const days = daysBetween(cs.icuIn, clock)
  const today = ymd(clock)
  const cats = [...new Set(cs.mar.map(o => o.category))]
  const orders = cs.mar.filter(o => !isAfter(o.start, clock))

  useEffect(() => {
    const el = wrap.current
    if (el && !hl) el.scrollLeft = el.scrollWidth
  }, [days.length, hl])

  return (
    <div className="tab-body">
      <div className="subbar">
        <strong>투약 기록 (MAR)</strong>
        <span className="muted">실제 투여 시각. 처방은 날짜 단위라 같은 날 선후는 이 기록으로 봅니다</span>
        <span className="spacer" />
        <span className="mchip given sample">✓ 투여</span>
        <span className="mchip stopped sample">■ 중단</span>
      </div>
      <div className="grid-wrap" ref={wrap}>
        <table className="grid mar-grid">
          <thead>
            <tr>
              <th className="stk mc1">약품명</th>
              <th className="stk mc2">용량</th>
              <th className="stk mc3">경로</th>
              <th className="stk mc4">횟수</th>
              {days.map(d => (
                <th key={d} className={cls('dc', d === today && 'today')}>
                  {md(d)}
                  {d === today && <span className="th-note"> · {hm(clock)} 까지</span>}
                </th>
              ))}
              <th className="fill" />
            </tr>
          </thead>
          <tbody>
            {cats.map(cat => {
              const rows = orders.filter(o => o.category === cat)
              if (!rows.length) return null
              return (
                <Fragment key={cat}>
                  <tr className="grp">
                    <td className="stk mc1" colSpan={4}>{cat}</td>
                    <td colSpan={days.length + 1} />
                  </tr>
                  {rows.map(o => (
                    <tr key={o.id} className={cls(isRowHl(hl, 'mar', o.id) && 'is-hl')}>
                      <td className="stk mc1 name" title={`시작 ${mdhm(o.start)}`}>{o.drug}</td>
                      <td className="stk mc2">{o.dose}</td>
                      <td className="stk mc3">{o.route}</td>
                      <td className="stk mc4">{o.freq}</td>
                      {days.map(d => (
                        <td key={d} className={cls('dc', d === today && 'today')}>
                          <div className="chips">
                            {o.admins
                              .filter(a => ymd(a.time) === d && !isAfter(a.time, clock))
                              .map(a => (
                                <span
                                  key={a.time}
                                  className={cls('mchip', a.status, isCellHl(hl, 'mar', o.id, a.time) && 'is-hl')}
                                  title={`${mdhm(a.time)} ${a.text ?? ''}`}
                                >
                                  {MARK[a.status]} {hm(a.time)}
                                  {a.text && <em>{a.text}</em>}
                                </span>
                              ))}
                          </div>
                        </td>
                      ))}
                      <td className="fill" />
                    </tr>
                  ))}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
