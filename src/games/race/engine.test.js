import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGame, tapRun, ranking, winner, progress, TAPS_TO_WIN } from './engine.js'

const players = [
  { id: 'a', name: 'A' },
  { id: 'b', name: 'B' },
  { id: 'c', name: 'C' },
]

test('탭하면 진행, 결승선에서 골인 + 종료', () => {
  let g = createGame(players)
  for (let i = 0; i < TAPS_TO_WIN - 1; i++) g = tapRun(g, 'a')
  assert.equal(g.status, 'playing')
  assert.equal(g.players[0].taps, TAPS_TO_WIN - 1)
  g = tapRun(g, 'a') // 골인
  assert.equal(g.status, 'finished')
  assert.deepEqual(g.finishOrder, ['a'])
  assert.equal(winner(g).id, 'a')
})

test('종료 후엔 더 진행 안 함', () => {
  let g = createGame(players)
  for (let i = 0; i < TAPS_TO_WIN; i++) g = tapRun(g, 'a')
  const before = g.players[1].taps
  g = tapRun(g, 'b')
  assert.equal(g.players[1].taps, before) // finished → 무시
})

test('진행률', () => {
  let g = createGame(players)
  g = tapRun(g, 'b')
  assert.ok(Math.abs(progress(g.players[1]) - 1 / TAPS_TO_WIN) < 1e-9)
})

test('순위: 골인자 우선, 나머지는 탭 많은 순', () => {
  let g = createGame(players)
  // b를 10, c를 5 탭
  for (let i = 0; i < 10; i++) g = tapRun(g, 'b')
  for (let i = 0; i < 5; i++) g = tapRun(g, 'c')
  // a 골인
  for (let i = 0; i < TAPS_TO_WIN; i++) g = tapRun(g, 'a')
  const order = ranking(g).map((p) => p.id)
  assert.deepEqual(order, ['a', 'b', 'c'])
})
