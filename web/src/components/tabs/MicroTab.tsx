import type { CaseData } from '../../types'
import { isAfter, mdhm } from '../../lib/time'
import { cls, isRowHl, type Highlight } from '../../lib/ui'

interface Props {
  cs: CaseData
  clock: string
  hl: Highlight
}

export function MicroTab({ cs, clock, hl }: Props) {
  const rows = cs.micro.filter(m => !isAfter(m.collected, clock))
  return (
    <div className="tab-body">
      <div className="subbar">
        <strong>미생물 검사</strong>
        <span className="muted">기준 시각에 나온 결과만 보입니다. 최종 결과 전에는 예비 결과나 배양 중으로 표시</span>
      </div>
      <div className="grid-wrap">
        <table className="grid list-grid">
          <thead>
            <tr><th>채취 일시</th><th>검체</th><th>검사</th><th>결과</th><th>보고 일시</th><th>상태</th><th className="fill" /></tr>
          </thead>
          <tbody>
            {rows.map(m => {
              const finalSeen = !isAfter(m.reported, clock)
              const prelimSeen = !finalSeen && m.prelim && !isAfter(m.prelim.time, clock)
              return (
                <tr key={m.id} className={cls(isRowHl(hl, 'micro', m.id) && 'is-hl')}>
                  <td className="mono">{mdhm(m.collected)}</td>
                  <td>{m.specimen}</td>
                  <td>{m.test}</td>
                  <td>{finalSeen ? m.result : prelimSeen ? m.prelim!.result : <span className="muted">결과 없음</span>}</td>
                  <td className="mono">{finalSeen ? mdhm(m.reported) : prelimSeen ? mdhm(m.prelim!.time) : ''}</td>
                  <td>
                    {finalSeen ? <span className="st-final">최종</span> : prelimSeen ? <span className="st-prelim">예비</span> : <span className="st-wait">배양 중</span>}
                  </td>
                  <td className="fill" />
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
