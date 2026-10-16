import type { CaseData, LiverEvent, Ref } from '../../types'
import { hoursBetween, hm, mdhm } from '../../lib/time'
import { fmtNum, xUln } from '../../lib/lab'
import { itemOf, patternOf, rRatio, sameDraw } from '../../lib/events'

interface Props {
  cs: CaseData
  ev: LiverEvent
  compact: boolean
  onJump: (ref: Ref) => void
}

const COMPANION = ['ALT', 'AST', 'ALP', 'TB', 'INR']
const short = (name: string) => name.split(' (')[0]

/** 사건 카드: 트리거 결과, 배수, t0 (공개 시각), 채혈 시각, 집단, 같은 채혈의 동반 검사, 손상 패턴 */
export function EventCard({ cs, ev, compact, onJump }: Props) {
  const { item, result: trig } = ev
  const R = rRatio(cs, ev)
  const alt = sameDraw(cs, ev, 'ALT')
  const ast = sameDraw(cs, ev, 'AST')

  return (
    <div className="alert-card">
      <div className="ac-head">
        <span className="ac-icon" aria-hidden>!</span>
        <strong>간 검사 이상 · {ev.k === 2 ? '첫 이상 (2배)' : `${ev.k}배 사건`}</strong>
        <span className="ac-group">{ev.group}</span>
      </div>
      <div className="ac-main">
        <span className="ac-val">
          {short(item.name).split(' ')[0]} {fmtNum(trig.value, item.dp)} <small>{item.unit}</small>
        </span>
        <span>
          기록 상한 {item.high} 의 <b>{xUln(item, trig.value)!.toFixed(1)}배</b>
          <span className="muted"> (사건 기준: {fmtNum(item.high! * ev.k, item.dp)} 이상)</span>
        </span>
      </div>
      <dl className="ac-meta">
        <div><dt>t0 (공개)</dt><dd className="mono">{mdhm(ev.t0)}</dd></div>
        <div><dt>채혈</dt><dd className="mono">{hm(ev.drawn)}</dd></div>
        <div><dt>ICU 입실 뒤</dt><dd>{hoursBetween(cs.icuIn, ev.t0).toFixed(1)}시간</dd></div>
        {ev.prev && <div><dt>직전 값</dt><dd>{fmtNum(ev.prev.value, item.dp)} <span className="mono muted">({mdhm(ev.prev.charttime)})</span></dd></div>}
      </dl>
      {!compact && (
        <div className="ac-companion">
          {COMPANION.map(code => {
            const r = sameDraw(cs, ev, code)
            if (!r) return null
            const it = itemOf(cs, code)
            const x = xUln(it, r.value)
            return (
              <button key={code} className="ac-lab" onClick={() => onJump({ tab: 'lab', row: code, col: r.id })} title="검사결과에서 보기">
                <span className="muted">{short(it.name)}</span>
                <b>{fmtNum(r.value, it.dp)}</b>
                {x !== null && <span className={x > 1 ? 'x hi' : 'x'}>{x.toFixed(1)}×</span>}
              </button>
            )
          })}
        </div>
      )}
      {R !== null && (
        <div className="ac-pattern">
          R 비 <b>{R.toFixed(1)}</b> · {patternOf(R)}
          {ast && alt && <> <span className="sep">|</span> AST/ALT <b>{(ast.value / alt.value).toFixed(1)}</b></>}
        </div>
      )}
    </div>
  )
}
