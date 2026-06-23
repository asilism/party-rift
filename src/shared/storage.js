// 로컬 저장(localStorage) — 리프트 조작 설정을 기기에 보존한다.

// ── 리프트 조작 방식(mobile/wasd/xbox) 보존 ──
// 'lol'(롤 방식)은 추후 도입 예정이라 저장 대상에서 제외한다.
const RIFT_CTRL_KEY = 'bgp.rift.control.v1'
const RIFT_CTRL_VALID = new Set(['mobile', 'wasd', 'xbox'])

// 저장된 조작 방식을 복원. 없으면 터치 지원 여부로 기본값을 고른다.
export function loadRiftControl() {
  try {
    const v = localStorage.getItem(RIFT_CTRL_KEY)
    if (v && RIFT_CTRL_VALID.has(v)) return v
  } catch {
    /* 무시 */
  }
  // 기본값: 터치 가능 기기는 모바일, 그 외엔 WASD 키보드
  const touch = typeof window !== 'undefined' &&
    ('ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0)
  return touch ? 'mobile' : 'wasd'
}

export function saveRiftControl(scheme) {
  if (!RIFT_CTRL_VALID.has(scheme)) return
  try {
    localStorage.setItem(RIFT_CTRL_KEY, scheme)
  } catch {
    /* 무시 */
  }
}
