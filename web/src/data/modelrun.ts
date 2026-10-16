// 모델 패키지 (MIMIC-IV 학습, 고정) 를 가상 사례에 적용한 출력 (model-bridge/run_models.py 가 만든 JSON) 을 화면 형식으로 바꾼다.
// 출력 파일: src/data/model/<사례>.json. 다시 만들기: npm run models
import type { A1Point, A2Output, A4Forecast, CaseData, EndState, Evidence, Factor, ModelOutputs, Ref } from '../types'
import { seriesAt } from '../lib/events'
import { addHours, floorHour } from '../lib/time'
import { a1Confidence, a2Confidence, pathSet, varName, type A1Uncertainty, type A3Inputs, type Connected } from '../lib/uncertainty'

interface Group { group: string; label: string; value: number }
interface FlagOut {
  present: number
  assessable: boolean
  score: number
  support: { analyte_or_label: string | null; measured_at: string | null; reason: string }[]
  against: string[]
}
interface Quant { h: number; q10: number; q50: number; q90: number }
export interface ModelRun {
  meta: {
    package: string
    code_version: string | null
    trained_on: string
    built_at: string
    sklearn: string
    python: string
    rule_model: string
    agent1_internal: { auroc: number; auprc: number } | null
    /** 확신 규칙 2 의 기준: 발생 예측 모델 기준 행의 5%, 95% */
    reference?: Record<string, [number, number]>
    connected?: Connected
  }
  first_event: { t0: string; drawn: string; analyte: string; ratio: number; detect: string } | null
  a1: ({ time: string; eligible: boolean; p?: number; base?: number; groups?: Group[] }
    & Partial<A1Uncertainty> & { next_test?: { analyte: string; lo: number; hi: number }[] })[]
  a2: { t0: string; classes: string[]; probs: Record<string, number>; icu_death: number; inputs: Record<string, number | null> } | null
  a3: {
    t0: string
    model: string
    pattern: string | null
    abstain: boolean
    uncertainty: string
    flags: Record<string, FlagOut>
    snapshot: { labs: number; context: number }
    history?: Record<string, boolean | null>
    inputs?: A3Inputs
    /** 판정 취약: 범주별로 0/1 을 바꾼 검사값 */
    fragile?: Record<string, { input: string; change: string; value: number; to: number; score: number }[]>
    error_range?: number
  } | null
  cluster: Record<string, { used: boolean; reason?: string; k?: number; cluster?: number; prob?: number; pattern?: string;
    input?: Record<string, number | null>; centers?: { cluster: number; share: number; center: Record<string, number> }[] }> | null
  a4: { time: string; forecasts: Record<string, Quant[]> }[]
}

// src/data/model/<사례 id>.json 을 모두 읽음 (없는 사례는 대체 계산)
const FILES = import.meta.glob<ModelRun>('./model/*.json', { eager: true, import: 'default' })
const RUNS: Record<string, ModelRun> = Object.fromEntries(Object.entries(FILES).map(([path, run]) => [path.split('/').at(-1)!.replace(/\.json$/, ''), run]))
export const modelRun = (caseId: string): ModelRun | undefined => RUNS[caseId]

/** 모델 패키지 검사 이름 → 화면 검사 코드 */
export const CODE_OF: Record<string, string> = {
  ALT: 'ALT', AST: 'AST', ALP: 'ALP', TBIL: 'TB', DBIL: 'DB', GGT: 'GGT', INR: 'INR', ALBUMIN: 'ALB', CK: 'CK', LDH: 'LDH',
  CREAT: 'CR', BUN: 'BUN', SODIUM: 'NA', GLUCOSE: 'GLU', BICARB: 'HCO3', LACTATE: 'LAC', WBC: 'WBC', HEMOGLOBIN: 'HB',
  PLATELET: 'PLT', CRP: 'CRP',
}

/** 원인 규칙의 범주 이름 → 화면 범주 번호 */
export const CAUSE_NO: Record<string, number> = {
  hypoxic_hepatitis: 1, congestive_hepatopathy: 2, sepsis_cholestasis: 3, dili: 4, pn_associated: 5,
  biliary_obstruction_cholangitis: 6, cholecystitis: 7, hemolysis: 8, viral_hepatitis: 9, others: 10,
}

