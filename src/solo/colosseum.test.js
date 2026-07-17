import test from 'node:test'
import assert from 'node:assert/strict'
import { createTournament, nextRound, resolveRound, userPlacement, arenaDeduction, ARENA_START_PTS } from './colosseum.js'

const lcg = (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)

test('콜로세움: 12인 6팀, 지신·직업 중복 없음', () => {
  const tour = createTournament('tiger', 'warrior', lcg(1))
  assert.equal(tour.teams.length, 6)
  const zs = tour.teams.flatMap((tm) => tm.members.map((m) => m.zodiacId))
  const cs = tour.teams.flatMap((tm) => tm.members.map((m) => m.cls))
  assert.equal(zs.length, 12)
  assert.equal(new Set(zs).size, 12, '지신 중복 없음')
  assert.equal(new Set(cs).size, 12, '직업 중복 없음')
  assert.ok(tour.teams[0].isUser && tour.teams[0].members[0].id === 'solo')
})

test('콜로세움: 차감은 3,5,7… 포인트 0이면 탈락', () => {
  assert.equal(arenaDeduction(1), 3)
  assert.equal(arenaDeduction(2), 5)
  assert.equal(arenaDeduction(3), 7)
  const tour = createTournament('tiger', 'warrior', lcg(2))
  const rng = lcg(3)
  // 유저가 계속 지면: 10-3=7 → 7-5=2 → 2-7=0(탈락, 3라운드째)
  for (let r = 1; r <= 3; r++) {
    nextRound(tour, rng)
    if (!tour.current.myPair) { resolveRound(tour, false, rng); r--; continue } // 부전이면 다음으로
    resolveRound(tour, false, rng)
  }
  const me = tour.teams.find((tm) => tm.isUser)
  assert.equal(me.alive, false, '3패면 반드시 탈락')
  assert.ok(userPlacement(tour) >= 2 && userPlacement(tour) <= 6)
})

test('콜로세움: 끝까지 진행하면 챔피언이 나온다 + 결승은 데스매치', () => {
  for (let seed = 10; seed < 20; seed++) {
    const rng = lcg(seed)
    const tour = createTournament('rat', 'mage', rng)
    let guard = 0
    while (!tour.over && guard++ < 30) {
      const cur = nextRound(tour, rng)
      // 결승(2팀)이면 데스매치 — 패자는 포인트와 무관하게 탈락해야 한다
      const userWon = rng() < 0.5
      const res = resolveRound(tour, userWon, rng)
      if (cur.isFinal) assert.ok(res.over, '결승 후엔 반드시 종료')
    }
    assert.ok(tour.over && tour.champion, `seed ${seed}: 챔피언 미결정`)
    assert.ok(tour.round <= 12, `seed ${seed}: ${tour.round}라운드 — 과도`)
  }
})

test('콜로세움: 부전은 최소 부전 팀에게, 포인트 변화 없음', () => {
  const rng = lcg(42)
  const tour = createTournament('ox', 'tank', rng)
  // 한 팀 강제 탈락 → 5팀(홀수)
  tour.teams[5].alive = false
  tour.teams[5].elimRound = 1
  tour.round = 1
  const cur = nextRound(tour, rng)
  assert.ok(cur.bye, '5팀이면 부전 존재')
  assert.equal(cur.bye.byes, 1)
  const ptsBefore = cur.bye.pts
  resolveRound(tour, true, rng)
  assert.equal(cur.bye.pts, ptsBefore, '부전 팀 포인트 불변')
})
