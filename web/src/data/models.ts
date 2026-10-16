// MIMIC 연구원이 만든 모델의 출력 자리. 지금은 예시값이고, 모델을 받으면 실제 출력으로 바꾼다 (placeholder: false).
// 에이전트 1 (발생 예측), 4 (24시간 궤적) 는 매시간 출력이라 standin.ts 가 같은 형식으로 계산한다.
// 예시값은 사례 1 의 첫 이상 (03-10 20:30 채혈, 21:25 공개) 시점 기준이다.
import type { ModelOutputs } from '../types'

export const modelOutputs: ModelOutputs[] = [
  {
    caseId: 'c01',
    placeholder: true,
    model1: {
      cluster: '군집 3',
      confidence: 0.81,
      assignable: true,
      devN: 2140,
      features: [
        '간 검사 패턴: 혼합형 (R 2~5), AST/ALT 1 이상, ALT 중앙 2.6배',
        '변화: 직전 값에서 하루 안 상승',
        '설명표 맥락: 승압제 58%, 저혈압 52%, LDH 상승 47%',
        '설명표 맥락: 간독성 약 노출 41%, 정맥영양 7%',
      ],
    },
    agent2: {
      probs: { 'rec-alive': 0.48, 'rec-dead': 0.11, 'norec-dead': 0.15, 'norec-alive': 0.26 },
      icuDeath: 0.24,
      factors: [
        { name: '직전 값 정상', value: 'ALT 35 (03-10 05:00)', dir: '-' },
        { name: '관찰 중 신규 이상', value: '입실 48시간 뒤', dir: '-' },
        { name: '승압제 사용 중', value: '노르에피네프린 0.35', dir: '+' },
        { name: '젖산', value: '5.9 mmol/L', dir: '+' },
        { name: 'INR', value: '1.38', dir: '+' },
        { name: '나이', value: '67세', dir: '+' },
      ],
    },
  },
]
