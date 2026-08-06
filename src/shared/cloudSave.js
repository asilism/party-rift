import { IS_APP_SHELL } from './appShell.js'

// ☁️ 클라우드 세이브 — Play 게임 서비스 "저장된 게임"(무료·서버 불필요·구글 계정 내장).
//  네이티브 쪽은 앱 내장 플러그인(SavedGamesPlugin.java), 여기는 수집·적용·동기화 정책.
//
// 동기화 모델(단순함 우선):
//  - 앱을 켤 때: 클라우드 스냅샷이 내 마지막 저장보다 새로우면 통째로 적용(최신 승리).
//    React가 localStorage를 읽기 전에 끝나야 하므로 main.jsx가 부팅을 잠깐 기다린다(상한 2.5초).
//  - 앱이 백그라운드로 갈 때: 자동 저장(스로틀 15초). 설정의 "지금 저장"은 수동 트리거.
//  - 기기 간 충돌은 스냅샷 정책(최근 수정본 승리)이 한 번 더 걸러 준다.
//  구매 플래그(noads/unlockall)도 함께 실리지만 근거는 어디까지나 스토어 — 환불 회수(iap.js)가
//  클라우드로 되살아난 플래그를 다음 초기화에서 다시 거둔다.

const SNAPSHOT_NAME = 'zodiac-progress'
const PREFIX = 'bgp.' // 게임 진행 데이터의 키 접두사 — 이 밖의 키는 싣지 않는다
const META_PREFIX = 'bgp.cloud.' // 동기화 메타 자신은 스냅샷에 싣지도, 적용하지도 않는다
const LAST_SAVED_KEY = 'bgp.cloud.lastSavedAt'

// ── 순수 로직(테스트 대상) ─────────────────────────────────────────────

// 진행 전체를 스냅샷 페이로드로 수집
export function collectProgress(now = Date.now()) {
  const keys = {}
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k || !k.startsWith(PREFIX) || k.startsWith(META_PREFIX)) continue
      keys[k] = localStorage.getItem(k)
    }
  } catch {
    /* 접근 불가 — 빈 페이로드 */
  }
  return { v: 1, savedAt: now, keys }
}

// 스냅샷을 로컬에 적용 — 접두사 밖·메타 키는 무시(악성 스냅샷 방어)
export function applyProgress(payload) {
  if (!payload || payload.v !== 1 || typeof payload.keys !== 'object' || !payload.keys) return 0
  let n = 0
  for (const [k, v] of Object.entries(payload.keys)) {
    if (!k.startsWith(PREFIX) || k.startsWith(META_PREFIX) || typeof v !== 'string') continue
    try {
      localStorage.setItem(k, v)
      n++
    } catch {
      /* 저장 실패 — 다음 키 계속 */
    }
  }
  return n
}

// 최신 승리: 클라우드가 내 마지막 저장보다 새로울 때만 적용
export function shouldApplyRemote(remote, lastSavedAt) {
  return !!remote && remote.v === 1 && typeof remote.savedAt === 'number'
    && remote.savedAt > (Number(lastSavedAt) || 0)
}

// ── 네이티브 연결 ─────────────────────────────────────────────────────

const isNative = () =>
  IS_APP_SHELL && typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.()

let pluginP = null
function plugin() {
  if (!pluginP) {
    pluginP = import('@capacitor/core').then(({ registerPlugin }) => registerPlugin('SavedGames'))
  }
  return pluginP
}

const lastSavedAt = () => {
  try {
    return Number(localStorage.getItem(LAST_SAVED_KEY)) || 0
  } catch {
    return 0
  }
}
const markSaved = (t) => {
  try {
    localStorage.setItem(LAST_SAVED_KEY, String(t))
  } catch {
    /* 무시 */
  }
}

// {available, signedIn} — 미지원·미설정·웹은 available:false
export async function cloudStatus() {
  if (!isNative()) return { available: false, signedIn: false }
  try {
    return await (await plugin()).status()
  } catch {
    return { available: false, signedIn: false }
  }
}

export async function signInCloud() {
  if (!isNative()) return false
  try {
    const r = await (await plugin()).signIn()
    return !!r?.signedIn
  } catch {
    return false
  }
}

// 지금 저장 — 성공 시 저장 시각 기록(이후 부팅에서 이보다 새 스냅샷만 적용)
export async function saveCloudNow() {
  if (!isNative()) return false
  try {
    const p = await plugin()
    const st = await p.status()
    if (!st?.signedIn) return false
    const payload = collectProgress()
    await p.save({ name: SNAPSHOT_NAME, data: JSON.stringify(payload) })
    markSaved(payload.savedAt)
    return true
  } catch {
    return false
  }
}

let autoWired = false
let lastAuto = 0
function wireAutoSave() {
  if (autoWired || typeof document === 'undefined') return
  autoWired = true
  // 백그라운드 전환 = 저장 타이밍(안드로이드 앱 이탈은 visibilitychange로 온다) — 15초 스로틀
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') return
    const now = Date.now()
    if (now - lastAuto < 15000) return
    lastAuto = now
    saveCloudNow() // 결과는 조용히 — 실패해도 다음 이탈 때 다시
  })
}

// 부팅 동기화 — main.jsx가 렌더 전에 await 한다. 어떤 경우에도 부팅을 2.5초 이상 막지 않는다.
export async function initCloudSave() {
  if (!isNative()) return { applied: false }
  const work = (async () => {
    const p = await plugin()
    const st = await p.status()
    wireAutoSave() // 로그인 전이라도 걸어 둔다 — 나중에 로그인하면 그때부터 저장된다
    if (!st?.signedIn) return { applied: false }
    const r = await p.loadData({ name: SNAPSHOT_NAME })
    if (!r?.data) return { applied: false }
    let remote = null
    try {
      remote = JSON.parse(r.data)
    } catch {
      return { applied: false } // 깨진 스냅샷 — 다음 저장이 덮어쓴다
    }
    if (!shouldApplyRemote(remote, lastSavedAt())) return { applied: false }
    const n = applyProgress(remote)
    markSaved(remote.savedAt) // 방금 받아 온 시점으로 맞춘다 — 같은 스냅샷 재적용 방지
    return { applied: n > 0 }
  })()
  const timeout = new Promise((res) => setTimeout(() => res({ applied: false }), 2500))
  return Promise.race([work, timeout]).catch(() => ({ applied: false }))
}
