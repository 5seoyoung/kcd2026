import type { Factor } from '../../types'
import { tr } from '../../lib/i18n'

/** 예측에 쓴 특징. '+' 는 위험을 높이거나 결과를 나쁘게 하는 쪽, 방향이 없으면 모델 입력값 */
export function FactorList({ factors, up, down }: { factors: Factor[]; up: string; down: string }) {
  return (
    <ul className="factors">
      {factors.map(f => (
        <li key={f.name}>
          {f.dir ? (
            <span className={f.dir === '+' ? 'fdir up' : 'fdir down'}>{f.dir === '+' ? `▲ ${up}` : `▼ ${down}`}</span>
          ) : (
            <span className="fdir in">{tr('입력', 'Input')}</span>
          )}
          <span>{f.name}</span>
          <b>{f.value}</b>
        </li>
      ))}
    </ul>
  )
}
