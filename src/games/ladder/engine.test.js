import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeMove, applyMove, createGame, tileToCoord } from './engine.js'
import { BOARDS, validateBoard, validateNoCrossings, tileRow } from './board.config.js'
import { resolveKeyCard, randomCardId, KEY_CARDS } from './keycards.js'

const config = {
  tileCount: 30,
  cols: 6,
  rows: 5,
  diceCount: 1,
  diceSides: 6,
  overshoot: true,
  platforms: { 3: 9, 16: 13 },
  keyTiles: [5, 8],
}

test('일반 이동: 발판 없는 칸', () => {
  const m = computeMove(1, 4, config) // 1 -> 5
  assert.equal(m.landing, 5)
  assert.equal(m.platform, null)
  assert.equal(m.finalPosition, 5)
  assert.equal(m.won, false)
  assert.deepEqual(m.walkPath, [2, 3, 4, 5])
})

test('올라가는 발판 발동', () => {
  const m = computeMove(1, 2, config) // 1 -> 3 -> 9
  assert.equal(m.landing, 3)
  assert.equal(m.platform.dir, 'up')
  assert.equal(m.finalPosition, 9)
})

test('내려가는 발판 발동', () => {
  const m = computeMove(13, 3, config) // 13 -> 16 -> 13
  assert.equal(m.landing, 16)
  assert.equal(m.platform.dir, 'down')
  assert.equal(m.finalPosition, 13)
})

test('초과 허용: 골 이상이면 골인', () => {
  const m = computeMove(28, 5, config) // 28 + 5 = 33 -> 30
  assert.equal(m.landing, 30)
  assert.equal(m.won, true)
  assert.equal(m.finalPosition, 30)
})

test('정확히 도착 규칙: 초과 시 이동 안 함', () => {
  const exact = { ...config, overshoot: false }
  const m = computeMove(28, 5, exact) // 33 > 30 -> 멈춤
  assert.equal(m.landing, 28)
  assert.equal(m.won, false)
})

test('applyMove: 턴 넘김', () => {
  const g = createGame([{ id: 'a', zodiacId: 'rat' }, { id: 'b', zodiacId: 'ox' }], config)
  const next = applyMove(g, 4)
  assert.equal(next.players[0].position, 5)
  assert.equal(next.currentIndex, 1)
  assert.equal(next.status, 'playing')
})

test('applyMove: 승리 시 finished', () => {
  const g = createGame([{ id: 'a', zodiacId: 'rat' }], config)
  g.players[0].position = 28
  const next = applyMove(g, 5)
  assert.equal(next.status, 'finished')
  assert.equal(next.winnerId, 'a')
})

test('tileToCoord: 뱀 배치', () => {
  assert.deepEqual(tileToCoord(1, 6), { row: 0, col: 0 })
  assert.deepEqual(tileToCoord(6, 6), { row: 0, col: 5 })
  assert.deepEqual(tileToCoord(7, 6), { row: 1, col: 5 }) // 다음 줄은 역방향
  assert.deepEqual(tileToCoord(12, 6), { row: 1, col: 0 })
})

test('열쇠카드 칸에 멈추면 keyCard=true', () => {
  const m = computeMove(1, 4, config) // 1 -> 5 (열쇠칸)
  assert.equal(m.landing, 5)
  assert.equal(m.platform, null)
  assert.equal(m.keyCard, true)
})

test('발판 칸은 열쇠카드가 아니다', () => {
  const m = computeMove(1, 2, config) // 1 -> 3 -> 9 (발판)
  assert.equal(m.keyCard, false)
})

test('규칙: 모든 보드의 발판은 줄간 1칸 이동만 한다', () => {
  for (const b of BOARDS) {
    assert.deepEqual(validateBoard(b.config), [], `${b.label} 발판 규칙 위반`)
  }
})

test('규칙: 발판 화살표가 서로 교차하지 않는다', () => {
  for (const b of BOARDS) {
    assert.deepEqual(validateNoCrossings(b.config), [], `${b.label} 화살표 교차`)
  }
})

