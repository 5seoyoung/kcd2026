// 다른 곳에서 만든 모델의 출력 자리. 지금은 예시값이고, 모델을 받으면 실제 출력으로 바꾼다 (placeholder: false).
// 에이전트 1 (발생 예측), 4 (24시간 궤적) 는 매시간 출력이라 standin.ts 가 같은 형식으로 계산한다.
import type { ModelOutputs } from '../types'

export const modelOutputs: ModelOutputs[] = [
  {
    caseId: 'c01',
    placeholder: true,
    model1: {
      cluster: '군집 2',
      confidence: 0.86,
      assignable: true,
      devN: 1284,
      features: [
        '간 검사 패턴: 간세포형, AST/ALT 1 이상, ALT 중앙 8.7배',
        '변화: 직전 값에서 하루 안 급상승',
        '설명표 맥락: 승압제 71%, 저혈압 63%, LDH 상승 64%',
        '설명표 맥락: 간독성 약 노출 38%, 정맥영양 6%',
      ],
    },
    agent2: {
      probs: { 'rec-alive': 0.48, 'rec-dead': 0.13, 'norec-dead': 0.17, 'norec-alive': 0.22 },
      factors: [
        { name: '직전 값 정상', value: 'ALT 35 (03-10 05:00)', dir: '-' },
        { name: '관찰 중 신규 이상', value: '입실 47시간 뒤', dir: '-' },
        { name: '승압제 사용 중', value: '노르에피네프린 0.35', dir: '+' },
        { name: '젖산', value: '5.9 mmol/L', dir: '+' },
        { name: 'INR', value: '1.38', dir: '+' },
        { name: '나이', value: '67세', dir: '+' },
      ],
    },
  },
]
