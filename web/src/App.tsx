import { useEffect, useMemo, useState } from 'react'
import type { AgentId, Condition, LiverEvent, Ref, TabId } from './types'
import { patients } from './data/patients'
import { getCase, getRun, getSim, type Sim } from './data'
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
const NO_CASE_CLOCK = '2026-03-11 08:00'

const caseOf = (patientId: string) => {
  const p = patients.find(x => x.id === patientId)!
  return p.caseId ? getCase(p.caseId) : undefined
}

export default function App() {
  const [patientId, setPatientId] = useState('p07')
  const patient = patients.find(p => p.id === patientId)!
  const cs = caseOf(patientId)
  const sim = cs ? getSim(cs) : undefined

  const [clock, setClock] = useState(() => sim?.ticks[0] ?? NO_CASE_CLOCK)
  const [playing, setPlaying] = useState(false)
  const [rate, setRate] = useState(1)
  const [agent, setAgent] = useState<AgentId>(1)
  const [tab, setTab] = useState<TabId>('lab')
  const [hl, setHl] = useState<Highlight>(null)
  const [condition, setCondition] = useState<Condition>('A')
  const [runs, setRuns] = useState<Record<Condition, RunState>>({ A: IDLE, B: IDLE })
  const [stepSpeed, setStepSpeed] = useState(1)
  const [modal, setModal] = useState<'log' | 'help' | null>(null)

  const run = cs ? getRun(cs.id, condition) : undefined
  const otherCond: Condition = condition === 'A' ? 'B' : 'A'
  const other = cs && runs[otherCond].phase === 'done' ? getRun(cs.id, otherCond) : undefined
  const st = runs[condition]
  const events = sim ? [sim.e2, sim.e5].filter((e): e is LiverEvent => isKnown(e, clock)) : []
  const ticks = sim?.ticks ?? []
  const idx = ticks.indexOf(clock)

  /**
   * 기준 시각 옮기기. natural 은 재생이나 한 시간 넘기기 (사건 시점에서 멈추고 그 에이전트를 보여 줌),
   * 아니면 시간선에서 바로 옮긴 것 (원인 추정은 이미 끝난 것으로 보여 줌).
   */
  const moveTo = (next: string, natural: boolean) => {
    if (!sim || next === clock) return
    const prev = clock
    const fwd = toMs(next) > toMs(prev)
    const crossed = (t?: string) => !!t && fwd && toMs(prev) < toMs(t) && toMs(t) <= toMs(next)
    setClock(next)
    setHl(null)
    if (!fwd) {
      if (sim.e5 && toMs(next) < toMs(sim.e5.detectAt)) {
        setRuns({ A: IDLE, B: IDLE })
        setCondition('A')
      }
      return
    }
    if (crossed(sim.e5?.detectAt)) {
      const n = cs ? getRun(cs.id, 'A')?.steps.length ?? 0 : 0
      setCondition('A')
      setRuns(r => (r.A.phase === 'idle' ? { ...r, A: natural ? { phase: 'running', step: 0 } : { phase: 'done', step: n } } : r))
      if (natural) {
        setAgent(3)
        setPlaying(false)
      }
    } else if (crossed(sim.e2?.detectAt) || crossed(sim.a1.firstAlarm)) {
      if (natural) {
        setAgent(crossed(sim.e2?.detectAt) ? 2 : 1)
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
      setRuns(s => {
        const next = s[condition].step + 1
        return { ...s, [condition]: next >= run.steps.length ? { phase: 'done', step: run.steps.length } : { phase: 'running', step: next } }
      })
    }, run.steps[st.step].ms / stepSpeed)
    return () => clearTimeout(id)
  }, [run, st, condition, stepSpeed])

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
    setAgent(1)
    setCondition('A')
    setRuns({ A: IDLE, B: IDLE })
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

  const startRun = () => isKnown(sim?.e5, clock) && setRuns(s => ({ ...s, [condition]: { phase: 'running', step: 0 } }))
  const skipRun = () => run && setRuns(s => ({ ...s, [condition]: { phase: 'done', step: run.steps.length } }))

  const live = useMemo<Record<string, LiveRow>>(() => {
    if (!cs || !sim) return {}
    const a1 = a1Now(sim, clock)
    const alert = isKnown(sim.e2, clock) ? 'event' : a1.point && !a1.ended && a1.point.p >= sim.a1.threshold ? 'risk' : null
    return { [cs.patientId]: { stayDay: dayIndex(cs.icuIn, clock), alert, out: !isAfter(cs.icuOut, clock) } }
  }, [cs, sim, clock])

  const out = cs && !isAfter(cs.icuOut, clock)
  const elapsed = cs ? (out ? 'ICU 퇴실' : `D+${dayIndex(cs.icuIn, clock)} · 입실 뒤 ${Math.floor(hoursBetween(cs.icuIn, clock))}시간`) : undefined

  const status = !sim
    ? '준비'
    : [
        playing ? `재생 중 ${rate}×` : '정지',
        st.phase === 'running' && run ? `원인 추정 실행 중 (${condition} 조건) · ${st.step + 1}/${run.steps.length} ${run.steps[st.step].title}` : null,
        isKnown(sim.e5, clock) ? '5배 사건 발생' : isKnown(sim.e2, clock) ? '2배 사건 발생' : null,
      ]
        .filter(Boolean)
        .join(' · ')

  const log = cs && sim
    ? {
        기준시각: clock,
        자료: '이 시각까지 결과가 나온 기록',
        agent1_발생예측: a1Now(sim, clock).point ?? null,
        agent2_종료상태: isKnown(sim.e2, clock) ? { t0: sim.e2.t0, 실행: sim.e2.detectAt, ...sim.models?.agent2 } : null,
        agent3_원인추정: st.phase === 'done' && run ? { ...run, handwritten: undefined } : null,
        agent4_24시간궤적: a4Now(cs, sim, clock).forecasts.map(f => ({ code: f.code, last: f.last, at24h: f.points.at(-1) })),
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
              <Timeline cs={cs} sim={sim} clock={clock} onSeek={t => moveTo(t, false)} onJump={jump} onAgent={setAgent} />
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
          selected={agent}
          onSelect={setAgent}
          run={run}
          other={other}
          state={st}
          condition={condition}
          onCondition={setCondition}
          onRun={startRun}
          onSkip={skipRun}
          speed={stepSpeed}
          onSpeed={setStepSpeed}
          onJump={jump}
        />
      </main>
      <StatusBar status={status} />

      {modal === 'log' && log && (
        <Modal title={`AI 실행 기록 · ${patient.bed} · ${clock} 기준`} onClose={() => setModal(null)} wide>
          <p className="muted">네 에이전트의 이 시각 입력 범위와 출력입니다. 원인 추정은 실행이 끝난 뒤에 보입니다.</p>
          <pre className="log">{JSON.stringify(log, (_k, v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v), 2)}</pre>
        </Modal>
      )}
      {modal === 'help' && (
        <Modal title="도움말" onClose={() => setModal(null)}>
          <div className="help">
            <p>ICU 환자의 간 검사 이상을 <b>생기기 전, 생긴 순간, 재원 내내</b> 따라가는 에이전트 네 개가 같은 화면에서 돕니다. 화면의 모든 기록은 <b>기준 시각</b>까지 나온 것만 보입니다.</p>
            <table className="mini-grid help-grid">
              <thead><tr><th>에이전트</th><th>도는 시점</th><th>출력</th></tr></thead>
              <tbody>
                <tr><td>1 발생 예측</td><td>5배 사건 전 매시간</td><td>24시간 안 5배 사건 확률. 사건이 생기면 멈춤</td></tr>
                <tr><td>2 종료 상태</td><td>2배 사건 때 한 번</td><td>ICU 퇴실 때 회복 여부 x 생존 여부 4가지 확률</td></tr>
                <tr><td>3 원인 추정</td><td>5배 사건 때 한 번</td><td>원인 범주 10개 중 3순위와 근거, A 와 B 조건 비교</td></tr>
                <tr><td>4 24시간 궤적</td><td>입실부터 매시간</td><td>앞으로 24시간 ALT, ALP, 총빌리 예측선</td></tr>
              </tbody>
            </table>
            <h4>사용 방법</h4>
            <ol>
              <li>위쪽 <b>재생</b>을 누르면 한 시간씩 넘어갑니다. 경보, 2배 사건, 5배 사건 시점에서 멈추고 그 에이전트를 보여 줍니다.</li>
              <li>시간선의 빈 곳을 누르거나 끌면 기준 시각을 바로 옮깁니다.</li>
              <li>오른쪽 카드를 누르면 에이전트별 결과가 보입니다. 근거 줄을 누르면 해당 원자료로 이동합니다.</li>
              <li>원인 추정은 <b>B 군집 정보 추가</b>로 바꿔 다시 실행하고 순위를 비교할 수 있습니다.</li>
            </ol>
            <h4>지키는 원칙</h4>
            <ul>
              <li>사건 기준: ALT, ALP, 총빌리 중 하나가 기준 상한의 2배 또는 5배 이상. t0 는 그 결과의 채혈 시각입니다.</li>
              <li>에이전트는 그 시각까지 결과가 나온 기록만 봅니다. 원인 추정은 t0 까지의 기록과 같은 채혈 결과만 씁니다.</li>
              <li>원인 후보는 확진이 아니고, 치료나 약 중단 결정은 출력하지 않습니다. 검사를 안 한 것은 반대 근거가 아니라 누락 근거입니다.</li>
              <li>종료 상태 예측은 원인 판단에 쓰지 않고 따로 보여 줍니다.</li>
            </ul>
            <p className="help-foot">KCD 2026 연구용 화면입니다. 환자 정보는 실제 환자가 아닙니다.</p>
          </div>
        </Modal>
      )}
      <div className="narrow-notice">이 화면은 너비 1280px 이상에서 사용할 수 있습니다.</div>
    </div>
  )
}
