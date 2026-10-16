export function StatusBar({ status }: { status: string }) {
  return (
    <footer className="statusbar">
      <span>{status}</span>
      <span className="spacer" />
      <span>중환자실 MICU</span>
      <span className="sb-sep" />
      <span>간 검사 이상 에이전트 v0.2 (발생 예측 · 종료 상태 · 원인 추정 · 24시간 궤적)</span>
    </footer>
  )
}
