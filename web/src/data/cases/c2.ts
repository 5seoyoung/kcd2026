// 2. 쇼크 간 (복막염 수술 뒤 패혈성 쇼크): 미회복, ICU 사망. MAP 28 까지 떨어지고 AST 가 ALT 보다 훨씬 높게 오른 뒤 간 수치가 내려오기 전에 사망.
// 조기 예측: +2h 부터 정상 구간, +16h 첫 이상과 5배 사건이 함께. 모든 값은 가상.
import type { CaseData, MarOrder } from '../../types'
import { dayOf, doses, every, infusion, LAB_ITEMS, makeVitals, panel } from './kit'

const T = dayOf('2026-03-04')
const ICU_IN = T(0, '18:00')
const ICU_OUT = T(2, '11:30')

const mar: MarOrder[] = [
  { id: 'PIP', category: '항생제', drug: 'Piperacillin/Tazobactam', dose: '4.5 g', route: 'IV', freq: 'q6h', start: T(0, '11:30'), admins: doses(every(T(0, '11:30'), T(2, '11:00'), 6)) },
  { id: 'NE', category: '승압제·심혈관', drug: 'Norepinephrine', dose: 'premix 8 mg/250 mL', route: 'IV', freq: 'mcg/kg/min', start: ICU_IN, infusion: true,
    admins: infusion([[ICU_IN, 0.2], [T(1, '07:00'), 0.6]]) },
  { id: 'VP', category: '승압제·심혈관', drug: 'Vasopressin', dose: '0.04 U/min', route: 'IV', freq: '지속', start: T(1, '07:40'), infusion: true,
    admins: infusion([[T(1, '07:40'), null]]) },
  { id: 'EPI', category: '승압제·심혈관', drug: 'Epinephrine', dose: 'premix 4 mg/250 mL', route: 'IV', freq: 'mcg/kg/min', start: T(1, '08:00'), infusion: true,
    admins: infusion([[T(1, '08:00'), 0.1]]) },
  { id: 'HC', category: '기타', drug: 'Hydrocortisone', dose: '50 mg', route: 'IV', freq: 'q6h', start: T(1, '08:00'), admins: doses(every(T(1, '08:00'), T(2, '08:00'), 6)) },
]

