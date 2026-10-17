// 좁은 화면 (폰) 에서 'PC 화면으로 보기': 화면 폭을 1280px 로 잡아 데스크톱 화면을 줄여 보여 준다 (손가락으로 확대 가능).
// 고른 것은 이 탭에서만 기억한다.
const KEY = 'kcd-desktop'
const DESKTOP = 'width=1280'
const DEVICE = 'width=device-width, initial-scale=1.0'

function stored(): boolean {
  try {
    return window.sessionStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function applyViewport(desktop = stored()) {
  const meta = document.querySelector('meta[name="viewport"]')
  meta?.setAttribute('content', desktop ? DESKTOP : DEVICE)
  document.documentElement.classList.toggle('force-desktop', desktop)
}

export function setDesktop(on: boolean) {
  try {
    window.sessionStorage.setItem(KEY, on ? '1' : '0')
  } catch {
    // 저장하지 못해도 이번 화면에서는 바뀜
  }
  applyViewport(on)
}
