import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createDeck, createGame, applyPair, winners, shuffle } from './engine.js'
import { DIFFICULTIES } from './board.config.js'

// 결정적 rng: 0,0,0... → 셔플은 고정 순열, 카운트/구조 검증에 충분
const zeroRng = () => 0

const players = [
  { id: 'p1', name: '1P', color: '#e05b5b' },
  { id: 'p2', name: '2P', color: '#5b8ce0' },
]

test('shuffle: 길이/원소 보존', () => {
  const a = [1, 2, 3, 4, 5]
  const s = shuffle(a, zeroRng)
  assert.equal(s.length, 5)
  assert.deepEqual([...s].sort(), a)
})

test('createDeck: pairs*2장, 각 동물 정확히 2장', () => {
  const deck = createDeck(6, zeroRng)
  assert.equal(deck.length, 12)
  const counts = {}
  deck.forEach((c) => (counts[c.animalId] = (counts[c.animalId] || 0) + 1))
  assert.equal(Object.keys(counts).length, 6)
  assert.ok(Object.values(counts).every((n) => n === 2))
  // 카드 id는 모두 고유
  assert.equal(new Set(deck.map((c) => c.id)).size, 12)
})

test('모든 난이도: 동물 12종 이내, 짝수 카드', () => {
  for (const d of DIFFICULTIES) {
    assert.ok(d.pairs <= 12, `${d.label} 동물 부족`)
    assert.equal(d.cols * d.rows, d.pairs * 2, `${d.label} 그리드 칸 수 불일치`)
  }
})

function gameWithPair() {
  // 같은 동물 두 장을 알기 위해 덱을 직접 구성
  const g = createGame(players, DIFFICULTIES[0], zeroRng)
  const first = g.cards[0]
  const partner = g.cards.find((c) => c.id !== first.id && c.animalId === first.animalId)
  const other = g.cards.find((c) => c.animalId !== first.animalId)
  return { g, first, partner, other }
}

test('applyPair: 짝 맞으면 점수+1, 같은 사람 유지', () => {
  const { g, first, partner } = gameWithPair()
  const { next, match, won } = applyPair(g, first.id, partner.id)
  assert.equal(match, true)
  assert.equal(won, false)
  assert.equal(next.players[0].score, 1)
  assert.equal(next.currentIndex, 0) // 한 번 더
  assert.deepEqual(next.matched.sort(), [first.id, partner.id].sort())
})

test('applyPair: 틀리면 점수 그대로, 다음 사람', () => {
  const { g, first, other } = gameWithPair()
  const { next, match } = applyPair(g, first.id, other.id)
  assert.equal(match, false)
  assert.equal(next.players[0].score, 0)
  assert.equal(next.currentIndex, 1)
  assert.deepEqual(next.matched, [])
})

test('applyPair: 마지막 짝까지 맞추면 finished', () => {
  // 솔로 플레이로 모든 짝을 순서대로 맞춘다
  let g = createGame([players[0]], DIFFICULTIES[0], zeroRng)
  // 동물별 카드 2장씩 모음
  const groups = {}
  g.cards.forEach((c) => (groups[c.animalId] = groups[c.animalId] || []).push(c))
  let result
  for (const animalId of Object.keys(groups)) {
    const [c1, c2] = groups[animalId]
    result = applyPair(g, c1.id, c2.id)
    g = result.next
  }
  assert.equal(g.status, 'finished')
  assert.equal(result.won, true)
  assert.equal(g.players[0].score, DIFFICULTIES[0].pairs)
})

test('winners: 최고 점수(동점 포함)', () => {
  const state = {
    players: [
      { id: 'a', score: 3 },
      { id: 'b', score: 5 },
      { id: 'c', score: 5 },
    ],
  }
  const w = winners(state)
  assert.deepEqual(w.map((p) => p.id), ['b', 'c'])
})
