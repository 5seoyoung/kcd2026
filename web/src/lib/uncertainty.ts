// 에이전트 불확실성 표시 (불확실성 구현 명세 10/17). 모델은 다시 학습하지 않고, 모델 패키지 출력 (model-bridge)
// 과 사례 자료 위에서 미리 고정한 규칙으로 계산한다. 기준값은 모두 이 파일에 있다.
import type { CaseData, Confidence, ConfReason, EndState, EvidenceItem, EvidenceStatus, LiverEvent } from '../types'
import { EVENT_CODES, publicAt, sameDraw, uln } from './events'
import { isAfter, toMs } from './time'
import { pct } from './ui'
import { bi, pick, tr, type Bi } from './i18n'

/** 규칙 1: 핵심 입력 (간 검사 4개, INR, 젖산, 크레아티닌) 중 이만큼 이상이 24시간 안 측정 없으면 확신 낮음 */
export const CORE_MISSING_MIN = 2
/**
 * 규칙 4: 구간 (빠진 핵심 입력 대체 + 잰 핵심 입력 흔들기) 폭 기준.
 * MIMIC 개발 집단 표본 (환자마다 정상 구간 한 시각, 16,915시각) 의 폭 상위 25% (10/17 로컬 MIMIC, uncertainty/stage1.py)
 */
export const WIDTH_LIMIT = 0.0113
/** 규칙 5: 높은 배수 확률이 낮은 배수 확률보다 이만큼 넘게 크면 사다리 뒤집힘 (0: 조금이라도 크면) */
export const LADDER_TOL = 0
/**
 * 예후 경로 집합 (기획안 4-5, split conformal LAC): 확률이 이 값 이상인 경로. MIMIC 평가 집단 반에서 실제 경로를 90% 담도록 정함
 * (나머지 반 1,005건에서 88.7% 를 담고 평균 2.05개. 10/17 로컬 MIMIC, uncertainty/stage3.py)
 */
export const PATH_MIN_PROB = 0.0786
/** MIMIC 확인 반에서 경로 집합이 실제 경로를 담은 비율 */
export const PATH_COVERAGE_MIMIC = 0.887
/**
 * 궤적 띠 넓힘 (기획안 4-5, CQR): 검사와 예측 시점마다 10~90% 띠를 아래위로 2^w 배 넓힘 (log2 ULN 배수 기준).
 * MIMIC 평가 집단 반에서 실제 값을 80% 담도록 정함 (원래 포함률 70.5~77.1% → 나머지 반에서 77.5~82.3%. 10/17 로컬 MIMIC)
 */
export const TRAJ_WIDEN: Record<string, Record<number, number>> = {
  ALT: { 6: 0.0567, 12: 0.0745, 18: 0.0686, 24: 0.1189 },
  AST: { 6: 0.0497, 12: 0.0934, 18: 0.0859, 24: 0.151 },
  ALP: { 6: 0.0335, 12: 0.0475, 18: 0.0542, 24: 0.0755 },
  TBIL: { 6: 0.0188, 12: 0.0399, 18: 0.0504, 24: 0.0783 },
}
/** 검사 오차 범위 (사건 경계값, 판정 취약, 구간의 잰 값 흔들기). 임상의 선생님 확인 전 기본값. model-bridge 의 ERR 와 같게 */
export const ERROR_RANGE = 0.1

