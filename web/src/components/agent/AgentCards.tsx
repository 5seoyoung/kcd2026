import type { ReactNode } from 'react'
import type { AgentRun, CaseData, PanelView } from '../../types'
import type { Sim } from '../../data'
import { causeName } from '../../data/causes'
import { END_STATES, itemOf, RULE_THRESHOLD, uln } from '../../lib/events'
import { fmtNum } from '../../lib/lab'
import { hm, isAfter, mdhm } from '../../lib/time'
import { cls } from '../../lib/ui'
import { a1Now, a1Verdict, a4Now, crossing, pct, targetKnown, type RunState } from './state'
import { lang, tr } from '../../lib/i18n'

interface Props {
  cs: CaseData
  sim: Sim
  clock: string
  selected: PanelView
  onSelect: (v: PanelView) => void
  run?: AgentRun
  runState: RunState
  qaCount: number
}

type Status = 'wait' | 'live' | 'run' | 'done' | 'off'

interface Card {
  id: 1 | 2 | 3 | 4
  name: string
  when: string
  status: Status
  statusText: string
  main: ReactNode
  sub: string
  /** 출력이 바뀔 때마다 바뀌는 값 (바뀌면 잠깐 강조) */
  stamp: string
  alarm?: boolean
}

const short = (name: string) => name.split(' (')[0]

