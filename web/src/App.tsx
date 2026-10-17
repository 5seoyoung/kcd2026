import { useEffect, useMemo, useRef, useState } from 'react'
import type { LiverEvent, PanelView, QaMsg, Ref, TabId } from './types'
import { patients } from './data/patients'
import { getCase, getRun, getSim, type Sim } from './data'
import { route } from './data/qa'
import { answerWiki, probeRag, type RagServer } from './data/rag'
import { isKnown } from './lib/events'
import { dayIndex, hoursBetween, isAfter, toMs } from './lib/time'
import { cls, type Highlight } from './lib/ui'
import { bi, pick, tr, useLang, type Bi } from './lib/i18n'
import { tx } from './data/cases/en'
import { setDesktop } from './lib/viewport'
import { TopBar } from './components/TopBar'
import { Toolbar } from './components/Toolbar'
import { PatientList, type LiveRow } from './components/PatientList'
import { PatientBanner } from './components/PatientBanner'
import { StatusBar } from './components/StatusBar'
import { Timeline } from './components/Timeline'
import { Modal } from './components/Modal'
import { WikiModal, type WikiAt } from './components/WikiModal'
import { LabTab } from './components/tabs/LabTab'
import { MarTab } from './components/tabs/MarTab'
import { VitalTab } from './components/tabs/VitalTab'
import { MicroTab } from './components/tabs/MicroTab'
import { ProcTab } from './components/tabs/ProcTab'
import { AgentPanel } from './components/agent/AgentPanel'
import { a1Now, a4Now, type RunState } from './components/agent/state'

const TABS: { id: TabId; label: Bi }[] = [
  { id: 'lab', label: bi('검사결과', 'Labs') },
  { id: 'mar', label: bi('투약기록 (MAR)', 'MAR') },
  { id: 'vital', label: bi('활력징후', 'Vitals') },
  { id: 'micro', label: bi('미생물', 'Microbiology') },
  { id: 'proc', label: bi('영상·처치', 'Imaging & procedures') },
]

const IDLE: RunState = { phase: 'idle', step: 0 }
/** 재생 1× 에서 한 시간이 지나가는 시간 (ms) */
const TICK_MS = 700
/** 질의응답 답을 보여 주기 전 최소로 기다리는 시간 (ms) */
const QA_MS = 500
const NO_CASE_CLOCK = '2026-03-11 08:00'

const caseOf = (patientId: string) => {
  const p = patients.find(x => x.id === patientId)!
  return p.caseId ? getCase(p.caseId) : undefined
}

