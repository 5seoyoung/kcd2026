// 가상 사례 1: 폐렴으로 기계환기 중 심방세동과 쇼크가 온 뒤 ALT 가 오른 사례 (허혈성 손상이 가장 그럴듯함).
// 쇼크 3시간 뒤 2배 사건 (에이전트 2), 다음 날 아침 5배 사건 (에이전트 3). ICU 퇴실 전에 회복하고 생존 퇴실.
// 모든 값은 손으로 만든 가상 값이다. K-MIMIC 원자료가 아니다.
import type { CaseData, LabItem, LabResult, MarOrder, VitalRow } from '../types'
import { hourly, hoursBetween, isAfter } from '../lib/time'

const ICU_IN = '2026-03-08 21:12'
const ICU_OUT = '2026-03-17 11:00'

// 참고치: 간 검사는 임상의 선생님 기준표, 나머지는 흔히 쓰는 값
const labItems: LabItem[] = [
  { code: 'ALT', name: 'ALT (GPT)', unit: 'IU/L', low: 1, high: 40, group: '간 기능', dp: 0 },
  { code: 'AST', name: 'AST (GOT)', unit: 'IU/L', low: 1, high: 40, group: '간 기능', dp: 0 },
  { code: 'ALP', name: 'ALP', unit: 'IU/L', low: 30, high: 115, group: '간 기능', dp: 0 },
  { code: 'TB', name: 'T. Bilirubin', unit: 'mg/dL', low: 0.2, high: 1.2, group: '간 기능', dp: 1 },
  { code: 'DB', name: 'D. Bilirubin', unit: 'mg/dL', low: 0, high: 0.5, group: '간 기능', dp: 1 },
  { code: 'GGT', name: 'r-GT', unit: 'IU/L', low: 8, high: 35, group: '간 기능', dp: 0 },
  { code: 'INR', name: 'PT (INR)', unit: '', low: 0.8, high: 1.2, group: '간 기능', dp: 2 },
  { code: 'ALB', name: 'Albumin', unit: 'g/dL', low: 3.5, high: 5.2, group: '간 기능', dp: 1 },
  { code: 'CK', name: 'CK', unit: 'IU/L', low: 20, high: 200, group: '근육·용혈', dp: 0 },
  { code: 'LDH', name: 'LDH', unit: 'IU/L', low: 100, high: 225, group: '근육·용혈', dp: 0 },
  { code: 'CR', name: 'Creatinine', unit: 'mg/dL', low: 0.7, high: 1.3, group: '신장', dp: 1 },
  { code: 'LAC', name: 'Lactate', unit: 'mmol/L', low: 0.5, high: 2.0, group: '혈액가스', dp: 1 },
  { code: 'WBC', name: 'WBC', unit: '10³/µL', low: 4, high: 10, group: '혈액·염증', dp: 1 },
  { code: 'HB', name: 'Hb', unit: 'g/dL', low: 13, high: 17, group: '혈액·염증', dp: 1 },
  { code: 'PLT', name: 'Platelet', unit: '10³/µL', low: 130, high: 400, group: '혈액·염증', dp: 0 },
  { code: 'CRP', name: 'CRP', unit: 'mg/dL', low: 0, high: 0.5, group: '혈액·염증', dp: 1 },
]

function panel(id: string, charttime: string, storetime: string, values: Record<string, number>, store: Record<string, string> = {}): LabResult[] {
  return Object.entries(values).map(([code, value]) => ({ id: `${id}-${code}`, code, value, charttime, storetime: store[code] ?? storetime }))
}

