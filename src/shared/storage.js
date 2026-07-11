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

// ── 전역 사운드 on/off — 메인 설정과 인게임 설정이 같은 값을 쓴다 ──
const RIFT_SOUND_KEY = 'bgp.rift.sound.v1'

export function loadSoundOn() {
  try {
    return localStorage.getItem(RIFT_SOUND_KEY) !== 'off' // 기본값: 켜짐
  } catch {
    return true
  }
}

export function saveSoundOn(on) {
  try {
    localStorage.setItem(RIFT_SOUND_KEY, on ? 'on' : 'off')
  } catch {
    /* 무시 */
  }
}

// ── 전투 버튼 크기 배율(0.7~1.3) — 설정 메뉴 슬라이더로 조절 ──
const RIFT_BTNSCALE_KEY = 'bgp.rift.btnscale.v1'

export function loadRiftBtnScale() {
  try {
    const v = Number(localStorage.getItem(RIFT_BTNSCALE_KEY))
    if (v >= 0.7 && v <= 1.3) return v
  } catch {
    /* 무시 */
  }
  return 1
}

export function saveRiftBtnScale(scale) {
  try {
    localStorage.setItem(RIFT_BTNSCALE_KEY, String(scale))
  } catch {
    /* 무시 */
  }
}

// ── 프로필(수호 지신) — 첫 실행 때 한 번 정하고, 메인 메뉴에서 변경 ──
const PROFILE_KEY = 'bgp.rift.profile.v1'

export function loadProfile() {
  try {
    const v = localStorage.getItem(PROFILE_KEY)
    if (v) return v
    // 구버전 이전: 솔로 픽에 들어 있던 조디악을 프로필로 승격(기존 유저는 선택 화면 생략)
    const pick = JSON.parse(localStorage.getItem(SOLO_PICK_KEY))
    if (pick?.zodiacId) {
      localStorage.setItem(PROFILE_KEY, pick.zodiacId)
      return pick.zodiacId
    }
  } catch {
    /* 무시 */
  }
  return null
}

export function saveProfile(zodiacId) {
  try {
    localStorage.setItem(PROFILE_KEY, zodiacId)
  } catch {
    /* 무시 */
  }
}

// ── 솔로(오프라인 봇전) 마지막 선택(조디악·직업·모드) 보존 ──
const SOLO_PICK_KEY = 'bgp.rift.solo.v1'

export function loadSoloPick() {
  try {
    const v = JSON.parse(localStorage.getItem(SOLO_PICK_KEY))
    if (v && typeof v === 'object') return v
  } catch {
    /* 무시 */
  }
  return null
}

export function saveSoloPick(pick) {
  try {
    localStorage.setItem(SOLO_PICK_KEY, JSON.stringify(pick))
  } catch {
    /* 무시 */
  }
}

// ── 솔로(오프라인 봇전) 직업별 전적 — { [cls]: { games, wins, kills, deaths, assists } } ──
const RIFT_RECORDS_KEY = 'bgp.rift.records.v1'

export function loadRiftRecords() {
  try {
    const v = JSON.parse(localStorage.getItem(RIFT_RECORDS_KEY))
    if (v && typeof v === 'object') return v
  } catch {
    /* 무시 */
  }
  return {}
}

// 한 판 결과를 직업 전적에 누적하고 전체 전적을 돌려준다 (무승부는 패로 센다)
export function addRiftRecord(cls, { win, kills = 0, deaths = 0, assists = 0 } = {}) {
  const all = loadRiftRecords()
  const r = all[cls] || (all[cls] = { games: 0, wins: 0, kills: 0, deaths: 0, assists: 0 })
  r.games += 1
  if (win) r.wins += 1
  r.kills += kills
  r.deaths += deaths
  r.assists += assists
  try {
    localStorage.setItem(RIFT_RECORDS_KEY, JSON.stringify(all))
  } catch {
    /* 무시 */
  }
  return all
}

// ── 해금 확인 수 — 마지막으로 본 해금 직업 수. 그보다 새로 열린 카드엔 NEW 배지를 띄운다 ──
const UNLOCK_SEEN_KEY = 'bgp.rift.unlockseen.v1'

export function loadUnlockSeen() {
  try {
    const n = Number(localStorage.getItem(UNLOCK_SEEN_KEY))
    return Number.isFinite(n) ? n : 0
  } catch {
    return 0
  }
}

export function saveUnlockSeen(count) {
  try {
    localStorage.setItem(UNLOCK_SEEN_KEY, String(count))
  } catch {
    /* 무시 */
  }
}

// ── 조작 가이드(첫 실행 안내)를 봤는지 보존 — 솔로 모드 첫 진입 시 자동으로 띄운다 ──
const GUIDE_SEEN_KEY = 'bgp.rift.guide.v1'

export function loadGuideSeen() {
  try {
    return localStorage.getItem(GUIDE_SEEN_KEY) === 'y'
  } catch {
    return false
  }
}

export function saveGuideSeen() {
  try {
    localStorage.setItem(GUIDE_SEEN_KEY, 'y')
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
