import { useEffect, useRef } from 'react'
import type { CaseData, LiverEvent, VitalRow } from '../../types'
import { floorHour, hm, isAfter, md, mdhm, toMs } from '../../lib/time'
import { cls, isRowHl, isTimeHl, rateAt, type Highlight } from '../../lib/ui'
import { tr } from '../../lib/i18n'
import { VitalChart } from './VitalChart'

interface Props {
  cs: CaseData
  clock: string
  events: LiverEvent[]
  hl: Highlight
}

interface Param {
  key: string
  label: string
  unit: string
  show: (r: VitalRow) => string
  alarm?: (r: VitalRow) => boolean
}

export function VitalTab({ cs, clock, events, hl }: Props) {
  const wrap = useRef<HTMLDivElement>(null)
  const rows = cs.vitals.filter(v => !isAfter(v.time, clock))
  const ne = cs.mar.find(o => o.id === 'NE')
  const evHour = new Map(events.map(e => [floorHour(e.t0), e]))

  const params: Param[] = [
    { key: 'bp', label: tr('혈압', 'BP'), unit: 'mmHg', show: r => `${r.sbp}/${r.dbp}` },
    { key: 'map', label: 'MAP', unit: 'mmHg', show: r => String(r.map), alarm: r => r.map < 65 },
    { key: 'hr', label: tr('심박수', 'Heart rate'), unit: tr('/분', '/min'), show: r => String(r.hr), alarm: r => r.hr > 130 },
    { key: 'rr', label: tr('호흡수', 'Resp. rate'), unit: tr('/분', '/min'), show: r => String(r.rr) },
    { key: 'bt', label: tr('체온', 'Temperature'), unit: '℃', show: r => r.bt.toFixed(1), alarm: r => r.bt >= 38 },
    { key: 'spo2', label: 'SpO2', unit: '%', show: r => String(r.spo2), alarm: r => r.spo2 < 90 },
    { key: 'cvp', label: 'CVP', unit: 'mmHg', show: r => (r.cvp === undefined ? '' : String(r.cvp)) },
    { key: 'ne', label: tr('노르에피네프린', 'Norepinephrine'), unit: 'mcg/kg/min', show: r => rateAt(ne, r.time)?.toFixed(2) ?? '' },
  ]

  useEffect(() => {
    const el = wrap.current
    if (el && !hl) el.scrollLeft = el.scrollWidth
  }, [rows.length, hl])

  const firstMin = rows.length ? Math.round((toMs(rows[0].time) - toMs(cs.icuIn)) / 60000) : 0

  if (!rows.length) {
    return (
      <div className="tab-body">
        <div className="subbar"><strong>{tr('활력징후', 'Vital signs')}</strong><span className="muted">{tr('아직 기록이 없습니다', 'No records yet')}</span></div>
      </div>
    )
  }

  return (
    <div className="tab-body">
      <div className="subbar">
        <strong>{tr('활력징후', 'Vital signs')}</strong>
        <span className="muted">
          {tr(
            '시간별 기록. 빨간 값: MAP 65 미만, SpO2 90 미만, 심박수 130 초과, 체온 38.0 이상',
            'Hourly records. Red values: MAP < 65, SpO2 < 90, heart rate > 130, temperature ≥ 38.0',
          )}
        </span>
      </div>
      <VitalChart cs={cs} rows={rows} clock={clock} events={events} hl={hl} />
      <div className="grid-wrap flowsheet" ref={wrap}>
        <table className="grid vital-grid">
          <thead>
            <tr>
              <th className="stk v1">{tr('항목', 'Item')}</th>
              <th className="stk v2">{tr('단위', 'Unit')}</th>
              {rows.map((r, i) => {
                const ev = evHour.get(r.time)
                return (
                  <th key={r.time} className={cls('hc', ev && 't0col')} title={ev ? tr(`${mdhm(r.time)} · ${ev.k}배 사건 t0 ${hm(ev.t0)}`, `${mdhm(r.time)} · ${ev.k}× event t0 ${hm(ev.t0)}`) : mdhm(r.time)}>
                    <div className="th-d">{i === 0 || hm(r.time) === '00:00' ? md(r.time) : ''}</div>
                    <div>{hm(r.time).slice(0, 2)}</div>
                    {ev && <span className="t0tag">{tr(`${ev.k}배`, `${ev.k}×`)}</span>}
                  </th>
                )
              })}
              <th className="fill" />
            </tr>
          </thead>
          <tbody>
            {params.map(p => (
              <tr key={p.key} className={cls(isRowHl(hl, 'vital', p.key) && 'is-hl')}>
                <td className="stk v1 name">{p.label}</td>
                <td className="stk v2 muted">{p.unit}</td>
                {rows.map(r => (
                  <td
                    key={r.time}
                    className={cls('num', p.alarm?.(r) && 'hi', evHour.has(r.time) && 't0col', isTimeHl(hl, 'vital', p.key, r.time) && 'is-hl')}
                  >
                    {p.show(r)}
                  </td>
                ))}
                <td className="fill" />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="foot-note muted">
        {tr(
          `기록 ${rows.length}시간 · 마지막 ${mdhm(rows[rows.length - 1].time)} · 첫 기록 ${mdhm(rows[0].time)} (입실 뒤 ${firstMin}분)`,
          `${rows.length} h of records · last ${mdhm(rows[rows.length - 1].time)} · first ${mdhm(rows[0].time)} (${firstMin} min after ICU admission)`,
        )}
      </p>
    </div>
  )
}
