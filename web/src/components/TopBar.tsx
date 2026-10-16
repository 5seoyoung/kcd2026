import logo from '../assets/snuh_logo_white.svg'

const MENUS = ['진료', '처방', '기록', '검사', '간호', '중환자', '통계', '도움말']

export function TopBar({ now }: { now: string }) {
  return (
    <header className="topbar">
      <div className="brand">
        <img src={logo} alt="서울대학교병원" />
        <span className="brand-sep" aria-hidden />
        <span className="brand-name">EMR</span>
      </div>
      <nav className="menus" aria-label="메뉴">
        {MENUS.map(m => (
          <span key={m} className={m === '중환자' ? 'menu on' : 'menu'}>{m}</span>
        ))}
      </nav>
      <div className="top-right">
        <span>중환자실</span>
        <span>중환자의학과 · ICU01</span>
        <span className="mono">{now}</span>
      </div>
    </header>
  )
}
