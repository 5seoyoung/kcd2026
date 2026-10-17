// 3. 기저 간질환형 (알코올 간경변, 식도정맥류 출혈): 미회복, 생존. 효소는 정상인 채 총빌리만 오름 (D0 2.9배 첫 이상 → D2 5.7배 5배 사건).
// 종료 상태와 원인 추정은 5배 사건 때 돎. 과거력: 1년 전 입원 진단 알코올 간경변 (K70.3). 모든 값은 가상.
import type { CaseData, MarOrder } from '../../types'
import { dayOf, doses, every, infusion, LAB_ITEMS, makeVitals, panel } from './kit'

const T = dayOf('2026-03-06')
const ICU_IN = T(0, '06:00')
const ICU_OUT = T(3, '15:00')

const mar: MarOrder[] = [
  { id: 'TERLI', category: '승압제·심혈관', drug: 'Terlipressin', dose: '1 mg', route: 'IV', freq: 'q6h', start: T(0, '06:30'), admins: doses(every(T(0, '06:30'), T(3, '06:30'), 6)) },
  { id: 'CTRX', category: '항생제', drug: 'Ceftriaxone', dose: '1 g (예방)', route: 'IV', freq: 'q24h', start: T(0, '07:00'), admins: doses(every(T(0, '07:00'), T(3, '07:00'), 24)) },
  { id: 'PPI', category: '기타', drug: 'Pantoprazole', dose: '8 mg/h', route: 'IV', freq: '지속', start: T(0, '06:30'), infusion: true,
    admins: infusion([[T(0, '06:30'), null]], T(3, '06:30')) },
  { id: 'LACT', category: '기타', drug: 'Lactulose', dose: '30 mL', route: 'PO', freq: 'tid', start: T(0, '12:00'), admins: doses(every(T(0, '12:00'), T(3, '12:00'), 8)) },
  { id: 'RBC', category: '수혈', drug: '농축적혈구', dose: '1단위', route: 'IV', freq: '수혈', start: T(0, '07:00'), admins: doses([T(0, '07:00'), T(0, '09:00')]) },
]

