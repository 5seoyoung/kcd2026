// 모델 패키지 (MIMIC-IV 학습, 고정) 를 가상 사례에 적용한 출력 (model-bridge/run_models.py 가 만든 JSON) 을 화면 형식으로 바꾼다.
// 출력 파일: src/data/model/<사례>.json. 다시 만들기: npm run models
import type { A1Point, A2Output, A4Forecast, CaseData, EndState, Evidence, Factor, ModelOutputs, Ref } from '../types'
import { seriesAt } from '../lib/events'
import { addHours, floorHour } from '../lib/time'
import { a1Confidence, a2Confidence, pathSet, TRAJ_WIDEN, varName, type A1Uncertainty, type A3Inputs, type Connected } from '../lib/uncertainty'
import { bi, lang, pick, tr, type Bi } from '../lib/i18n'
import { tx } from './cases/en'

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
  /** 5배 사건. 종료 상태 (a2) 와 원인 추정 (a3) 은 이 시점 기록으로 돈다 */
  target_event?: { t0: string; drawn: string; analyte: string; ratio: number; detect: string } | null
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

const pp = (v: number) => {
  const n = `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(2)}`
  return tr(`${n}%p`, `${n} pp`)
}

/** 특징 묶음 이름 (develop.py FEATURE_GROUPS). 한국어는 출력 JSON 의 label 그대로, 영어는 묶음 키로 */
const GROUP_EN: Record<string, string> = {
  liver_level: 'Liver tests (current)', liver_change: 'Liver-test change', measurement: 'Measurement pattern',
  perfusion: 'Perfusion · shock', inflammation: 'Inflammation · infection', renal_metabolic: 'Renal · metabolic',
  synthetic: 'Synthetic function · blood', respiratory: 'Respiratory', background: 'Background · history',
}
const groupName = (g: Group) => tr(g.label, GROUP_EN[g.group] ?? g.label)

/** 손상 패턴 (rule_agent.py, ACG 2017 R 비) */
const PATTERN_EN: Record<string, string> = { 간세포형: 'hepatocellular', 담즙정체형: 'cholestatic', 혼합형: 'mixed' }
export const patternName = (p: string) => tr(p, PATTERN_EN[p] ?? p)

