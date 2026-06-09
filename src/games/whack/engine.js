// 두더지 잡기 순수 로직(점수/승자). 두더지 등장/사라짐 타이밍은 화면(컴포넌트)에서 처리.
export const DURATION_MS = 30000 // 30초
export const HOLES = 6 // 플레이어당 구멍 수

export function createGame(players) {
  return { players: players.map((p) => ({ ...p, score: 0 })), status: 'playing' }
}

export function whack(state, id) {
  return {
    ...state,
    players: state.players.map((p) => (p.id === id ? { ...p, score: p.score + 1 } : p)),
  }
}

export function winners(state) {
  const max = Math.max(...state.players.map((p) => p.score))
  return state.players.filter((p) => p.score === max)
}