export const c3: CaseData = {
  id: 'c3',
  patientId: 'c3',
  admitDate: T(0, '02:00').slice(0, 10),
  admitTime: T(0, '02:00'),
  icuIn: ICU_IN,
  icuOut: ICU_OUT,
  height: 169,
  weight: 64,
  badges: [
    { label: '수혈', tone: 'red', from: T(0, '07:00'), to: T(0, '10:00') },
    { label: '간경변', tone: 'gray' },
    { label: '알레르기 없음', tone: 'gray' },
  ],
  outcome: { icuDeath: false, death1y: false, dischargeTo: '소화기내과 병동' },
  history: [{ admitted: '2025-02-11 10:00', discharged: '2025-02-20 11:00', codes: [{ code: 'K70.3', version: 10, name: '알코올 간경변' }] }],
  labItems: LAB_ITEMS,
  labs: [
    ...panel('L0', T(0, '02:30'), T(0, '03:30'), { ALT: 30, AST: 52, ALP: 115, TB: 2.7, INR: 1.7, ALB: 2.7, LAC: 3.1, CR: 1.0, BUN: 30, PLT: 70, WBC: 9.8, NA: 132, GLU: 160, HCO3: 20, HB: 9.6 }),
    // 첫 이상: 총빌리 단독, 입실 초기
    ...panel('L1', T(0, '11:00'), T(0, '12:00'), { ALT: 32, AST: 58, ALP: 120, TB: 4.4, INR: 1.8, ALB: 2.6, LAC: 2.2, CR: 1.1, BUN: 38, PLT: 62, WBC: 10.5, NA: 131, GLU: 140, HCO3: 21, HB: 7.2, DB: 2.0, GGT: 180, LDH: 280, CK: 95 }),
    ...panel('L2', T(1, '05:00'), T(1, '06:00'), { ALT: 34, AST: 60, ALP: 122, TB: 6.2, INR: 1.9, ALB: 2.5, LAC: 1.5, CR: 1.1, BUN: 34, PLT: 58, WBC: 8.9, NA: 131, GLU: 128, HCO3: 23, HB: 8.4 }),
    // 5배 사건: 총빌리 8.6 (5.7배), 효소는 그대로
    ...panel('L3', T(2, '05:00'), T(2, '06:00'), { ALT: 33, AST: 62, ALP: 125, TB: 8.6, DB: 3.9, GGT: 170, INR: 2.0, ALB: 2.4, LAC: 1.4, CR: 1.2, BUN: 30, PLT: 55, WBC: 10.6, NA: 130, GLU: 132, HCO3: 23, HB: 8.6, LDH: 290, CK: 90 }),
    // 퇴실 전 마지막 값: 총빌리 4.3배, 미회복
    ...panel('L4', T(3, '05:00'), T(3, '06:00'), { ALT: 30, AST: 52, ALP: 118, TB: 6.4, INR: 1.8, ALB: 2.6, LAC: 1.2, CR: 1.0, BUN: 22, PLT: 64, WBC: 7.6, NA: 133, GLU: 118, HCO3: 24, HB: 8.8 }),
  ],
  mar,
  vitals: makeVitals({
    from: ICU_IN, to: ICU_OUT, seed: 31,
    segs: [
      { from: ICU_IN, map: [58, 64], hr: [110, 120], rr: [20, 24], spo2: [94, 98], bt: [36.4, 37.0] },
      { from: T(0, '10:00'), map: [68, 78], hr: [85, 95], rr: [16, 20], spo2: [95, 98], bt: [36.4, 37.1] },
    ],
  }),
  micro: [
    { id: 'M1', collected: T(0, '06:30'), specimen: '혈액 (말초)', test: '혈액배양 2회', result: '5일 배양 균 자라지 않음', reported: T(5, '07:00'), prelim: { time: T(2, '07:00'), result: '48시간 균 자라지 않음' } },
  ],
  procs: [
    { id: 'PR1', time: T(0, '08:30'), kind: '처치', name: '위내시경 정맥류 결찰' },
    { id: 'PR2', time: T(1, '10:00'), kind: '영상', name: '복부 초음파', note: '판독문 없음' },
  ],
  missing: [
    { id: 'miss-bnp', name: 'NT-proBNP', reason: '측정 기록 없음' },
    { id: 'miss-hapto', name: '합토글로빈', reason: '측정 기록 없음 (용혈 판단 불가)' },
    { id: 'miss-virus', name: '간염 바이러스 표지자', reason: '측정 기록 없음' },
    { id: 'miss-read', name: '영상 판독문', reason: '자료에 시행 기록만 있고 판독문 없음' },
  ],
  events: [
    { id: 'E1', lane: 'hemo', label: 'MAP 65 미만', start: ICU_IN, end: T(0, '09:00'), ref: { tab: 'vital', row: 'map', from: ICU_IN, to: T(0, '09:00') } },
    { id: 'E2', lane: 'drug', label: '테를리프레신', start: T(0, '06:30'), end: T(3, '06:30'), ref: { tab: 'mar', row: 'TERLI' } },
    { id: 'E3', lane: 'drug', label: '세프트리악손', start: T(0, '07:00'), end: ICU_OUT, ref: { tab: 'mar', row: 'CTRX' } },
    { id: 'E4', lane: 'test', label: '적혈구 수혈 2단위', start: T(0, '07:00'), end: T(0, '09:30'), ref: { tab: 'mar', row: 'RBC' } },
    { id: 'E5', lane: 'test', label: '정맥류 결찰', start: T(0, '08:30'), ref: { tab: 'proc', row: 'PR1' } },
    { id: 'E6', lane: 'test', label: '복부 초음파', start: T(1, '10:00'), ref: { tab: 'proc', row: 'PR2' } },
  ],
}