export default function App() {
  // 언어가 바뀌면 전체를 다시 그림 (사례 자료와 에이전트 출력도 그 언어로 다시 만듦)
  const lang = useLang()
  const [patientId, setPatientId] = useState('c1')
  const patient = patients.find(p => p.id === patientId)!
  const cs = caseOf(patientId)
  const sim = cs ? getSim(cs) : undefined

  const [clock, setClock] = useState(() => sim?.ticks[0] ?? NO_CASE_CLOCK)
  const [playing, setPlaying] = useState(false)
  const [rate, setRate] = useState(1)
  const [view, setView] = useState<PanelView>(1)
  // 좁은 화면에서는 에이전트와 진료 기록을 번갈아 보여 줌
  const [mPane, setMPane] = useState<'agents' | 'records'>('agents')
  const [tab, setTab] = useState<TabId>('lab')
  const [hl, setHl] = useState<Highlight>(null)
  const [st, setSt] = useState<RunState>(IDLE)
  const [stepSpeed, setStepSpeed] = useState(1)
  const [modal, setModal] = useState<'log' | 'help' | null>(null)
  const [qa, setQa] = useState<QaMsg[]>([])
  const [qaPending, setQaPending] = useState<string | null>(null)
  const [wikiAt, setWikiAt] = useState<WikiAt | null>(null)
  const [server, setServer] = useState<RagServer | null>(null)
  // 답을 기다리는 동안 환자를 바꾸거나 시간을 되돌리면 그 답은 버림
  const qaTicket = useRef(0)
  const clockRef = useRef(clock)
  clockRef.current = clock

  useEffect(() => {
    probeRag().then(setServer)
  }, [])

  // 언어를 바꾸면 이미 받은 질의응답은 지움 (그 언어로 만든 답이라)
  useEffect(() => {
    setQa([])
  }, [lang])

  const run = cs ? getRun(cs.id) : undefined
  const events = sim ? [sim.first, sim.target].filter((e): e is LiverEvent => isKnown(e, clock)) : []
  const ticks = sim?.ticks ?? []
  const idx = ticks.indexOf(clock)

  /**
   * 기준 시각 옮기기. natural 은 재생이나 한 시간 넘기기 (사건 시점에서 멈추고 그 에이전트를 보여 줌),
   * 아니면 시간선에서 바로 옮긴 것 (원인 추정은 이미 끝난 것으로 보여 줌).
   * 첫 이상 (2배) 때 발생 예측이 멈추고, 5배 사건 때 종료 상태 예측과 원인 추정이 함께 돈다.
   */
  const moveTo = (next: string, natural: boolean) => {
    if (!sim || next === clock) return
    const prev = clock
    const fwd = toMs(next) > toMs(prev)
    const crossed = (t?: string) => !!t && fwd && toMs(prev) < toMs(t) && toMs(t) <= toMs(next)
    setClock(next)
    setHl(null)
    if (!fwd) {
      if (sim.target && toMs(next) < toMs(sim.target.detectAt)) setSt(IDLE)
      // 질의응답도 그 시각 뒤의 답은 지움 (뒤의 기록으로 만든 답이라)
      setQa(q => q.filter(m => !isAfter(m.clock, next)))
      if (qaPending) {
        qaTicket.current++
        setQaPending(null)
      }
      return
    }
    if (crossed(sim.target?.detectAt)) {
      const n = run?.steps.length ?? 0
      setSt(s => (s.phase === 'idle' ? (natural ? { phase: 'running', step: 0 } : { phase: 'done', step: n }) : s))
      if (natural) {
        setView(3)
        setPlaying(false)
      }
    } else if (crossed(sim.first?.detectAt) || crossed(sim.a1.firstAlarm)) {
      if (natural) {
        setView(1)
        setPlaying(false)
      }
    }
    if (next === sim.ticks.at(-1)) setPlaying(false)
  }

  const stepBy = (n: number, natural: boolean) => {
    if (!sim) return
    const i = Math.max(0, Math.min(ticks.length - 1, idx + n))
    if (i === idx) setPlaying(false)
    else moveTo(ticks[i], natural)
  }

  // 재생: 한 시간씩 넘긴다
  useEffect(() => {
    if (!playing || !sim) return
    const id = setTimeout(() => stepBy(1, true), TICK_MS / rate)
    return () => clearTimeout(id)
    // stepBy 는 clock 이 바뀔 때마다 새로 만들어지므로 clock 만 보면 된다
  }, [playing, clock, rate, sim])

  // 원인 추정 실행 기록 재생: 단계마다 기록된 시간만큼 기다렸다가 다음 단계로
  useEffect(() => {
    if (!run || st.phase !== 'running') return
    const id = setTimeout(() => {
      setSt(s => {
        const next = s.step + 1
        return next >= run.steps.length ? { phase: 'done', step: run.steps.length } : { phase: 'running', step: next }
      })
    }, run.steps[st.step].ms / stepSpeed)
    return () => clearTimeout(id)
  }, [run, st, stepSpeed])

  // 근거로 이동하면 강조된 칸이 보이게 스크롤
  useEffect(() => {
    if (!hl) return
    const id = requestAnimationFrame(() => {
      const el = document.querySelector('.center .is-hl')
      // 행 전체 강조는 세로로만 맞추고, 칸 강조는 가로로도 가운데에 둔다
      el?.scrollIntoView({ block: 'center', inline: el.tagName === 'TR' ? 'nearest' : 'center', behavior: 'smooth' })
    })
    return () => cancelAnimationFrame(id)
  }, [hl, tab])

  const resetTo = (s?: Sim) => {
    if (s) setClock(s.ticks[0])
    setPlaying(false)
    setTab('lab')
    setHl(null)
    setView(1)
    setSt(IDLE)
    setQa([])
    setQaPending(null)
    qaTicket.current++
  }

  const selectPatient = (id: string) => {
    setPatientId(id)
    const c = caseOf(id)
    resetTo(c ? getSim(c) : undefined)
  }

  const jump = (ref: Ref) => {
    setMPane('records')
    setTab(ref.tab)
    setHl(null)
    requestAnimationFrame(() => setHl(h => ({ ref, n: (h?.n ?? 0) + 1 })))
  }

  const togglePlay = () => {
    if (!sim) return
    if (playing) return setPlaying(false)
    if (idx === ticks.length - 1) moveTo(ticks[0], false)
    setPlaying(true)
  }

  const startRun = () => isKnown(sim?.target, clock) && setSt({ phase: 'running', step: 0 })
  const skipRun = () => run && setSt({ phase: 'done', step: run.steps.length })

  /** 이 환자 질문은 바로 계산하고, 지식 질문은 근거 위키 검색 (서버가 있으면 답 생성까지) */
  const onAsk = async (input: { id: string } | { text: string }) => {
    if (!cs || !sim || qaPending) return
    const at = clock
    const r = route({ cs, sim, clock: at, run: st.phase === 'done' ? run : undefined }, input)
    const ticket = ++qaTicket.current
    setQaPending(r.type === 'case' ? r.msg.q : r.q)
    const started = Date.now()
    let msg: Omit<QaMsg, 'id'>
    if (r.type === 'case') msg = r.msg
    else {
      try {
        msg = { q: r.q, kind: '지식', clock: at, answer: await answerWiki(r.q, server) }
      } catch (e) {
        msg = { q: r.q, kind: '지식', clock: at, answer: { status: 'notFound', sources: [], text: [e instanceof Error ? e.message : tr('근거 위키를 읽지 못했습니다.', 'Could not read the evidence wiki.')] } }
      }
    }
    await new Promise(res => setTimeout(res, Math.max(0, QA_MS - (Date.now() - started))))
    if (ticket !== qaTicket.current || isAfter(at, clockRef.current)) return
    setQa(q => [...q, { ...msg, id: (q.at(-1)?.id ?? 0) + 1 }])
    setQaPending(null)
  }

  const live = useMemo<Record<string, LiveRow>>(() => {
    if (!cs || !sim) return {}
    const a1 = a1Now(sim, clock)
    const alert = isKnown(sim.first, clock) ? 'event' : a1.point && !a1.ended && !a1.unknown && a1.point.p >= sim.a1.threshold ? 'risk' : null
    const out = !isAfter(cs.icuOut, clock)
    return { [cs.patientId]: { stayDay: dayIndex(cs.icuIn, clock), alert, out, dead: out && cs.outcome.icuDeath && cs.outcome.deathTime === cs.icuOut } }
  }, [cs, sim, clock])

  const out = cs && !isAfter(cs.icuOut, clock)
  const elapsedH = cs ? Math.floor(hoursBetween(cs.icuIn, clock)) : 0
  const elapsed = cs
    ? out
      ? tr('ICU 퇴실', 'Discharged from ICU')
      : tr(`D+${dayIndex(cs.icuIn, clock)} · 입실 뒤 ${elapsedH}시간`, `D+${dayIndex(cs.icuIn, clock)} · ${elapsedH} h in ICU`)
    : undefined

  const status = !sim
    ? tr('준비', 'Ready')
    : [
        playing ? tr(`재생 중 ${rate}×`, `Playing ${rate}×`) : tr('정지', 'Paused'),
        st.phase === 'running' && run
          ? tr(`원인 추정 실행 중 · ${st.step + 1}/${run.steps.length} ${run.steps[st.step].title}`, `Cause assessment running · ${st.step + 1}/${run.steps.length} ${run.steps[st.step].title}`)
          : null,
        isKnown(sim.target, clock) ? tr('5배 사건 발생', '5× event occurred') : isKnown(sim.first, clock) ? tr('첫 이상 (2배) 발생', 'First abnormality (2×) occurred') : null,
      ]
        .filter(Boolean)
        .join(' · ')

  const log = cs && sim
    ? {
        기준시각: clock,
        자료: tr('이 시각까지 공개된 기록 (공개 시각 = max(채혈, 보고))', 'Records released by this time (release time = max(drawn, reported))'),
        agent1_발생예측: (() => {
          const a = a1Now(sim, clock)
          return a.unknown ? { 판정: tr('판정 불가', 'not assessable'), 이유: a.unknown } : a.point ?? null
        })(),
        agent2_종료상태: isKnown(sim.target, clock) ? { t0: sim.target.t0, 실행: sim.target.detectAt, ...sim.models?.agent2 } : null,
        agent3_원인추정: st.phase === 'done' && run ? { 실행: sim.target?.detectAt, ...run, handwritten: undefined } : null,
        agent4_24시간궤적: a4Now(cs, sim, clock).forecasts.map(f => ({ code: f.code, last: f.last, points: f.points })),
        질의응답: qa.map(m => ({
          질문: m.q, 기준시각: m.clock, 방식: m.answer.mode, 상태: m.answer.status ?? tr('답함', 'answered'),
          위키조각: m.answer.hits?.map(h => `${h.heading} (${h.score.toFixed(1)})`), 인용확인: m.answer.llm?.checks, 출처: m.answer.sources.map(s => s.label),
        })),
      }
    : null

  return (
    <div className="app">
      <TopBar now={clock} lang={lang} />
      <Toolbar
        onReset={() => resetTo(sim)}
        onLog={() => setModal('log')}
        onHelp={() => setModal('help')}
        canLog={!!sim && !!sim.a4.start && !isAfter(sim.a4.start, clock)}
        clock={clock}
        elapsed={elapsed}
        playing={playing}
        rate={rate}
        atStart={idx <= 0}
        atEnd={idx === ticks.length - 1}
        onPlay={togglePlay}
        onStep={n => stepBy(n, true)}
        onStart={() => moveTo(ticks[0], false)}
        onRate={setRate}
      />
      <PatientBanner p={patient} cs={cs} clock={clock} />
      <main className={cls('main', `m-${mPane}`)}>
        <div className="m-bar">
          <select className="m-patient" value={patientId} onChange={e => selectPatient(e.target.value)} aria-label={tr('환자 선택', 'Choose patient')}>
            {patients.map(p => (
              <option key={p.id} value={p.id}>{p.bed} · {tx(p.name)}{p.caseId ? '' : tr(' (기록 없음)', ' (no records)')}</option>
            ))}
          </select>
          <div className="m-seg" role="tablist" aria-label={tr('보기', 'View')}>
            <button role="tab" aria-selected={mPane === 'agents'} className={cls(mPane === 'agents' && 'on')} onClick={() => setMPane('agents')}>{tr('AI 에이전트', 'AI agents')}</button>
            <button role="tab" aria-selected={mPane === 'records'} className={cls(mPane === 'records' && 'on')} onClick={() => setMPane('records')}>{tr('진료 기록', 'Records')}</button>
          </div>
          <button className="link m-desk" onClick={() => setDesktop(true)}>{tr('PC 화면으로 보기', 'Desktop view')}</button>
        </div>
        <PatientList selected={patientId} onSelect={selectPatient} live={live} />
        <section className="panel center">
          {cs && sim ? (
            <>
              <Timeline cs={cs} sim={sim} clock={clock} onSeek={t => moveTo(t, false)} onJump={jump} onAgent={v => { setView(v); setMPane('agents') }} />
              <div className="tabs" role="tablist">
                {TABS.map(t => (
                  <button
                    key={t.id}
                    role="tab"
                    aria-selected={tab === t.id}
                    className={cls('tab', tab === t.id && 'active')}
                    onClick={() => {
                      setTab(t.id)
                      setHl(null)
                    }}
                  >
                    {pick(t.label)}
                  </button>
                ))}
              </div>
              <div className="tab-panel" role="tabpanel">
                {tab === 'lab' && <LabTab cs={cs} clock={clock} events={events} hl={hl} />}
                {tab === 'mar' && <MarTab cs={cs} clock={clock} hl={hl} />}
                {tab === 'vital' && <VitalTab cs={cs} clock={clock} events={events} hl={hl} />}
                {tab === 'micro' && <MicroTab cs={cs} clock={clock} hl={hl} />}
                {tab === 'proc' && <ProcTab cs={cs} clock={clock} hl={hl} />}
              </div>
            </>
          ) : (
            <div className="not-ready">
              <div className="nr-title">{tx(patient.name)} · {patient.bed}</div>
              <div className="muted">{tr('조회된 진료 기록이 없습니다.', 'No clinical records found.')}</div>
            </div>
          )}
        </section>
        <AgentPanel
          patient={patient}
          cs={cs}
          sim={sim}
          clock={clock}
          events={events}
          selected={view}
          onSelect={setView}
          run={run}
          state={st}
          onRun={startRun}
          onSkip={skipRun}
          speed={stepSpeed}
          onSpeed={setStepSpeed}
          onJump={jump}
          qa={qa}
          qaPending={qaPending}
          onAsk={onAsk}
          server={server}
          onWiki={setWikiAt}
        />
      </main>
      <StatusBar status={status} />

      {modal === 'log' && log && (
        <Modal title={tr(`AI 실행 기록 · ${patient.bed} · ${clock} 기준`, `AI run log · ${patient.bed} · as of ${clock}`)} onClose={() => setModal(null)} wide>
          <p className="muted">
            {tr(
              '네 에이전트와 질의응답의 이 시각 입력 범위와 출력입니다. 원인 추정은 실행이 끝난 뒤에 보입니다.',
              'Input range and output of the four agents and Q&A at this time. The cause assessment appears after its run finishes.',
            )}
          </p>
          <pre className="log">{JSON.stringify(log, (_k, v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v), 2)}</pre>
        </Modal>
      )}
      {modal === 'help' && (
        <Modal title={tr('도움말', 'Help')} onClose={() => setModal(null)}>
          {lang === 'en' ? <HelpEn /> : (
            <div className="help">
              <p>ICU 환자의 간 검사 이상을 <b>생기기 전, 생긴 순간, 재원 내내</b> 따라가는 에이전트 네 개가 같은 화면에서 돕니다. 화면의 모든 기록은 <b>기준 시각</b>까지 공개된 것만 보입니다.</p>
              <table className="mini-grid help-grid">
                <thead><tr><th>에이전트</th><th>도는 시점</th><th>출력</th></tr></thead>
                <tbody>
                  <tr><td>1 발생 예측</td><td>첫 이상 전 매시간 (정상 구간만)</td><td>24시간 안 5배 사건 확률과 변수 묶음별 기여 (그래디언트 부스팅, MIMIC-IV 학습). 정상 구간이 아니면 판정 불가</td></tr>
                  <tr><td>2 종료 상태</td><td>5배 사건 때 한 번</td><td>ICU 퇴실 때 회복 여부 x ICU 사망 여부 4경로 확률, ICU 사망 확률 (그래디언트 부스팅)</td></tr>
                  <tr><td>3 원인 추정</td><td>5배 사건 때 한 번</td><td>원인 범주 10개마다 규칙 점수와 근거 (규칙 기준 모델, 학습 없음). 1.0 이상이면 해당 (여러 개 가능)</td></tr>
                  <tr><td>4 24시간 궤적</td><td>입실부터 매시간</td><td>6, 12, 18, 24시간 뒤 ALT, AST, ALP, 총빌리 예측 (분위 그래디언트 부스팅, 10~90%)</td></tr>
                  <tr><td>질의응답</td><td>물을 때</td><td>이 환자 질문은 사례 자료와 에이전트 출력으로, 지식 질문은 근거 위키 (원문 13편) 를 검색해 답하고 원문과 쪽수를 붙임</td></tr>
                </tbody>
              </table>
              <h4>사용 방법</h4>
              <ol>
                <li>위쪽 <b>재생</b>을 누르면 한 시간씩 넘어갑니다. 경보, 첫 이상, 5배 사건 시점에서 멈추고 그 에이전트를 보여 줍니다. 5배 사건 때는 원인 추정이 단계별로 실행됩니다.</li>
                <li>시간선의 빈 곳을 누르거나 끌면 기준 시각을 바로 옮깁니다.</li>
                <li>오른쪽 카드를 누르면 에이전트별 결과가 보입니다. 근거 줄을 누르면 해당 원자료로 이동합니다.</li>
                <li><b>질의응답</b>에서 질문을 누르거나 입력하면 그 시각까지의 기록이나 근거 위키로 답합니다. 위키 조각과 인용을 누르면 위키 원문 요약이 열립니다.</li>
              </ol>
              <h4>지키는 원칙</h4>
              <ul>
                <li>사건 기준: ALT, ALP, 총빌리 중 하나가 그 행의 기록 상한의 2배 (첫 이상, 발생 예측이 멈춤) 또는 5배 이상 (5배 사건, 종료 상태와 원인 추정이 돎). t0 는 공개 시각 (채혈 시각과 보고 시각 중 늦은 쪽) 입니다.</li>
                <li>ICU 입실 전 같은 입원에서 이미 2배 이상이던 환자는 분석 대상이 아닙니다.</li>
                <li>에이전트는 그 시각까지 공개된 기록만 봅니다. 원인 범주 해당은 확진이 아니고, 치료나 약 중단 결정은 출력하지 않습니다. 검사를 안 한 것은 반대 근거가 아니라 없는 근거입니다.</li>
                <li>종료 상태 예측과 군집 정보는 원인 판정에 쓰지 않고 따로 보여 줍니다. 질의응답은 근거가 없으면 답하지 않습니다.</li>
                <li>"확신" 은 모델 출력이 아니라 미리 고정한 규칙으로 정합니다. 발생 예측은 핵심 입력 결측, MIMIC 범위 밖, 입력 오류, 구간 폭, 사다리 뒤집힘, 종료 상태는 경로 집합 크기로 보고, 원인 추정은 근거 자료 완성도, 판정 취약, 판단 보류로 따로 표시합니다.</li>
              </ul>
              <p className="help-foot">KCD 2026 연구용 화면입니다. 환자 정보는 실제 환자가 아닙니다.</p>
            </div>
          )}
        </Modal>
      )}
      {wikiAt && <WikiModal key={`${wikiAt.page}#${wikiAt.heading ?? ''}`} at={wikiAt} onClose={() => setWikiAt(null)} />}
      <button className="btn m-back" onClick={() => setDesktop(false)}>{tr('모바일 화면으로', 'Mobile view')}</button>
    </div>
  )
}

