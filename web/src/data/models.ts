// 모델 1 (군집, 보조) 과 에이전트 2 (종료 상태) 출력. 모델 패키지를 적용한 출력 (modelrun.ts) 에서 가져온다.
import type { ModelOutputs } from '../types'
import { CASES } from './cases'
import { agent2Of, model1Of, modelRun } from './modelrun'

function fromRun(caseId: string): ModelOutputs | undefined {
  const run = modelRun(caseId)
  const agent2 = run && agent2Of(run)
  if (!agent2) return undefined
  const model1 = (run && model1Of(run)) ?? { cluster: '군집 할당 없음', confidence: 0, assignable: false, share: 0, features: [] }
  return { caseId, placeholder: false, model1, agent2 }
}

export const modelOutputs: ModelOutputs[] = CASES.map(c => fromRun(c.id)).filter((m): m is ModelOutputs => !!m)
