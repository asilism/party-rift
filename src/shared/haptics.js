// 햅틱(진동) — 지원 환경(안드로이드 웹뷰 등)에서만 동작. 평타는 짧게, 스킬은 굵게.
// 데스크톱/미지원 브라우저에선 no-op. 설정에서 끄고 켤 수 있다(bgp.rift.haptic.v1).
const KEY = 'bgp.rift.haptic.v1'

let enabled = (() => {
  try { return localStorage.getItem(KEY) !== 'off' } catch { return true }
})()

const can = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'
export const hapticSupported = can

export function hapticEnabled() { return enabled }
export function setHapticEnabled(v) {
  enabled = v
  try { localStorage.setItem(KEY, v ? 'on' : 'off') } catch { /* 프라이빗 모드 등 */ }
  if (!v && can) try { navigator.vibrate(0) } catch { /* no-op */ }
}

const buzz = (pattern) => {
  if (!enabled || !can) return
  try { navigator.vibrate(pattern) } catch { /* no-op */ }
}

export const haptic = {
  tap: () => buzz(12), // 평타 — 톡
  skill: () => buzz(35), // 스킬 — 묵직하게
  ult: () => buzz([0, 45, 40, 45]), // 궁극기 — 두 번 굵게
}
