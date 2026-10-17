import { tr } from '../lib/i18n'

export function StatusBar({ status }: { status: string }) {
  return (
    <footer className="statusbar">
      <span>{status}</span>
      <span className="spacer" />
      <span>{tr('중환자실', 'ICU')}</span>
      <span className="sb-sep" />
      <span>{tr('간 검사 이상 에이전트 v0.2 (발생 예측 · 종료 상태 · 원인 추정 · 24시간 궤적)', 'Liver-test agents v0.2 (early warning · end state · cause assessment · 24-h trajectory)')}</span>
    </footer>
  )
}
