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

export function ProcTab({ cs, clock, hl }: Props) {
  const rows = cs.procs.filter(p => !isAfter(p.time, clock))
  return (
    <div className="tab-body">
      <div className="subbar">
        <strong>{tr('영상·처치 기록', 'Imaging & procedure records')}</strong>
        <span className="muted">{tr('자료에는 시행 기록만 있고 판독문은 없습니다', 'The data hold only the records that these were done, not the reports')}</span>
      </div>
      <div className="grid-wrap proc-wrap">
        <table className="grid list-grid">
          <thead>
            <tr><th>{tr('시행 일시', 'Performed')}</th><th>{tr('구분', 'Type')}</th><th>{tr('이름', 'Name')}</th><th>{tr('비고', 'Note')}</th><th className="fill" /></tr>
          </thead>
          <tbody>
            {rows.map(p => (
              <tr key={p.id} className={cls(isRowHl(hl, 'proc', p.id) && 'is-hl')}>
                <td className="mono">{mdhm(p.time)}</td>
                <td>{tx(p.kind)}</td>
                <td>{tx(p.name)}</td>
                <td className="muted">{tx(p.note)}</td>
                <td className="fill" />
              </tr>
            ))}
          </tbody>
        </table>
        <div className="missing-box">
          <div className="missing-head">
            {tr('이 자료에 없는 기록', 'Records not in this data')}{' '}
            <span className="muted">{tr('에이전트는 이것을 반대 근거가 아니라 누락 근거로 씁니다', 'Agents treat these as missing evidence, not as evidence against')}</span>
          </div>
          <table className="grid list-grid">
            <thead>
              <tr><th>{tr('항목', 'Item')}</th><th>{tr('상태', 'Status')}</th><th className="fill" /></tr>
            </thead>
            <tbody>
              {cs.missing.map(m => (
                <tr key={m.id} className={cls(isRowHl(hl, 'proc', m.id) && 'is-hl')}>
                  <td><span className="miss-mark" aria-hidden>?</span>{tx(m.name)}</td>
                  <td className="muted">{tx(m.reason)}</td>
                  <td className="fill" />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
