// 신호등 반응 순수 로직. 초록불에 가장 빨리 누른 사람이 그 라운드 승(+1). 빨강에 누르면 부정출발.
export const ROUNDS = 5

export function createGame(players, rounds = ROUNDS) {
  return {
    players: players.map((p) => ({ ...p, score: 0 })),
    round: 1,
    rounds,
    status: 'playing',
  }
}

// entries: [{ id, ms, falseStart }] — ms=반응시간(ms), 안 누르면 ms=null
// 유효(부정출발 아님 + 누름) 중 가장 빠른 사람이 승. 없으면 null.
export function roundWinner(entries) {
  const valid = entries.filter((e) => !e.falseStart && e.ms != null)
  if (!valid.length) return null
  return valid.reduce((best, e) => (e.ms < best.ms ? e : best)).id
}

export function applyRound(state, winnerId) {
  const players = state.players.map((p) =>
    p.id === winnerId ? { ...p, score: p.score + 1 } : p
  )
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
