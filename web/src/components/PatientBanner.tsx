import type { CaseData, Patient } from '../types'
import { dayIndex, isAfter, mdhm } from '../lib/time'
import { tr } from '../lib/i18n'
import { tx } from '../data/cases/en'

export function PatientBanner({ p, cs, clock }: { p: Patient; cs?: CaseData; clock: string }) {
  const field = (label: string, value: string) => (
    <div className="bf">
      <span className="bl">{label}</span>
      <span className="bv">{value}</span>
    </div>
  )
  const out = cs && !isAfter(cs.icuOut, clock)
  // ICU 안에서 사망 (사망 시각이 퇴실 시각과 같음)
  const dead = !!cs?.outcome.icuDeath && cs.outcome.deathTime === cs.icuOut
  const badges = cs?.badges.filter(b => (!b.from || !isAfter(b.from, clock)) && (!b.to || isAfter(b.to, clock))) ?? []
  return (
    <div className="banner">
      <div className="b-name">
        <strong>{tx(p.name)}</strong>
        <span>{p.sex === 'M' ? tr('남', 'M') : tr('여', 'F')} / {tr(`${p.age}세`, `${p.age} y`)}</span>
      </div>
      {field(tr('등록번호', 'MRN'), `9000${p.id.slice(1).padStart(4, '0')}`)}
      {field(tr('병상', 'Bed'), p.bed)}
      {field(tr('진료과', 'Department'), tx(p.dept))}
      {field(tr('진단', 'Diagnosis'), tx(p.dx))}
      {cs && field(tr('ICU 입실', 'ICU admission'), `${mdhm(cs.icuIn)} (D+${dayIndex(cs.icuIn, out ? cs.icuOut : clock)})`)}
      {cs?.history?.length ? field(tr('과거력', 'History'), cs.history.flatMap(h => h.codes.map(c => `${tx(c.name)} (${c.code})`)).join(', ')) : null}
      {out && field(dead ? tr('ICU 사망', 'ICU death') : tr('ICU 퇴실', 'ICU discharge'), dead ? mdhm(cs!.icuOut) : `${mdhm(cs!.icuOut)} · ${tx(cs!.outcome.dischargeTo)}`)}
      {cs && field(tr('키 / 몸무게', 'Height / weight'), `${cs.height} cm / ${cs.weight} kg`)}
      <div className="b-badges">
        {out && <span className="badge gray">{dead ? tr('사망', 'Died') : tr('퇴실', 'Discharged')}</span>}
        {!out && badges.map(b => (
          <span key={b.label} className={`badge ${b.tone}`}>{tx(b.label)}</span>
        ))}
      </div>
    </div>
  )
}
