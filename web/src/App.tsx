import { useEffect, useMemo, useRef, useState } from 'react'
import type { LiverEvent, PanelView, QaMsg, Ref, TabId } from './types'
import { patients } from './data/patients'
import { getCase, getRun, getSim, type Sim } from './data'
import { route } from './data/qa'
import { answerWiki, probeRag, type RagServer } from './data/rag'
import { isKnown } from './lib/events'
import { dayIndex, hoursBetween, isAfter, toMs } from './lib/time'
import { cls, type Highlight } from './lib/ui'
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

const TABS: { id: TabId; label: string }[] = [
  { id: 'lab', label: '검사결과' },
  { id: 'mar', label: '투약기록 (MAR)' },
  { id: 'vital', label: '활력징후' },
  { id: 'micro', label: '미생물' },
  { id: 'proc', label: '영상·처치' },
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
  const [patientId, setPatientId] = useState('c1')
  const patient = patients.find(p => p.id === patientId)!
  const cs = caseOf(patientId)
  const sim = cs ? getSim(cs) : undefined

  const [clock, setClock] = useState(() => sim?.ticks[0] ?? NO_CASE_CLOCK)
  const [playing, setPlaying] = useState(false)
  const [rate, setRate] = useState(1)
  const [view, setView] = useState<PanelView>(1)
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

  const run = cs ? getRun(cs.id) : undefined
  const events = sim ? [sim.first, sim.target].filter((e): e is LiverEvent => isKnown(e, clock)) : []
  const ticks = sim?.ticks ?? []
  const idx = ticks.indexOf(clock)

  /**
   * 기준 시각 옮기기. natural 은 재생이나 한 시간 넘기기 (사건 시점에서 멈추고 그 에이전트를 보여 줌),
   * 아니면 시간선에서 바로 옮긴 것 (원인 추정은 이미 끝난 것으로 보여 줌).
   * 첫 이상 때 종료 상태 예측과 원인 추정이 함께 돌고, 5배 사건 때 발생 예측의 정답을 확인한다.
   */
  const moveTo = (next: string, natural: boolean) => {
    if (!sim || next === clock) return
    const prev = clock
    const fwd = toMs(next) > toMs(prev)
    const crossed = (t?: string) => !!t && fwd && toMs(prev) < toMs(t) && toMs(t) <= toMs(next)
    setClock(next)
    setHl(null)
    if (!fwd) {
      if (sim.first && toMs(next) < toMs(sim.first.detectAt)) setSt(IDLE)
      // 질의응답도 그 시각 뒤의 답은 지움 (뒤의 기록으로 만든 답이라)
      setQa(q => q.filter(m => !isAfter(m.clock, next)))
      if (qaPending) {
        qaTicket.current++
        setQaPending(null)
      }
      return
    }
    if (crossed(sim.first?.detectAt)) {
      const n = run?.steps.length ?? 0
      setSt(s => (s.phase === 'idle' ? (natural ? { phase: 'running', step: 0 } : { phase: 'done', step: n }) : s))
      if (natural) {
        setView(3)
        setPlaying(false)
      }
    } else if (crossed(sim.target?.detectAt) || crossed(sim.a1.firstAlarm)) {
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

  const startRun = () => isKnown(sim?.first, clock) && setSt({ phase: 'running', step: 0 })
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
        msg = { q: r.q, kind: '지식', clock: at, answer: { status: 'notFound', sources: [], text: [e instanceof Error ? e.message : '근거 위키를 읽지 못했습니다.'] } }
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
  const elapsed = cs ? (out ? 'ICU 퇴실' : `D+${dayIndex(cs.icuIn, clock)} · 입실 뒤 ${Math.floor(hoursBetween(cs.icuIn, clock))}시간`) : undefined

  const status = !sim
    ? '준비'
    : [
        playing ? `재생 중 ${rate}×` : '정지',
        st.phase === 'running' && run ? `원인 추정 실행 중 · ${st.step + 1}/${run.steps.length} ${run.steps[st.step].title}` : null,
        isKnown(sim.target, clock) ? '5배 사건 발생' : isKnown(sim.first, clock) ? '첫 이상 (2배) 발생' : null,
      ]
        .filter(Boolean)
        .join(' · ')

  const log = cs && sim
    ? {
        기준시각: clock,
        자료: '이 시각까지 공개된 기록 (공개 시각 = max(채혈, 보고))',
        agent1_발생예측: (() => {
          const a = a1Now(sim, clock)
          return a.unknown ? { 판정: '판정 불가', 이유: a.unknown } : a.point ?? null
        })(),
        agent2_종료상태: isKnown(sim.first, clock) ? { t0: sim.first.t0, 실행: sim.first.detectAt, ...sim.models?.agent2 } : null,
        agent3_원인추정: st.phase === 'done' && run ? { 실행: sim.first?.detectAt, ...run, handwritten: undefined } : null,
        agent4_24시간궤적: a4Now(cs, sim, clock).forecasts.map(f => ({ code: f.code, last: f.last, points: f.points })),
        질의응답: qa.map(m => ({
          질문: m.q, 기준시각: m.clock, 방식: m.answer.mode, 상태: m.answer.status ?? '답함',
          위키조각: m.answer.hits?.map(h => `${h.heading} (${h.score.toFixed(1)})`), 인용확인: m.answer.llm?.checks, 출처: m.answer.sources.map(s => s.label),
        })),
      }
    : null

  return (
    <div className="app">
      <TopBar now={clock} />
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
      <main className="main">
        <PatientList selected={patientId} onSelect={selectPatient} live={live} />
        <section className="panel center">
          {cs && sim ? (
            <>
              <Timeline cs={cs} sim={sim} clock={clock} onSeek={t => moveTo(t, false)} onJump={jump} onAgent={setView} />
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
                    {t.label}
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
              <div className="nr-title">{patient.name} · {patient.bed}</div>
              <div className="muted">조회된 진료 기록이 없습니다.</div>
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
        <Modal title={`AI 실행 기록 · ${patient.bed} · ${clock} 기준`} onClose={() => setModal(null)} wide>
          <p className="muted">네 에이전트와 질의응답의 이 시각 입력 범위와 출력입니다. 원인 추정은 실행이 끝난 뒤에 보입니다.</p>
          <pre className="log">{JSON.stringify(log, (_k, v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v), 2)}</pre>
        </Modal>
      )}
      {modal === 'help' && (
        <Modal title="도움말" onClose={() => setModal(null)}>
          <div className="help">
            <p>ICU 환자의 간 검사 이상을 <b>생기기 전, 생긴 순간, 재원 내내</b> 따라가는 에이전트 네 개가 같은 화면에서 돕니다. 화면의 모든 기록은 <b>기준 시각</b>까지 공개된 것만 보입니다.</p>
            <table className="mini-grid help-grid">
              <thead><tr><th>에이전트</th><th>도는 시점</th><th>출력</th></tr></thead>
              <tbody>
                <tr><td>1 발생 예측</td><td>첫 이상 전 매시간 (정상 구간만)</td><td>24시간 안 5배 사건 확률과 변수 묶음별 기여 (그래디언트 부스팅, MIMIC-IV 학습). 정상 구간이 아니면 판정 불가</td></tr>
                <tr><td>2 종료 상태</td><td>첫 이상 (2배) 때 한 번</td><td>ICU 퇴실 때 회복 여부 x ICU 사망 여부 4경로 확률, ICU 사망 확률 (그래디언트 부스팅)</td></tr>
                <tr><td>3 원인 추정</td><td>첫 이상 (2배) 때 한 번</td><td>원인 범주 10개마다 규칙 점수와 근거 (규칙 기준 모델, 학습 없음). 1.0 이상이면 해당 (여러 개 가능)</td></tr>
                <tr><td>4 24시간 궤적</td><td>입실부터 매시간</td><td>6, 12, 18, 24시간 뒤 ALT, AST, ALP, 총빌리 예측 (분위 그래디언트 부스팅, 10~90%)</td></tr>
                <tr><td>질의응답</td><td>물을 때</td><td>이 환자 질문은 사례 자료와 에이전트 출력으로, 지식 질문은 근거 위키 (원문 13편) 를 검색해 답하고 원문과 쪽수를 붙임</td></tr>
              </tbody>
            </table>
            <h4>사용 방법</h4>
            <ol>
              <li>위쪽 <b>재생</b>을 누르면 한 시간씩 넘어갑니다. 경보, 첫 이상, 5배 사건 시점에서 멈추고 그 에이전트를 보여 줍니다.</li>
              <li>시간선의 빈 곳을 누르거나 끌면 기준 시각을 바로 옮깁니다.</li>
              <li>오른쪽 카드를 누르면 에이전트별 결과가 보입니다. 근거 줄을 누르면 해당 원자료로 이동합니다.</li>
              <li><b>질의응답</b>에서 질문을 누르거나 입력하면 그 시각까지의 기록이나 근거 위키로 답합니다. 위키 조각과 인용을 누르면 위키 원문 요약이 열립니다.</li>
            </ol>
            <h4>지키는 원칙</h4>
            <ul>
              <li>사건 기준: ALT, ALP, 총빌리 중 하나가 그 행의 기록 상한의 2배 (첫 이상) 또는 5배 이상. t0 는 공개 시각 (채혈 시각과 보고 시각 중 늦은 쪽) 입니다.</li>
              <li>ICU 입실 전 같은 입원에서 이미 2배 이상이던 환자는 분석 대상이 아닙니다.</li>
              <li>에이전트는 그 시각까지 공개된 기록만 봅니다. 원인 범주 해당은 확진이 아니고, 치료나 약 중단 결정은 출력하지 않습니다. 검사를 안 한 것은 반대 근거가 아니라 없는 근거입니다.</li>
              <li>종료 상태 예측과 군집 정보는 원인 판정에 쓰지 않고 따로 보여 줍니다. 질의응답은 근거가 없으면 답하지 않습니다.</li>
              <li>"확신" 은 모델 출력이 아니라 화면 표시입니다. 발생 예측은 젖산과 INR 이 24시간 안에 있는지, 원인 추정은 해당 범주 수와 판단 보류로 정합니다.</li>
            </ul>
            <p className="help-foot">KCD 2026 연구용 화면입니다. 환자 정보는 실제 환자가 아닙니다.</p>
          </div>
        </Modal>
      )}
      {wikiAt && <WikiModal key={`${wikiAt.page}#${wikiAt.heading ?? ''}`} at={wikiAt} onClose={() => setWikiAt(null)} />}
      <div className="narrow-notice">이 화면은 너비 1280px 이상에서 사용할 수 있습니다.</div>
    </div>
  )
}