/** 모델 패키지 변수 이름 → 화면 이름과 표시 자릿수. ratio 는 ×ULN */
const VAR: Record<string, { name: Bi | string; dp: number; ratio?: boolean }> = {
  ALT: { name: 'ALT', dp: 2, ratio: true }, AST: { name: 'AST', dp: 2, ratio: true }, ALP: { name: 'ALP', dp: 2, ratio: true },
  TBIL: { name: bi('총빌리', 'T. bili'), dp: 2, ratio: true }, INR: { name: 'INR', dp: 1 }, ALBUMIN: { name: bi('알부민', 'Albumin'), dp: 1 },
  LACTATE: { name: bi('젖산', 'Lactate'), dp: 1 }, CREAT: { name: bi('크레아티닌', 'Creatinine'), dp: 1 }, BUN: { name: 'BUN', dp: 0 },
  NTPROBNP: { name: 'NT-proBNP', dp: 0 }, age: { name: bi('나이', 'Age'), dp: 0 }, PLATELET: { name: bi('혈소판', 'Platelets'), dp: 0 },
  WBC: { name: bi('백혈구', 'WBC'), dp: 1 }, SODIUM: { name: bi('나트륨', 'Sodium'), dp: 0 }, GLUCOSE: { name: bi('혈당', 'Glucose'), dp: 0 },
  BICARB: { name: bi('중탄산', 'Bicarbonate'), dp: 0 }, HEMOGLOBIN: { name: bi('혈색소', 'Hemoglobin'), dp: 1 }, MAP: { name: 'MAP', dp: 0 },
  HR: { name: bi('심박', 'Heart rate'), dp: 0 }, RR: { name: bi('호흡수', 'Respiratory rate'), dp: 0 }, SPO2: { name: 'SpO2', dp: 0 },
  TEMP_C: { name: bi('체온', 'Temperature'), dp: 1 },
  DBIL: { name: bi('직접빌리', 'D. bili'), dp: 1 }, GGT: { name: 'GGT', dp: 0 }, CK: { name: 'CK', dp: 0 }, LDH: { name: 'LDH', dp: 0 },
  HAPTO: { name: bi('합토글로빈', 'Haptoglobin'), dp: 0 }, HEMOGLOBIN_DROP: { name: bi('48시간 혈색소 감소', '48-h hemoglobin drop'), dp: 1 },
}
export const varName = (v: string) => (VAR[v] ? pick(VAR[v].name) : v)
const num = (x: number, dp: number) => String(+x.toFixed(dp))
/** 값 표시. ×ULN 변수는 배수로 */
export const fmtVar = (v: string, x: number) => (VAR[v]?.ratio ? `${num(x, 2)}×ULN` : num(x, VAR[v]?.dp ?? 1))
const names = (vs: string[]) => vs.map(varName).join(', ')
const pp = (x: number) => `${(x * 100).toFixed(1)}${tr('%p', ' pp')}`

const GUARD_REASON: Record<string, Bi> = {
  range: bi('생리적 범위 밖', 'outside physiological range'), jump: bi('48시간 안 급변', 'abrupt change within 48 h'),
  jump_unconfirmed: bi('급변 (짝 효소는 그대로)', 'abrupt change (partner enzyme unchanged)'),
  discordant_partner: bi('짝 효소와 맞지 않음', 'discordant with partner enzyme'),
}

/** 발생 예측 한 시각의 모델 연결부 출력 (확신 규칙 입력) */
export interface A1Uncertainty {
  ladder: Record<string, number>
  missing_core: string[]
  interval: [number, number] | null
  out_of_range: { var: string; value: number }[]
  guard: { var: string; value: number; at: string | null; reason: string }[]
}

/** 규칙 5: 사다리에서 높은 배수 확률이 바로 아래 배수보다 큰 쌍 */
export function ladderInversions(ladder: { k: number; p: number }[]): [{ k: number; p: number }, { k: number; p: number }][] {
  const out: [{ k: number; p: number }, { k: number; p: number }][] = []
  for (let i = 1; i < ladder.length; i++) if (ladder[i].p - ladder[i - 1].p > LADDER_TOL) out.push([ladder[i], ladder[i - 1]])
  return out
}

/** 발생 예측 확신: 규칙 1~5 중 하나라도 해당하면 낮음 */
export function a1Confidence(u: A1Uncertainty, ref: Record<string, [number, number]>): Confidence {
  const reasons: ConfReason[] = []
  if (u.missing_core.length >= CORE_MISSING_MIN) {
    reasons.push({ rule: 1, text: tr(`${names(u.missing_core)} 24시간 안 측정 없음`, `${names(u.missing_core)} not measured within 24 h`) })
  }
  if (u.out_of_range.length) {
    const sep = tr('~', '–')
    const r = u.out_of_range.map(o => `${varName(o.var)} ${fmtVar(o.var, o.value)}${ref[o.var] ? ` (${fmtVar(o.var, ref[o.var][0])}${sep}${fmtVar(o.var, ref[o.var][1])})` : ''}`)
    reasons.push({ rule: 2, text: tr(`${r.join(', ')} (괄호는 개발 집단 5~95%)`, `${r.join(', ')} (in parentheses: development cohort 5–95%)`) })
  }
  if (u.guard.length) {
    reasons.push({ rule: 3, text: `${u.guard.map(g => `${varName(g.var)} ${g.value}${g.at ? ` (${g.at.slice(5)})` : ''} ${GUARD_REASON[g.reason] ? pick(GUARD_REASON[g.reason]) : g.reason}`).join(', ')}` })
  }
  if (u.interval && u.interval[1] - u.interval[0] >= WIDTH_LIMIT) {
    const w = pp(u.interval[1] - u.interval[0])
    reasons.push({
      rule: 4,
      text: tr(`구간 폭 ${w}, 기준 ${pp(WIDTH_LIMIT)} (MIMIC 개발 표본 상위 25%) 이상`,
        `Interval width ${w}, at or above the ${pp(WIDTH_LIMIT)} threshold (top 25% of the MIMIC development sample)`),
    })
  }
  const lad = Object.entries(u.ladder).map(([k, p]) => ({ k: +k, p })).sort((a, b) => a.k - b.k)
  const inv = ladderInversions(lad)
  const x = tr('배', '×')
  if (inv.length) reasons.push({ rule: 5, text: `${inv.map(([hi, lo]) => `${hi.k}${x} ${pct(hi.p)} > ${lo.k}${x} ${pct(lo.p)}`).join(', ')}` })
  return { level: reasons.length ? '낮음' : '높음', reasons }
}

