import { CLASS_IDS } from '../games/rift/engine.js'
import { loadCoinUnlocks } from '../shared/storage.js'

// 솔로 모드 캐릭터 해금 — 시작은 기본 6종(역할 골고루: 전사·궁수·마법사·힐러·암살자·탱커),
// 승리(클리어) 1회마다 CLASS_IDS 정의 순서대로 1종씩 열린다.
// 별도 저장 없이 통산 승수(전적)에서 유도한다 — 상태가 꼬일 일이 없고, 과거 승수도 소급 인정.
export const STARTER_COUNT = 6

// 해금된 직업 집합: 기본 6종 + 코인 선행 해금(임의 직업) + 승리 해금.
//  승리 해금은 CLASS_IDS 순서대로 "아직 안 열린" 직업을 승수만큼 연다 — 코인으로 미리 연
//  직업은 건너뛴다. 그래야 코인 해금이 승리 해금과 충돌하지 않고, "한 번 더 이기면 X 해금"
//  안내도 실제로 다음에 열릴 직업을 정확히 가리킨다.
export function unlockedClassIds(totalWins) {
  const coins = loadCoinUnlocks().filter((id) => CLASS_IDS.includes(id))
  const unlocked = new Set([...CLASS_IDS.slice(0, STARTER_COUNT), ...coins])
  let wins = Math.max(0, totalWins || 0)
  for (const id of CLASS_IDS) {
    if (wins <= 0) break
    if (unlocked.has(id)) continue // 이미 열림(기본/코인) — 승리 슬롯을 낭비하지 않는다
    unlocked.add(id)
    wins--
  }
  return [...unlocked]
}

export function unlockedCount(totalWins) {
  return unlockedClassIds(totalWins).length
}

// 코인 선행 해금 가격 — 캐릭터 1종 300코인 고정(승 30코인 기준 약 10판, 광고 2배면 절반).
export const UNLOCK_PRICE = 300

// 다음 승리로 열릴 직업 id — CLASS_IDS 순서상 아직 안 열린 첫 직업(코인 해금 반영). 전부 열렸으면 null
export function nextUnlock(totalWins) {
  const unlocked = new Set(unlockedClassIds(totalWins))
  return CLASS_IDS.find((id) => !unlocked.has(id)) || null
}
