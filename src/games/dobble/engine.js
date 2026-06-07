// 도블(Dobble) 순수 로직. (화면/애니메이션과 분리되어 테스트 가능)
// 핵심 성질: 어떤 두 카드든 공통 문양이 "정확히 1개". 유한 사영평면(차수 n, n은 소수)로 생성.
import { SYMBOLS } from './symbols.js'

// Fisher-Yates 셔플 (rng 주입 → 테스트 결정적)
export function shuffle(arr, rng = Math.random) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// 차수 n(소수)인 사영평면으로 도블 덱 생성.
//  - 문양/카드 수 = n²+n+1, 카드당 문양 = n+1
//  - 카드는 문양 인덱스(0..n²+n) 배열
export function generateDobble(n) {
  const cards = []
  // n² 개: "기울기 a, 절편 b" 직선 카드
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      const card = []
      for (let c = 0; c < n; c++) card.push(c * n + ((a * c + b) % n))
      card.push(n * n + a) // 무한점(기울기 a)
      cards.push(card)
    }
  }
  // n 개: 수직선 카드
  for (let c = 0; c < n; c++) {
    const card = []
    for (let r = 0; r < n; r++) card.push(c * n + r)
    card.push(n * n + n) // 공통 무한점
    cards.push(card)
  }
  // 1 개: 모든 무한점 카드
  const last = []
  for (let k = 0; k <= n; k++) last.push(n * n + k)
  cards.push(last)
  return cards
}

// 게임 초기 상태. players: [{ id, name, zodiacId, color }]
//  - 각자 카드 1장으로 시작. 맞히면 중앙 카드를 가져와 내 카드(top)가 교체되고,
//    중앙은 덱의 다음 카드로 바뀐다 → 매 라운드 문제가 계속 변한다.
//    (어떤 두 카드든 공통 문양 1개라, 교체돼도 항상 정답이 정확히 하나 존재)
export function createGame(players, n, rng = Math.random) {
  const deck = shuffle(generateDobble(n), rng)
  const symCount = n * n + n + 1
  const symbols = shuffle([...SYMBOLS], rng).slice(0, symCount) // 문양 인덱스 → 이모지
  const k = players.length
  const centerQueue = deck.slice(k) // 중앙으로 돌릴 카드들
  return {
    n,
    symbols,
    players: players.map((p, i) => ({ ...p, card: deck[i], score: 0 })),
    centerQueue,
    centerPos: 0,
    center: centerQueue[0] || null,
    locked: [], // 이번 라운드에 틀려서 잠긴 플레이어
    status: centerQueue.length ? 'playing' : 'finished',
  }
}

// 다음 중앙 카드로 진행(또는 종료)
function advanceCenter(state, extra) {
  const centerPos = state.centerPos + 1
  const finished = centerPos >= state.centerQueue.length
  return {
    ...state,
    ...extra,
    centerPos,
    center: finished ? state.center : state.centerQueue[centerPos],
    locked: [],
    status: finished ? 'finished' : 'playing',
  }
}

// 플레이어가 자기 카드의 문양 하나를 탭. 중앙 카드에 있으면 정답.
//  반환: { state, result: 'correct'|'wrong'|'locked'|'ignored', playerId, advanced?, finished? }
export function tapSymbol(state, playerId, symbol) {
  if (state.status === 'finished') return { state, result: 'ignored' }
  if (state.locked.includes(playerId)) return { state, result: 'locked' }
  const pIdx = state.players.findIndex((p) => p.id === playerId)
  if (pIdx < 0) return { state, result: 'ignored' }

  if (state.center && state.center.includes(symbol)) {
    // 정답 → 중앙 카드를 가져와 내 카드(top)로 교체하고 점수 +1
    const wonCard = state.center
    const players = state.players.map((p, i) =>
      i === pIdx ? { ...p, score: p.score + 1, card: wonCard } : p
    )
    const next = advanceCenter(state, { players })
    return { state: next, result: 'correct', playerId, advanced: true, finished: next.status === 'finished' }
  }

  // 오답 → 이번 라운드 잠금(패널티)
  const locked = [...state.locked, playerId]
  if (locked.length >= state.players.length) {
    // 전원 잠김 → 아무도 못 맞힘, 다음 카드로 넘어감
    const next = advanceCenter(state, {})
    return { state: next, result: 'wrong', playerId, advanced: true, skipped: true, finished: next.status === 'finished' }
  }
  return { state: { ...state, locked }, result: 'wrong', playerId }
}

// 우승자(최고 점수, 동점 가능)
export function winners(state) {
  const max = Math.max(...state.players.map((p) => p.score))
  return state.players.filter((p) => p.score === max)
}