/** 도움말 (영어). 한국어 도움말과 같은 내용 */
function HelpEn() {
  return (
    <div className="help">
      <p>Four agents run on one screen and follow liver-test abnormalities in ICU patients <b>before they occur, at onset and throughout the stay</b>. Every record on screen is shown only if it was released by the <b>as-of time</b>.</p>
      <table className="mini-grid help-grid">
        <thead><tr><th>Agent</th><th>When it runs</th><th>Output</th></tr></thead>
        <tbody>
          <tr><td>1 Early warning</td><td>Hourly before the first abnormality (normal window only)</td><td>Probability of a 5× event within 24 h and the contribution of each feature group (gradient boosting, trained on MIMIC-IV). Not assessable outside the normal window</td></tr>
          <tr><td>2 End state</td><td>Once, at the 5× event</td><td>Probabilities of the 4 paths at ICU discharge (recovered or not × ICU death or not) and the ICU death probability (gradient boosting)</td></tr>
          <tr><td>3 Cause assessment</td><td>Once, at the 5× event</td><td>Rule score and evidence for each of 10 cause categories (rule-based model, no training). Flagged at 1.0 or above (more than one possible)</td></tr>
          <tr><td>4 24-h trajectory</td><td>Hourly from ICU admission</td><td>ALT, AST, ALP and total bilirubin forecasts at 6, 12, 18 and 24 h (quantile gradient boosting, 10–90%)</td></tr>
          <tr><td>Q&amp;A</td><td>When asked</td><td>Answers questions about this patient from the case data and agent outputs, and knowledge questions by searching the evidence wiki (13 source documents, in Korean), citing the source and page</td></tr>
        </tbody>
      </table>
      <h4>How to use</h4>
      <ol>
        <li>Press <b>Play</b> at the top to move forward one hour at a time. Playback stops at an alarm, the first abnormality and the 5× event, and shows that agent. At the 5× event the cause assessment runs step by step.</li>
        <li>Click or drag an empty spot on the timeline to move the as-of time directly.</li>
        <li>Click a card on the right to see that agent's results. Click an evidence line to go to its source record.</li>
        <li>In <b>Q&amp;A</b>, click or type a question to get an answer from the records up to that time or from the evidence wiki. Click a wiki passage or citation to open a summary of the wiki source.</li>
      </ol>
      <h4>Ground rules</h4>
      <ul>
        <li>Event definition: ALT, ALP or total bilirubin reaches 2× (first abnormality; early warning stops) or 5× (5× event; end state and cause assessment run) the upper limit recorded on that row. t0 is the release time (the later of draw time and report time).</li>
        <li>Patients already at 2× or more earlier in the same hospital admission, before ICU admission, are not eligible.</li>
        <li>Agents see only records released by that time. A flagged cause category is not a diagnosis, and no treatment or drug-stopping decision is output. A test that was not done is missing evidence, not evidence against.</li>
        <li>End-state predictions and cluster information are shown separately and are not used for the cause call. Q&amp;A does not answer without evidence.</li>
        <li>"Confidence" is set by fixed rules, not by the model output. Early warning checks missing core inputs, outside MIMIC range, input errors, interval width and ladder inversion; end state checks the size of the path set; cause assessment shows evidence completeness, fragile calls and withheld calls separately.</li>
      </ul>
      <p className="help-foot">Research screen for KCD 2026. The patients shown are not real patients.</p>
    </div>
  )
}