// 모델 패키지 출력의 한국어 문구 (rule_agent.py 의 근거 reason, against, NOT_ASSESSABLE, 판단 보류 후보, uncertainty 와
// run_models.py 의 군집 reason). 영어 화면에서만 바꾸고 한국어는 출력 그대로
const RULE_EN: Record<string, string> = {
  '승압제 주입 기록': 'Vasopressor infusion recorded',
  '이전 입원 심부전 코드': 'Heart-failure code at a prior admission',
  '승압제 (패혈성 쇼크 가능)': 'Vasopressor (possible septic shock)',
  '담즙정체·혼합 패턴': 'Cholestatic or mixed pattern',
  '이전 입원 만성 바이러스 간염 코드': 'Chronic viral hepatitis code at a prior admission',
  '기저 간질환 코드 (이전 입원)': 'Chronic liver disease code (prior admission)',
  '48시간 내 MAP 65 mmHg 미만 기록 없음': 'No MAP < 65 mmHg within 48 h',
  '혈압 기록 없음': 'No blood pressure record',
  '심초음파·중심정맥압 정보 없음': 'No echocardiography or CVP data',
  '배양·감염 진단 기록이 입력에 없음': 'No culture or infection diagnosis in the input',
  '48시간 창 밖의 투약·잠복기·RUCAM은 확인 불가': 'Dosing outside the 48-h window, latency and RUCAM cannot be checked',
  '정맥영양 조성·열량은 입력에 없음': 'PN composition and calories are not in the input',
  "TG18 C 영상(담관 확장)이 입력에 없음: '의심' 수준까지만": "No TG18 C imaging (bile duct dilatation) in the input: 'suspected' level at most",
  '합토글로빈 측정 없음': 'Haptoglobin not measured',
  '국소 소견(Murphy 징후)과 영상이 구조화 자료에 없어 판단 불가 (TG18)': 'Not assessable: local signs (Murphy sign) and imaging are not in structured data (TG18)',
  '근거가 약하거나 서로 충돌해 판단 보류': 'Withheld: evidence is weak or conflicting',
  'R 비 계산 불가 (ALT·ALP 동시 측정 없음)': 'R ratio not computable (no paired ALT and ALP)',
  '규칙 기반 기준 모델. 노트·영상·배양 정보는 사용하지 않음.': 'Rule-based baseline model. Notes, imaging and cultures are not used.',
  '개발 집단에서 불안정 (부트스트랩 ARI 중앙값 0.75 미만)': 'Unstable in the development cohort (median bootstrap ARI < 0.75)',
}
const RULE_RE: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^체온 ([\d.]+)°C$/, m => `Temperature ${m[1]}°C`],
  [/^MAP 최저 ([\d.]+) mmHg$/, m => `MAP nadir ${m[1]} mmHg`],
  [/^젖산 ([\d.]+) mmol\/L$/, m => `Lactate ${m[1]} mmol/L`],
  [/^NT-proBNP ([\d.]+) pg\/mL \(기준 ([\d.]+)\)$/, m => `NT-proBNP ${m[1]} pg/mL (cut-off ${m[2]})`],
  [/^NT-proBNP ([\d.]+) pg\/mL, 기준 ([\d.]+) 미만$/, m => `NT-proBNP ${m[1]} pg/mL, below cut-off ${m[2]}`],
  [/^(\S+) ([\d.]+)×ULN, 담즙정체 우세$/, m => `${m[1]} ${m[2]}×ULN, cholestatic predominance`],
  [/^혈소판 ([\d.]+)$/, m => `Platelets ${m[1]}`],
  [/^정맥영양 노출 ([\d.]+)일$/, m => `Parenteral nutrition exposure ${m[1]} days`],
  [/^TG18 B 담즙정체: TBIL ([\d.]+) mg\/dL$/, m => `TG18 B cholestasis: TBIL ${m[1]} mg/dL`],
  [/^ALP ([\d.]+)× \+ TBIL ([\d.]+)×ULN 폐쇄 패턴$/, m => `ALP ${m[1]}× + TBIL ${m[2]}×ULN obstructive pattern`],
  [/^직접 빌리루빈 (\d+%)$/, m => `Direct bilirubin ${m[1]}`],
  [/^간접 빌리루빈 우세 \(직접 (\d+%)\)$/, m => `Indirect bilirubin predominant (direct ${m[1]})`],
  [/^직접 빌리루빈 (\d+%): 포합형 우세$/, m => `Direct bilirubin ${m[1]}: conjugated predominance`],
  [/^합토글로빈 ([\d.]+) mg\/dL$/, m => `Haptoglobin ${m[1]} mg/dL`],
  [/^48시간 내 혈색소 ([\d.]+) g\/dL 감소$/, m => `Hemoglobin fell ${m[1]} g/dL within 48 h`],
  [/^근육 기원 가능: (.+)$/, m => `Possible muscle source: ${m[1]}`],
  [/^설명되지 않는 간세포형 \(R ([\d.]+)\): 자가면역·기타 감별$/, m => `Unexplained hepatocellular pattern (R ${m[1]}): consider autoimmune and other causes`],
  [/^R 비 ([\d.]+) \((.+)\)$/, m => `R ratio ${m[1]} (${PATTERN_EN[m[2]] ?? m[2]})`],
  [/^최근 측정 없음: (.+)$/, m => `Not measured recently: ${m[1]}`],
  // 약 이름, 혈청 검사 이름이 앞에 오는 문구 (이름은 영어 그대로)
  [/^(.+) 투여 기록$/, m => `${m[1]} administration recorded`],
  [/^(.+) 양성 \((.*)\)$/, m => `${m[1]} positive (${m[2]})`],
]

/** 규칙 모델 출력 문구를 지금 언어로 (영어 번역이 없으면 그대로) */
export function ruleText(s: string): string {
  if (lang() !== 'en') return s
  if (RULE_EN[s]) return RULE_EN[s]
  for (const [re, f] of RULE_RE) {
    const m = s.match(re)
    if (m) return f(m)
  }
  // uncertainty 처럼 ' · ' 로 이은 문구
  return s.includes(' · ') ? s.split(' · ').map(ruleText).join(' · ') : s
}

