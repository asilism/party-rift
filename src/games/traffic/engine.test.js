import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGame, roundWinner, applyRound, winners } from './engine.js'

test('roundWinner: 부정출발 제외, 가장 빠른 사람', () => {
  const w = roundWinner([
    { id: 'a', ms: 320, falseStart: false },
    { id: 'b', ms: 210, falseStart: false },
    { id: 'c', ms: 100, falseStart: true }, // 부정출발 → 제외
    { id: 'd', ms: null, falseStart: false }, // 안 누름
  ])
  assert.equal(w, 'b')
})

test('roundWinner: 전원 무효면 null', () => {
  assert.equal(roundWinner([{ id: 'a', ms: null, falseStart: true }]), null)
})

test('applyRound: 승자 +1, 라운드 진행/종료', () => {
  let g = createGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], 2)
  g = applyRound(g, 'a')
  assert.equal(g.players[0].score, 1)
  assert.equal(g.round, 2)
  assert.equal(g.status, 'playing')
  g = applyRound(g, 'b')
  assert.equal(g.status, 'finished')
  assert.deepEqual(winners(g).map((p) => p.id).sort(), ['a', 'b'])
})

test('applyRound: 승자 없음(null)도 진행', () => {
  let g = createGame([{ id: 'a', name: 'A' }], 2)
  g = applyRound(g, null)
  assert.equal(g.round, 2)
  assert.equal(g.players[0].score, 0)
})