export const c2: CaseData = {
  id: 'c2',
  patientId: 'c2',
  admitDate: T(0, '10:30').slice(0, 10),
  admitTime: T(0, '10:30'),
  icuIn: ICU_IN,
  icuOut: ICU_OUT,
  height: 152,
  weight: 48,
  badges: [
    { label: '기계환기', tone: 'blue', from: ICU_IN },
    { label: '승압제', tone: 'red', from: ICU_IN },
    { label: '수술 뒤', tone: 'gray' },
    { label: '연명의료 유보', tone: 'gray', from: T(2, '09:00') },
  ],
  outcome: { icuDeath: true, deathTime: ICU_OUT, death1y: true, dischargeTo: '사망' },
  labItems: LAB_ITEMS,
  labs: [
    ...panel('L0', T(0, '11:00'), T(0, '12:00'), { ALT: 22, AST: 30, ALP: 85, TB: 1.0 }),
    ...panel('L1', T(0, '19:00'), T(0, '20:00'), { ALT: 30, AST: 45, ALP: 90, TB: 1.2, INR: 1.4, ALB: 2.6, LAC: 4.0, CR: 1.4, BUN: 30, PLT: 150, WBC: 2.8, NA: 133, GLU: 180, HCO3: 18, HB: 10.2 }),
    // 첫 이상과 5배 사건이 같은 채혈
    ...panel('L2', T(1, '09:00'), T(1, '10:00'), { ALT: 200, AST: 760, ALP: 110, TB: 2.1, INR: 2.3, ALB: 2.2, LAC: 8.5, CR: 2.4, BUN: 42, PLT: 88, WBC: 1.9, NA: 132, GLU: 70, HCO3: 11, HB: 9.1, LDH: 1650, CK: 280, DB: 1.2, GGT: 55 }),
    ...panel('L3', T(1, '21:00'), T(1, '22:00'), { ALT: 260, AST: 900, ALP: 115, TB: 3.2 }),
    ...panel('L4', T(2, '05:00'), T(2, '06:00'), { ALT: 230, AST: 610, ALP: 120, TB: 4.0, INR: 2.8, ALB: 2.0, LAC: 10.2, CR: 2.9, BUN: 48, PLT: 52, WBC: 2.4, NA: 134, GLU: 95, HCO3: 12, HB: 8.4 }),
  ],
  mar,
  vitals: makeVitals({
    from: ICU_IN, to: ICU_OUT, seed: 23,
    segs: [
      { from: ICU_IN, map: [62, 68], hr: [105, 115], rr: [18, 22], spo2: [93, 97], bt: [38.3, 38.8] },
      { from: T(1, '06:00'), map: [28, 45], hr: [132, 142], rr: [18, 22], spo2: [88, 93], bt: [38.0, 38.6] },
      { from: T(1, '09:00'), map: [55, 60], hr: [125, 135], rr: [18, 22], spo2: [90, 94], bt: [38.0, 38.6] },
      { from: T(2, '00:00'), map: [45, 55], hr: [125, 140], rr: [18, 22], spo2: [88, 93], bt: [37.5, 38.2] },
    ],
    fixed: {
      [T(1, '06:00')]: { map: 62, hr: 124 },
      [T(1, '06:30')]: { map: 45, hr: 132 },
      [T(1, '07:00')]: { map: 34, hr: 140 },
      [T(1, '07:30')]: { map: 28, hr: 142 },
      [T(1, '08:00')]: { map: 41, hr: 138 },
    },
  }),
  micro: [
    { id: 'M1', collected: T(0, '15:00'), specimen: '복수', test: '일반 배양', result: '장내세균 혼합 (E. coli, Bacteroides fragilis)', reported: T(2, '08:00') },
    { id: 'M2', collected: T(0, '19:00'), specimen: '혈액 (말초)', test: '혈액배양 2회', result: 'Escherichia coli', reported: T(3, '09:00'), prelim: { time: T(1, '14:00'), result: '그람음성 막대균 (E. coli 추정)' } },
  ],
  procs: [
    { id: 'PR1', time: T(0, '11:30'), kind: '영상', name: '복부 CT', note: '판독문 없음' },
    { id: 'PR2', time: T(0, '14:00'), kind: '처치', name: '응급 개복술 (하트만 수술)' },
    { id: 'PR3', time: ICU_IN, kind: '처치', name: '기계환기 (수술 뒤)' },
    { id: 'PR4', time: T(0, '18:10'), kind: '처치', name: '중심정맥관 삽입' },
    { id: 'PR5', time: T(0, '18:20'), kind: '처치', name: '동맥관 삽입' },
    { id: 'PR6', time: T(2, '09:00'), kind: '처치', name: '연명의료 유보 결정' },
  ],
  missing: [
    { id: 'miss-bnp', name: 'NT-proBNP', reason: '측정 기록 없음' },
    { id: 'miss-virus', name: '간염 바이러스 표지자', reason: '측정 기록 없음' },
    { id: 'miss-hapto', name: '합토글로빈', reason: '측정 기록 없음 (용혈 판단 불가)' },
    { id: 'miss-read', name: '영상 판독문', reason: '자료에 시행 기록만 있고 판독문 없음' },
  ],
  events: [
    { id: 'E1', lane: 'hemo', label: 'MAP 최저 28', start: T(1, '06:30'), end: T(1, '08:30'), ref: { tab: 'vital', row: 'map', from: T(1, '06:30'), to: T(1, '08:00') } },
    { id: 'E2', lane: 'drug', label: '노르에피네프린', start: ICU_IN, end: ICU_OUT, ref: { tab: 'mar', row: 'NE' } },
    { id: 'E3', lane: 'drug', label: '바소프레신', start: T(1, '07:40'), end: ICU_OUT, ref: { tab: 'mar', row: 'VP' } },
    { id: 'E4', lane: 'drug', label: '에피네프린', start: T(1, '08:00'), end: ICU_OUT, ref: { tab: 'mar', row: 'EPI' } },
    { id: 'E5', lane: 'test', label: '혈액배양', start: T(0, '19:00'), ref: { tab: 'micro', row: 'M2' } },
    { id: 'E6', lane: 'test', label: '젖산 8.5', start: T(1, '09:00'), ref: { tab: 'lab', row: 'LAC', col: 'L2-LAC' } },
    { id: 'E7', lane: 'test', label: '연명의료 유보', start: T(2, '09:00'), ref: { tab: 'proc', row: 'PR6' } },
  ],
}
