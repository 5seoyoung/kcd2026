// 가상 사례를 모델 브리지 (run_models.py) 가 읽는 JSON 으로 내보낸다 (사례마다 파일 하나).
// 검사 이름은 모델 패키지의 이름 (TBIL, CREAT 등) 으로, 시각은 공개 시각 (max(채혈, 보고)) 을 함께 넣는다.
// 실행: npm run models (이 파일을 묶어 실행한 뒤 run_models.py 를 부른다)
import { mkdirSync, writeFileSync } from 'node:fs'
import type { CaseData } from '../src/types'
import { CASES } from '../src/data/cases'
import { patients } from '../src/data/patients'
import { publicAt } from '../src/lib/events'

/** 화면 검사 코드 → 모델 패키지 검사 이름 */
const ANALYTE: Record<string, string> = {
  ALT: 'ALT', AST: 'AST', ALP: 'ALP', TB: 'TBIL', DB: 'DBIL', GGT: 'GGT', INR: 'INR', ALB: 'ALBUMIN', CK: 'CK', LDH: 'LDH',
  CR: 'CREAT', BUN: 'BUN', NA: 'SODIUM', GLU: 'GLUCOSE', HCO3: 'BICARB', LAC: 'LACTATE', WBC: 'WBC', HB: 'HEMOGLOBIN',
  PLT: 'PLATELET', CRP: 'CRP', BNP: 'NTPROBNP', HAPTO: 'HAPTO',
}

const dir = process.argv[2] ?? 'model-bridge/cases'
mkdirSync(dir, { recursive: true })

function exportCase(cs: CaseData) {
const p = patients.find(x => x.id === cs.patientId)!
const item = (code: string) => cs.labItems.find(i => i.code === code)!

const doc = {
  caseId: cs.id,
  age: p.age,
  sex: p.sex,
  admitTime: cs.admitTime,
  icuIn: cs.icuIn,
  icuOut: cs.icuOut,
  icuDeath: cs.outcome.icuDeath,
  // 이전 입원 (과거력): 모델 패키지의 history_flags 가 이번 ICU 입실 전에 퇴원한 입원의 코드만 씀
  history: (cs.history ?? []).map(h => ({ admitted: h.admitted, discharged: h.discharged, codes: h.codes.map(c => ({ code: c.code, version: c.version })) })),
  // 간염 혈청 검사 (모델 패키지의 serology_record)
  serology: (cs.serology ?? []).map(s => ({ label: s.label, value: s.value, time: s.time, available_at: s.reported })),
  // 연결부가 모델에 넘기는 검사 (이름 대응표에 있는 것)
  connected: [...new Set(Object.values(ANALYTE))].sort(),
  labs: cs.labs.map(r => ({
    id: r.id,
    code: r.code,
    analyte: ANALYTE[r.code] ?? r.code,
    value: r.value,
    uln: item(r.code).high ?? null,
    charttime: r.charttime,
    available_at: publicAt(r),
  })),
  vitals: cs.vitals.map(v => ({ time: v.time, MAP: v.map, HR: v.hr, RR: v.rr, SPO2: v.spo2, TEMP_C: v.bt })),
  meds: cs.mar.flatMap(o =>
    o.admins
      .filter(a => a.status !== 'stopped')
      .map(a => ({
        order: o.id,
        drug: o.drug,
        // 지속 주입은 주입 기록 (MIMIC inputevents), 나머지는 투여 기록 (emar)
        kind: o.infusion ? 'infusion_record' : 'emar_record',
        value: a.status === 'given' ? 'Administered' : 'Not Given',
        time: a.time,
      })),
  ),
}

const out = `${dir}/${cs.id}.json`
writeFileSync(out, JSON.stringify(doc, null, 1))
console.log(`${out}: 검사 ${doc.labs.length}, 활력징후 ${doc.vitals.length}, 투약 ${doc.meds.length}, 이전 입원 ${doc.history.length}`)
}

CASES.forEach(exportCase)