const labs: LabResult[] = [
  ...panel('P0', '2026-03-08 21:40', '2026-03-08 22:35', { ALT: 28, AST: 35, ALP: 88, TB: 0.8, DB: 0.2, GGT: 30, INR: 1.1, ALB: 3.4, CK: 140, LDH: 210, CR: 1.1, LAC: 2.1, WBC: 15.8, HB: 13.1, PLT: 210, CRP: 18.2 }, { LAC: '2026-03-08 21:50' }),
  ...panel('P1', '2026-03-09 05:00', '2026-03-09 06:10', { ALT: 31, AST: 40, ALP: 92, TB: 0.9, DB: 0.3, GGT: 33, INR: 1.12, ALB: 3.1, CK: 165, LDH: 215, CR: 1.2, LAC: 1.6, WBC: 17.2, HB: 12.4, PLT: 188, CRP: 21.5 }, { LAC: '2026-03-09 05:10' }),
  ...panel('P2', '2026-03-10 05:00', '2026-03-10 06:05', { ALT: 35, AST: 44, ALP: 95, TB: 1.0, DB: 0.3, GGT: 34, INR: 1.15, ALB: 3.0, CK: 180, LDH: 222, CR: 1.2, LAC: 1.4, WBC: 14.1, HB: 12.0, PLT: 172, CRP: 16.3 }, { LAC: '2026-03-10 05:10' }),
  ...panel('P3', '2026-03-10 18:00', '2026-03-10 18:12', { LAC: 5.9 }),
  // 쇼크 뒤 응급 검사: ALT 2배 사건 (에이전트 2 의 t0)
  ...panel('PE', '2026-03-10 20:30', '2026-03-10 21:25', { ALT: 96, AST: 182, ALP: 104, TB: 1.2, DB: 0.4, INR: 1.38, CK: 260, LDH: 520, CR: 1.5, HB: 11.8, PLT: 150 }),
  ...panel('P4', '2026-03-10 22:10', '2026-03-10 22:20', { LAC: 6.8 }),
  ...panel('P5', '2026-03-11 02:00', '2026-03-11 02:10', { LAC: 4.2 }),
  // 아침 정기 검사: ALT 5배 사건 (에이전트 3 의 t0)
  ...panel('P6', '2026-03-11 06:05', '2026-03-11 07:42', { ALT: 412, AST: 689, ALP: 121, TB: 1.6, DB: 0.6, GGT: 48, INR: 1.72, ALB: 2.8, CK: 410, LDH: 1240, CR: 1.9, LAC: 3.1, WBC: 19.6, HB: 11.2, PLT: 121, CRP: 14.8 }, { LAC: '2026-03-11 06:15' }),
  ...panel('P7', '2026-03-11 14:00', '2026-03-11 15:05', { ALT: 538, AST: 812, ALP: 124, TB: 1.8, DB: 0.7, INR: 1.85, CK: 380, LDH: 1410, CR: 2.1, LAC: 2.0 }),
  ...panel('P8', '2026-03-12 05:00', '2026-03-12 06:10', { ALT: 486, AST: 455, ALP: 118, TB: 1.9, DB: 0.8, GGT: 52, INR: 1.52, ALB: 2.7, CK: 300, LDH: 820, CR: 2.0, LAC: 1.5, WBC: 16.2, HB: 10.9, PLT: 108, CRP: 10.1 }),
  ...panel('P9', '2026-03-13 05:00', '2026-03-13 06:05', { ALT: 302, AST: 168, ALP: 112, TB: 1.6, DB: 0.6, INR: 1.31, LDH: 410, CR: 1.6, WBC: 12.8, PLT: 115, CRP: 6.4 }),
  ...panel('P10', '2026-03-14 05:00', '2026-03-14 06:00', { ALT: 176, AST: 79, ALP: 108, TB: 1.3, INR: 1.18, LDH: 280, CR: 1.3, WBC: 11.0, HB: 10.8, PLT: 142, CRP: 4.2 }),
  ...panel('P11', '2026-03-15 05:00', '2026-03-15 06:10', { ALT: 104, AST: 51, ALP: 104, TB: 1.1, INR: 1.12, CR: 1.2 }),
  // ALT 71: 2 x ULN (80) 미만으로 회복
  ...panel('P12', '2026-03-16 05:00', '2026-03-16 06:05', { ALT: 71, AST: 38, ALP: 101, TB: 1.0, INR: 1.1, CR: 1.1, WBC: 9.8, HB: 11.0, PLT: 178, CRP: 2.6 }),
  ...panel('P13', '2026-03-17 05:00', '2026-03-17 06:00', { ALT: 58, AST: 32, ALP: 98, TB: 0.9, INR: 1.08, CR: 1.0 }),
]

function q(times: string[]): MarOrder['admins'] {
  return times.map(time => ({ time, status: 'given' as const }))
}

/** from 부터 to 까지 every 시간마다 */
function every(from: string, to: string, hours: number): string[] {
  return hourly(from, to).filter(t => Math.round(hoursBetween(from, t)) % hours === 0)
}

