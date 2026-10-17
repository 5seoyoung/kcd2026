import type { CaseData, LiverEvent, Ref } from '../../types'
import { hoursBetween, hm, mdhm } from '../../lib/time'
import { fmtNum, xUln } from '../../lib/lab'
import { itemOf, patternOf, rRatio, sameDraw } from '../../lib/events'
import { lang, tr } from '../../lib/i18n'

interface Props {
  cs: CaseData
  ev: LiverEvent
  compact: boolean
  onJump: (ref: Ref) => void
}

const COMPANION = ['ALT', 'AST', 'ALP', 'TB', 'INR']
const short = (name: string) => name.split(' (')[0]

/** lib/events.ts 의 사건 집단과 손상 패턴 (한국어 값) 을 영어 화면에서 바꿈 */
const GROUP_EN: Record<string, string> = { '입실 초기 이상': 'Early after ICU admission', '관찰 중 신규 이상': 'New during observation', '발생 시점 불명': 'Onset time unknown' }
const PATTERN_EN: Record<string, string> = { 간세포형: 'Hepatocellular', 담즙정체형: 'Cholestatic', 혼합형: 'Mixed' }
const en = (map: Record<string, string>, s: string) => tr(s, map[s] ?? s)

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
        <strong>{tr(`간 검사 이상 · ${ev.k === 2 ? '첫 이상 (2배)' : `${ev.k}배 사건`}`, `Liver-test abnormality · ${ev.k === 2 ? 'first abnormality (2×)' : `${ev.k}× event`}`)}</strong>
        <span className="ac-group">{en(GROUP_EN, ev.group)}</span>
      </div>
      <div className="ac-main">
        <span className="ac-val">
          {short(item.name).split(' ')[0]} {fmtNum(trig.value, item.dp)} <small>{item.unit}</small>
        </span>
        <span>
          {lang() === 'ko' ? (
            <>기록 상한 {item.high} 의 <b>{xUln(item, trig.value)!.toFixed(1)}배</b></>
          ) : (
            <><b>{xUln(item, trig.value)!.toFixed(1)}×</b> the recorded upper limit {item.high}</>
          )}
          <span className="muted">{tr(` (사건 기준: ${fmtNum(item.high! * ev.k, item.dp)} 이상)`, ` (event threshold: ≥ ${fmtNum(item.high! * ev.k, item.dp)})`)}</span>
        </span>
      </div>
      <dl className="ac-meta">
        <div><dt>{tr('t0 (공개)', 't0 (released)')}</dt><dd className="mono">{mdhm(ev.t0)}</dd></div>
        <div><dt>{tr('채혈', 'Drawn')}</dt><dd className="mono">{hm(ev.drawn)}</dd></div>
        <div><dt>{tr('ICU 입실 뒤', 'Since ICU admission')}</dt><dd>{tr(`${hoursBetween(cs.icuIn, ev.t0).toFixed(1)}시간`, `${hoursBetween(cs.icuIn, ev.t0).toFixed(1)} h`)}</dd></div>
        {ev.prev && <div><dt>{tr('직전 값', 'Previous value')}</dt><dd>{fmtNum(ev.prev.value, item.dp)} <span className="mono muted">({mdhm(ev.prev.charttime)})</span></dd></div>}
      </dl>
      {!compact && (
        <div className="ac-companion">
          {COMPANION.map(code => {
            const r = sameDraw(cs, ev, code)
            if (!r) return null
            const it = itemOf(cs, code)
            const x = xUln(it, r.value)
            return (
              <button key={code} className="ac-lab" onClick={() => onJump({ tab: 'lab', row: code, col: r.id })} title={tr('검사결과에서 보기', 'Show in Labs')}>
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
          {tr('R 비', 'R ratio')} <b>{R.toFixed(1)}</b> · {en(PATTERN_EN, patternOf(R))}
          {ast && alt && <> <span className="sep">|</span> AST/ALT <b>{(ast.value / alt.value).toFixed(1)}</b></>}
        </div>
      )}
    </div>
  )
}
