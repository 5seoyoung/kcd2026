// 시연 사례 5명. 종료 상태 5가지 (회복 사망, 미회복 사망, 미회복 생존, 회복 생존, 판정 불가 생존) 와 조기 예측 대상 여부가 모두 나오게 나눔.
import type { CaseData } from '../../types'
import { c1 } from './c1'
import { c2 } from './c2'
import { c3 } from './c3'
import { c4 } from './c4'
import { c5 } from './c5'

export const CASES: CaseData[] = [c1, c2, c3, c4, c5]
