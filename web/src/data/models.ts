// 모델 1 (군집, 보조) 과 에이전트 2 (종료 상태) 출력. 모델 패키지를 적용한 출력 (modelrun.ts) 에서 가져온다.
import type { ModelOutputs } from '../types'
import { CASES } from './cases'
import { agent2Of, model1Of, modelRun } from './modelrun'
import { lang, tr, type Lang } from '../lib/i18n'

function fromRun(caseId: string): ModelOutputs | undefined {
  const run = modelRun(caseId)
  const agent2 = run && agent2Of(run)
  if (!agent2) return undefined
  const model1 = (run && model1Of(run)) ?? { cluster: tr('군집 할당 없음', 'No cluster assigned'), confidence: 0, assignable: false, share: 0, features: [] }
  return { caseId, placeholder: false, model1, agent2 }
}

// 문구가 언어마다 달라 언어별로 한 번씩 만듦
const OUTS = new Map<Lang, ModelOutputs[]>()
export function modelOutputsNow(): ModelOutputs[] {
  const l = lang()
  if (!OUTS.has(l)) OUTS.set(l, CASES.map(c => fromRun(c.id)).filter((m): m is ModelOutputs => !!m))
  return OUTS.get(l)!
}
