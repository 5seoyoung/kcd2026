// 사례 1 의 에이전트 3 (원인 추정) 실행 기록 (손으로 쓴 예시). 실제 에이전트가 완성되면 같은 형식의 실행 결과로 바꾼다.
import type { AgentRun, AgentStep, Candidate } from '../types'
import { case01 } from './case01'
import { firstEvent, K_A3 } from '../lib/events'
import { hm, isAfter, mdhm } from '../lib/time'

// 5배 사건: t0 는 채혈 시각, 에이전트는 결과 보고 뒤 첫 정시에 돈다
const ev = firstEvent(case01, K_A3)!
const t0 = ev.t0
const runAt = ev.detectAt

const before = (t: string) => !isAfter(t, t0)
const between = (t: string) => isAfter(t, t0) && !isAfter(t, runAt)
const admins = case01.mar.flatMap(o => o.admins)

const nLab = case01.labs.filter(r => before(r.charttime) && !isAfter(r.storetime, runAt)).length
const nAdmin = admins.filter(a => before(a.time)).length
const nAdminCut = admins.filter(a => between(a.time)).length
const nVital = case01.vitals.filter(v => before(v.time)).length
const nVitalCut = case01.vitals.filter(v => between(v.time)).length
const nMicro = case01.micro.filter(m => before(m.collected)).length
const nDrug = case01.mar.filter(o => o.admins.some(a => a.status === 'given' && before(a.time))).length

const commonSteps: AgentStep[] = [
  {
    id: 's1', tool: 'build_case', title: '사례 자료 만들기', ms: 900,
    summary: `t0 = ${mdhm(t0)} (ALT 채혈 시각, 보고 ${hm(ev.result.storetime)}). 입실부터 t0 까지의 기록과 같은 채혈 결과만 씀`,
    details: [
      `검사 결과 ${nLab}건, 투약 기록 ${nAdmin}건, 활력징후 ${nVital}시간, 배양 ${nMicro}건`,
      `t0 뒤 실행 시각 (${hm(runAt)}) 까지 생긴 기록은 뺌: 투약 ${nAdminCut}건, 활력징후 ${nVitalCut}시간`,
    ],
  },
  {
    id: 's2', tool: 'detect_event', title: '사건 확인', ms: 600,
    summary: 'ALT 412 IU/L, 기준 상한 40 의 10.3배 (5배 사건). 직전 값 96 (03-10 20:30) 은 5배 미만 → 관찰 중 신규 이상',
  },
  {
    id: 's3', tool: 'injury_pattern', title: '손상 패턴 계산', ms: 500,
    summary: 'R 비 9.8 → 간세포형. AST/ALT 1.7, LDH 1,240 (5.5배)',
  },
  {
    id: 's4', tool: 'query_evidence', title: '혈역학·산소화 근거', ms: 1100,
    summary: 'MAP 65 미만 3시간 (최저 52), 노르에피네프린 최대 0.35, 바소프레신 추가, 젖산 최고 6.8, SpO2 최저 86%',
  },
  {
    id: 's5', tool: 'query_evidence', title: '약물 노출', ms: 1000,
    summary: `t0 전 투여 약 ${nDrug}종. 간독성 지식표에 있는 약: 아미오다론, 피페라실린/타조박탐, 아세트아미노펜`,
  },
  {
    id: 's6', tool: 'query_evidence', title: '감염 근거', ms: 800,
    summary: '기관 흡인물 배양 S. pneumoniae (03-10 14:00 보고). 03-10 혈액배양은 t0 시점 배양 중',
  },
  {
    id: 's7', tool: 'query_evidence', title: '심장·담도·비간성 근거', ms: 900,
    summary: '심초음파, BNP, 복부 영상 없음. 정맥영양 없음. CK 410 (5배 미만). 용혈 검사 없음',
  },
  {
    id: 's8', tool: 'lookup_knowledge', title: '지식표 조회', ms: 700,
    summary: '아미오다론 정맥: 투여 직후 급성 간세포형 손상 보고 있음. 피페라실린/타조박탐: 드물고 주로 담즙정체형',
  },
]

const model1Step: AgentStep = {
  id: 's9', tool: 'query_model1', title: '간 검사 이상 패턴 조회 (모델 1)', ms: 800,
  summary: '군집 2, 확신도 0.86. 하루 안 급상승한 간세포형, AST/ALT 1 이상',
}

const tailSteps = (n: number): AgentStep[] => [
  { id: 's10', tool: 'rank_causes', title: '원인 순위 작성 (LLM)', ms: 1600, summary: '후보 3개. 판단 보류 아님' },
  { id: 's11', tool: 'verify_source', title: '원자료 대조', ms: 700, summary: `출력 문장 속 숫자와 시각 ${n}개 모두 원자료와 일치` },
]

