// 12지신 메모리(짝 맞추기) 순수 로직. (화면/애니메이션과 분리되어 테스트 가능)
import { ZODIAC } from '../../shared/zodiac.js'

// Fisher-Yates 셔플 (rng 주입 가능 → 테스트 결정적)
export function shuffle(arr, rng = Math.random) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// 카드 덱 생성: 동물 pairs종을 골라 각 2장씩 → 섞어서 반환.
//  카드: { id(고유), animalId }
export function createDeck(pairs, rng = Math.random, animals = ZODIAC) {
  const chosen = shuffle(animals, rng).slice(0, pairs)
  const cards = []
  chosen.forEach((z, p) => {
    cards.push({ id: p * 2, animalId: z.id })
    cards.push({ id: p * 2 + 1, animalId: z.id })
  })
  return shuffle(cards, rng)
}

// 게임 초기 상태. players: [{ id, name, color }]
export function createGame(players, difficulty, rng = Math.random) {
  return {
    difficulty,
    players: players.map((p) => ({ ...p, score: 0 })),
    currentIndex: 0,
    cards: createDeck(difficulty.pairs, rng),
    matched: [], // 맞춘 카드 id들
    status: 'playing', // 'playing' | 'finished'
  }
}

// 뒤집은 두 장을 평가해 새 상태를 반환.
//  - match: 짝이 맞았는지
//  - won: 모든 짝을 다 맞췄는지(게임 종료)
// 규칙: 짝이 맞으면 점수 +1 & 같은 사람 한 번 더, 틀리면 다음 사람 차례.
export function applyPair(state, idA, idB) {
  const a = state.cards.find((c) => c.id === idA)
  const b = state.cards.find((c) => c.id === idB)
  const match = !!a && !!b && a.id !== b.id && a.animalId === b.animalId

  let players = state.players
  let matched = state.matched
  let currentIndex = state.currentIndex
  let status = state.status

  if (match) {
    matched = [...state.matched, idA, idB]
    players = state.players.map((p, i) =>
      i === state.currentIndex ? { ...p, score: p.score + 1 } : p
    )
    if (matched.length === state.cards.length) status = 'finished'
  } else {
    currentIndex = (state.currentIndex + 1) % state.players.length
  }

  return {
    next: { ...state, players, matched, currentIndex, status },
    match,
    won: status === 'finished',
  }
}

// 우승자(최고 점수). 동점이면 여러 명.
export function winners(state) {
  const max = Math.max(...state.players.map((p) => p.score))
  return state.players.filter((p) => p.score === max)
}
