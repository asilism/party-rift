import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  scoreRound,
  createGame,
  applyRoundScores,
  winners,
  randomDuration,
} from './engine.js'

const TRAVEL = 600

test('늦거나 안 누르면 0점(펑)', () => {
  const entries = [
    { id: 'a', pressAt: 1000 }, // 들어감 1600 ≤ 2500 → 세이프
    { id: 'b', pressAt: 2000 }, // 2600 > 2500 → 펑
    { id: 'c', pressAt: null }, // 안 누름 → 펑
  ]
  const { points, rows } = scoreRound(entries, 2500, TRAVEL)
  assert.equal(points.a, 1) // 세이프 1명 → 1점
  assert.equal(points.b, 0)
  assert.equal(points.c, 0)
  assert.equal(rows.find((r) => r.id === 'b').busted, true)
})

test('가장 근접(오차 작음)한 사람이 최고점', () => {
  const entries = [
    { id: 'a', pressAt: 500 }, // 1100, error 1400 (가장 일찍)
    { id: 'b', pressAt: 1200 }, // 1800, error 700
    { id: 'c', pressAt: 1800 }, // 2400, error 100 (가장 근접)
  ]
  const { points } = scoreRound(entries, 2500, TRAVEL)
  assert.equal(points.a, 1) // 오차 제일 큼 → 1점
  assert.equal(points.b, 2)
  assert.equal(points.c, 3) // 가장 근접 → 최고점
})

test('정확히 deadline에 들어가면 세이프(오차 0)', () => {
  const entries = [{ id: 'a', pressAt: 2500 - TRAVEL }] // 정확히 2500
  const { points, rows } = scoreRound(entries, 2500, TRAVEL)
  assert.equal(rows[0].busted, false)
  assert.equal(rows[0].error, 0)
  assert.equal(points.a, 1)
})

test('전원 펑이면 모두 0점', () => {
  const entries = [
    { id: 'a', pressAt: 3000 },
    { id: 'b', pressAt: null },
  ]
  const { points } = scoreRound(entries, 2500, TRAVEL)
  assert.equal(points.a, 0)
  assert.equal(points.b, 0)
})

test('라운드 점수 누적 + 종료', () => {
  let g = createGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], 2)
  g = applyRoundScores(g, { a: 2, b: 1 })
  assert.equal(g.players[0].score, 2)
  assert.equal(g.round, 2)
  assert.equal(g.status, 'playing')
  g = applyRoundScores(g, { a: 0, b: 2 })
  assert.equal(g.status, 'finished')
  assert.equal(g.players[1].score, 3) // a=2, b=3
  assert.deepEqual(winners(g).map((p) => p.id), ['b'])
})

test('승자 계산', () => {
  const state = {
    players: [
      { id: 'a', score: 5 },
      { id: 'b', score: 8 },
      { id: 'c', score: 8 },
    ],
  }
  assert.deepEqual(winners(state).map((p) => p.id), ['b', 'c'])
})

test('randomDuration 범위', () => {
  for (const r of [0, 0.5, 0.999]) {
    const d = randomDuration(() => r)
    assert.ok(d >= 3200 && d <= 6000, `d=${d}`)
  }
})