const hypoxic: Candidate = {
  cause: 1, uncertainty: '낮음',
  temporal: '저혈압 시작 (03-10 17:00) 이 사건 채혈 (03-11 06:05) 보다 13시간 앞섬',
  support: [
    { text: 'MAP 65 미만 3시간, 최저 52', time: '03-10 17:00~19:59', ref: { tab: 'vital', row: 'map', from: '2026-03-10 17:00', to: '2026-03-10 19:00' } },
    { text: '노르에피네프린 시작, 최대 0.35 mcg/kg/min', time: '03-10 17:40', ref: { tab: 'mar', row: 'NE' } },
    { text: '바소프레신 추가', time: '03-10 20:30', ref: { tab: 'mar', row: 'VP' } },
    { text: '젖산 최고 6.8 mmol/L', time: '03-10 22:10', ref: { tab: 'lab', row: 'LAC', col: 'P4-LAC' } },
    { text: 'SpO2 최저 86%', time: '03-10 17:00', ref: { tab: 'vital', row: 'spo2', from: '2026-03-10 17:00', to: '2026-03-10 18:00' } },
    { text: '쇼크 3시간 뒤 AST 182 가 ALT 96 보다 먼저 오름', time: '03-10 20:30', ref: { tab: 'lab', row: 'AST', col: 'PE-AST' } },
    { text: 'AST 689 가 ALT 412 보다 높고 LDH 1,240 으로 크게 오름 (허혈성에 흔한 양상)', time: '03-11 06:05', ref: { tab: 'lab', row: 'LDH', col: 'P6-LDH' } },
  ],
  against: [],
  missing: [
    { text: '심초음파 없음 → 울혈이 함께 있는지 모름', ref: { tab: 'proc', row: 'miss-echo' } },
  ],
}

const dili: Candidate = {
  cause: 4, uncertainty: '높음',
  temporal: '아미오다론 시작이 사건 채혈보다 11시간 앞섬',
  support: [
    { text: '아미오다론 정맥 부하 뒤 지속 주입', time: '03-10 18:40', ref: { tab: 'mar', row: 'AMIO' } },
    { text: '피페라실린/타조박탐 투여 2.3일째', time: '03-08 22:00~', ref: { tab: 'mar', row: 'PIP' } },
  ],
  against: [
    { text: '같은 시점의 쇼크로 충분히 설명됨' },
    { text: '피페라실린/타조박탐은 잠복기가 짧고 대개 담즙정체형이라 패턴이 맞지 않음' },
  ],
  missing: [
    { text: '약을 끊은 뒤 반응은 t0 뒤 정보라 판단에 쓰지 않음' },
  ],
}

const congestive = (b: boolean): Candidate => ({
  cause: 2, uncertainty: '높음',
  support: [
    { text: '신속 심방세동, 심박 최고 152', time: '03-10 17:00', ref: { tab: 'vital', row: 'hr', from: '2026-03-10 16:00', to: '2026-03-10 18:00' } },
    { text: 'CVP 15 mmHg 로 오름', time: '03-10 19:00~22:00', ref: { tab: 'vital', row: 'cvp', from: '2026-03-10 19:00', to: '2026-03-10 22:00' } },
    ...(b ? [{ text: '군집 2 (모델 1): 하루 안 급상승한 간세포형. 설명표에서 승압제, 저혈압 맥락이 많고 간독성 약 노출은 적음' }] : []),
  ],
  against: [
    { text: '울혈만으로는 AST 가 10배 넘게 갑자기 오르는 일이 드묾' },
  ],
  missing: [
    { text: '심초음파 없음', ref: { tab: 'proc', row: 'miss-echo' } },
    { text: 'BNP 측정 없음', ref: { tab: 'proc', row: 'miss-bnp' } },
  ],
})

const suspectDrugs = [
  { drug: 'Amiodarone (IV)', latency: '11시간', hepatotox: '정맥 투여 직후 급성 손상 보고 있음', pattern: '간세포형, 맞음', ref: { tab: 'mar' as const, row: 'AMIO' } },
  { drug: 'Piperacillin/Tazobactam', latency: '2.3일', hepatotox: '드묾', pattern: '주로 담즙정체형, 안 맞음', ref: { tab: 'mar' as const, row: 'PIP' } },
  { drug: 'Acetaminophen', latency: '1.7일 (2회)', hepatotox: '용량 의존', pattern: '650 mg 2회로 용량이 낮음', ref: { tab: 'mar' as const, row: 'APAP' } },
]

const recommendedTests = [
  { name: '심초음파', why: 'Congestive hepatopathy 와 심기능 확인. 이 자료에 없음' },
  { name: '복부 초음파와 Doppler', why: '간 혈류와 담도 확인 (담도폐쇄, 담낭염 배제)' },
  { name: '12~24시간 뒤 AST, ALT, LDH 재측정', why: '빠르게 내려가면 허혈성 쪽' },
]

export const runs: AgentRun[] = [
  {
    caseId: 'c01', condition: 'A', handwritten: true, llm: '(연결 전)', promptVersion: 'draft-1016',
    steps: [...commonSteps, ...tailSteps(16)],
    summary: '쇼크와 저산소가 사건보다 13시간 앞서고, AST 우세와 LDH 상승이 맞아 Hypoxic hepatitis 가 1순위.',
    abstain: false,
    candidates: [hypoxic, dili, congestive(false)],
    suspectDrugs, recommendedTests,
    verification: { total: 16, matched: 16, issues: [] },
  },
  {
    caseId: 'c01', condition: 'B', handwritten: true, llm: '(연결 전)', promptVersion: 'draft-1016',
    steps: [...commonSteps, model1Step, ...tailSteps(17)],
    summary: 'Hypoxic hepatitis 가 1순위. 군집 정보 (혈역학 맥락이 많은 패턴) 로 Congestive hepatopathy 가 DILI 보다 앞섬.',
    abstain: false,
    candidates: [hypoxic, congestive(true), dili],
    suspectDrugs, recommendedTests,
    verification: { total: 17, matched: 17, issues: [] },
  },
]
