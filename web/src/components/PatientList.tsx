import { patients } from '../data/patients'
import { cls } from '../lib/ui'

/** 재생 중인 환자는 기준 시각에 따라 재원일과 알림이 바뀐다 */
export interface LiveRow {
  stayDay: number
  /** event: 간 검사 이상 (2배 이상), risk: 발생 예측 경보 */
  alert: 'event' | 'risk' | null
  out: boolean
}

interface Props {
  selected: string
  onSelect: (id: string) => void
  live: Record<string, LiveRow>
}

export function PatientList({ selected, onSelect, live }: Props) {
  const alertOf = (id: string, fallback: boolean) => (live[id] ? live[id].alert : fallback ? 'event' : null)
  const alerts = patients.filter(p => alertOf(p.id, p.liverAlert)).length
  return (
    <section className="panel plist">
      <div className="panel-head">
        재원 환자 <span className="head-sub">MICU · {patients.length}명</span>
      </div>
      <div className="plist-filter" aria-hidden>
        <span className="seg on">병동 전체</span>
        <span className="seg">내 환자</span>
        <span className="seg">간 알림 {alerts}</span>
      </div>
      <div className="scroll">
        <table className="grid plist-grid">
          <thead>
            <tr><th>병상</th><th>환자</th><th>성/나이</th><th>재원</th><th>알림</th></tr>
          </thead>
          <tbody>
            {patients.map(p => {
              const lv = live[p.id]
              const alert = alertOf(p.id, p.liverAlert)
              return (
                <tr
                  key={p.id}
                  className={cls(p.id === selected && 'sel', !p.caseId && p.liverAlert && 'pending')}
                  onClick={() => onSelect(p.id)}
                  onKeyDown={e => e.key === 'Enter' && onSelect(p.id)}
                  tabIndex={0}
                  title={p.dx}
                >
                  <td className="mono">{p.bed.replace('MICU-', '')}</td>
                  <td>{p.name}</td>
                  <td>{p.sex}/{p.age}</td>
                  <td>{lv?.out ? '퇴실' : `D+${lv ? lv.stayDay : p.stayDay}`}</td>
                  <td>
                    {alert === 'event' && <span className="chip-liver" title="간 검사 이상 (2배 이상)">간</span>}
                    {alert === 'risk' && <span className="chip-liver risk" title="24시간 안 간 검사 이상 위험 (발생 예측 경보)">간</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="plist-legend">
        <span><span className="chip-liver">간</span> 간 검사 이상</span>
        <span><span className="chip-liver risk">간</span> 발생 위험 경보</span>
      </div>
    </section>
  )
}
