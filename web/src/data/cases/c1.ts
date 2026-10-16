// 1. 대량 간세포 손상 (심정지 뒤 저산소성 간염): 회복, ICU 사망. 간 수치는 9일째 회복했지만 뇌손상으로 연명의료를 중단해 ICU 에서 사망.
// 조기 예측: +2h~+9h 정상 구간, +10h 첫 이상과 5배 사건이 함께. 모든 값은 가상.
import type { CaseData, MarOrder } from '../../types'
import { dayOf, doses, every, infusion, LAB_ITEMS, makeVitals, panel } from './kit'

const T = dayOf('2026-03-02')
const ICU_IN = T(0, '10:00')
const ICU_OUT = T(9, '15:10')

const mar: MarOrder[] = [
  { id: 'NE', category: '승압제·심혈관', drug: 'Norepinephrine', dose: 'premix 8 mg/250 mL', route: 'IV', freq: 'mcg/kg/min', start: T(0, '10:00'), infusion: true,
    admins: infusion([[T(0, '10:00'), 0.1], [T(0, '16:00'), 0.3], [T(2, '08:00'), 0.1]], T(3, '12:00')) },
  { id: 'EPI', category: '승압제·심혈관', drug: 'Epinephrine', dose: 'premix 4 mg/250 mL', route: 'IV', freq: 'mcg/kg/min', start: T(0, '10:30'), infusion: true,
    admins: infusion([[T(0, '10:30'), 0.05]], T(1, '14:00')) },
  { id: 'HEP', category: '항혈전', drug: 'Heparin', dose: '지속 주입', route: 'IV', freq: '지속', start: T(0, '10:00'), infusion: true,
    admins: infusion([[T(0, '10:00'), null]], T(3, '10:00')) },
  { id: 'ASA', category: '항혈전', drug: 'Aspirin', dose: '100 mg', route: 'PO', freq: 'qd', start: T(1, '09:00'), admins: doses(every(T(1, '09:00'), T(9, '09:00'), 24)) },
  { id: 'TICA', category: '항혈전', drug: 'Ticagrelor', dose: '90 mg', route: 'PO', freq: 'bid', start: T(0, '21:00'), admins: doses(every(T(0, '21:00'), T(9, '09:00'), 12)) },
  { id: 'PROP', category: '진통·진정', drug: 'Propofol', dose: '지속 주입', route: 'IV', freq: '지속', start: T(0, '10:00'), infusion: true,
    admins: infusion([[T(0, '10:00'), null]], T(3, '08:00')) },
  { id: 'FENT', category: '진통·진정', drug: 'Fentanyl', dose: '지속 주입', route: 'IV', freq: '지속', start: T(0, '10:00'), infusion: true,
    admins: infusion([[T(0, '10:00'), null]]) },
]

