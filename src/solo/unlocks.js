import { CLASS_IDS } from '../games/rift/engine.js'
import { loadCoinUnlocks } from '../shared/storage.js'
import { hasUnlockAll } from '../shared/iap.js'

// 솔로 모드 캐릭터 해금 — 시작은 기본 6종(역할 골고루: 전사·궁수·마법사·힐러·암살자·탱커),
// 나머지는 코인 해금만(승리 해금 폐지, v72). 캐릭터가 "기다리면 공짜"인 동안은 코인을 쓸
// 이유가 없다 — 코인의 쓸 곳이 곧 광고 2배·플레이의 동기다.
export const STARTER_COUNT = 6

// 해금된 직업 집합: 기본 6종 + 코인 해금 (올인원 구매자는 전부)
export function unlockedClassIds() {
  if (hasUnlockAll()) return [...CLASS_IDS]
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
