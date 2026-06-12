import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createGame, setInput, castAttack, castSkill, castUlt, step, makeView, makeBot,
  towerVulnerable, nexusVulnerable,
  STEP, COUNTDOWN_TIME, TIME_LIMIT, ULT_LEVEL, TEAM_SIZE, MAX_LEVEL,
} from './engine.js'
import { NEXUS_POS, LANES, nearestWp, resolveTerrain, WORLD } from './map.js'

// 3:3 사람 풀파티 (봇 AI가 끼어들지 않아 결정적 테스트가 쉽다)
function humans() {
  const z = ['rat', 'ox', 'tiger', 'rabbit', 'dragon', 'snake']
  return z.map((id, i) => ({
    id, name: id.toUpperCase(), zodiacId: id, color: '#abc',
    team: i < 3 ? 'blue' : 'red',
  }))
}

function startPlaying(g) {
  while (g.status === 'countdown') step(g, STEP)
}

function run(g, seconds) {
  const n = Math.round(seconds / STEP)
  for (let i = 0; i < n; i++) step(g, STEP)
}

// 적 미니언을 시험용으로 슬쩍 배치
function plantMinion(g, team, x, z, hp = 50) {
  const m = {
    id: g.nextId++, team, lane: 'top', ranged: false,
    x, z, hp, maxHp: hp, atkCd: 0, wpI: team === 'blue' ? 1 : LANES.top.length - 2,
  }
  g.minions.push(m)
  return m
}

test('createGame: 3:3 구성, 자기 우물에서 시작, 카운트다운', () => {
  const g = createGame(humans())
  assert.equal(g.status, 'countdown')
  assert.equal(g.heroes.length, TEAM_SIZE * 2)
  for (const h of g.heroes) {
    const nx = NEXUS_POS[h.team]
    assert.ok(Math.hypot(h.x - nx.x, h.z - nx.z) < 15) // 우물 근처
    assert.equal(h.lvl, 1)
    assert.ok(h.hp > 0)
  }
  assert.equal(g.towers.length, 8)
  assert.ok(g.towers.every((t) => t.alive))
})

test('카운트다운이 끝나면 playing', () => {
  const g = createGame(humans())
  startPlaying(g)
  assert.equal(g.status, 'playing')
  assert.ok(g.time >= COUNTDOWN_TIME)
})

test('미니언 웨이브: 레인마다 양 팀 3마리씩 생성되고 적진으로 행군', () => {
  const g = createGame(humans())
  startPlaying(g)
  run(g, 3) // 첫 웨이브(시작 2초 후) 이후
  assert.equal(g.minions.length, 12) // 2팀 × 2레인 × 3
  const blueTop = g.minions.find((m) => m.team === 'blue' && m.lane === 'top')
  const x0 = blueTop.x
  run(g, 5)
  assert.ok(blueTop.x > x0 + 5) // 오른쪽(빨강 진영)으로 전진
})

test('기본공격: 사거리 안 미니언을 잡으면 경험치를 얻는다', () => {
  const g = createGame(humans())
  startPlaying(g)
  const h = g.heroes[0] // blue
  h.x = 0
  h.z = 0
  const m = plantMinion(g, 'red', 5, 0, 40)
  castAttack(g, h.id)
  assert.equal(g.projectiles.length, 1)
  assert.ok(h.atkCd > 0)
  run(g, 1)
  assert.ok(!g.minions.includes(m)) // 처치됨
  assert.ok(h.xp > 0)
})

test('스킬: 쿨다운 동안 다시 못 쓴다', () => {
  const g = createGame(humans())
  startPlaying(g)
  const h = g.heroes[0]
  castSkill(g, h.id)
  assert.equal(g.projectiles.filter((p) => p.kind === 'skill').length, 1)
  castSkill(g, h.id)
  assert.equal(g.projectiles.filter((p) => p.kind === 'skill').length, 1) // 무시됨
  assert.ok(h.skillCd > 4)
})

test(`궁극기: 레벨 ${ULT_LEVEL} 전엔 잠겨 있고, 열리면 주변 적을 스턴`, () => {
  const g = createGame(humans())
  startPlaying(g)
  const a = g.heroes[0] // blue
  const b = g.heroes[3] // red
  a.x = 0
  a.z = 0
  b.x = 5
  b.z = 0
  castUlt(g, a.id)
  assert.equal(g.novas.length, 0) // 아직 잠김
  a.lvl = ULT_LEVEL
  castUlt(g, a.id)
  assert.equal(g.novas.length, 1)
  assert.ok(b.hp < b.maxHp)
  assert.ok(b.stunT > 0)
  assert.ok(a.ultCd > 0)
})