export function AgentCards({ cs, sim, clock, selected, onSelect, run, runState, qaCount }: Props) {
  const cards: Card[] = []
  // 5배 사건 없이 퇴실하면 종료 상태와 원인 추정은 돌지 않음
  const noTarget = !sim.target && !isAfter(cs.icuOut, clock)
  // 상태 이름
  const S = {
    na: tr('대상 아님', 'Not eligible'), wait: tr('대기', 'Waiting'), stop: tr('종료', 'Stopped'), hourly: tr('매시간', 'Hourly'),
    done: tr('완료', 'Done'), running: tr('실행 중', 'Running'),
  }
  const en = lang() === 'en'
  const lowChip = <span className="agc-low">{tr('확신 낮음', 'Low conf.')}</span>

  // 1 발생 예측
  {
    const { point, unknown, started, ended } = a1Now(sim, clock)
    const base = { id: 1 as const, name: tr('발생 예측', 'Early warning'), when: tr('첫 이상 전 매시간', 'Hourly') }
    const v = a1Verdict(sim, clock)
    if (sim.excluded) cards.push({ ...base, status: 'off', statusText: S.na, main: '–', sub: tr('ICU 입실 전 이미 2배 이상', '≥ 2× before ICU admission'), stamp: 'na' })
    else if (sim.a1.notEligible && sim.first && !isAfter(sim.first.detectAt, clock))
      cards.push({ ...base, status: 'off', statusText: S.na, main: tr('조기 예측 대상 아님', 'Not eligible for early warning'), sub: sim.a1.notEligible, stamp: 'na' })
    else if (!started) cards.push({ ...base, status: 'wait', statusText: S.wait, main: '–', sub: tr('첫 간 검사 결과 대기', 'Waiting for first liver test'), stamp: 'wait' })
    else if (v) {
      const main =
        v.pending ? <>{tr('첫 이상으로 멈춤', 'Stopped at first abnormality')}</>
        : v.kind === 'hit'
          ? <>{tr('경보 적중', 'Alarm hit')}{v.lead !== undefined && (en
            ? <> · <b>{Math.floor(v.lead)} h</b> before event</>
            : <> · 사건 <b>{Math.floor(v.lead)}시간</b> 전</>)}</>
        : v.kind === 'miss' ? <>{tr('경보 없이 사건', 'Event without alarm')}</>
        : v.kind === 'false' ? <>{tr('경보 뒤 사건 없음', 'No event after alarm')}</>
        : <>{tr('경보 없음 · 사건 없음', 'No alarm · no event')}</>
      cards.push({
        ...base, status: 'off', statusText: S.stop, stamp: v.pending ? 'stop' : v.kind,
        main,
        sub: v.pending
          ? tr(`정답 확인 중 · ${mdhm(v.until)} 까지`, `Checking outcome · until ${mdhm(v.until)}`)
          : v.target
            ? tr(`5배 사건 ${mdhm(v.target.t0)} 공개`, `5× event released ${mdhm(v.target.t0)}`)
            : tr(`${mdhm(v.until)} 까지 5배 사건 없음`, `No 5× event by ${mdhm(v.until)}`),
      })
    } else if (ended) cards.push({ ...base, status: 'off', statusText: S.stop, main: tr('ICU 퇴실로 멈춤', 'Stopped at ICU discharge'), sub: tr('첫 이상 없음', 'No first abnormality'), stamp: 'out' })
    else if (unknown) cards.push({ ...base, status: 'live', statusText: S.hourly, main: <span className="agc-unk">{tr('판정 불가', 'Not assessable')}</span>, sub: unknown, stamp: `u-${clock}` })
    else if (!point) cards.push({ ...base, status: 'wait', statusText: S.wait, main: '–', sub: tr('정상 구간 대기', 'Waiting for normal window'), stamp: 'wait' })
    else {
      const alarm = point.p >= sim.a1.threshold
      cards.push({
        ...base, status: 'live', statusText: S.hourly, stamp: point.time, alarm,
        main: <><b className="agc-num">{pct(point.p)}</b>{alarm && <span className="agc-alarm">{tr('경보', 'Alarm')}</span>}{point.confidence?.level === '낮음' && lowChip}</>,
        sub: tr(`24시간 안 5배 사건 · ${hm(point.time)} 실행`, `5× event within 24 h · run ${hm(point.time)}`),
      })
    }
  }

  // 2 종료 상태
  {
    const base = { id: 2 as const, name: tr('종료 상태', 'End state'), when: tr('5배 사건 때 1회', 'At 5×') }
    const out = sim.models?.agent2
    if (!targetKnown(sim, clock) || !out) {
      cards.push({
        ...base, status: noTarget ? 'off' : 'wait', statusText: noTarget ? S.na : S.wait, main: '–',
        sub: noTarget ? tr('5배 사건 없이 퇴실', 'Discharged without 5× event') : tr('5배 사건 대기', 'Waiting for 5× event'), stamp: 'wait',
      })
    }
    else {
      const top = END_STATES.reduce((a, b) => (out.probs[b.key] > out.probs[a.key] ? b : a))
      const done = !isAfter(cs.icuOut, clock)
      const actual = END_STATES.find(s => s.key === sim.endState)
      cards.push({
        ...base, status: 'done', statusText: S.done, stamp: 'done',
        main: <>{top.label} <b className="agc-num">{pct(out.probs[top.key])}</b>{out.confidence.level === '낮음' && lowChip}</>,
        sub: done
          ? (actual ? tr(`실제 ${actual.label}`, `Actual: ${actual.label}`) : tr('실제 판정 불가', 'Actual: not assessable'))
          : tr(`ICU 퇴실 때 · ${mdhm(sim.target!.detectAt)} 실행`, `At ICU discharge · run ${mdhm(sim.target!.detectAt)}`),
      })
    }
  }

  // 3 원인 추정
  {
    const base = { id: 3 as const, name: tr('원인 추정', 'Cause assessment'), when: tr('5배 사건 때 1회', 'At 5×') }
    if (!targetKnown(sim, clock) || !run) {
      cards.push({
        ...base, status: noTarget ? 'off' : 'wait', statusText: noTarget ? S.na : S.wait, main: '–',
        sub: noTarget ? tr('5배 사건 없이 퇴실', 'Discharged without 5× event') : tr('5배 사건 대기', 'Waiting for 5× event'), stamp: 'wait',
      })
    } else if (runState.phase === 'running') {
      cards.push({
        ...base, status: 'run', statusText: S.running, stamp: 'run',
        main: <>{tr(`${runState.step + 1}/${run.steps.length} 단계`, `Step ${runState.step + 1}/${run.steps.length}`)}</>, sub: run.steps[runState.step].title,
      })
    } else if (runState.phase === 'done') {
      const hits = run.calls.filter(c => c.score !== null && c.score >= RULE_THRESHOLD).sort((a, b) => b.score! - a.score!)
      cards.push({
        ...base, status: 'done', statusText: S.done, stamp: 'done',
        main: hits.length
          ? <><b>{causeName(hits[0].cause)}</b>{hits.length > 1 && <span className="muted">{tr(` 외 ${hits.length - 1}`, ` +${hits.length - 1}`)}</span>}</>
          : tr('해당 범주 없음', 'No category flagged'),
        sub: [
          tr(`범주 10개 중 ${hits.length}개 해당`, `${hits.length} of 10 flagged`),
          run.calls.some(c => c.fragile?.length) ? tr(`판정 취약 ${run.calls.filter(c => c.fragile?.length).length}`, `fragile ${run.calls.filter(c => c.fragile?.length).length}`) : '',
          run.calls.some(c => c.hold) ? tr(`판단 보류 ${run.calls.filter(c => c.hold).length}`, `withheld ${run.calls.filter(c => c.hold).length}`) : '',
          tr(`${mdhm(sim.target!.detectAt)} 실행`, `run ${mdhm(sim.target!.detectAt)}`),
        ].filter(Boolean).join(' · '),
      })
    } else cards.push({ ...base, status: 'wait', statusText: S.wait, main: tr('실행 전', 'Not run yet'), sub: tr('원인 범주 10개 규칙 판정', 'Rule check of 10 cause categories'), stamp: 'idle' })
  }

  // 4 24시간 궤적: 마지막 값의 배수가 가장 큰 항목을 보여 줌
  {
    const base = { id: 4 as const, name: tr('24시간 궤적', '24-h trajectory'), when: tr('매시간', 'Hourly') }
    const { at, ended, forecasts } = a4Now(cs, sim, clock)
    if (!at) cards.push({ ...base, status: 'wait', statusText: S.wait, main: '–', sub: tr('첫 간 검사 결과 대기', 'Waiting for first liver test'), stamp: 'wait' })
    else if (!forecasts.length) {
      cards.push({
        ...base, status: 'live', statusText: S.hourly, main: <span className="agc-unk">{tr('예측 없음', 'No forecast')}</span>,
        sub: tr('최근 24시간 안 간 검사 없음', 'No liver test in the last 24 h'), stamp: `n-${at}`,
      })
    }
    else {
      const f = forecasts.reduce((a, b) => (b.last.value / uln(cs, b.code) > a.last.value / uln(cs, a.code) ? b : a))
      const it = itemOf(cs, f.code)
      const end = f.points.at(-1)!.v
      const ratio = end / f.last.value
      const arrow = ratio > 1.1 ? '↑' : ratio < 0.9 ? '↓' : '→'
      const k = crossing(cs, f)
      cards.push({
        ...base, status: ended ? 'off' : 'live', statusText: ended ? S.stop : S.hourly, stamp: at, alarm: k === 5,
        main: <>{short(it.name)} {fmtNum(f.last.value, it.dp)} → <b className="agc-num">{fmtNum(end, it.dp)}</b> {arrow}</>,
        sub: ended
          ? tr('ICU 퇴실로 멈춤', 'Stopped at ICU discharge')
          : k ? tr(`24시간 안 ${k}배 넘을 것으로 예측`, `Forecast to cross ${k}× within 24 h`) : tr(`24시간 뒤 예측 · ${hm(at)} 실행`, `24-h forecast · run ${hm(at)}`),
      })
    }
  }

  return (
    <div className="ag-cards" role="tablist" aria-label={tr('에이전트', 'Agents')}>
      {cards.map(c => (
        <button
          key={c.id}
          role="tab"
          aria-selected={selected === c.id}
          className={cls('ag-card', c.status, selected === c.id && 'sel', c.alarm && 'alarm')}
          onClick={() => onSelect(c.id)}
        >
          <span className="agc-top">
            <span className="agc-no">{c.id}</span>
            <b>{c.name}</b>
            <span className="agc-when">{c.when}</span>
            <span className="spacer" />
            <span className={`agc-st ${c.status}`}>{c.statusText}</span>
          </span>
          <span key={c.stamp} className="agc-main">{c.main}</span>
          <span className="agc-sub">{c.sub}</span>
        </button>
      ))}
      <button role="tab" aria-selected={selected === 'qa'} className={cls('ag-qa', selected === 'qa' && 'sel')} onClick={() => onSelect('qa')}>
        <span className="agc-no ask" aria-hidden>?</span>
        <b>{tr('질의응답', 'Q&A')}</b>
        <span className="muted">{tr('이 환자 기록과 근거 위키로 답합니다', "Answers from this patient's records and the evidence wiki")}</span>
        <span className="spacer" />
        {qaCount > 0 && <span className="agc-st off">{tr(`${qaCount}건`, `${qaCount}`)}</span>}
      </button>
    </div>
  )
}
