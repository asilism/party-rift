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

// ── 조디악 코인(메타 화폐) — 경기 보상으로 모아 캐릭터 선행 해금·꾸미기에 쓴다 ──
const COINS_KEY = 'bgp.rift.coins.v1'
const FIRSTWIN_KEY = 'bgp.rift.firstwin.v1' // 하루 첫 승 보너스 지급일(YYYY-MM-DD)
const COIN_UNLOCKS_KEY = 'bgp.rift.coinunlocks.v1' // 코인으로 선행 해금한 직업 id 배열

export function loadCoins() {
  try {
    const v = Number(localStorage.getItem(COINS_KEY))
    return Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0
  } catch {
    return 0
  }
}

export function saveCoins(n) {
  try {
    localStorage.setItem(COINS_KEY, String(Math.max(0, Math.floor(n))))
  } catch {
    /* 무시 */
  }
}

export function addCoins(n) {
  const next = loadCoins() + Math.floor(n)
  saveCoins(next)
  return next
}

// 오늘(로컬 날짜) 첫 승 보너스를 아직 안 받았으면 true를 반환하며 오늘로 도장 찍는다.
export function claimFirstWinToday() {
  const today = new Date().toISOString().slice(0, 10)
  try {
    if (localStorage.getItem(FIRSTWIN_KEY) === today) return false
    localStorage.setItem(FIRSTWIN_KEY, today)
    return true
  } catch {
    return false
  }
}