const mar: MarOrder[] = [
  {
    id: 'PIP', category: '항생제', drug: 'Piperacillin/Tazobactam', dose: '4.5 g', route: 'IV', freq: 'q6h', start: '2026-03-08 22:00',
    admins: [...q(every('2026-03-08 22:00', '2026-03-15 22:00', 6)), { time: '2026-03-16 04:00', status: 'stopped', text: '7일 종료' }],
  },
  {
    id: 'VAN', category: '항생제', drug: 'Vancomycin', dose: '1 g', route: 'IV', freq: 'q12h', start: '2026-03-08 22:30',
    admins: [...q(['2026-03-08 22:30', '2026-03-09 10:30', '2026-03-09 22:30', '2026-03-10 10:30']), { time: '2026-03-10 14:00', status: 'stopped', text: '중단' }],
  },
  {
    id: 'NE', category: '승압제·심혈관', drug: 'Norepinephrine', dose: '지속 주입', route: 'IV', freq: 'mcg/kg/min', start: '2026-03-10 17:40',
    admins: [
      { time: '2026-03-10 17:40', status: 'given', text: '0.08 시작', rate: 0.08 },
      { time: '2026-03-10 18:30', status: 'given', text: '↑0.20', rate: 0.2 },
      { time: '2026-03-10 19:30', status: 'given', text: '↑0.35', rate: 0.35 },
      { time: '2026-03-11 02:00', status: 'given', text: '↓0.20', rate: 0.2 },
      { time: '2026-03-11 05:00', status: 'given', text: '↓0.10', rate: 0.1 },
      { time: '2026-03-11 12:00', status: 'given', text: '↓0.05', rate: 0.05 },
      { time: '2026-03-11 18:00', status: 'stopped', text: '중단', rate: 0 },
    ],
  },
  {
    id: 'VP', category: '승압제·심혈관', drug: 'Vasopressin', dose: '0.03 U/min', route: 'IV', freq: '지속', start: '2026-03-10 20:30',
    admins: [{ time: '2026-03-10 20:30', status: 'given', text: '시작' }, { time: '2026-03-11 04:00', status: 'stopped', text: '중단' }],
  },
  {
    id: 'AMIO', category: '승압제·심혈관', drug: 'Amiodarone', dose: '150 mg → 지속', route: 'IV', freq: 'mg/min', start: '2026-03-10 18:40',
    admins: [
      { time: '2026-03-10 18:40', status: 'given', text: '150 mg 부하' },
      { time: '2026-03-10 18:50', status: 'given', text: '1.0 시작' },
      { time: '2026-03-11 00:50', status: 'given', text: '↓0.5' },
      { time: '2026-03-12 00:50', status: 'stopped', text: '중단' },
    ],
  },
  {
    id: 'FLUID', category: '승압제·심혈관', drug: '생리식염수 볼루스', dose: '500 mL', route: 'IV', freq: '1회', start: '2026-03-10 17:10',
    admins: q(['2026-03-10 17:10', '2026-03-10 17:35']),
  },
  {
    id: 'FURO', category: '승압제·심혈관', drug: 'Furosemide', dose: '20 mg', route: 'IV', freq: 'qd', start: '2026-03-13 09:00',
    admins: q(['2026-03-13 09:00', '2026-03-14 09:00', '2026-03-15 09:00']),
  },
  {
    id: 'FENT', category: '진통·진정', drug: 'Fentanyl', dose: '50 mcg/h', route: 'IV', freq: '지속', start: '2026-03-08 21:30',
    admins: [
      { time: '2026-03-08 21:30', status: 'given', text: '시작' },
      { time: '2026-03-13 20:00', status: 'given', text: '↓25' },
      { time: '2026-03-14 08:00', status: 'stopped', text: '중단' },
    ],
  },
  {
    id: 'APAP', category: '진통·진정', drug: 'Acetaminophen', dose: '650 mg', route: 'IV', freq: 'PRN (발열)', start: '2026-03-09 14:00',
    admins: q(['2026-03-09 14:00', '2026-03-10 02:00']),
  },
  {
    id: 'ESO', category: '기타', drug: 'Esomeprazole', dose: '40 mg', route: 'IV', freq: 'qd', start: '2026-03-09 09:00',
    admins: q(every('2026-03-09 09:00', '2026-03-17 09:00', 24)),
  },
  {
    id: 'HEP', category: '기타', drug: 'Heparin', dose: '5,000 U', route: 'SC', freq: 'q12h', start: '2026-03-09 09:00',
    admins: q(every('2026-03-09 09:00', '2026-03-17 09:00', 12)),
  },
]