export const c1: CaseData = {
  id: 'c1',
  patientId: 'c1',
  admitDate: T(0, '07:20').slice(0, 10),
  admitTime: T(0, '07:20'),
  icuIn: ICU_IN,
  icuOut: ICU_OUT,
  height: 172,
  weight: 78,
  badges: [
    { label: '기계환기', tone: 'blue', from: ICU_IN },
    { label: '목표 체온 유지', tone: 'blue', from: ICU_IN, to: T(2, '10:00') },
    { label: '승압제', tone: 'red', from: ICU_IN, to: T(3, '12:00') },
    { label: '연명의료 중단', tone: 'gray', from: T(9, '12:00') },
    { label: '알레르기 없음', tone: 'gray' },
  ],
  outcome: { icuDeath: true, deathTime: ICU_OUT, death1y: true, dischargeTo: '사망' },
  labItems: LAB_ITEMS,
  labs: [
    ...panel('L0', T(0, '07:40'), T(0, '08:30'), { ALT: 45, AST: 70, ALP: 80, TB: 0.9 }),
    ...panel('L1', T(0, '11:00'), T(0, '12:00'), { ALT: 60, AST: 110, ALP: 82, TB: 1.0, INR: 1.3, ALB: 3.8, LAC: 6.2, CR: 1.2, BUN: 18, PLT: 210, WBC: 14.2, NA: 139, GLU: 260, HCO3: 15, HB: 14.1 }),
    // 첫 이상과 5배 사건이 같은 채혈
    ...panel('L2', T(0, '19:00'), T(0, '20:00'), { ALT: 6760, AST: 8040, ALP: 95, TB: 1.6, INR: 3.0, ALB: 3.4, LAC: 5.5, CR: 1.9, BUN: 24, PLT: 168, WBC: 16.5, NA: 137, GLU: 198, HCO3: 17, HB: 13.2, LDH: 10500, CK: 1450 }),
    ...panel('L3', T(1, '05:00'), T(1, '06:00'), { ALT: 7400, AST: 6900, ALP: 102, TB: 1.8, LDH: 7800, DB: 0.7, GGT: 40 }),
    ...panel('L4', T(2, '05:00'), T(2, '06:00'), { ALT: 5200, AST: 2900, ALP: 105, TB: 1.7, INR: 2.2, ALB: 3.1, LAC: 2.1, CR: 2.8, BUN: 40, PLT: 120, WBC: 12.8, NA: 136, GLU: 150, HCO3: 21, HB: 12.4 }),
    ...panel('L5', T(3, '05:00'), T(3, '06:00'), { ALT: 2900, AST: 1100, ALP: 100, TB: 1.6 }),
    ...panel('L6', T(4, '05:00'), T(4, '06:00'), { ALT: 1600, AST: 420, ALP: 98, TB: 1.5 }),
    ...panel('L7', T(5, '05:00'), T(5, '06:00'), { ALT: 860, AST: 160, ALP: 96, TB: 1.4, INR: 1.4, ALB: 3.0, LAC: 1.2, CR: 1.9, BUN: 36, PLT: 135, WBC: 10.1, NA: 138, GLU: 132, HCO3: 24, HB: 11.9 }),
    ...panel('L8', T(6, '05:00'), T(6, '06:00'), { ALT: 450, AST: 72, ALP: 95, TB: 1.4 }),
    ...panel('L9', T(7, '05:00'), T(7, '06:00'), { ALT: 230, AST: 48, ALP: 94, TB: 1.3 }),
    ...panel('L10', T(8, '05:00'), T(8, '06:00'), { ALT: 118, AST: 38, ALP: 95, TB: 1.3 }),
    // 회복: 세 항목 모두 2배 미만
    ...panel('L11', T(9, '06:00'), T(9, '07:00'), { ALT: 66, AST: 34, ALP: 95, TB: 1.4, INR: 1.1, ALB: 3.0, LAC: 1.0, CR: 1.2, BUN: 22, PLT: 190, WBC: 9.0, NA: 140, GLU: 120, HCO3: 25, HB: 11.6 }),
  ],
  mar,
  vitals: makeVitals({
    from: ICU_IN, to: ICU_OUT, seed: 11,
    segs: [
      { from: ICU_IN, map: [55, 62], hr: [95, 110], rr: [16, 18], spo2: [95, 99], bt: [33.0, 34.0] },
      { from: T(1, '07:00'), map: [66, 75], hr: [85, 100], rr: [16, 18], spo2: [95, 99], bt: [33.5, 34.5] },
      { from: T(2, '00:00'), map: [66, 75], hr: [85, 98], rr: [16, 18], spo2: [95, 99], bt: [35.0, 36.0] },
      { from: T(2, '10:00'), map: [68, 76], hr: [80, 95], rr: [16, 18], spo2: [95, 99], bt: [36.5, 37.4] },
      { from: T(3, '12:00'), map: [70, 80], hr: [78, 92], rr: [16, 18], spo2: [95, 99], bt: [36.5, 37.3] },
      { from: T(9, '12:00'), map: [40, 55], hr: [110, 130], rr: [10, 14], spo2: [80, 90], bt: [36.2, 36.8] },
    ],
    fixed: { [T(0, '14:00')]: { map: 52 } },
  }),
  micro: [
    { id: 'M1', collected: T(0, '11:00'), specimen: '혈액 (말초)', test: '혈액배양 2회', result: '5일 배양 균 자라지 않음', reported: T(5, '11:30') },
  ],
  procs: [
    { id: 'PR1', time: T(0, '08:30'), kind: '처치', name: '관상동맥 중재술 (스텐트)' },
    { id: 'PR2', time: ICU_IN, kind: '처치', name: '목표 체온 유지 시작', note: '33~36도' },
    { id: 'PR3', time: ICU_IN, kind: '처치', name: '기계환기', note: '응급실에서 삽관' },
    { id: 'PR4', time: T(0, '14:00'), kind: '영상', name: '경흉부 심초음파', note: '판독문 없음' },
    { id: 'PR5', time: T(1, '10:00'), kind: '영상', name: '뇌 CT', note: '판독문 없음' },
    { id: 'PR6', time: T(2, '10:00'), kind: '처치', name: '목표 체온 유지 종료' },
    { id: 'PR7', time: T(3, '11:00'), kind: '검사', name: '뇌파', note: '판독문 없음' },
    { id: 'PR8', time: T(9, '12:00'), kind: '처치', name: '연명의료 중단 결정' },
  ],
  missing: [
    { id: 'miss-bnp', name: 'NT-proBNP', reason: '측정 기록 없음' },
    { id: 'miss-virus', name: '간염 바이러스 표지자', reason: '측정 기록 없음' },
    { id: 'miss-hapto', name: '합토글로빈', reason: '측정 기록 없음 (용혈 판단 불가)' },
    { id: 'miss-read', name: '영상·뇌파 판독문', reason: '자료에 시행 기록만 있고 판독문 없음' },
  ],
  events: [
    { id: 'E1', lane: 'hemo', label: 'MAP 65 미만', start: ICU_IN, end: T(1, '06:00'), ref: { tab: 'vital', row: 'map', from: ICU_IN, to: T(1, '06:00') } },
    { id: 'E2', lane: 'drug', label: '노르에피네프린', start: ICU_IN, end: T(3, '12:00'), ref: { tab: 'mar', row: 'NE' } },
    { id: 'E3', lane: 'drug', label: '에피네프린', start: T(0, '10:30'), end: T(1, '14:00'), ref: { tab: 'mar', row: 'EPI' } },
    { id: 'E4', lane: 'test', label: '목표 체온 유지', start: ICU_IN, end: T(2, '10:00'), ref: { tab: 'proc', row: 'PR2' } },
    { id: 'E5', lane: 'test', label: '젖산 6.2', start: T(0, '11:00'), ref: { tab: 'lab', row: 'LAC', col: 'L1-LAC' } },
    { id: 'E6', lane: 'test', label: '뇌 CT', start: T(1, '10:00'), ref: { tab: 'proc', row: 'PR5' } },
    { id: 'E7', lane: 'test', label: '연명의료 중단 결정', start: T(9, '12:00'), ref: { tab: 'proc', row: 'PR8' } },
  ],
}
