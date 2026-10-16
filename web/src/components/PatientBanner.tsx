import type { CaseData, Patient } from '../types'
import { dayIndex, isAfter, mdhm } from '../lib/time'

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
        <strong>{p.name}</strong>
        <span>{p.sex === 'M' ? '남' : '여'} / {p.age}세</span>
      </div>
      {field('등록번호', `9000${p.id.slice(1).padStart(4, '0')}`)}
      {field('병상', p.bed)}
      {field('진료과', p.dept)}
      {field('진단', p.dx)}
      {cs && field('ICU 입실', `${mdhm(cs.icuIn)} (D+${dayIndex(cs.icuIn, out ? cs.icuOut : clock)})`)}
      {cs?.history?.length ? field('과거력', cs.history.flatMap(h => h.codes.map(c => `${c.name} (${c.code})`)).join(', ')) : null}
      {out && field(dead ? 'ICU 사망' : 'ICU 퇴실', dead ? mdhm(cs!.icuOut) : `${mdhm(cs!.icuOut)} · ${cs!.outcome.dischargeTo}`)}
      {cs && field('키 / 몸무게', `${cs.height} cm / ${cs.weight} kg`)}
      <div className="b-badges">
        {out && <span className="badge gray">{dead ? '사망' : '퇴실'}</span>}
        {!out && badges.map(b => (
          <span key={b.label} className={`badge ${b.tone}`}>{b.label}</span>
        ))}
      </div>
    </div>
  )
}
