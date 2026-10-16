// 5. 관찰 중 새로 발생 (직장암 수술 뒤 문합부 누출, 패혈성 쇼크): 판정 불가, 생존.
// 59시간 정상 뒤 첫 이상. 안정기에는 젖산, INR 을 재지 않았고, 사건 뒤 ALP 와 총빌리를 다시 재지 않아 회복을 판정할 수 없음. 모든 값은 가상.
import type { CaseData, MarOrder } from '../../types'
import { dayOf, doses, every, infusion, LAB_ITEMS, makeVitals, panel } from './kit'

const T = dayOf('2026-03-10')
const ICU_IN = T(0, '13:00')
const ICU_OUT = T(5, '10:00')

const mar: MarOrder[] = [
  { id: 'CFZ', category: '항생제', drug: 'Cefazolin', dose: '2 g (수술 예방)', route: 'IV', freq: 'q8h', start: T(0, '07:30'), admins: doses(every(T(0, '07:30'), T(1, '07:30'), 8)) },
  { id: 'MTZ', category: '항생제', drug: 'Metronidazole', dose: '500 mg (수술 예방)', route: 'IV', freq: 'q8h', start: T(0, '07:30'), admins: doses(every(T(0, '07:30'), T(1, '07:30'), 8)) },
  { id: 'APAP', category: '진통·진정', drug: 'Acetaminophen', dose: '1 g', route: 'IV', freq: 'q6h', start: T(0, '14:00'), admins: doses(every(T(0, '14:00'), T(2, '20:00'), 6)) },
  { id: 'PIP', category: '항생제', drug: 'Piperacillin/Tazobactam', dose: '4.5 g', route: 'IV', freq: 'q6h', start: T(2, '20:00'), admins: doses(every(T(2, '20:00'), T(5, '08:00'), 6)) },
  { id: 'NE', category: '승압제·심혈관', drug: 'Norepinephrine', dose: 'premix 8 mg/250 mL', route: 'IV', freq: 'mcg/kg/min', start: T(2, '19:00'), infusion: true,
    admins: infusion([[T(2, '19:00'), 0.08], [T(3, '01:00'), 0.18]], T(4, '08:00')) },
]