// 시간별 활력징후: 기본 흐름에 작은 흔들림을 넣고, 쇼크 구간은 직접 지정
function makeVitals(): VitalRow[] {
  let seed = 7
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }
  const jitter = (n: number) => Math.round((rand() - 0.5) * 2 * n)

  const fixed: Record<string, Partial<VitalRow>> = {
    '2026-03-10 16:00': { map: 70, hr: 128, spo2: 93, cvp: 11 },
    '2026-03-10 17:00': { map: 52, hr: 152, spo2: 86, cvp: 13 },
    '2026-03-10 18:00': { map: 56, hr: 146, spo2: 88, cvp: 14 },
    '2026-03-10 19:00': { map: 61, hr: 138, spo2: 91, cvp: 15 },
    '2026-03-10 20:00': { map: 66, hr: 124, spo2: 93, cvp: 15 },
    '2026-03-10 21:00': { map: 68, hr: 116, spo2: 94, cvp: 15 },
    '2026-03-10 22:00': { map: 71, hr: 110, spo2: 95, cvp: 15 },
  }

  const rows: VitalRow[] = []
  for (const time of hourly('2026-03-08 22:00', ICU_OUT)) {
    const h = hoursBetween(ICU_IN, time)
    const afterShock = isAfter(time, '2026-03-10 22:00')
    // 노르에피네프린을 끊은 뒤 (03-11 18:00) 부터 회복기
    const recovering = isAfter(time, '2026-03-11 18:00')
    const extubated = !isAfter('2026-03-14 10:00', time)
    let map = (recovering ? 80 : afterShock ? 74 : 77) + jitter(3)
    let hr = afterShock ? Math.max(84, Math.round(106 - (h - 49) * 0.4)) + jitter(3) : Math.round(98 - h * 0.15) + jitter(4)
    let spo2 = (extubated ? 95 : recovering ? 96 : 95) + jitter(1)
    let cvp: number | undefined = h < 2 ? undefined : (afterShock ? Math.max(recovering ? 7 : 10, Math.round(14 - (h - 49) * 0.12)) : 9) + jitter(1)
    const bt = Math.round((h < 20 ? 38.4 - h * 0.05 : recovering ? 36.9 : 37.3 + (afterShock ? 0.3 : 0)) * 10 + jitter(1)) / 10
    const rr = (extubated ? 20 : 18) + Math.abs(jitter(2))
    const f = fixed[time]
    if (f) {
      map = f.map ?? map
      hr = f.hr ?? hr
      spo2 = f.spo2 ?? spo2
      cvp = f.cvp ?? cvp
    }
    // 중심정맥관 제거 뒤에는 CVP 없음
    if (!isAfter('2026-03-16 14:00', time)) cvp = undefined
    // 맥압을 3의 배수로 두어 MAP = (SBP + 2 x DBP) / 3 이 정수로 맞게 함
    const pp = f ? 36 : 3 * (14 + Math.floor(rand() * 3))
    rows.push({ time, sbp: map + (2 * pp) / 3, dbp: map - pp / 3, map, hr, rr, bt, spo2: Math.min(100, spo2), cvp })
  }
  return rows
}

