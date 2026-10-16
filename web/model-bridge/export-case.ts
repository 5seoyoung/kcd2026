// 가상 사례를 모델 브리지 (run_models.py) 가 읽는 JSON 으로 내보낸다.
// 검사 이름은 모델 패키지의 이름 (TBIL, CREAT 등) 으로, 시각은 공개 시각 (max(채혈, 보고)) 을 함께 넣는다.
// 실행: npm run models (이 파일을 묶어 실행한 뒤 run_models.py 를 부른다)
import { mkdirSync, writeFileSync } from 'node:fs'
import { case01 } from '../src/data/case01'
import { patients } from '../src/data/patients'
import { publicAt } from '../src/lib/events'

/** 화면 검사 코드 → 모델 패키지 검사 이름 */
const ANALYTE: Record<string, string> = {
  ALT: 'ALT', AST: 'AST', ALP: 'ALP', TB: 'TBIL', DB: 'DBIL', GGT: 'GGT', INR: 'INR', ALB: 'ALBUMIN', CK: 'CK', LDH: 'LDH',
  CR: 'CREAT', BUN: 'BUN', NA: 'SODIUM', GLU: 'GLUCOSE', HCO3: 'BICARB', LAC: 'LACTATE', WBC: 'WBC', HB: 'HEMOGLOBIN',
  PLT: 'PLATELET', CRP: 'CRP',
}
/** 지속 주입으로 기록할 약 (MIMIC 의 inputevents 에 해당). 나머지 투약은 투여 기록 (emar) */
const INFUSION = new Set(['NE', 'VP', 'FENT'])

const out = process.argv[2] ?? 'model-bridge/cases/c01.json'
const cs = case01
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
        // 아미오다론은 부하 용량만 투여 기록, 그 뒤 지속 주입
        kind: INFUSION.has(o.id) || (o.id === 'AMIO' && !/부하/.test(a.text ?? '')) ? 'infusion_record' : 'emar_record',
        value: a.status === 'given' ? 'Administered' : 'Not Given',
        time: a.time,
      })),
  ),
}

mkdirSync(out.replace(/\/[^/]+$/, ''), { recursive: true })
writeFileSync(out, JSON.stringify(doc, null, 1))
console.log(`${out}: 검사 ${doc.labs.length}, 활력징후 ${doc.vitals.length}, 투약 ${doc.meds.length}`)
