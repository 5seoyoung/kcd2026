// 4. 담즙정체형 (총담관 결석, 급성 담관염, 패혈성 쇼크): 회복, 생존. 입실 3시간에 ALP 우세 이상 (2.2배, R 0.8),
// ERCP 다음 날 ALP 가 5.3배까지 올라 5배 사건 (기준 5배와 10% 안, 경계값) 뒤 D4 회복. 종료 상태와 원인 추정은 5배 사건 때 돎. 모든 값은 가상.
import type { CaseData, MarOrder } from '../../types'
import { dayOf, doses, every, infusion, LAB_ITEMS, makeVitals, panel } from './kit'

const T = dayOf('2026-03-08')
const ICU_IN = T(0, '13:00')
const ICU_OUT = T(4, '13:00')

const mar: MarOrder[] = [
  { id: 'PIP', category: '항생제', drug: 'Piperacillin/Tazobactam', dose: '4.5 g', route: 'IV', freq: 'q6h', start: T(0, '10:00'), admins: doses(every(T(0, '10:00'), T(4, '10:00'), 6)) },
  { id: 'NE', category: '승압제·심혈관', drug: 'Norepinephrine', dose: 'premix 8 mg/250 mL', route: 'IV', freq: 'mcg/kg/min', start: T(0, '13:30'), infusion: true,
    admins: infusion([[T(0, '13:30'), 0.08]], T(1, '10:00')) },
]

export const c4: CaseData = {
  id: 'c4',
  patientId: 'c4',
  admitDate: T(0, '09:00').slice(0, 10),
  admitTime: T(0, '09:00'),
  icuIn: ICU_IN,
  icuOut: ICU_OUT,
  height: 155,
  weight: 58,
  badges: [
    { label: '승압제', tone: 'red', from: T(0, '13:30'), to: T(1, '10:00') },
    { label: '알레르기 없음', tone: 'gray' },
  ],
  outcome: { icuDeath: false, death1y: false, dischargeTo: '소화기내과 병동' },
  labItems: LAB_ITEMS,
  labs: [
    ...panel('L0', T(0, '09:30'), T(0, '10:30'), { ALT: 60, AST: 70, ALP: 230, TB: 2.6, INR: 1.3, ALB: 3.2, LAC: 3.6, CR: 1.5, BUN: 28, PLT: 140, WBC: 18.4, NA: 135, GLU: 190, HCO3: 19, HB: 12.0 }),
    // 첫 이상: ALP 2.2배, R 0.8 (담즙정체형)
    ...panel('L1', T(0, '15:00'), T(0, '16:00'), { ALT: 70, AST: 85, ALP: 286, TB: 2.8, INR: 1.4, ALB: 3.0, LAC: 2.8, CR: 1.6, BUN: 30, PLT: 128, WBC: 19.8, NA: 134, GLU: 165, HCO3: 20, HB: 11.6, DB: 2.1, GGT: 380, LDH: 260, CK: 70 }),
    // 5배 사건: ERCP 다음 날 ALP 690 (5.3배)
    ...panel('L2', T(1, '05:00'), T(1, '06:00'), { ALT: 82, AST: 90, ALP: 690, TB: 3.4, DB: 2.6, GGT: 520, INR: 1.4, ALB: 2.9, LAC: 1.8, CR: 1.3, BUN: 26, PLT: 118, WBC: 16.2, NA: 136, GLU: 140, HCO3: 22, HB: 11.2, LDH: 240 }),
    ...panel('L3', T(2, '05:00'), T(2, '06:00'), { ALT: 62, AST: 58, ALP: 520, TB: 2.3 }),
    ...panel('L4', T(3, '05:00'), T(3, '06:00'), { ALT: 50, AST: 40, ALP: 360, TB: 1.7, WBC: 11.0 }),
    // 회복: 세 항목 모두 2배 미만
    ...panel('L5', T(4, '05:00'), T(4, '06:00'), { ALT: 42, AST: 34, ALP: 240, TB: 1.4, INR: 1.1, ALB: 3.0, LAC: 1.0, CR: 0.9, BUN: 16, PLT: 165, WBC: 9.0, NA: 138, GLU: 115, HCO3: 25, HB: 11.4 }),
  ],
  mar,
  vitals: makeVitals({
    from: ICU_IN, to: ICU_OUT, seed: 41,
    segs: [
      { from: ICU_IN, map: [60, 64], hr: [112, 120], rr: [22, 26], spo2: [93, 96], bt: [38.8, 39.2] },
      { from: T(0, '15:00'), map: [68, 75], hr: [100, 112], rr: [20, 24], spo2: [94, 97], bt: [38.4, 39.0] },
      { from: T(1, '14:00'), map: [70, 78], hr: [85, 95], rr: [16, 20], spo2: [95, 98], bt: [36.8, 37.4] },
    ],
  }),
  micro: [
    { id: 'M1', collected: T(0, '09:30'), specimen: '혈액 (말초)', test: '혈액배양 2회', result: 'Escherichia coli (piperacillin/tazobactam 감수성)', reported: T(2, '10:00'), prelim: { time: T(1, '03:00'), result: '그람음성 막대균' } },
    { id: 'M2', collected: T(0, '18:30'), specimen: '담즙', test: '일반 배양', result: 'Escherichia coli', reported: T(2, '14:00') },
  ],
  procs: [
    { id: 'PR1', time: T(0, '11:00'), kind: '영상', name: '복부 CT', note: '판독문 없음' },
    { id: 'PR2', time: T(0, '18:00'), kind: '처치', name: 'ERCP 결석 제거, 담관 스텐트', note: '판독문 없음' },
  ],
  missing: [
    { id: 'miss-bnp', name: 'NT-proBNP', reason: '측정 기록 없음' },
    { id: 'miss-virus', name: '간염 바이러스 표지자', reason: '측정 기록 없음' },
    { id: 'miss-hapto', name: '합토글로빈', reason: '측정 기록 없음 (용혈 판단 불가)' },
    { id: 'miss-read', name: '영상·시술 판독문', reason: '자료에 시행 기록만 있고 판독문 없음' },
  ],
  events: [
    { id: 'E1', lane: 'hemo', label: '발열 39.2', start: ICU_IN, end: T(1, '14:00'), ref: { tab: 'vital', row: 'bt', from: ICU_IN, to: T(1, '13:00') } },
    { id: 'E2', lane: 'drug', label: '노르에피네프린', start: T(0, '13:30'), end: T(1, '10:00'), ref: { tab: 'mar', row: 'NE' } },
    { id: 'E3', lane: 'drug', label: '피페라실린/타조박탐', start: T(0, '10:00'), end: ICU_OUT, ref: { tab: 'mar', row: 'PIP' } },
    { id: 'E4', lane: 'test', label: 'ERCP', start: T(0, '18:00'), ref: { tab: 'proc', row: 'PR2' } },
    { id: 'E5', lane: 'test', label: '혈액배양', start: T(0, '09:30'), ref: { tab: 'micro', row: 'M1' } },
  ],
}
