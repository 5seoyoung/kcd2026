import logo from '../assets/snuh_logo_white.svg'
import { bi, pick, setLang, tr, type Lang } from '../lib/i18n'

const MENUS = [bi('진료', 'Clinic'), bi('처방', 'Orders'), bi('기록', 'Notes'), bi('검사', 'Tests'), bi('간호', 'Nursing'), bi('중환자', 'ICU'), bi('통계', 'Stats'), bi('도움말', 'Help')]

export function TopBar({ now, lang }: { now: string; lang: Lang }) {
  return (
    <header className="topbar">
      <div className="brand">
        <img src={logo} alt={tr('서울대학교병원', 'Seoul National University Hospital')} />
        <span className="brand-sep" aria-hidden />
        <span className="brand-name">EMR</span>
      </div>
      <nav className="menus" aria-label={tr('메뉴', 'Menu')}>
        {MENUS.map(m => (
          <span key={m.ko} className={m.ko === '중환자' ? 'menu on' : 'menu'}>{pick(m)}</span>
        ))}
      </nav>
      <div className="top-right">
        <span>{tr('중환자실', 'ICU')}</span>
        <span>{tr('중환자의학과 · ICU01', 'Critical Care · ICU01')}</span>
        <span className="mono">{now}</span>
        <span className="lang-switch" role="group" aria-label={tr('화면 언어', 'Language')}>
          <button className={lang === 'ko' ? 'on' : ''} aria-pressed={lang === 'ko'} onClick={() => setLang('ko')}>한국어</button>
          <button className={lang === 'en' ? 'on' : ''} aria-pressed={lang === 'en'} onClick={() => setLang('en')}>English</button>
        </span>
      </div>
    </header>
  )
}
