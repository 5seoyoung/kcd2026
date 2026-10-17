import type { CaseData } from '../../types'
import type { Sim } from '../../data'
import { EVENT_CODES, inIcu, isKnown, recoveryAt } from '../../lib/events'
import { hm, hoursBetween, isAfter } from '../../lib/time'
import { borderlineOf, ERROR_RANGE, labLabel, pendingAt } from '../../lib/uncertainty'
import { tr } from '../../lib/i18n'

/** 보고 대기 목록에서 이름을 다 보여 줄 개수 */
const SHOW = 6

/** 네 에이전트 공통 알림: 보고 대기, 회복 판정에 필요한 검사, 사건 경계값, 병원 공지 */
export function Notices({ cs, sim, clock }: { cs: CaseData; sim: Sim; clock: string }) {
  const rows: { key: string; tag: string; tone: 'wait' | 'need' | 'edge' | 'site'; text: string }[] = []

  // 보고 대기: 채혈했지만 아직 결과가 보고되지 않은 검사 (에이전트 출력이 바뀔 수 있음)
  if (inIcu(cs, clock)) {
    for (const g of pendingAt(cs, clock)) {
      const names = g.codes.map(c => labLabel(cs, c))
      const list = names.length > SHOW
        ? tr(`${names.slice(0, SHOW).join(', ')} 외 ${names.length - SHOW}개`, `${names.slice(0, SHOW).join(', ')} and ${names.length - SHOW} more`)
        : names.join(', ')
      rows.push({
        key: `w-${g.drawn}`, tag: tr('보고 대기', 'Pending results'), tone: 'wait',
        text: tr(`${list} (${hm(g.drawn)} 채혈) · 결과가 나오면 에이전트 출력이 바뀔 수 있음`, `${list} (drawn ${hm(g.drawn)}) · agent outputs may change when results arrive`),
      })
    }
  }

  // 회복 판정과 경계값은 종료 상태·원인 추정이 도는 5배 사건 기준
  const ev = sim.target
  if (isKnown(ev, clock)) {
    // 회복 판정에 필요한 검사: 5배 사건 뒤 ALT, ALP, 총빌리 중 다시 재지 않은 항목 (퇴실 전까지).
    // 사건 직후에는 아직 아무것도 다시 재지 않은 것이 당연하므로, 일부만 다시 쟀거나 사건 뒤 24시간이 지났을 때 띄움
    const rec = recoveryAt(cs, ev, clock)
    const partial = rec.notRemeasured.length < EVENT_CODES.length
    if (!rec.judged && isAfter(cs.icuOut, clock) && (partial || hoursBetween(ev.t0, clock) >= 24)) {
      const names = rec.notRemeasured.map(c => labLabel(cs, c)).join(', ')
      rows.push({
        key: 'need', tag: tr('회복 판정에 필요한 검사', 'Tests needed for the recovery call'), tone: 'need',
        text: tr(`${names} 퇴실 전 재측정 필요 (없으면 판정 불가)`, `Re-measure ${names} before discharge (otherwise not assessable)`),
      })
    }
    // 사건 경계값: 5배 사건 값이 기준 (5배) 의 검사 오차 범위 안
    const b = borderlineOf(cs, ev)
    if (b) {
      rows.push({
        key: 'edge', tag: tr('사건 경계값', 'Borderline event'), tone: 'edge',
        text: tr(
          `${labLabel(cs, ev.result.code)} ${b.x.toFixed(1)}배 (기준 ${b.k}배와 ${Math.round(ERROR_RANGE * 100)}% 안 차이) · 검사 오차 범위 안에서 기준 아래일 수 있음`,
          `${labLabel(cs, ev.result.code)} ${b.x.toFixed(1)}× (within ${Math.round(ERROR_RANGE * 100)}% of the ${b.k}× threshold) · could be below it within measurement error`,
        ),
      })
    }
  }

  for (const [i, n] of sim.notices.entries()) rows.push({ key: `s-${i}`, tag: tr('병원 공지', 'Site notice'), tone: 'site', text: n })

  if (!rows.length) return null
  return (
    <div className="notices" aria-label={tr('공통 알림', 'Shared notices')}>
      {rows.map(r => (
        <div key={r.key} className={`nt ${r.tone}`}>
          <span className="nt-tag">{r.tag}</span>
          <span className="nt-text">{r.text}</span>
        </div>
      ))}
    </div>
  )
}
