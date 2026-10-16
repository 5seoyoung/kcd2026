// 모델 1 (군집, 보조) 과 에이전트 2 (종료 상태) 출력. 모델 패키지를 적용한 출력 (modelrun.ts) 에서 가져온다.
// 패키지 출력이 없는 사례는 여기에 예시값을 넣고 placeholder: true 로 둔다.
import type { ModelOutputs } from '../types'
import { agent2Of, model1Of, modelRun } from './modelrun'

function fromRun(caseId: string): ModelOutputs | undefined {
  const run = modelRun(caseId)
  const agent2 = run && agent2Of(run)
  const model1 = run && model1Of(run)
  return agent2 && model1 ? { caseId, placeholder: false, model1, agent2 } : undefined
}

export const modelOutputs: ModelOutputs[] = [fromRun('c01')].filter((m): m is ModelOutputs => !!m)
