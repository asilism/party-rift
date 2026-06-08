// 스릴팡(타이밍) 순수 로직. (화면/애니메이션과 분리되어 테스트 가능)
//
// 규칙: 폭탄 구슬이 deadline(ms)에 구멍에 빠진다(매 라운드 랜덤 속도).
//  각자 버튼을 눌러 자기 구슬을 출발 → travel(ms) 뒤 구멍에 들어간다.
//   - 폭탄보다 늦게(또는 안 눌러서) 들어가면 '펑' → 0점.
//   - 폭탄보다 빨리 들어간 사람들끼리: 오차(가장 일찍=오차 큼) 큰 사람이 1점,
//     그다음 2점 … 폭탄에 가장 가깝게(오차 작게) 넣은 사람이 최고점.

export const TRAVEL_MS = 1600 // 버튼 → 구멍까지 내 구슬 이동 시간(더 느리게=스릴↑)
export const ROUNDS = 5
const DUR_MIN = 3200
const DUR_MAX = 6000

// 폭탄이 구멍에 빠지는 시각(ms). 매 라운드 랜덤.
export function randomDuration(rng = Math.random) {
  return Math.round(DUR_MIN + rng() * (DUR_MAX - DUR_MIN))
}

export function createGame(players, rounds = ROUNDS) {
  return {
    players: players.map((p) => ({ ...p, score: 0 })),
    round: 1,
    rounds,
    status: 'playing', // 'playing' | 'finished'
  }
}

// 한 라운드 채점.
//  entries: [{ id, pressAt }]  pressAt = 출발 누른 시각(ms), 안 눌렀으면 null
//  deadline: 폭탄이 빠지는 시각(ms), travel: 내 구슬 이동 시간(ms)
//  반환: { points: {id->점수}, rows: [{id, marbleTime, busted, error}] }
export function scoreRound(entries, deadline, travel = TRAVEL_MS) {
  const rows = entries.map((e) => {
    const marbleTime = e.pressAt == null ? null : e.pressAt + travel
    const busted = marbleTime == null || marbleTime > deadline
    return { id: e.id, marbleTime, busted, error: busted ? null : deadline - marbleTime }
  })
  // 안 터진(세이프) 사람들: 오차 큰 순서로 1,2,3… → 가장 근접(오차 작음)한 사람이 최고점
  const safe = rows.filter((r) => !r.busted).sort((a, b) => b.error - a.error)
  const points = {}
  rows.forEach((r) => (points[r.id] = 0))
  safe.forEach((r, i) => (points[r.id] = i + 1))
  return { points, rows }
}

// 라운드 점수 반영 + 다음 라운드/종료 처리
export function applyRoundScores(state, points) {
  const players = state.players.map((p) => ({ ...p, score: p.score + (points[p.id] || 0) }))
  const finished = state.round >= state.rounds
  return {
    ...state,
    players,
    round: finished ? state.round : state.round + 1,
    status: finished ? 'finished' : 'playing',
  }
}

export function winners(state) {
  const max = Math.max(...state.players.map((p) => p.score))
  return state.players.filter((p) => p.score === max)
}
