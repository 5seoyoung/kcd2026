import { patients } from '../data/patients'
import { cls } from '../lib/ui'
import { tr } from '../lib/i18n'
import { tx } from '../data/cases/en'

/** 재생 중인 환자는 기준 시각에 따라 재원일과 알림이 바뀐다 */
export interface LiveRow {
  stayDay: number
  /** event: 간 검사 이상 (2배 이상), risk: 발생 예측 경보 */
  alert: 'event' | 'risk' | null
  out: boolean
  /** ICU 안에서 사망 */
  dead?: boolean
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
        {tr('재원 환자', 'Inpatients')} <span className="head-sub">{tr(`중환자실 · ${patients.length}명`, `ICU · ${patients.length} patients`)}</span>
      </div>
      <div className="plist-filter" aria-hidden>
        <span className="seg on">{tr('병동 전체', 'All')}</span>
        <span className="seg">{tr('내 환자', 'My patients')}</span>
        <span className="seg">{tr(`간 알림 ${alerts}`, `Liver alerts ${alerts}`)}</span>
      </div>
      <div className="scroll">
        <table className="grid plist-grid">
          <thead>
            <tr><th>{tr('병상', 'Bed')}</th><th>{tr('환자', 'Patient')}</th><th>{tr('성/나이', 'S/age')}</th><th>{tr('재원', 'Stay')}</th><th>{tr('알림', 'LFT')}</th></tr>
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
                  title={tx(p.dx)}
                >
                  <td className="mono">{p.bed}</td>
                  <td>{tx(p.name)}</td>
                  <td>{p.sex}/{p.age}</td>
                  <td>{lv?.out ? (lv.dead ? tr('사망', 'Died') : tr('퇴실', 'Disch.')) : `D+${lv ? lv.stayDay : p.stayDay}`}</td>
                  <td>
                    {alert === 'event' && <span className="chip-liver" title={tr('간 검사 이상 (2배 이상)', 'Liver-test abnormality (2× or more)')}>{tr('간', 'L')}</span>}
                    {alert === 'risk' && <span className="chip-liver risk" title={tr('24시간 안 간 검사 이상 위험 (발생 예측 경보)', 'Risk of a liver-test abnormality within 24 h (early-warning alarm)')}>{tr('간', 'L')}</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="plist-legend">
        <span><span className="chip-liver">{tr('간', 'L')}</span> {tr('간 검사 이상', 'Liver-test abnormality')}</span>
        <span><span className="chip-liver risk">{tr('간', 'L')}</span> {tr('발생 위험 경보', 'Early-warning alarm')}</span>
      </div>
    </section>
  )
}
