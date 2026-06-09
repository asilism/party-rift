import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGame, whack, winners } from './engine.js'

const players = [
  { id: 'a', name: 'A' },
  { id: 'b', name: 'B' },
]

test('whack: 점수 +1', () => {
  let g = createGame(players)
  g = whack(g, 'a')
  g = whack(g, 'a')
  g = whack(g, 'b')
  assert.equal(g.players[0].score, 2)
  assert.equal(g.players[1].score, 1)
})

test('winners: 최고 점수(동점 포함)', () => {
  const state = { players: [{ id: 'a', score: 3 }, { id: 'b', score: 3 }, { id: 'c', score: 1 }] }
  assert.deepEqual(winners(state).map((p) => p.id), ['a', 'b'])
})
