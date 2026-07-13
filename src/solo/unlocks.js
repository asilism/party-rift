import { CLASS_IDS } from '../games/rift/engine.js'
import { loadCoinUnlocks } from '../shared/storage.js'

// 솔로 모드 캐릭터 해금 — 시작은 기본 6종(역할 골고루: 전사·궁수·마법사·힐러·암살자·탱커),
// 승리(클리어) 1회마다 CLASS_IDS 정의 순서대로 1종씩 열린다.
// 별도 저장 없이 통산 승수(전적)에서 유도한다 — 상태가 꼬일 일이 없고, 과거 승수도 소급 인정.
export const STARTER_COUNT = 6

export function unlockedCount(totalWins) {
  return Math.min(CLASS_IDS.length, STARTER_COUNT + Math.max(0, totalWins || 0))
}

export function unlockedClassIds(totalWins) {
  // 승수 해금(순서대로) + 코인 선행 해금(원하는 직업 골라서)의 합집합
  const byWins = CLASS_IDS.slice(0, unlockedCount(totalWins))
  const byCoins = loadCoinUnlocks().filter((id) => CLASS_IDS.includes(id))
  return [...new Set([...byWins, ...byCoins])]
}

// 코인 선행 해금 가격 — 승리 약 17판 분량(승 30코인 기준). 광고 2배면 절반.
export const UNLOCK_PRICE = 500

// 다음 승리로 열릴 직업 id — 전부 열렸으면 null
export function nextUnlock(totalWins) {
  const n = unlockedCount(totalWins)
  return n < CLASS_IDS.length ? CLASS_IDS[n] : null
}
