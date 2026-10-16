import type { Factor } from '../../types'

/** 예측에 쓴 특징. '+' 는 위험을 높이거나 결과를 나쁘게 하는 쪽 */
export function FactorList({ factors, up, down }: { factors: Factor[]; up: string; down: string }) {
  return (
    <ul className="factors">
      {factors.map(f => (
        <li key={f.name}>
          <span className={f.dir === '+' ? 'fdir up' : 'fdir down'}>{f.dir === '+' ? `▲ ${up}` : `– ${down}`}</span>
          <span>{f.name}</span>
          <b>{f.value}</b>
        </li>
      ))}
    </ul>
  )
}