test('영웅 처치: 킬/데스 집계 + 피드 + 부활 후 우물에서 풀피', () => {
  const g = createGame(humans())
  startPlaying(g)
  const a = g.heroes[0] // blue
  const b = g.heroes[3] // red
  a.x = 0
  a.z = 0
  b.x = 5
  b.z = 0
  b.hp = 1
  castAttack(g, a.id)
  run(g, 1)
  assert.equal(a.kills, 1)
  assert.equal(b.deaths, 1)
  assert.equal(g.kills.blue, 1)
  assert.ok(b.respawnT > 0)
  assert.ok(g.feed.some((f) => f.t === 'kill'))
  run(g, b.respawnT + 0.5)
  assert.equal(b.respawnT, 0)
  assert.equal(b.hp, b.maxHp)
  assert.ok(Math.hypot(b.x - NEXUS_POS.red.x, b.z - NEXUS_POS.red.z) < 15)
})

test('타워 공격 순서: 외곽이 살아 있으면 내곽 무적, 내곽이 부서져야 넥서스 공격 가능', () => {
  const g = createGame(humans())
  const outer = g.towers.find((t) => t.id === 'r-top-1')
  const inner = g.towers.find((t) => t.id === 'r-top-2')
  assert.equal(towerVulnerable(g, outer), true)
  assert.equal(towerVulnerable(g, inner), false)
  assert.equal(nexusVulnerable(g, 'red'), false)
  outer.alive = false
  assert.equal(towerVulnerable(g, inner), true)
  inner.alive = false
  assert.equal(nexusVulnerable(g, 'red'), true)
})

test('타워는 사거리 안 적을 (미니언 우선으로) 쏜다', () => {
  const g = createGame(humans())
  startPlaying(g)
  const t = g.towers.find((o) => o.id === 'r-top-1')
  const h = g.heroes[0] // blue
  h.x = t.x - 8
  h.z = t.z
  const m = plantMinion(g, 'blue', t.x - 6, t.z, 80)
  run(g, 1.5)
  assert.ok(m.hp < 80 || !g.minions.includes(m)) // 미니언이 먼저 맞는다
  assert.equal(h.hp, h.maxHp) // 영웅은 아직 무사
  g.minions.length = 0
  run(g, 2)
  assert.ok(h.hp < h.maxHp) // 미니언이 없으면 영웅을 쏜다
})

test('넥서스가 터지면 게임 종료 + 승리 팀 확정', () => {
  const g = createGame(humans())
  startPlaying(g)
  for (const t of g.towers) if (t.team === 'red') t.alive = false
  g.nexus.red.hp = 10
  // 빨강 영웅들이 자동 조준에 먼저 잡히지 않게 우물 밖으로 치워둔다
  for (const o of g.heroes) {
    if (o.team === 'red') {
      o.x = 0
      o.z = 50
    }
  }
  const h = g.heroes[0]
  h.x = NEXUS_POS.red.x - 7
  h.z = NEXUS_POS.red.z
  castAttack(g, h.id)
  run(g, 1)
  assert.equal(g.status, 'finished')
  assert.equal(g.winner, 'blue')
})

test('적 우물은 따끔: 들어가면 체력이 깎인다', () => {
  const g = createGame(humans())
  startPlaying(g)
  const h = g.heroes[0] // blue
  h.x = NEXUS_POS.red.x - 8
  h.z = NEXUS_POS.red.z + 6
  run(g, 2)
  assert.ok(h.hp < h.maxHp)
})

test('용을 잡으면 팀 전체가 버프 + 리스폰 대기', () => {
  const g = createGame(humans())
  startPlaying(g)
  const d = g.monsters.find((m) => m.kind === 'dragon')
  d.alive = true
  d.hp = 1
  const h = g.heroes[0] // blue
  h.x = d.x - 6
  h.z = d.z
  castAttack(g, h.id)
  run(g, 1)
  assert.equal(d.alive, false)
  assert.ok(d.respawnT > 0)
  for (const o of g.heroes) {
    if (o.team === 'blue') assert.ok(o.dragonT > 0)
    else assert.equal(o.dragonT, 0)
  }
})

