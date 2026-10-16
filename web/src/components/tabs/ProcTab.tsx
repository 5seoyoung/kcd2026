import type { CaseData } from '../../types'
import { isAfter, mdhm } from '../../lib/time'
import { cls, isRowHl, type Highlight } from '../../lib/ui'

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
        <strong>영상·처치 기록</strong>
        <span className="muted">자료에는 시행 기록만 있고 판독문은 없습니다</span>
      </div>
      <div className="grid-wrap proc-wrap">
        <table className="grid list-grid">
          <thead>
            <tr><th>시행 일시</th><th>구분</th><th>이름</th><th>비고</th><th className="fill" /></tr>
          </thead>
          <tbody>
            {rows.map(p => (
              <tr key={p.id} className={cls(isRowHl(hl, 'proc', p.id) && 'is-hl')}>
                <td className="mono">{mdhm(p.time)}</td>
                <td>{p.kind}</td>
                <td>{p.name}</td>
                <td className="muted">{p.note}</td>
                <td className="fill" />
              </tr>
            ))}
          </tbody>
        </table>
        <div className="missing-box">
          <div className="missing-head">
            이 자료에 없는 기록 <span className="muted">에이전트는 이것을 반대 근거가 아니라 누락 근거로 씁니다</span>
          </div>
          <table className="grid list-grid">
            <thead>
              <tr><th>항목</th><th>상태</th><th className="fill" /></tr>
            </thead>
            <tbody>
              {cs.missing.map(m => (
                <tr key={m.id} className={cls(isRowHl(hl, 'proc', m.id) && 'is-hl')}>
                  <td><span className="miss-mark" aria-hidden>?</span>{m.name}</td>
                  <td className="muted">{m.reason}</td>
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
