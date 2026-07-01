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

// ── 타격 효과(피격 테두리·화면 흔들림) 켜고/끄기 보존 ──
const RIFT_HITFX_KEY = 'bgp.rift.hitfx.v1'

export function loadRiftHitFx() {
  try {
    return localStorage.getItem(RIFT_HITFX_KEY) !== 'off' // 기본값: 켜짐
  } catch {
    return true
  }
}

export function saveRiftHitFx(on) {
  try {
    localStorage.setItem(RIFT_HITFX_KEY, on ? 'on' : 'off')
  } catch {
    /* 무시 */
  }
}

// ── 그래픽 품질(상/중/하) 보존 ──
// high: 현재 화질 그대로 / med: 균형 / low: 저사양·모바일용 (픽셀레이트·장식·AA를 낮춘다)
const RIFT_GFX_KEY = 'bgp.rift.gfx.v1'
const RIFT_GFX_VALID = new Set(['high', 'med', 'low'])

export function loadRiftGfx() {
  try {
    const v = localStorage.getItem(RIFT_GFX_KEY)
    if (v && RIFT_GFX_VALID.has(v)) return v
  } catch {
    /* 무시 */
  }
  return 'med' // 기본값: 균형
}

export function saveRiftGfx(q) {
  if (!RIFT_GFX_VALID.has(q)) return
  try {
    localStorage.setItem(RIFT_GFX_KEY, q)
  } catch {
    /* 무시 */
  }
}
