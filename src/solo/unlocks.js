import { CLASS_IDS } from '../games/rift/engine.js'
import { loadCoinUnlocks, addCoinUnlock } from '../shared/storage.js'

// 솔로 모드 캐릭터 해금 — 시작은 기본 6종(역할 골고루: 전사·궁수·마법사·힐러·암살자·탱커),
// 나머지는 코인 해금만(승리 해금 폐지, v72). 캐릭터가 "기다리면 공짜"인 동안은 코인을 쓸
// 이유가 없다 — 코인의 쓸 곳이 곧 광고 2배·플레이의 동기다.
export const STARTER_COUNT = 6

// 승리 해금 폐지 마이그레이션: 폐지 시점까지 통산 승수로 열려 있던 직업을 코인 해금
// 목록으로 굳힌다(폐지 전과 같은 순서·같은 규칙). 이미 열린 직업은 건너뛰므로 멱등 —
// 기존 유저가 쓰던 캐릭터가 다시 잠기는 일은 없어야 한다.
const MIGRATE_KEY = 'bgp.rift.winunlock.migrated.v1'
export function migrateWinUnlocks(totalWins) {
  // 1회성: 저장식이라 재호출하면 "다음 직업"을 계속 열어버린다(가산) — 플래그로 한 번만
  try {
    if (localStorage.getItem(MIGRATE_KEY) === 'done') return
    localStorage.setItem(MIGRATE_KEY, 'done')
  } catch {
    return // 저장이 안 되는 환경이면 마이그레이션도 하지 않는다(재실행 가산 방지)
  }
  let wins = Math.max(0, totalWins || 0)
  const owned = new Set([...CLASS_IDS.slice(0, STARTER_COUNT), ...loadCoinUnlocks()])
  for (const id of CLASS_IDS) {
    if (wins <= 0) break
    if (owned.has(id)) continue
    addCoinUnlock(id)
    wins--
  }
}

// 해금된 직업 집합: 기본 6종 + 코인 해금
export function unlockedClassIds() {
  const coins = loadCoinUnlocks().filter((id) => CLASS_IDS.includes(id))
  return [...new Set([...CLASS_IDS.slice(0, STARTER_COUNT), ...coins])]
}

export function unlockedCount() {
  return unlockedClassIds().length
}

// 가격 곡선: 열수록 다음 캐릭터가 비싸진다(승 30코인 기준 10판 → 18판).
// 첫 해금은 가볍게 손이 가고, 전 캐릭터 완주는 긴 여정이 되도록.
export const UNLOCK_PRICES = [300, 350, 400, 450, 500, 550]

// 다음 해금 가격 — 기본 6종 밖에서 이미 열린 수(코인+마이그레이션)에 따라 오른다
export function unlockPrice() {
  const opened = loadCoinUnlocks().filter(
    (id) => CLASS_IDS.includes(id) && CLASS_IDS.indexOf(id) >= STARTER_COUNT
  ).length
  return UNLOCK_PRICES[Math.min(opened, UNLOCK_PRICES.length - 1)]
}