export function loadCoinUnlocks() {
  try {
    const v = JSON.parse(localStorage.getItem(COIN_UNLOCKS_KEY))
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

export function addCoinUnlock(clsId) {
  const list = loadCoinUnlocks()
  if (!list.includes(clsId)) {
    list.push(clsId)
    try {
      localStorage.setItem(COIN_UNLOCKS_KEY, JSON.stringify(list))
    } catch {
      /* 무시 */
    }
  }
}

// ── 일일 미션 — 로컬 날짜 기준으로 매일 3개, 진행도·수령 상태를 저장 ──
const MISSIONS_KEY = 'bgp.rift.missions.v1'

export function loadMissionState() {
  try {
    const v = JSON.parse(localStorage.getItem(MISSIONS_KEY))
    if (v && typeof v === 'object') return v
  } catch {
    /* 무시 */
  }
  return null
}

export function saveMissionState(state) {
  try {
    localStorage.setItem(MISSIONS_KEY, JSON.stringify(state))
  } catch {
    /* 무시 */
  }
}

// ── 무한 방어 기록 — 최고 도달 파도·누적 파도·출전 수 ──
const DEFENSE_REC_KEY = 'bgp.rift.defenseRecords.v1'

export function loadDefenseRecords() {
  try {
    const v = JSON.parse(localStorage.getItem(DEFENSE_REC_KEY))
    if (v && typeof v === 'object') return { bestWave: v.bestWave || 0, runs: v.runs || 0, totalWaves: v.totalWaves || 0 }
  } catch { /* 무시 */ }
  return { bestWave: 0, runs: 0, totalWaves: 0 }
}

// 방어 1판 기록 — { isBest(최고 기록 갱신), bestWave } 반환
export function recordDefenseRun(wave) {
  const rec = loadDefenseRecords()
  const isBest = wave > rec.bestWave
  const next = { bestWave: Math.max(rec.bestWave, wave), runs: rec.runs + 1, totalWaves: rec.totalWaves + wave }
  try {
    localStorage.setItem(DEFENSE_REC_KEY, JSON.stringify(next))
  } catch { /* 무시 */ }
  return { isBest, bestWave: next.bestWave }
}

// ── 칭호 — 업적 보상으로 얻고, 장착하면 메뉴 프로필 칩·전투 이름표에 붙는다 ──
const TITLE_KEY = 'bgp.rift.title.v1'

export function loadEquippedTitle() {
  try {
    return localStorage.getItem(TITLE_KEY) || null
  } catch {
    return null
  }
}

export function saveEquippedTitle(title) {
  try {
    if (title) localStorage.setItem(TITLE_KEY, title)
    else localStorage.removeItem(TITLE_KEY)
  } catch {
    /* 무시 */
  }
}

// ── 업적 — 평생 누적 카운터(cnt)와 달성 시각(done). 미션과 달리 리셋되지 않는다 ──
const ACH_KEY = 'bgp.rift.achievements.v1'

export function loadAchState() {
  try {
    const v = JSON.parse(localStorage.getItem(ACH_KEY))
    if (v && typeof v === 'object') return { done: v.done || {}, cnt: v.cnt || {} }
  } catch {
    /* 무시 */
  }
  return { done: {}, cnt: {} }
}

export function saveAchState(state) {
  try {
    localStorage.setItem(ACH_KEY, JSON.stringify(state))
  } catch {
    /* 무시 */
  }
}

// ── 모자 꾸미기 — 보유 목록과 장착 상태 ──
const HAT_EQUIP_KEY = 'bgp.rift.hat.v1'
const HATS_OWNED_KEY = 'bgp.rift.hats.v1'

export function loadEquippedHat() {
  try {
    return localStorage.getItem(HAT_EQUIP_KEY) || null
  } catch {
    return null
  }
}

export function saveEquippedHat(hatId) {
  try {
    if (hatId) localStorage.setItem(HAT_EQUIP_KEY, hatId)
    else localStorage.removeItem(HAT_EQUIP_KEY)
  } catch {
    /* 무시 */
  }
}

export function loadOwnedHats() {
  try {
    const v = JSON.parse(localStorage.getItem(HATS_OWNED_KEY))
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

export function addOwnedHat(hatId) {
  const list = loadOwnedHats()
  if (!list.includes(hatId)) {
    list.push(hatId)
    try {
      localStorage.setItem(HATS_OWNED_KEY, JSON.stringify(list))
    } catch {
      /* 무시 */
    }
  }
}

// ── 옷 코스튬 꾸미기 — 보유 목록과 장착 상태(모자와 같은 구조) ──
const COSTUME_EQUIP_KEY = 'bgp.rift.costume.v1'
const COSTUMES_OWNED_KEY = 'bgp.rift.costumes.v1'

export function loadEquippedCostume() {
  try {
    return localStorage.getItem(COSTUME_EQUIP_KEY) || null
  } catch {
    return null
  }
}

export function saveEquippedCostume(costumeId) {
  try {
    if (costumeId) localStorage.setItem(COSTUME_EQUIP_KEY, costumeId)
    else localStorage.removeItem(COSTUME_EQUIP_KEY)
  } catch {
    /* 무시 */
  }
}

export function loadOwnedCostumes() {
  try {
    const v = JSON.parse(localStorage.getItem(COSTUMES_OWNED_KEY))
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

export function addOwnedCostume(costumeId) {
  const list = loadOwnedCostumes()
  if (!list.includes(costumeId)) {
    list.push(costumeId)
    try {
      localStorage.setItem(COSTUMES_OWNED_KEY, JSON.stringify(list))
    } catch {
      /* 무시 */
    }
  }
}

// ── 무기 스킨 꾸미기 — 보유 목록과 장착 상태(모자·옷과 같은 구조) ──
const WEAPON_EQUIP_KEY = 'bgp.rift.weapon.v1'
const WEAPONS_OWNED_KEY = 'bgp.rift.weapons.v1'

export function loadEquippedWeapon() {
  try {
    return localStorage.getItem(WEAPON_EQUIP_KEY) || null
  } catch {
    return null
  }
}

export function saveEquippedWeapon(weaponId) {
  try {
    if (weaponId) localStorage.setItem(WEAPON_EQUIP_KEY, weaponId)
    else localStorage.removeItem(WEAPON_EQUIP_KEY)
  } catch {
    /* 무시 */
  }
}

export function loadOwnedWeapons() {
  try {
    const v = JSON.parse(localStorage.getItem(WEAPONS_OWNED_KEY))
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

export function addOwnedWeapon(weaponId) {
  const list = loadOwnedWeapons()
  if (!list.includes(weaponId)) {
    list.push(weaponId)
    try {
      localStorage.setItem(WEAPONS_OWNED_KEY, JSON.stringify(list))
    } catch {
      /* 무시 */
    }
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

// ── 솔로(오프라인 봇전) 직업별 전적 — 모드별로 나눠 저장 ──
//  { [mode]: { [cls]: { games, wins, kills, deaths, assists } } }  (mode = '3v3' | '5v5')
//  보스전은 별도(bossRecords)로 관리 — 여기엔 안 쌓는다.
const RIFT_RECORDS_KEY = 'bgp.rift.records.v1'

// 저장 원본을 읽는다. 레거시(모드 구분 없는 평면 { [cls]: {...} })는 '3v3' 버킷으로 승격한다.
function loadRecordsRaw() {
  try {
    const v = JSON.parse(localStorage.getItem(RIFT_RECORDS_KEY))
    if (v && typeof v === 'object') {
      const legacy = Object.values(v).some((x) => x && typeof x.games === 'number')
      return legacy ? { '3v3': v } : v // 옛 평면 데이터는 3v3(기본 모드)으로 본다
    }
  } catch {
    /* 무시 */
  }
  return {}
}

// 모드별 전적 전체 { [mode]: { [cls]: {...} } }
export function loadRiftRecordsByMode() {
  return loadRecordsRaw()
}

// 전 모드 합산 평면 전적 { [cls]: {...} } — 캐릭터 선택 화면 등 기존 사용처 호환용
export function loadRiftRecords() {
  const byMode = loadRecordsRaw()
  const flat = {}
  for (const mode of Object.keys(byMode)) {
    for (const [cls, r] of Object.entries(byMode[mode])) {
      const a = flat[cls] || (flat[cls] = { games: 0, wins: 0, kills: 0, deaths: 0, assists: 0 })
      a.games += r.games; a.wins += r.wins; a.kills += r.kills; a.deaths += r.deaths; a.assists += r.assists
    }
  }
  return flat
}

// 한 판 결과를 해당 모드의 직업 전적에 누적한다 (무승부는 패로 센다)
export function addRiftRecord(cls, { win, kills = 0, deaths = 0, assists = 0, mode = '3v3' } = {}) {
  const byMode = loadRecordsRaw()
  const bucket = byMode[mode] || (byMode[mode] = {})
  const r = bucket[cls] || (bucket[cls] = { games: 0, wins: 0, kills: 0, deaths: 0, assists: 0 })
  r.games += 1
  if (win) r.wins += 1
  r.kills += kills
  r.deaths += deaths
  r.assists += assists
  try {
    localStorage.setItem(RIFT_RECORDS_KEY, JSON.stringify(byMode))
  } catch {
    /* 무시 */
  }
  return byMode
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

// ── 보스전 토벌 기록 — 보스별 { clears(토벌 횟수), best(최단 클리어 초) } ──
// v2: 난이도 티어별 기록 { [bossCls]: { [tier]: { clears, best } } } — v1(티어 없음)은 '보통'으로 이관
const BOSS_REC_KEY = 'bgp.rift.bossRecords.v2'
const BOSS_REC_KEY_V1 = 'bgp.rift.bossRecords.v1'

export function loadBossRecords() {
  try {
    const v2 = JSON.parse(localStorage.getItem(BOSS_REC_KEY))
    if (v2 && typeof v2 === 'object') return v2
  } catch { /* 무시 */ }
  // v1 → v2 마이그레이션: 티어 개념이 없던 기록은 전부 '보통' 클리어였다
  try {
    const v1 = JSON.parse(localStorage.getItem(BOSS_REC_KEY_V1) || '{}')
    if (v1 && typeof v1 === 'object' && Object.keys(v1).length) {
      const out = {}
      for (const [cls, rec] of Object.entries(v1)) out[cls] = { normal: rec }
      localStorage.setItem(BOSS_REC_KEY, JSON.stringify(out))
      return out
    }
  } catch { /* 무시 */ }
  return {}
}

// 토벌 1건 기록하고 { isFirst(이 보스·티어 첫 토벌), isBest(최단 갱신), best }를 돌려준다
export function recordBossClear(bossCls, timeSec, tier = 'normal') {
  const all = loadBossRecords()
  const byTier = all[bossCls] || {}
  const cur = byTier[tier] || { clears: 0, best: null }
  const isFirst = cur.clears === 0
  const isBest = cur.best == null || timeSec < cur.best
  byTier[tier] = { clears: cur.clears + 1, best: isBest ? Math.round(timeSec) : cur.best }
  all[bossCls] = byTier
  try {
    localStorage.setItem(BOSS_REC_KEY, JSON.stringify(all))
  } catch {
    /* 무시 */
  }
  return { isFirst, isBest, best: byTier[tier].best }
}

// 티어 해금 — 실력 게이트: 보통은 항상, 어려움은 아무 보스든 보통 클리어, 악몽은 어려움 클리어.
// (도전 보스가 무작위 배정이라 보스별이 아닌 전역 게이트가 자연스럽다)
export function bossTierUnlocked(tier) {
  if (tier === 'normal') return true
  const prev = tier === 'hard' ? 'normal' : 'hard'
  const all = loadBossRecords()
  return Object.values(all).some((byTier) => (byTier?.[prev]?.clears || 0) > 0)
}