export const c5: CaseData = {
  id: 'c5',
  patientId: 'c5',
  admitDate: T(-1, '14:00').slice(0, 10),
  admitTime: T(-1, '14:00'),
  icuIn: ICU_IN,
  icuOut: ICU_OUT,
  height: 171,
  weight: 70,
  badges: [
    { label: '수술 뒤', tone: 'gray' },
    { label: '승압제', tone: 'red', from: T(2, '19:00'), to: T(4, '08:00') },
    { label: '알레르기 없음', tone: 'gray' },
  ],
  outcome: { icuDeath: false, death1y: false, dischargeTo: '외과 병동' },
  labItems: LAB_ITEMS,
  labs: [
    ...panel('L0', T(-1, '15:00'), T(-1, '16:00'), { ALT: 20, AST: 24, ALP: 72, TB: 0.8 }),
    ...panel('L1', T(0, '14:00'), T(0, '15:00'), { ALT: 25, AST: 30, ALP: 70, TB: 0.9, INR: 1.2, ALB: 3.1, LAC: 1.8, CR: 0.9, BUN: 15, PLT: 210, WBC: 11.0, NA: 138, GLU: 150, HCO3: 23, HB: 11.8 }),
    // D1, D2 아침에는 INR, 젖산을 재지 않음
    ...panel('L2', T(1, '05:00'), T(1, '06:00'), { ALT: 28, AST: 33, ALP: 68, TB: 1.0, ALB: 2.9, CR: 0.8, BUN: 14, PLT: 195, WBC: 10.2, NA: 137, GLU: 132, HCO3: 24, HB: 11.2 }),
    ...panel('L3', T(2, '05:00'), T(2, '06:00'), { ALT: 31, AST: 36, ALP: 72, TB: 1.2, ALB: 2.8, CR: 0.9, BUN: 16, PLT: 188, WBC: 12.4, NA: 136, GLU: 128, HCO3: 24, HB: 11.0 }),
    // 쇼크 뒤: 젖산은 혈액가스로 먼저 나옴
    ...panel('L4', T(2, '19:30'), T(2, '20:30'), { INR: 1.5, LAC: 4.2, CR: 1.4, BUN: 22, PLT: 160, WBC: 19.6, NA: 134, GLU: 190, HCO3: 18, HB: 10.6 }, { LAC: T(2, '19:40') }),
    // 첫 이상 (59시간 정상 뒤)
    ...panel('L5', T(3, '00:50'), T(3, '02:00'), { ALT: 96, AST: 140, ALP: 88, TB: 2.0, INR: 1.6, ALB: 2.4, LAC: 3.6, CR: 1.7, BUN: 26, PLT: 132, WBC: 22.0, NA: 134, GLU: 170, HCO3: 19, HB: 10.1, LDH: 520, CK: 210, DB: 1.1, GGT: 70 }),
    // 5배 사건: ALT, AST 만 처방
    ...panel('L6', T(3, '12:00'), T(3, '13:00'), { ALT: 268, AST: 430 }),
    // ALP, 총빌리 재지 않음 → 회복 판정 불가
    ...panel('L7', T(4, '05:00'), T(4, '06:00'), { ALT: 190, AST: 160, INR: 1.4, ALB: 2.5, LAC: 1.6, CR: 1.3, BUN: 24, PLT: 140, WBC: 15.5, NA: 136, GLU: 140, HCO3: 23, HB: 10.0 }),
  ],
  mar,
  vitals: makeVitals({
    from: ICU_IN, to: ICU_OUT, seed: 53,
    segs: [
      { from: ICU_IN, map: [75, 85], hr: [80, 92], rr: [14, 18], spo2: [96, 99], bt: [37.0, 37.6] },
      { from: T(2, '18:00'), map: [58, 64], hr: [118, 128], rr: [24, 28], spo2: [92, 95], bt: [38.6, 39.2] },
      { from: T(2, '20:00'), map: [65, 72], hr: [105, 118], rr: [22, 26], spo2: [93, 96], bt: [38.2, 38.9] },
      { from: T(4, '00:00'), map: [72, 82], hr: [85, 95], rr: [16, 20], spo2: [95, 98], bt: [37.0, 37.6] },
    ],
    fixed: { [T(2, '18:00')]: { map: 58, hr: 125, bt: 39.0 } },
  }),
  micro: [
    { id: 'M1', collected: T(2, '19:30'), specimen: '혈액 (말초)', test: '혈액배양 2회', result: 'Enterococcus faecalis', reported: T(4, '10:00'), prelim: { time: T(3, '10:00'), result: '그람양성 알균' } },
    { id: 'M2', collected: T(3, '10:30'), specimen: '배액', test: '일반 배양', result: '장내세균 혼합', reported: T(5, '08:00') },
  ],
  procs: [
    { id: 'PR1', time: T(0, '08:00'), kind: '처치', name: '저위전방절제술' },
    { id: 'PR2', time: T(2, '21:00'), kind: '영상', name: '복부 CT', note: '판독문 없음' },
    { id: 'PR3', time: T(3, '10:00'), kind: '처치', name: '경피 배액', note: '판독문 없음' },
  ],
  missing: [
    { id: 'miss-early', name: 'D1~D2 INR, 젖산', reason: '수술 뒤 안정기에 측정하지 않음' },
    { id: 'miss-bnp', name: 'NT-proBNP', reason: '측정 기록 없음' },
    { id: 'miss-virus', name: '간염 바이러스 표지자', reason: '측정 기록 없음' },
    { id: 'miss-hapto', name: '합토글로빈', reason: '측정 기록 없음 (용혈 판단 불가)' },
    { id: 'miss-read', name: '영상 판독문', reason: '자료에 시행 기록만 있고 판독문 없음' },
  ],
  events: [
    { id: 'E1', lane: 'hemo', label: '발열 39.0, MAP 58', start: T(2, '18:00'), end: T(2, '20:00'), ref: { tab: 'vital', row: 'map', from: T(2, '18:00'), to: T(2, '20:00') } },
    { id: 'E2', lane: 'drug', label: '노르에피네프린', start: T(2, '19:00'), end: T(4, '08:00'), ref: { tab: 'mar', row: 'NE' } },
    { id: 'E3', lane: 'drug', label: '아세트아미노펜', start: T(0, '14:00'), end: T(2, '20:00'), ref: { tab: 'mar', row: 'APAP' } },
    { id: 'E4', lane: 'drug', label: '피페라실린/타조박탐', start: T(2, '20:00'), end: ICU_OUT, ref: { tab: 'mar', row: 'PIP' } },
    { id: 'E5', lane: 'test', label: '혈액배양', start: T(2, '19:30'), ref: { tab: 'micro', row: 'M1' } },
    { id: 'E6', lane: 'test', label: '복부 CT', start: T(2, '21:00'), ref: { tab: 'proc', row: 'PR2' } },
    { id: 'E7', lane: 'test', label: '경피 배액', start: T(3, '10:00'), ref: { tab: 'proc', row: 'PR3' } },
  ],
}
