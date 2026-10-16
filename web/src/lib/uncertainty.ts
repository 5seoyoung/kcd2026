// 에이전트 불확실성 표시 (불확실성 구현 명세 10/17). 모델은 다시 학습하지 않고, 모델 패키지 출력 (model-bridge)
// 과 사례 자료 위에서 미리 고정한 규칙으로 계산한다. 기준값은 모두 이 파일에 있다.
import type { CaseData, Confidence, ConfReason, EndState, EvidenceItem, EvidenceStatus, LiverEvent } from '../types'
import { EVENT_CODES, publicAt, sameDraw, uln } from './events'
import { isAfter, toMs } from './time'
import { pct } from './ui'

/** 규칙 1: 핵심 입력 (간 검사 4개, INR, 젖산, 크레아티닌) 중 이만큼 이상이 24시간 안 측정 없으면 확신 낮음 */
export const CORE_MISSING_MIN = 2
/** 규칙 4: 결측 대체 구간 폭 기준. 개발 집단 상위 25% 폭을 받기 전 임시값 */
export const WIDTH_LIMIT = 0.1
/** 규칙 5: 높은 배수 확률이 낮은 배수 확률보다 이만큼 넘게 크면 사다리 뒤집힘 (0: 조금이라도 크면) */
export const LADDER_TOL = 0
/** 예후 경로 집합 (임시): 확률 큰 순으로 더해 이 값에 이를 때까지. 보장 없음, conformal 기준을 받으면 바꿈 */
export const PATH_MASS = 0.9
/** 검사 오차 범위 (사건 경계값, 판정 취약). 임상의 선생님 확인 전 기본값 */
export const ERROR_RANGE = 0.1

/** 모델 패키지 변수 이름 → 화면 이름과 표시 자릿수. ratio 는 ×ULN */
const VAR: Record<string, { name: string; dp: number; ratio?: boolean }> = {
  ALT: { name: 'ALT', dp: 2, ratio: true }, AST: { name: 'AST', dp: 2, ratio: true }, ALP: { name: 'ALP', dp: 2, ratio: true },
  TBIL: { name: '총빌리', dp: 2, ratio: true }, INR: { name: 'INR', dp: 1 }, ALBUMIN: { name: '알부민', dp: 1 },
  LACTATE: { name: '젖산', dp: 1 }, CREAT: { name: '크레아티닌', dp: 1 }, BUN: { name: 'BUN', dp: 0 },
  NTPROBNP: { name: 'NT-proBNP', dp: 0 }, age: { name: '나이', dp: 0 }, PLATELET: { name: '혈소판', dp: 0 },
  WBC: { name: '백혈구', dp: 1 }, SODIUM: { name: '나트륨', dp: 0 }, GLUCOSE: { name: '혈당', dp: 0 },
  BICARB: { name: '중탄산', dp: 0 }, HEMOGLOBIN: { name: '혈색소', dp: 1 }, MAP: { name: 'MAP', dp: 0 },
  HR: { name: '심박', dp: 0 }, RR: { name: '호흡수', dp: 0 }, SPO2: { name: 'SpO2', dp: 0 }, TEMP_C: { name: '체온', dp: 1 },
  DBIL: { name: '직접빌리', dp: 1 }, GGT: { name: 'GGT', dp: 0 }, CK: { name: 'CK', dp: 0 }, LDH: { name: 'LDH', dp: 0 },
  HAPTO: { name: '합토글로빈', dp: 0 }, HEMOGLOBIN_DROP: { name: '48시간 혈색소 감소', dp: 1 },
}
export const varName = (v: string) => VAR[v]?.name ?? v
const num = (x: number, dp: number) => String(+x.toFixed(dp))
/** 값 표시. ×ULN 변수는 배수로 */
export const fmtVar = (v: string, x: number) => (VAR[v]?.ratio ? `${num(x, 2)}×ULN` : num(x, VAR[v]?.dp ?? 1))
const names = (vs: string[]) => vs.map(varName).join(', ')
const pp = (x: number) => `${(x * 100).toFixed(1)}%p`