/** 예후 경로 집합 (conformal LAC): 확률이 PATH_MIN_PROB 이상인 경로, 확률 큰 순 */
export function pathSet(probs: Record<EndState, number>): { keys: EndState[]; mass: number } {
  const keys = (Object.keys(probs) as EndState[]).filter(k => probs[k] >= PATH_MIN_PROB).sort((a, b) => probs[b] - probs[a])
  return { keys, mass: keys.reduce((s, k) => s + probs[k], 0) }
}

/** 규칙 6: 예후 경로 집합이 둘 이상이면 확신 낮음 */
export function a2Confidence(set: { keys: EndState[] }): Confidence {
  return set.keys.length >= 2
    ? { level: '낮음', reasons: [{ rule: 6, text: tr(`가능성이 높은 경로가 ${set.keys.length}개`, `${set.keys.length} likely paths`) }] }
    : { level: '높음', reasons: [] }
}

/** 알림에 쓰는 검사 이름 (핵심 입력은 우리말 약칭) */
const LAB_LABEL: Record<string, Bi | string> = {
  TB: bi('총빌리', 'T. bili'), DB: bi('직접빌리', 'D. bili'), INR: 'INR', LAC: bi('젖산', 'Lactate'), CR: bi('크레아티닌', 'Creatinine'),
  ALB: bi('알부민', 'Albumin'), HB: bi('혈색소', 'Hemoglobin'), PLT: bi('혈소판', 'Platelets'),
  WBC: bi('백혈구', 'WBC'), NA: bi('나트륨', 'Sodium'), GLU: bi('혈당', 'Glucose'), HCO3: bi('중탄산', 'Bicarbonate'), GGT: 'GGT',
}
export const labLabel = (cs: CaseData, code: string) =>
  LAB_LABEL[code] ? pick(LAB_LABEL[code]) : (cs.labItems.find(i => i.code === code)?.name.split(' (')[0] ?? code)
/** 핵심 입력 (규칙 1) 을 앞에 */
const CORE_FIRST = ['ALT', 'AST', 'ALP', 'TB', 'INR', 'LAC', 'CR']

/** 보고 대기: 채혈 시각 ≤ 지금 < 보고 (공개) 시각인 검사. 채혈 시각별로 묶고, 핵심 입력을 앞에 둠 */
export function pendingAt(cs: CaseData, t: string): { drawn: string; codes: string[] }[] {
  const order = (c: string) => (CORE_FIRST.includes(c) ? CORE_FIRST.indexOf(c) : 100 + cs.labItems.findIndex(i => i.code === c))
  const wait = cs.labs.filter(r => !isAfter(r.charttime, t) && isAfter(publicAt(r), t))
  const by = new Map<string, string[]>()
  for (const r of wait) by.set(r.charttime, [...(by.get(r.charttime) ?? []), r.code])
  return [...by.entries()]
    .sort((a, b) => toMs(a[0]) - toMs(b[0]))
    .map(([drawn, codes]) => ({ drawn, codes: [...new Set(codes)].sort((a, b) => order(a) - order(b)) }))
}

/**
 * 사건 경계값: 사건 값이 기준 (k x ULN) 의 검사 오차 범위 안. 같은 채혈에서 기준을 넉넉히 넘은 다른 사건 항목이 있으면 경계값 아님.
 */
export function borderlineOf(cs: CaseData, ev: LiverEvent): { code: string; x: number; k: number } | null {
  const over = EVENT_CODES.map(c => sameDraw(cs, ev, c)).filter(r => !!r && r.value >= ev.k * uln(cs, r.code))
  const near = over.every(r => r!.value <= ev.k * uln(cs, r!.code) * (1 + ERROR_RANGE) + 1e-9)
  return over.length && near ? { code: ev.result.code, x: ev.result.value / uln(cs, ev.result.code), k: ev.k } : null
}

