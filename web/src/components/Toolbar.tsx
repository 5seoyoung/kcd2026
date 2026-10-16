import { cls } from '../lib/ui'

interface Props {
  onReset: () => void
  onLog: () => void
  onHelp: () => void
  canLog: boolean
  clock: string
  /** 입실 뒤 경과 (없으면 시각 조작을 숨김) */
  elapsed?: string
  playing: boolean
  rate: number
  atStart: boolean
  atEnd: boolean
  onPlay: () => void
  onStep: (n: number) => void
  onStart: () => void
  onRate: (r: number) => void
}

const ICON = {
  start: 'M1.5 1.5h1.6v7H1.5zM8.5 1.5v7L3.6 5z',
  prev: 'M8 1.5v7L2.5 5z',
  next: 'M2 1.5v7L7.5 5z',
  play: 'M2.5 1.5l6 3.5-6 3.5z',
  pause: 'M2.2 1.5h2v7h-2zM5.8 1.5h2v7h-2z',
}

const Icon = ({ d }: { d: string }) => (
  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
    <path d={d} fill="currentColor" />
  </svg>
)

export const RATES = [1, 4, 16]

export function Toolbar(p: Props) {
  return (
    <div className="toolbar">
      <div className="search">
        <input disabled placeholder="등록번호 또는 이름" aria-label="환자 검색" />
        <button className="btn" disabled>조회</button>
      </div>
      <span className="tb-sep" />
      <button className="btn" onClick={p.onReset}>새로고침</button>
      <button className="btn" onClick={p.onLog} disabled={!p.canLog}>AI 실행 기록</button>
      {p.elapsed && (
        <>
          <span className="tb-sep" />
          <div className="clock" role="group" aria-label="기준 시각">
            <span className="clk-label">기준 시각</span>
            <span className="clk-time mono">{p.clock}</span>
            <span className="clk-elapsed">{p.elapsed}</span>
            <button className="btn icon" onClick={p.onStart} disabled={p.atStart} title="입실 시각으로" aria-label="입실 시각으로"><Icon d={ICON.start} /></button>
            <button className="btn icon" onClick={() => p.onStep(-1)} disabled={p.atStart} title="1시간 전" aria-label="1시간 전"><Icon d={ICON.prev} /></button>
            <button className={cls('btn play', p.playing && 'on')} onClick={p.onPlay} aria-label={p.playing ? '정지' : '재생'}>
              <Icon d={p.playing ? ICON.pause : ICON.play} />
              {p.playing ? '정지' : '재생'}
            </button>
            <button className="btn icon" onClick={() => p.onStep(1)} disabled={p.atEnd} title="1시간 뒤" aria-label="1시간 뒤"><Icon d={ICON.next} /></button>
            <span className="clk-rate" role="radiogroup" aria-label="재생 속도">
              {RATES.map(r => (
                <button key={r} role="radio" aria-checked={p.rate === r} className={cls('btn mini', p.rate === r && 'on')} onClick={() => p.onRate(r)}>{r}×</button>
              ))}
            </span>
          </div>
        </>
      )}
      <span className="spacer" />
      <button className="btn" onClick={p.onHelp}>도움말</button>
    </div>
  )
}