const GUARD_REASON: Record<string, string> = {
  range: '생리적 범위 밖', jump: '48시간 안 급변', jump_unconfirmed: '급변 (짝 효소는 그대로)', discordant_partner: '짝 효소와 맞지 않음',
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
  if (u.missing_core.length >= CORE_MISSING_MIN) reasons.push({ rule: 1, text: `${names(u.missing_core)} 24시간 안 측정 없음` })
  if (u.out_of_range.length) {
    const r = u.out_of_range.map(o => `${varName(o.var)} ${fmtVar(o.var, o.value)}${ref[o.var] ? ` (${fmtVar(o.var, ref[o.var][0])}~${fmtVar(o.var, ref[o.var][1])})` : ''}`)
    reasons.push({ rule: 2, text: `${r.join(', ')} (괄호는 개발 집단 5~95%)` })
  }
  if (u.guard.length) {
    reasons.push({ rule: 3, text: `${u.guard.map(g => `${varName(g.var)} ${g.value}${g.at ? ` (${g.at.slice(5)})` : ''} ${GUARD_REASON[g.reason] ?? g.reason}`).join(', ')}` })
  }
  if (u.interval && u.interval[1] - u.interval[0] >= WIDTH_LIMIT) {
    reasons.push({ rule: 4, text: `결측 대체 구간 폭 ${pp(u.interval[1] - u.interval[0])}, 기준 ${pp(WIDTH_LIMIT)} 이상 (기준은 임시값)` })
  }
  const lad = Object.entries(u.ladder).map(([k, p]) => ({ k: +k, p })).sort((a, b) => a.k - b.k)
  const inv = ladderInversions(lad)
  if (inv.length) reasons.push({ rule: 5, text: `${inv.map(([hi, lo]) => `${hi.k}배 ${pct(hi.p)} > ${lo.k}배 ${pct(lo.p)}`).join(', ')}` })
  return { level: reasons.length ? '낮음' : '높음', reasons }
}

/** 예후 경로 집합 (임시): 확률 큰 순으로 더해 PATH_MASS 에 이를 때까지 */
export function pathSet(probs: Record<EndState, number>): { keys: EndState[]; mass: number } {
  const order = (Object.keys(probs) as EndState[]).sort((a, b) => probs[b] - probs[a])
  const keys: EndState[] = []
  let mass = 0
  for (const k of order) {
    if (mass >= PATH_MASS - 1e-9) break
    keys.push(k)
    mass += probs[k]
  }
  return { keys, mass }
}

/** 규칙 6: 예후 경로 집합이 둘 이상이면 확신 낮음 */
export function a2Confidence(set: { keys: EndState[] }): Confidence {
  return set.keys.length >= 2
    ? { level: '낮음', reasons: [{ rule: 6, text: `가능성이 높은 경로가 ${set.keys.length}개` }] }
    : { level: '높음', reasons: [] }
}

/** 알림에 쓰는 검사 이름 (핵심 입력은 우리말 약칭) */
const LAB_LABEL: Record<string, string> = {
  TB: '총빌리', DB: '직접빌리', INR: 'INR', LAC: '젖산', CR: '크레아티닌', ALB: '알부민', HB: '혈색소', PLT: '혈소판',
  WBC: '백혈구', NA: '나트륨', GLU: '혈당', HCO3: '중탄산', GGT: 'GGT',
}
export const labLabel = (cs: CaseData, code: string) => LAB_LABEL[code] ?? (cs.labItems.find(i => i.code === code)?.name.split(' (')[0] ?? code)
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
const vital = (v: string): Get => c => (c.inp.vitals.includes(v) ? { status: '있음' } : { status: '측정 없음', detail: '48시간 안 기록 없음' })
const either = (a: Get, b: Get): Get => c => {
  const x = a(c)
  return x.status === '있음' ? x : b(c)
}
const history: Get = c => (!c.con.history ? { status: '연결 안 됨' } : c.histKnown ? { status: '있음' } : { status: '이전 입원 없음', detail: '과거력 판단 불가' })
const pressor: Get = c => (c.con.infusion ? { status: '있음', detail: c.pressor ? '48시간 안 주입 있음' : '48시간 안 주입 없음' } : { status: '연결 안 됨' })

