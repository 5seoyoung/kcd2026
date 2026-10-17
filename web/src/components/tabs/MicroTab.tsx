import type { CaseData } from '../../types'
import { isAfter, mdhm } from '../../lib/time'
import { cls, isRowHl, type Highlight } from '../../lib/ui'
import { tr } from '../../lib/i18n'
import { tx } from '../../data/cases/en'

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
        <strong>{tr('미생물 검사', 'Microbiology')}</strong>
        <span className="muted">
          {tr(
            '기준 시각에 나온 결과만 보입니다. 최종 결과 전에는 예비 결과나 배양 중으로 표시',
            'Only results available at the as-of time are shown. Before the final result, the preliminary result or "in culture" is shown',
          )}
        </span>
      </div>
      <div className="grid-wrap">
        <table className="grid list-grid">
          <thead>
            <tr>
              <th>{tr('채취 일시', 'Collected')}</th><th>{tr('검체', 'Specimen')}</th><th>{tr('검사', 'Test')}</th><th>{tr('결과', 'Result')}</th>
              <th>{tr('보고 일시', 'Reported')}</th><th>{tr('상태', 'Status')}</th><th className="fill" />
            </tr>
          </thead>
          <tbody>
            {rows.map(m => {
              const finalSeen = !isAfter(m.reported, clock)
              const prelimSeen = !finalSeen && m.prelim && !isAfter(m.prelim.time, clock)
              return (
                <tr key={m.id} className={cls(isRowHl(hl, 'micro', m.id) && 'is-hl')}>
                  <td className="mono">{mdhm(m.collected)}</td>
                  <td>{tx(m.specimen)}</td>
                  <td>{tx(m.test)}</td>
                  <td>{finalSeen ? tx(m.result) : prelimSeen ? tx(m.prelim!.result) : <span className="muted">{tr('결과 없음', 'No result')}</span>}</td>
                  <td className="mono">{finalSeen ? mdhm(m.reported) : prelimSeen ? mdhm(m.prelim!.time) : ''}</td>
                  <td>
                    {finalSeen ? (
                      <span className="st-final">{tr('최종', 'Final')}</span>
                    ) : prelimSeen ? (
                      <span className="st-prelim">{tr('예비', 'Preliminary')}</span>
                    ) : (
                      <span className="st-wait">{tr('배양 중', 'In culture')}</span>
                    )}
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