export const case01: CaseData = {
  id: 'c01',
  patientId: 'p07',
  admitDate: '2026-03-08',
  icuIn: ICU_IN,
  icuOut: ICU_OUT,
  height: 168,
  weight: 64,
  badges: [
    { label: '기계환기', tone: 'blue', from: '2026-03-08 21:35', to: '2026-03-14 10:00' },
    { label: '비강 캐뉼라', tone: 'blue', from: '2026-03-14 10:00' },
    { label: '승압제', tone: 'red', from: '2026-03-10 17:40', to: '2026-03-11 18:00' },
    { label: '알레르기 없음', tone: 'gray' },
  ],
  outcome: { icuDeath: false, death1y: false, dischargeTo: '호흡기내과 병동' },
  labItems,
  labs,
  mar,
  vitals: makeVitals(),
  micro: [
    { id: 'M1', collected: '2026-03-08 22:10', specimen: '혈액 (말초)', test: '혈액배양', result: '5일 배양 균 자라지 않음', reported: '2026-03-13 22:30' },
    { id: 'M2', collected: '2026-03-08 22:12', specimen: '혈액 (말초)', test: '혈액배양', result: '5일 배양 균 자라지 않음', reported: '2026-03-13 22:30' },
    { id: 'M3', collected: '2026-03-08 22:30', specimen: '기관 흡인물', test: '일반 배양', result: 'Streptococcus pneumoniae, penicillin 감수성', reported: '2026-03-10 14:00', prelim: { time: '2026-03-09 15:00', result: '그람 양성 쌍구균 다수' } },
    { id: 'M4', collected: '2026-03-08 22:30', specimen: '소변', test: '폐렴구균 소변 항원', result: '양성', reported: '2026-03-09 01:10' },
    { id: 'M5', collected: '2026-03-08 22:40', specimen: '소변', test: '일반 배양', result: '균 자라지 않음', reported: '2026-03-10 09:00' },
    { id: 'M6', collected: '2026-03-10 19:00', specimen: '혈액 (말초)', test: '혈액배양 2회', result: '5일 배양 균 자라지 않음', reported: '2026-03-15 19:30' },
  ],
  procs: [
    { id: 'PR1', time: '2026-03-08 21:20', kind: '처치', name: '기관삽관', note: '7.5 mm' },
    { id: 'PR2', time: '2026-03-08 21:35', kind: '처치', name: '기계환기 시작' },
    { id: 'PR3', time: '2026-03-08 21:50', kind: '영상', name: '흉부 X선 (이동식)', note: '판독문 없음' },
    { id: 'PR4', time: '2026-03-08 22:05', kind: '처치', name: '동맥관 삽입', note: '좌측 요골' },
    { id: 'PR5', time: '2026-03-08 23:10', kind: '처치', name: '중심정맥관 삽입', note: '우측 내경정맥' },
    { id: 'PR6', time: '2026-03-09 06:00', kind: '영상', name: '흉부 X선 (이동식)', note: '판독문 없음' },
    { id: 'PR7', time: '2026-03-10 16:40', kind: '검사', name: '12유도 심전도', note: '판독문 없음' },
    { id: 'PR8', time: '2026-03-10 18:10', kind: '영상', name: '흉부 X선 (이동식)', note: '판독문 없음' },
    { id: 'PR9', time: '2026-03-11 08:30', kind: '영상', name: '복부 초음파', note: '판독문 없음' },
    { id: 'PR10', time: '2026-03-12 06:00', kind: '영상', name: '흉부 X선 (이동식)', note: '판독문 없음' },
    { id: 'PR11', time: '2026-03-14 10:00', kind: '처치', name: '발관' },
    { id: 'PR12', time: '2026-03-14 11:20', kind: '영상', name: '흉부 X선 (이동식)', note: '판독문 없음' },
    { id: 'PR13', time: '2026-03-16 14:00', kind: '처치', name: '중심정맥관 제거' },
  ],
  missing: [
    { id: 'miss-echo', name: '심초음파', reason: '시행 기록 없음' },
    { id: 'miss-read', name: '영상 판독문', reason: '자료에 시행 기록만 있고 판독문 없음' },
    { id: 'miss-bnp', name: 'BNP', reason: '측정 기록 없음' },
    { id: 'miss-smear', name: '말초혈액 도말, haptoglobin', reason: '측정 기록 없음 (용혈 판단 불가)' },
    { id: 'miss-virus', name: '간염 바이러스 표지자', reason: '측정 기록 없음' },
  ],
  events: [
    { id: 'E1', lane: 'test', label: '기관삽관', start: '2026-03-08 21:20', ref: { tab: 'proc', row: 'PR1' } },
    { id: 'E2', lane: 'drug', label: '피페라실린/타조박탐', start: '2026-03-08 22:00', end: '2026-03-16 04:00', ref: { tab: 'mar', row: 'PIP' } },
    { id: 'E3', lane: 'hemo', label: '심방세동', start: '2026-03-10 16:30', ref: { tab: 'vital', row: 'hr', from: '2026-03-10 16:00', to: '2026-03-10 19:00' } },
    { id: 'E4', lane: 'hemo', label: 'MAP 65 미만', start: '2026-03-10 17:00', end: '2026-03-10 20:00', ref: { tab: 'vital', row: 'map', from: '2026-03-10 17:00', to: '2026-03-10 19:00' } },
    { id: 'E5', lane: 'drug', label: '노르에피네프린', start: '2026-03-10 17:40', end: '2026-03-11 18:00', ref: { tab: 'mar', row: 'NE' } },
    { id: 'E6', lane: 'drug', label: '아미오다론', start: '2026-03-10 18:40', end: '2026-03-12 00:50', ref: { tab: 'mar', row: 'AMIO' } },
    { id: 'E7', lane: 'test', label: '혈액배양', start: '2026-03-10 19:00', ref: { tab: 'micro', row: 'M6' } },
    { id: 'E8', lane: 'test', label: '젖산 6.8', start: '2026-03-10 22:10', ref: { tab: 'lab', row: 'LAC', col: 'P4-LAC' } },
    { id: 'E9', lane: 'test', label: '복부 초음파', start: '2026-03-11 08:30', ref: { tab: 'proc', row: 'PR9' } },
    { id: 'E10', lane: 'test', label: '발관', start: '2026-03-14 10:00', ref: { tab: 'proc', row: 'PR11' } },
    { id: 'E11', lane: 'drug', label: '푸로세미드', start: '2026-03-13 09:00', end: '2026-03-15 09:00', ref: { tab: 'mar', row: 'FURO' } },
  ],
}
