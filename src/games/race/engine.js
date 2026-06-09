// 달리기 경주(버튼 연타) 순수 로직. 각자 자기 레인을 연타해 결승선까지.
export const TAPS_TO_WIN = 26 // 결승선까지 필요한 탭 수

export function createGame(players) {
  return {
    players: players.map((p) => ({ ...p, taps: 0 })),
    finishOrder: [], // 골인한 순서(id)
    status: 'playing', // 'playing' | 'finished'
  }
}

// 한 번 탭(연타). 결승선 도달 시 골인 기록, 첫 골인이면 종료.
export function tapRun(state, id) {
  if (state.status === 'finished') return state
  const players = state.players.map((p) =>
    p.id === id && p.taps < TAPS_TO_WIN ? { ...p, taps: p.taps + 1 } : p
  )
  let finishOrder = state.finishOrder
  let status = state.status
  const pl = players.find((p) => p.id === id)
  if (pl && pl.taps >= TAPS_TO_WIN && !finishOrder.includes(id)) {
    finishOrder = [...finishOrder, id]
    status = 'finished' // 첫 골인 → 승자 결정
  }
  return { ...state, players, finishOrder, status }
}

// 진행률 0~1
export function progress(player) {
  return Math.min(1, player.taps / TAPS_TO_WIN)
}

// 순위: 골인순 우선, 나머지는 탭 많은 순
export function ranking(state) {
  return [...state.players].sort((a, b) => {
    const ai = state.finishOrder.indexOf(a.id)
    const bi = state.finishOrder.indexOf(b.id)
    if (ai !== -1 || bi !== -1) {
      if (ai === -1) return 1
      if (bi === -1) return -1
      return ai - bi
    }
    return b.taps - a.taps
  })
}

export function winner(state) {
  const id = state.finishOrder[0]
  return id ? state.players.find((p) => p.id === id) : null
}
