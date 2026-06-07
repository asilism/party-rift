import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateDobble, createGame, tapSymbol, winners, shuffle } from './engine.js'

const zeroRng = () => 0

const players = [
  { id: 'p1', name: '1P', zodiacId: 'rat' },
  { id: 'p2', name: '2P', zodiacId: 'ox' },
  { id: 'p3', name: '3P', zodiacId: 'tiger' },
]

test('generateDobble: 카드/문양 수와 카드당 문양 수', () => {
  for (const n of [2, 3, 5, 7]) {
    const deck = generateDobble(n)
    assert.equal(deck.length, n * n + n + 1, `n=${n} 카드 수`)
    deck.forEach((card) => assert.equal(card.length, n + 1, `n=${n} 카드당 문양`))
    // 사용된 문양 인덱스 종류 = n²+n+1
    const set = new Set(deck.flat())
    assert.equal(set.size, n * n + n + 1, `n=${n} 문양 종류`)
  }
})

test('도블 성질: 어떤 두 카드든 공통 문양이 정확히 1개', () => {
  for (const n of [2, 3, 5, 7]) {
    const deck = generateDobble(n)
    for (let i = 0; i < deck.length; i++) {
      for (let j = i + 1; j < deck.length; j++) {
        const a = new Set(deck[i])
        const common = deck[j].filter((s) => a.has(s))
        assert.equal(common.length, 1, `n=${n} 카드 ${i},${j} 공통=${common.length}`)
      }
    }
  }
})

test('createGame: 각자 카드 1장, 중앙 카드 준비', () => {
  const g = createGame(players, 5, zeroRng)
  assert.equal(g.players.length, 3)
  g.players.forEach((p) => assert.equal(p.card.length, 6)) // n+1
  assert.equal(g.center.length, 6)
  assert.equal(g.centerQueue.length, 31 - 3) // 전체 - 개인카드
  assert.equal(g.symbols.length, 31)
  assert.equal(g.status, 'playing')
})

// 현재 중앙 카드와 특정 플레이어의 공통 문양 찾기
function commonSym(g, pIdx) {
  const center = new Set(g.center)
  return g.players[pIdx].card.find((s) => center.has(s))
}
function wrongSym(g, pIdx) {
  const center = new Set(g.center)
  return g.players[pIdx].card.find((s) => !center.has(s))
}

test('정답 탭: 점수+1, 다음 중앙 카드로, 잠금 해제', () => {
  const g = createGame(players, 5, zeroRng)
  const sym = commonSym(g, 0)
  const { state, result, advanced } = tapSymbol(g, 'p1', sym)
  assert.equal(result, 'correct')
  assert.equal(advanced, true)
  assert.equal(state.players[0].score, 1)
  assert.equal(state.centerPos, 1)
  assert.notDeepEqual(state.center, g.center)
  assert.deepEqual(state.locked, [])
})

test('정답 시 중앙 카드가 내 새 카드(top)가 된다', () => {
  const g = createGame(players, 5, zeroRng)
  const prevCenter = g.center
  const sym = commonSym(g, 0)
  const { state } = tapSymbol(g, 'p1', sym)
  assert.deepEqual(state.players[0].card, prevCenter) // 가져온 카드가 내 카드로
  assert.notDeepEqual(state.center, prevCenter) // 중앙은 새 카드
  // 새 카드와 새 중앙도 여전히 공통 문양 1개
  const common = state.players[0].card.filter((s) => state.center.includes(s))
  assert.equal(common.length, 1)
})

test('오답 탭: 점수 그대로, 해당 플레이어 잠금(패널티)', () => {
  const g = createGame(players, 5, zeroRng)
  const bad = wrongSym(g, 0)
  const { state, result } = tapSymbol(g, 'p1', bad)
  assert.equal(result, 'wrong')
  assert.equal(state.players[0].score, 0)
  assert.deepEqual(state.locked, ['p1'])
  assert.equal(state.centerPos, 0) // 라운드 유지
})

test('잠긴 플레이어는 더 못 누른다', () => {
  const g = createGame(players, 5, zeroRng)
  const s1 = tapSymbol(g, 'p1', wrongSym(g, 0)).state
  // 이제 p1은 정답을 눌러도 무시됨
  const sym = commonSym(s1, 0)
  const { result } = tapSymbol(s1, 'p1', sym)
  assert.equal(result, 'locked')
})

test('전원 오답이면 라운드 스킵(다음 카드)', () => {
  let g = createGame(players, 5, zeroRng)
  const startPos = g.centerPos
  g = tapSymbol(g, 'p1', wrongSym(g, 0)).state
  g = tapSymbol(g, 'p2', wrongSym(g, 1)).state
  const r = tapSymbol(g, 'p3', wrongSym(g, 2))
  assert.equal(r.skipped, true)
  assert.equal(r.state.centerPos, startPos + 1)
  assert.deepEqual(r.state.locked, [])
})

test('덱 소진 시 finished + winners', () => {
  let g = createGame(players, 3, zeroRng) // n=3 → 카드 13, 중앙 10장
  let guard = 0
  while (g.status === 'playing' && guard++ < 100) {
    const sym = commonSym(g, 0) // 항상 p1이 정답
    g = tapSymbol(g, 'p1', sym).state
  }
  assert.equal(g.status, 'finished')
  assert.equal(g.players[0].score, 13 - 3) // 중앙 카드 수만큼 득점
  assert.deepEqual(winners(g).map((p) => p.id), ['p1'])
})

test('shuffle 보존', () => {
  const a = [1, 2, 3, 4, 5]
  assert.deepEqual([...shuffle(a, zeroRng)].sort(), a)
})
