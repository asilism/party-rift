import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeMove, applyMove, createGame, tileToCoord } from './engine.js'

const config = {
  tileCount: 30,
  cols: 6,
  rows: 5,
  diceCount: 1,
  diceSides: 6,
  overshoot: true,
  platforms: { 3: 9, 16: 13 },
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