/** 원인별 필요한 근거 (명세 표 그대로). 근거 자료 완성도 = 있음 / 전체 */
const NEED: Record<number, { name: string; get: Get }[]> = {
  1: [
    { name: 'AST 또는 ALT 최고 배수', get: lab('AST', 'ALT') },
    { name: 'MAP', get: vital('MAP') },
    { name: '젖산', get: lab('LACTATE') },
    { name: '승압제 기록', get: pressor },
  ],
  2: [
    { name: '간 검사 배수', get: lab('ALT', 'ALP', 'TBIL') },
    { name: '심부전 과거력', get: history },
    { name: 'NT-proBNP', get: lab('NTPROBNP') },
  ],
  3: [
    { name: '총빌리 또는 ALP 배수', get: lab('TBIL', 'ALP') },
    {
      name: 'R 비',
      get: c => (c.inp.labs.ALT && c.inp.labs.ALP && c.inp.labs.ALP.ratio
        ? { status: '있음', detail: `R ${num(c.inp.labs.ALT.ratio! / c.inp.labs.ALP.ratio, 1)}` }
        : { status: '측정 없음', detail: 'ALT, ALP 동시 측정 없음' }),
    },
    { name: '백혈구 또는 체온', get: either(lab('WBC'), vital('TEMP_C')) },
    { name: '혈소판', get: lab('PLATELET') },
    { name: '승압제 기록', get: pressor },
  ],
  4: [{ name: '48시간 안 투약 기록', get: c => (c.con.emar ? { status: '있음', detail: `간독성 목록의 약 ${c.drugs}개` } : { status: '연결 안 됨' }) }],
  5: [{ name: '정맥영양 기록', get: c => (c.con.infusion || c.con.emar ? { status: '있음', detail: c.inp.pn_days !== null ? `노출 ${c.inp.pn_days}일` : '정맥영양 기록 없음' } : { status: '연결 안 됨' }) }],
  6: [
    { name: '총빌리', get: lab('TBIL') },
    { name: 'ALP', get: lab('ALP') },
    { name: 'GGT', get: lab('GGT') },
    { name: 'AST', get: lab('AST') },
    { name: 'ALT', get: lab('ALT') },
    { name: '염증 지표 (백혈구 또는 체온)', get: either(lab('WBC'), vital('TEMP_C')) },
  ],
  7: [{ name: '영상 판독', get: c => (c.con.imaging_report ? { status: '측정 없음' } : { status: '자료에 없음', detail: '구조화 자료에 없어 항상 판단 불가' }) }],
  8: [
    { name: '직접빌리 (간접 우세 판단)', get: lab('DBIL') },
    { name: '합토글로빈', get: lab('HAPTO') },
    { name: 'LDH', get: lab('LDH') },
    {
      name: '혈색소 변화',
      get: c => (c.inp.hb_drop !== null ? { status: '있음', detail: `48시간 ${num(c.inp.hb_drop, 1)} g/dL 감소` }
        : { status: '측정 없음', detail: c.inp.labs.HEMOGLOBIN ? '48시간 안 1회만 측정' : undefined }),
    },
  ],
  9: [
    { name: '간염 혈청 검사', get: c => (c.inp.serology > 0 ? { status: '있음', detail: `${c.inp.serology}건` } : c.con.serology ? { status: '측정 없음' } : { status: '연결 안 됨' }) },
    { name: '과거력', get: history },
  ],
  10: [
    { name: 'CK', get: lab('CK') },
    { name: '과거력', get: history },
  ],
}

export function completeness(cause: number, c: Ctx): { have: number; need: number; items: EvidenceItem[] } {
  const items = (NEED[cause] ?? []).map(n => ({ name: n.name, ...n.get(c) }))
  return { have: items.filter(i => i.status === '있음').length, need: items.length, items }
}

/** 판정 취약 한 줄: 바꾼 검사값과 그때 결과 */
export function fragileText(f: { input: string; change: string; value: number; to: number; score: number }): string {
  const dp = VAR[f.input]?.dp ?? 1
  const moved = f.value * (1 + parseFloat(f.change) / 100)
  return `${varName(f.input)} ${num(f.value, dp)} → ${num(moved, dp + 1)} (${f.change.replace('-', '−')}) 이면 ${f.to ? '해당' : '해당 아님'} (점수 ${f.score.toFixed(2)})`
}

/** 병원 공지: 이 병원 자료 전체에 해당하는 한계 (환자별 이유로 띄우지 않음) */
export function siteNotices(con: Connected | undefined): string[] {
  if (!con) return []
  const out: string[] = []
  if (!con.imaging_report) out.push('이 병원 자료에는 영상·시술 판독문이 없어 담낭염은 판단하지 않고, 담관염은 TG18 의심 수준까지만 봅니다.')
  if (!con.history) out.push('이 병원 자료에는 이전 입원 정보가 없어 기저 간질환, 심부전, 만성 바이러스 간염 과거력을 판단하기 어렵습니다.')
  return out
}