// ───────── 원인: 근거 자료 완성도 ─────────

/** 원인 규칙이 읽은 입력 (모델 연결부 a3.inputs) */
export interface A3Inputs {
  labs: Record<string, { value: number; ratio: number | null; at: string }>
  vitals: string[]
  records: string[]
  hb_drop: number | null
  serology: number
  pn_days: number | null
}
/** 연결부가 모델에 넘기는 자료 (meta.connected) */
export interface Connected {
  labs: string[]
  history: boolean
  serology: boolean
  infusion: boolean
  emar: boolean
  imaging_report: boolean
}
interface Ctx {
  inp: A3Inputs
  con: Connected
  /** 이전 입원 진단이 있는지 (없으면 과거력 판단 불가) */
  histKnown: boolean
  pressor: boolean
  drugs: number
}
type Get = (c: Ctx) => { status: EvidenceStatus; detail?: string }

const shown = (c: Ctx, a: string) => {
  const l = c.inp.labs[a]
  return `${varName(a)} ${l.ratio !== null && VAR[a]?.ratio ? fmtVar(a, l.ratio) : num(l.value, VAR[a]?.dp ?? 1)}`
}
/** 검사 하나 이상 (여럿이면 배수가 가장 큰 것을 보여 줌) */
const lab = (...as: string[]): Get => c => {
  const got = as.filter(a => c.inp.labs[a])
  if (!got.length) return { status: as.some(a => c.con.labs.includes(a)) ? '측정 없음' : '연결 안 됨' }
  const top = got.reduce((a, b) => ((c.inp.labs[b].ratio ?? 0) > (c.inp.labs[a].ratio ?? 0) ? b : a))
  return { status: '있음', detail: shown(c, top) }
}
const vital = (v: string): Get => c => (c.inp.vitals.includes(v) ? { status: '있음' } : { status: '측정 없음', detail: tr('48시간 안 기록 없음', 'No record within 48 h') })
const either = (a: Get, b: Get): Get => c => {
  const x = a(c)
  return x.status === '있음' ? x : b(c)
}
const history: Get = c =>
  !c.con.history ? { status: '연결 안 됨' } : c.histKnown ? { status: '있음' } : { status: '이전 입원 없음', detail: tr('과거력 판단 불가', 'History not assessable') }
const pressor: Get = c =>
  c.con.infusion
    ? { status: '있음', detail: c.pressor ? tr('48시간 안 주입 있음', 'Infused within 48 h') : tr('48시간 안 주입 없음', 'No infusion within 48 h') }
    : { status: '연결 안 됨' }