/**
 * 에이전트 1: 정상 구간의 매시간 확률과 그룹 Shapley 요인 (위험을 많이 움직인 순), 불확실성 표시
 * (사다리, 구간, 줄이는 검사, 확신 규칙 1~5).
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
        factors: groups.map<Factor>(g => ({ name: groupName(g), value: pp(g.value), dir: g.value >= 0 ? '+' : '-' })),
        drivers: groups.filter(g => g.value > 0).sort((a, b) => b.value - a.value).slice(0, 2).map(g => ({ name: groupName(g), value: pp(g.value), dir: '+' })),
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

const INPUT_NAME: Record<string, [Bi, (v: number) => string]> = {
  ALT_latest: [bi('ALT', 'ALT'), v => `${v.toFixed(1)}×ULN`],
  AST_latest: [bi('AST', 'AST'), v => `${v.toFixed(1)}×ULN`],
  ALP_latest: [bi('ALP', 'ALP'), v => `${v.toFixed(1)}×ULN`],
  TBIL_latest: [bi('총빌리', 'T. bili'), v => `${v.toFixed(1)}×ULN`],
  ALT_delta24: [bi('ALT 24시간 변화', 'ALT 24-h change'), v => `${v >= 0 ? '+' : ''}${v.toFixed(1)}×ULN`],
  LACTATE_latest: [bi('젖산', 'Lactate'), v => `${v.toFixed(1)} mmol/L`],
  MAP_latest: [bi('MAP (6시간 안 최근)', 'MAP (latest, 6 h)'), v => `${v.toFixed(0)} mmHg`],
  pressor_6h: [bi('승압제 주입 (6시간 안)', 'Vasopressor (6 h)'), v => (v ? tr('있음', 'Yes') : tr('없음', 'No'))],
  CREAT_latest: [bi('크레아티닌', 'Creatinine'), v => `${v.toFixed(1)} mg/dL`],
  INR_latest: [bi('INR', 'INR'), v => v.toFixed(2)],
  PLATELET_latest: [bi('혈소판', 'Platelets'), v => `${v.toFixed(0)}`],
  WBC_latest: [bi('백혈구', 'WBC'), v => v.toFixed(1)],
  age: [bi('나이', 'Age'), v => tr(`${v.toFixed(0)}세`, `${v.toFixed(0)} y`)],
  hours_since_icu: [bi('ICU 입실 뒤', 'Since ICU admission'), v => tr(`${v.toFixed(1)}시간`, `${v.toFixed(1)} h`)],
}

/** 에이전트 2: 4경로 확률, ICU 사망 확률, 모델이 본 주요 입력값 (방향 없음) */
export function agent2Of(run: ModelRun): A2Output | undefined {
  const a = run.a2
  if (!a) return undefined
  const probs = Object.fromEntries(Object.entries(a.probs).map(([k, v]) => [END[k], v])) as Record<EndState, number>
  const factors: Factor[] = Object.entries(a.inputs)
    .filter(([k, v]) => v !== null && INPUT_NAME[k])
    .map(([k, v]) => ({ name: pick(INPUT_NAME[k][0]), value: INPUT_NAME[k][1](v as number) }))
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
    cluster: tr(`간 패턴 군집 ${lp.cluster} / ${lp.k}`, `Liver-pattern cluster ${lp.cluster} / ${lp.k}`),
    confidence: lp.prob ?? 0,
    assignable: true,
    share: center.share,
    features: [
      tr(`입력: ALT ${f1(inp.ALT_ratio)}×, ALP ${f1(inp.ALP_ratio)}×, 총빌리 ${f1(inp.TBIL_ratio)}×ULN, R 비 ${f1(inp.R_ratio)}`,
        `Input: ALT ${f1(inp.ALT_ratio)}×, ALP ${f1(inp.ALP_ratio)}×, T. bili ${f1(inp.TBIL_ratio)}×ULN, R ratio ${f1(inp.R_ratio)}`),
      tr(`군집 중심: ALT ${f1(center.center.ALT_ratio)}×, ALP ${f1(center.center.ALP_ratio)}×, 총빌리 ${f1(center.center.TBIL_ratio)}×ULN, R 비 ${f1(center.center.R_ratio)}`,
        `Cluster center: ALT ${f1(center.center.ALT_ratio)}×, ALP ${f1(center.center.ALP_ratio)}×, T. bili ${f1(center.center.TBIL_ratio)}×ULN, R ratio ${f1(center.center.R_ratio)}`),
      ...(clinical && !clinical.used
        ? [tr(`임상 표현형 군집: ${clinical.reason ?? '쓰지 않음'}`, `Clinical-phenotype cluster: ${clinical.reason ? ruleText(clinical.reason) : 'not used'}`)]
        : []),
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
      // 띠는 CQR 로 넓힘 (MIMIC 에서 실제 값을 80% 담도록, TRAJ_WIDEN)
      points: qs.map(q => {
        const w = 2 ** (TRAJ_WIDEN[an]?.[q.h] ?? 0)
        return { h: q.h, time: addHours(row.time, q.h), v: q.q50 * item.high!, lo: (q.q10 * item.high!) / w, hi: q.q90 * item.high! * w }
      }),
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
    const h = cs.history?.flatMap(x => x.codes.map(c => tr(`${c.name} ${c.code} (${x.discharged.slice(0, 7)} 퇴원)`, `${tx(c.name)} ${c.code} (discharged ${x.discharged.slice(0, 7)})`))).join(', ')
    return { text: `${ruleText(s.reason)}${h ? `: ${h}` : ''}`, time: tr('이전 입원', 'Prior admission') }
  }
  return { text: ruleText(s.reason), time: t, ref: refOf(cs, s.analyte_or_label, s.measured_at) }
}