test('정글몹: 맞으면 반격하고, 캠프를 벗어나면 복귀하며 회복', () => {
  const g = createGame(humans())
  startPlaying(g)
  const w = g.monsters.find((m) => m.kind === 'wolf')
  const h = g.heroes[0]
  h.x = w.x - 6
  h.z = w.z
  castAttack(g, h.id)
  run(g, 1.5)
  assert.equal(w.aggro, h.id)
  assert.ok(h.hp < h.maxHp || w.hp < w.maxHp)
  // 멀리 도망 → 늑대는 포기하고 집으로
  h.x = -90
  h.z = 0
  const hurt = w.hp
  run(g, 4)
  assert.equal(w.aggro, null)
  assert.ok(w.hp >= hurt)
})

test('시간 초과: 부순 타워 → 킬 순서로 승부 판정', () => {
  const g = createGame(humans())
  startPlaying(g)
  g.kills.red = 3
  g.time = COUNTDOWN_TIME + TIME_LIMIT
  step(g, STEP)
  assert.equal(g.status, 'finished')
  assert.equal(g.winner, 'red')
})

test('setInput으로 이동: 입력 방향으로 움직인다', () => {
  const g = createGame(humans())
  startPlaying(g)
  const h = g.heroes[0]
  const x0 = h.x
  setInput(g, h.id, { mx: 1, mz: 0 })
  run(g, 1)
  assert.ok(h.x > x0 + 5)
})

test('makeBot: 이탈한 참가자를 봇이 이어받고 빈 역할을 맡는다', () => {
  const g = createGame(humans())
  const h = makeBot(g, 'rat')
  assert.ok(h.isBot)
  assert.ok(['top', 'bot', 'jungle'].includes(h.role))
  assert.equal(makeBot(g, 'rat'), null) // 이미 봇
})

test('makeView: JSON 직렬화 가능한 완전한 스냅샷', () => {
  const g = createGame(humans())
  startPlaying(g)
  run(g, 5)
  const v = makeView(g)
  const back = JSON.parse(JSON.stringify(v))
  assert.equal(back.heroes.length, 6)
  assert.equal(back.towers.length, 8)
  assert.ok(back.nexus.blue.hp > 0)
  assert.ok(Array.isArray(back.minions))
  assert.ok(back.timeLeft <= TIME_LIMIT)
})

test('레벨은 최대 10: 경험치를 쏟아부어도 그 위로 안 오른다', () => {
  const g = createGame(humans())
  startPlaying(g)
  const h = g.heroes[0]
  const d = g.monsters.find((m) => m.kind === 'dragon')
  // 직접 경험치 주입 대신 미니언 떼 처치로 (공개 API만 사용)
  for (let i = 0; i < 200 && h.lvl < MAX_LEVEL; i++) {
    const m = plantMinion(g, 'red', h.x + 5, h.z, 1)
    castAttack(g, h.id)
    run(g, 1)
    g.minions.length = 0
    h.atkCd = 0
  }
  assert.equal(h.lvl, MAX_LEVEL)
  assert.ok(h.maxHp > 1000)
  void d
})

test('지형: 바위/맵 경계를 뚫고 나갈 수 없다', () => {
  const p = { x: -12, z: 0 } // 가운데 바위 한복판
  resolveTerrain(p, 1.3, [])
  assert.ok(Math.hypot(p.x - -12, p.z - 0) >= 3.4) // 밀려남
  const q = { x: 9999, z: -9999 }
  resolveTerrain(q, 1.3, [])
  assert.ok(q.x <= WORLD.maxX && q.z >= WORLD.minZ)
  assert.equal(nearestWp('top', -96, 0), 0)
})

test('풀봇 3:3 스모크 테스트: 3분 시뮬레이션이 멀쩡히 돈다', () => {
  const players = humans().map((p) => ({ ...p, isBot: true }))
  let seed = 42
  const rng = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 4294967296
  }
  const g = createGame(players, rng)
  startPlaying(g)
  run(g, 180)
  for (const h of g.heroes) {
    assert.ok(Number.isFinite(h.x) && Number.isFinite(h.z), '위치가 NaN이면 안 된다')
    assert.ok(h.hp >= 0 && h.hp <= h.maxHp + 1)
    assert.ok(h.lvl >= 1 && h.lvl <= MAX_LEVEL)
  }
  assert.ok(g.minions.length < 200, '미니언이 무한히 쌓이면 안 된다')
  const v = makeView(g)
  JSON.stringify(v)
  assert.ok(['playing', 'finished'].includes(g.status))
})