/** 원인별 필요한 근거 (명세 표 그대로). 근거 자료 완성도 = 있음 / 전체 */
const NEED: Record<number, { name: Bi | string; get: Get }[]> = {
  1: [
    { name: bi('AST 또는 ALT 최고 배수', 'Peak AST or ALT (×ULN)'), get: lab('AST', 'ALT') },
    { name: 'MAP', get: vital('MAP') },
    { name: bi('젖산', 'Lactate'), get: lab('LACTATE') },
    { name: bi('승압제 기록', 'Vasopressor record'), get: pressor },
  ],
  2: [
    { name: bi('간 검사 배수', 'Liver tests (×ULN)'), get: lab('ALT', 'ALP', 'TBIL') },
    { name: bi('심부전 과거력', 'Heart failure history'), get: history },
    { name: 'NT-proBNP', get: lab('NTPROBNP') },
  ],
  3: [
    { name: bi('총빌리 또는 ALP 배수', 'T. bili or ALP (×ULN)'), get: lab('TBIL', 'ALP') },
    {
      name: bi('R 비', 'R ratio'),
      get: c => (c.inp.labs.ALT && c.inp.labs.ALP && c.inp.labs.ALP.ratio
        ? { status: '있음', detail: `R ${num(c.inp.labs.ALT.ratio! / c.inp.labs.ALP.ratio, 1)}` }
        : { status: '측정 없음', detail: tr('ALT, ALP 동시 측정 없음', 'No paired ALT and ALP') }),
    },
    { name: bi('백혈구 또는 체온', 'WBC or temperature'), get: either(lab('WBC'), vital('TEMP_C')) },
    { name: bi('혈소판', 'Platelets'), get: lab('PLATELET') },
    { name: bi('승압제 기록', 'Vasopressor record'), get: pressor },
  ],
  4: [{
    name: bi('48시간 안 투약 기록', 'MAR within 48 h'),
    get: c => (c.con.emar ? { status: '있음', detail: tr(`간독성 목록의 약 ${c.drugs}개`, `${c.drugs} drugs on the hepatotoxicity list`) } : { status: '연결 안 됨' }),
  }],
  5: [{
    name: bi('정맥영양 기록', 'Parenteral nutrition record'),
    get: c => (c.con.infusion || c.con.emar
      ? { status: '있음', detail: c.inp.pn_days !== null ? tr(`노출 ${c.inp.pn_days}일`, `${c.inp.pn_days} days of exposure`) : tr('정맥영양 기록 없음', 'No parenteral nutrition record') }
      : { status: '연결 안 됨' }),
  }],
  6: [
    { name: bi('총빌리', 'T. bili'), get: lab('TBIL') },
    { name: 'ALP', get: lab('ALP') },
    { name: 'GGT', get: lab('GGT') },
    { name: 'AST', get: lab('AST') },
    { name: 'ALT', get: lab('ALT') },
    { name: bi('염증 지표 (백혈구 또는 체온)', 'Inflammation (WBC or temperature)'), get: either(lab('WBC'), vital('TEMP_C')) },
  ],
  7: [{
    name: bi('영상 판독', 'Imaging report'),
    get: c => (c.con.imaging_report ? { status: '측정 없음' } : { status: '자료에 없음', detail: tr('구조화 자료에 없어 항상 판단 불가', 'Not in structured data, so never assessable') }),
  }],
  8: [
    { name: bi('직접빌리 (간접 우세 판단)', 'D. bili (indirect predominance)'), get: lab('DBIL') },
    { name: bi('합토글로빈', 'Haptoglobin'), get: lab('HAPTO') },
    { name: 'LDH', get: lab('LDH') },
    {
      name: bi('혈색소 변화', 'Hemoglobin change'),
      get: c => (c.inp.hb_drop !== null ? { status: '있음', detail: tr(`48시간 ${num(c.inp.hb_drop, 1)} g/dL 감소`, `${num(c.inp.hb_drop, 1)} g/dL drop over 48 h`) }
        : { status: '측정 없음', detail: c.inp.labs.HEMOGLOBIN ? tr('48시간 안 1회만 측정', 'Measured only once within 48 h') : undefined }),
    },
  ],
  9: [
    {
      name: bi('간염 혈청 검사', 'Hepatitis serology'),
      get: c => (c.inp.serology > 0 ? { status: '있음', detail: tr(`${c.inp.serology}건`, `${c.inp.serology} results`) } : c.con.serology ? { status: '측정 없음' } : { status: '연결 안 됨' }),
    },
    { name: bi('과거력', 'History'), get: history },
  ],
  10: [
    { name: 'CK', get: lab('CK') },
    { name: bi('과거력', 'History'), get: history },
  ],
}

export function completeness(cause: number, c: Ctx): { have: number; need: number; items: EvidenceItem[] } {
  const items = (NEED[cause] ?? []).map(n => ({ name: pick(n.name), ...n.get(c) }))
  return { have: items.filter(i => i.status === '있음').length, need: items.length, items }
}

/** 판정 취약 한 줄: 바꾼 검사값과 그때 결과 */
export function fragileText(f: { input: string; change: string; value: number; to: number; score: number }): string {
  const dp = VAR[f.input]?.dp ?? 1
  const moved = f.value * (1 + parseFloat(f.change) / 100)
  const from = `${varName(f.input)} ${num(f.value, dp)} → ${num(moved, dp + 1)} (${f.change.replace('-', '−')})`
  return tr(`${from} 이면 ${f.to ? '해당' : '해당 아님'} (점수 ${f.score.toFixed(2)})`, `If ${from}: ${f.to ? 'flagged' : 'not flagged'} (score ${f.score.toFixed(2)})`)
}

/** 병원 공지: 이 병원 자료 전체에 해당하는 한계 (환자별 이유로 띄우지 않음) */
export function siteNotices(con: Connected | undefined): string[] {
  if (!con) return []
  const out: string[] = []
  if (!con.imaging_report) {
    out.push(tr('이 병원 자료에는 영상·시술 판독문이 없어 담낭염은 판단하지 않고, 담관염은 TG18 의심 수준까지만 봅니다.',
      "This site's data has no imaging or procedure reports, so cholecystitis is not assessed and cholangitis is assessed only up to TG18 \"suspected\"."))
  }
  if (!con.history) {
    out.push(tr('이 병원 자료에는 이전 입원 정보가 없어 기저 간질환, 심부전, 만성 바이러스 간염 과거력을 판단하기 어렵습니다.',
      "This site's data has no prior-admission information, so a history of underlying liver disease, heart failure or chronic viral hepatitis is hard to assess."))
  }
  return out
}