const pp = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(2)}%p`

/**
 * 에이전트 1: 정상 구간의 매시간 확률과 그룹 Shapley 요인 (위험을 많이 움직인 순), 불확실성 표시
 * (사다리, 결측 대체 구간, 줄이는 검사, 확신 규칙 1~5).
 */
export function a1Points(run: ModelRun): A1Point[] {
  const ref = run.meta.reference ?? {}
  return run.a1
    .filter(x => x.eligible && x.p !== undefined)
    .map(x => {
      const groups = [...(x.groups ?? [])].sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
      const best = x.next_test?.[0]
      const point: A1Point = {
        time: x.time,
        p: x.p!,
        base: x.base,
        factors: groups.map<Factor>(g => ({ name: g.label, value: pp(g.value), dir: g.value >= 0 ? '+' : '-' })),
        drivers: groups.filter(g => g.value > 0).sort((a, b) => b.value - a.value).slice(0, 2).map(g => ({ name: g.label, value: pp(g.value), dir: '+' })),
      }
      if (!x.ladder) return point
      const u: A1Uncertainty = { ladder: x.ladder, missing_core: x.missing_core ?? [], interval: x.interval ?? null, out_of_range: x.out_of_range ?? [], guard: x.guard ?? [] }
      return {
        ...point,
        ladder: Object.entries(u.ladder).map(([k, p]) => ({ k: +k, p })).sort((a, b) => a.k - b.k),
        missingCore: u.missing_core.map(varName),
        interval: u.interval ? { lo: u.interval[0], hi: u.interval[1] } : undefined,
        nextTest: best ? { name: varName(best.analyte), lo: best.lo, hi: best.hi } : undefined,
        confidence: a1Confidence(u, ref),
      }
    })
}

const END: Record<string, EndState> = {
  recovered_alive_icu: 'rec-alive', recovered_died_icu: 'rec-dead', unrecovered_alive_icu: 'norec-alive', unrecovered_died_icu: 'norec-dead',
}

const INPUT_NAME: Record<string, [string, (v: number) => string]> = {
  ALT_latest: ['ALT', v => `${v.toFixed(1)}×ULN`],
  AST_latest: ['AST', v => `${v.toFixed(1)}×ULN`],
  ALP_latest: ['ALP', v => `${v.toFixed(1)}×ULN`],
  TBIL_latest: ['총빌리', v => `${v.toFixed(1)}×ULN`],
  ALT_delta24: ['ALT 24시간 변화', v => `${v >= 0 ? '+' : ''}${v.toFixed(1)}×ULN`],
  LACTATE_latest: ['젖산', v => `${v.toFixed(1)} mmol/L`],
  MAP_latest: ['MAP (6시간 안 최근)', v => `${v.toFixed(0)} mmHg`],
  pressor_6h: ['승압제 주입 (6시간 안)', v => (v ? '있음' : '없음')],
  CREAT_latest: ['크레아티닌', v => `${v.toFixed(1)} mg/dL`],
  INR_latest: ['INR', v => v.toFixed(2)],
  PLATELET_latest: ['혈소판', v => `${v.toFixed(0)}`],
  WBC_latest: ['백혈구', v => v.toFixed(1)],
  age: ['나이', v => `${v.toFixed(0)}세`],
  hours_since_icu: ['ICU 입실 뒤', v => `${v.toFixed(1)}시간`],
}

/** 에이전트 2: 4경로 확률, ICU 사망 확률, 모델이 본 주요 입력값 (방향 없음) */
export function agent2Of(run: ModelRun): A2Output | undefined {
  const a = run.a2
  if (!a) return undefined
  const probs = Object.fromEntries(Object.entries(a.probs).map(([k, v]) => [END[k], v])) as Record<EndState, number>
  const factors: Factor[] = Object.entries(a.inputs)
    .filter(([k, v]) => v !== null && INPUT_NAME[k])
    .map(([k, v]) => ({ name: INPUT_NAME[k][0], value: INPUT_NAME[k][1](v as number) }))
  const set = pathSet(probs)
  return { probs, icuDeath: a.icu_death, factors, pathSet: set, confidence: a2Confidence(set) }
}

const f1 = (v: number | null | undefined) => (v === null || v === undefined ? '–' : v.toFixed(1))

/** 보조 군집 (간 패턴). 임상 표현형 군집은 개발 때 불안정해 쓰지 않음 */
export function model1Of(run: ModelRun): ModelOutputs['model1'] | undefined {
  const lp = run.cluster?.liver_pattern_gmm
  if (!lp?.used || !lp.cluster) return undefined
  const center = lp.centers!.find(c => c.cluster === lp.cluster)!
  const inp = lp.input ?? {}
  const clinical = run.cluster?.clinical_phenotype_gmm
  return {
    cluster: `간 패턴 군집 ${lp.cluster} / ${lp.k}`,
    confidence: lp.prob ?? 0,
    assignable: true,
    share: center.share,
    features: [
      `입력: ALT ${f1(inp.ALT_ratio)}×, ALP ${f1(inp.ALP_ratio)}×, 총빌리 ${f1(inp.TBIL_ratio)}×ULN, R 비 ${f1(inp.R_ratio)}`,
      `군집 중심: ALT ${f1(center.center.ALT_ratio)}×, ALP ${f1(center.center.ALP_ratio)}×, 총빌리 ${f1(center.center.TBIL_ratio)}×ULN, R 비 ${f1(center.center.R_ratio)}`,
      ...(clinical && !clinical.used ? [`임상 표현형 군집: ${clinical.reason ?? '쓰지 않음'}`] : []),
    ],
  }
}

/** 에이전트 4: 그 시각의 예측 (×ULN) 을 원래 단위로. 그 시각 24시간 안에 잰 값이 없는 항목은 예측이 없음 */
export function a4From(run: ModelRun, cs: CaseData, t: string): A4Forecast[] {
  const row = run.a4.find(x => x.time === floorHour(t))
  if (!row) return []
  const out: A4Forecast[] = []
  for (const [an, qs] of Object.entries(row.forecasts)) {
    const code = CODE_OF[an]
    const item = cs.labItems.find(i => i.code === code)
    const last = seriesAt(cs, code, t).at(-1)
    if (!item?.high || !last) continue
    out.push({
      code,
      last: { time: last.charttime, value: last.value },
      points: qs.map(q => ({ h: q.h, time: addHours(row.time, q.h), v: q.q50 * item.high!, lo: q.q10 * item.high!, hi: q.q90 * item.high! })),
    })
  }
  const order = ['ALT', 'AST', 'ALP', 'TB']
  return out.sort((a, b) => order.indexOf(a.code) - order.indexOf(b.code))
}

/** 규칙 모델이 인용한 기록 (검사 이름, 활력징후, 약 이름 + 시각) 을 원자료 위치로 */
export function refOf(cs: CaseData, label: string | null, at: string | null): Ref | undefined {
  if (!label) return undefined
  const t = at ? at.replace('T', ' ').slice(0, 16) : null
  const code = CODE_OF[label]
  if (code) {
    const r = cs.labs.find(x => x.code === code && (!t || x.charttime === t))
    return r ? { tab: 'lab', row: code, col: r.id } : undefined
  }
  const vital: Record<string, string> = { MAP: 'map', HR: 'hr', RR: 'rr', SPO2: 'spo2', TEMP_C: 'bt' }
  if (vital[label]) return t ? { tab: 'vital', row: vital[label], from: t, to: t } : undefined
  const o = cs.mar.find(m => m.drug.toLowerCase() === label.toLowerCase())
  return o ? { tab: 'mar', row: o.id } : undefined
}

/** 규칙 모델 근거 한 줄 → 화면 근거 (원자료로 갈 수 있으면 ref) */
export function evidenceOf(cs: CaseData, s: FlagOut['support'][number]): Evidence {
  const t = s.measured_at ? s.measured_at.replace('T', ' ').slice(5, 16) : undefined
  if ((s.analyte_or_label ?? '').startsWith('history_')) {
    const h = cs.history?.flatMap(x => x.codes.map(c => `${c.name} ${c.code} (${x.discharged.slice(0, 7)} 퇴원)`)).join(', ')
    return { text: `${s.reason}${h ? `: ${h}` : ''}`, time: '이전 입원' }
  }
  return { text: s.reason, time: t, ref: refOf(cs, s.analyte_or_label, s.measured_at) }
}
