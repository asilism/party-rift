// 열쇠카드: 칸을 밟으면 5장 중 1장을 고르고, 그 효과가 발동한다.
// 효과는 순수 함수(resolveKeyCard)로 계산 — 화면/애니메이션과 분리.

// weight: 뽑힐 가중치. swap(자리바꾸기)은 판을 크게 흔들어서 드물게(전체의 약 7%) 나오게 한다.
// 합계 14 → swap 1/14 ≈ 7%, 나머지 각 ≈ 23% / 23% / 15% / 31%... 가 아니라
// (3+4+3+3)=13 + swap1 = 14. swap≈7%, back2≈21%, forward5≈29%, again≈21%, chase≈21%.
export const KEY_CARDS = [
  { id: 'swap', emoji: '🔄', title: '자리 바꾸기', desc: '꼴찌와 선두가 자리를 바꿔요!', weight: 1 },
  { id: 'back2', emoji: '⏪', title: '두 칸 뒤로', desc: '두 칸 뒤로 가요', weight: 3 },
  { id: 'forward5', emoji: '⏩', title: '다섯 칸 앞으로', desc: '다섯 칸 앞으로!', weight: 4 },
  { id: 'again', emoji: '🎲', title: '한 번 더!', desc: '주사위를 한 번 더 던져요', weight: 3 },
  { id: 'chase', emoji: '🏃', title: '앞사람 따라잡기', desc: '바로 앞 사람을 따라잡아요 (1등이면 효과 없음)', weight: 3 },
]

export function getCard(id) {
  return KEY_CARDS.find((c) => c.id === id) || null
}

// 가중치에 따라 카드 1장을 뽑는다.
export function randomCardId(rng = Math.random) {
  const total = KEY_CARDS.reduce((s, c) => s + c.weight, 0)
  let r = rng() * total
  for (const c of KEY_CARDS) {
    r -= c.weight
    if (r < 0) return c.id
  }
  return KEY_CARDS[KEY_CARDS.length - 1].id
}

// 카드 효과를 상태에 적용한다(상태를 바꾸지 않고 새 상태 반환).
//  - next: 효과를 반영한 새 게임 상태(턴/승리 처리 포함)
//  - changes: 자리를 옮긴 말들 [{ id, from, to }] (애니메이션용)
//  - rollAgain: 같은 사람이 한 번 더 던지는지 여부
export function resolveKeyCard(state, cardId) {
  const goal = state.config.tileCount
  const idx = state.currentIndex
  const cur = state.players[idx]
  const players = state.players.map((p) => ({ ...p }))
  const changes = []
  let rollAgain = false
  let winnerId = null

  const move = (i, to) => {
    const from = players[i].position
    if (to !== from) changes.push({ id: players[i].id, from, to })
    players[i].position = to
  }

  switch (cardId) {
    case 'swap': {
      // 선두(최고 위치)와 꼴찌(최저 위치)를 찾아 자리 교환
      let hi = 0
      let lo = 0
      players.forEach((p, i) => {
        if (p.position > players[hi].position) hi = i
        if (p.position < players[lo].position) lo = i
      })
      if (hi !== lo) {
        const a = players[hi].position
        const b = players[lo].position
        move(hi, b)
        move(lo, a)
      }
      break
    }
    case 'back2':
      move(idx, Math.max(1, cur.position - 2))
      break
    case 'forward5': {
      let to = cur.position + 5
      if (to >= goal) {
        to = goal
        winnerId = cur.id
      }
      move(idx, to)
      break
    }
    case 'again':
      rollAgain = true
      break
    case 'chase': {
      // 바로 앞사람 = 내 위치보다 큰 위치 중 가장 가까운 사람
      let ahead = null
      players.forEach((p, i) => {
        if (p.position > cur.position && (ahead === null || p.position < players[ahead].position)) {
          ahead = i
        }
      })
      if (ahead !== null) move(idx, players[ahead].position)
      break
    }
    default:
      break
  }

  let status = state.status
  let currentIndex = state.currentIndex
  if (winnerId) {
    status = 'finished'
  } else if (!rollAgain) {
    currentIndex = (state.currentIndex + 1) % state.players.length
  }

  return {
    next: { ...state, players, status, winnerId: winnerId ?? state.winnerId, currentIndex },
    changes,
    rollAgain,
  }
}