test('반전: 골 바로 앞에 아랫줄로 내려가는 발판이 있다', () => {
  for (const b of BOARDS) {
    const c = b.config
    const goalRow = tileRow(c.tileCount, c.cols)
    // 마지막 줄에서 시작해 아랫줄로 내려가는 발판이 존재해야 함
    const hasPreGoalDown = Object.entries(c.platforms).some(
      ([from, to]) => tileRow(Number(from), c.cols) === goalRow && to < Number(from)
    )
    assert.equal(hasPreGoalDown, true, `${b.label} 골 앞 반전 발판 없음`)
  }
})

test('규칙: 열쇠칸은 발판/출발/골 칸과 겹치지 않는다', () => {
  for (const b of BOARDS) {
    const c = b.config
    const used = new Set([1, c.tileCount])
    for (const [from, to] of Object.entries(c.platforms)) {
      used.add(Number(from))
      used.add(to)
    }
    for (const k of c.keyTiles) {
      assert.equal(used.has(k), false, `${b.label} 열쇠칸 ${k} 겹침`)
    }
  }
})

function game4() {
  const players = [
    { id: 'a', zodiacId: 'rat', name: 'A', position: 5 },
    { id: 'b', zodiacId: 'ox', name: 'B', position: 12 },
    { id: 'c', zodiacId: 'tiger', name: 'C', position: 20 },
    { id: 'd', zodiacId: 'rabbit', name: 'D', position: 8 },
  ]
  return { config, players, currentIndex: 3, status: 'playing', winnerId: null, lastRoll: null }
}

test('카드 swap: 선두와 꼴찌 자리 교환', () => {
  const { next } = resolveKeyCard(game4(), 'swap')
  assert.equal(next.players[0].position, 20) // 꼴찌 A(5) → 선두 자리(20)
  assert.equal(next.players[2].position, 5) // 선두 C(20) → 꼴찌 자리(5)
})

test('카드 back2: 두 칸 뒤로(최소 1칸)', () => {
  const { next } = resolveKeyCard(game4(), 'back2') // 현재 D(8) -> 6
  assert.equal(next.players[3].position, 6)
})

test('카드 forward5: 다섯 칸 앞으로', () => {
  const { next } = resolveKeyCard(game4(), 'forward5') // D(8) -> 13
  assert.equal(next.players[3].position, 13)
})

test('카드 forward5: 골 도달 시 승리', () => {
  const g = game4()
  g.players[3].position = 28
  const { next } = resolveKeyCard(g, 'forward5') // 28+5=33 -> 30 골인
  assert.equal(next.status, 'finished')
  assert.equal(next.winnerId, 'd')
})

test('카드 again: 같은 사람이 한 번 더(턴 유지)', () => {
  const { next, rollAgain } = resolveKeyCard(game4(), 'again')
  assert.equal(rollAgain, true)
  assert.equal(next.currentIndex, 3)
})

test('카드 chase: 바로 앞사람 따라잡기', () => {
  const { next } = resolveKeyCard(game4(), 'chase') // D(8) 앞사람 = B(12)
  assert.equal(next.players[3].position, 12)
})

test('카드 chase: 1등이면 효과 없음', () => {
  const g = game4()
  g.currentIndex = 2 // C(20) = 선두
  const { next } = resolveKeyCard(g, 'chase')
  assert.equal(next.players[2].position, 20)
})

test('카드 적용 후 턴이 넘어간다(again 제외)', () => {
  const { next } = resolveKeyCard(game4(), 'back2')
  assert.equal(next.currentIndex, 0) // 3 -> (3+1)%4 = 0
})

test('카드 가중치: swap은 가장 드물고, 경계값이 맞다', () => {
  const total = KEY_CARDS.reduce((s, c) => s + c.weight, 0) // 14
  assert.equal(randomCardId(() => 0), 'swap') // [0,1) -> swap
  assert.equal(randomCardId(() => 0.5 / total), 'swap')
  assert.equal(randomCardId(() => 1.5 / total), 'back2') // [1,4)
  assert.equal(randomCardId(() => 5 / total), 'forward5') // [4,8)
  assert.equal(randomCardId(() => 9 / total), 'again') // [8,11)
  assert.equal(randomCardId(() => 12 / total), 'chase') // [11,14)
  // swap 가중치가 가장 작아야 함
  const swap = KEY_CARDS.find((c) => c.id === 'swap')
  assert.equal(Math.min(...KEY_CARDS.map((c) => c.weight)), swap.weight)
})
