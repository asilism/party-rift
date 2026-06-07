// 사다리 게임의 순수 로직. (화면/애니메이션과 분리되어 테스트 가능)

// 주사위 굴리기: 1 ~ diceSides 사이 정수 (diceCount개 합)
export function rollDice(config, rng = Math.random) {
  let total = 0
  for (let i = 0; i < config.diceCount; i++) {
    total += Math.floor(rng() * config.diceSides) + 1
  }
  return total
}

// 게임 초기 상태 생성. players: [{ id, zodiacId }]
export function createGame(players, config) {
  return {
    config,
    players: players.map((p) => ({ ...p, position: 1 })),
    currentIndex: 0,
    status: 'playing', // 'playing' | 'finished'
    winnerId: null,
    lastRoll: null,
  }
}

// 한 번의 이동을 계산한다(상태를 바꾸지 않음). 애니메이션용 정보를 함께 반환.
//  - walkPath: 한 칸씩 걸어가는 경로(시작칸 다음 ~ 도착칸)
//  - landing: 주사위만큼 이동해 멈춘 칸
//  - platform: 발판 발동 시 { from, to, dir } / 없으면 null
//  - finalPosition: 발판까지 적용한 최종 칸
//  - won: 골인 여부
export function computeMove(position, roll, config) {
  const goal = config.tileCount
  let landing = position + roll
  let won = false

  if (config.overshoot) {
    if (landing >= goal) {
      landing = goal
      won = true
    }
  } else {
    // 정확히 도착 규칙: 초과하면 이동하지 않음
    if (landing > goal) landing = position
    if (landing === goal) won = true
  }

  const walkPath = []
  for (let p = position + 1; p <= landing; p++) walkPath.push(p)

  let platform = null
  let finalPosition = landing

  // 골인 칸에서는 발판을 적용하지 않는다.
  if (!won && config.platforms[landing] != null) {
    const to = config.platforms[landing]
    platform = { from: landing, to, dir: to > landing ? 'up' : 'down' }
    finalPosition = to
    if (to >= goal) {
      finalPosition = goal
      won = true
    }
  }

  return { walkPath, landing, platform, finalPosition, won }
}

// 이동 결과를 상태에 반영한 새 상태를 반환.
export function applyMove(state, roll) {
  const player = state.players[state.currentIndex]
  const move = computeMove(player.position, roll, state.config)

  const players = state.players.map((p, i) =>
    i === state.currentIndex ? { ...p, position: move.finalPosition } : p
  )

  if (move.won) {
    return {
      ...state,
      players,
      lastRoll: roll,
      status: 'finished',
      winnerId: player.id,
    }
  }

  return {
    ...state,
    players,
    lastRoll: roll,
    currentIndex: (state.currentIndex + 1) % state.players.length,
  }
}

// 칸 번호 → 보드 격자 좌표 (뱀/boustrophedon 배치)
//  row 0 = 맨 아래줄(왼→오), row 1 = 그 위(오→왼) ...
export function tileToCoord(tile, cols) {
  const i = tile - 1
  const row = Math.floor(i / cols)
  let col = i % cols
  if (row % 2 === 1) col = cols - 1 - col
  return { row, col }
}
