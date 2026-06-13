import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createGame, setInput, castAttack, castSkill, castUlt, step, makeView, makeBot,
  towerVulnerable, nexusVulnerable, isHeroVisible, isUnitVisible,
  STEP, COUNTDOWN_TIME, TIME_LIMIT, ULT_LEVEL, TEAM_SIZE, MAX_LEVEL, CLASS_IDS, CLASSES,
} from './engine.js'
import {
  NEXUS_POS, LANES, LANE_IDS, BUSHES, WALLS, TOWER_SPOTS, avoidDir,
  nearestWp, resolveTerrain, WORLD, bushIndexAt,
} from './map.js'

// 3:3 사람 풀파티 — 직업 6종이 모두 등장한다 (봇 AI가 안 끼어 결정적 테스트가 쉽다)
function humans() {
  const defs = [
    ['rat', 'mage', 'blue'], ['ox', 'archer', 'blue'], ['tiger', 'warrior', 'blue'],
    ['rabbit', 'healer', 'red'], ['dragon', 'assassin', 'red'], ['snake', 'tank', 'red'],
  ]
  return defs.map(([id, cls, team]) => ({
    id, name: id.toUpperCase(), zodiacId: id, color: '#abc', cls, team,
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

test('createGame: 3:3 구성, 직업 6종, 자기 우물에서 시작', () => {
  const g = createGame(humans())
  assert.equal(g.status, 'countdown')
  assert.equal(g.heroes.length, TEAM_SIZE * 2)
  for (const h of g.heroes) {
    const nx = NEXUS_POS[h.team]
    assert.ok(Math.hypot(h.x - nx.x, h.z - nx.z) < 15) // 우물 근처
    assert.equal(h.lvl, 1)
    assert.equal(h.hp, h.maxHp)
    assert.ok(CLASS_IDS.includes(h.cls))
  }
  assert.equal(g.towers.length, 12) // 3레인 × 외곽/내곽 × 2팀
})

test('직업 중복 보정: 한 팀에 같은 직업이 오면 남은 직업으로 바꿔준다', () => {
  const players = humans().map((p) => ({ ...p, cls: 'warrior' })) // 전부 전사 요청
  const g = createGame(players)
  for (const team of ['blue', 'red']) {
    const cls = g.heroes.filter((h) => h.team === team).map((h) => h.cls)
    assert.equal(new Set(cls).size, TEAM_SIZE) // 중복 없음
  }
})

test('3갈래 레인: 미드 포함 미니언 웨이브가 레인마다 생성되고 행군', () => {
  assert.deepEqual(LANE_IDS, ['top', 'mid', 'bot'])
  const g = createGame(humans())
  startPlaying(g)
  run(g, 3) // 첫 웨이브(시작 2초 후) 이후
  assert.equal(g.minions.length, 18) // 2팀 × 3레인 × 3
  const blueMid = g.minions.find((m) => m.team === 'blue' && m.lane === 'mid')
  const x0 = blueMid.x
  run(g, 5)
  assert.ok(blueMid.x > x0 + 5) // 오른쪽(빨강 진영)으로 전진
})

test('기본공격: 사거리 안 미니언을 잡으면 경험치를 얻는다', () => {
  const g = createGame(humans())
  startPlaying(g)
  const h = g.heroes[0] // blue mage
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

test('마법사 화염구: 폭발 투사체, 쿨다운 동안 다시 못 쓴다', () => {
  const g = createGame(humans())
  startPlaying(g)
  const h = g.heroes[0] // mage
  castSkill(g, h.id)
  assert.equal(g.projectiles.filter((p) => p.kind === 'fireball').length, 1)
  castSkill(g, h.id)
  assert.equal(g.projectiles.filter((p) => p.kind === 'fireball').length, 1) // 무시됨
  assert.ok(h.skillCd > 4)
})

test('궁수 연속사격: 화살 3발이 한꺼번에 날아간다', () => {
  const g = createGame(humans())
  startPlaying(g)
  const h = g.heroes[1] // archer
  h.x = 0
  h.z = 0
  plantMinion(g, 'red', 6, 0, 500)
  castSkill(g, h.id)
  assert.equal(g.projectiles.filter((p) => p.kind === 'bolt').length, 3)
})

test('전사 돌진: 적에게 파고들어 피해 + 짧은 기절', () => {
  const g = createGame(humans())
  startPlaying(g)
  const w = g.heroes[2] // warrior (blue)
  const e = g.heroes[3] // healer (red)
  w.x = 0
  w.z = 0
  e.x = 12
  e.z = 0
  castSkill(g, w.id)
  assert.ok(Math.hypot(w.x - e.x, w.z - e.z) < 4) // 바짝 붙음
  assert.ok(e.hp < e.maxHp)
  assert.ok(e.stunT > 0)
})

test('힐러 치유: 아픈 아군을 회복, 다 멀쩡하면 쿨다운을 안 쓴다', () => {
  const g = createGame(humans())
  startPlaying(g)
  const heal = g.heroes[3] // healer (red)
  const ally = g.heroes[4] // assassin (red)
  heal.x = 0
  heal.z = 0
  ally.x = 5
  ally.z = 0
  castSkill(g, heal.id) // 아무도 안 아픔 → 불발
  assert.equal(heal.skillCd, 0)
  ally.hp = 100
  castSkill(g, heal.id)
  assert.ok(ally.hp > 150)
  assert.ok(heal.skillCd > 0)
})

test('암살자 점멸습격: 적 등 뒤로 순간이동 + 일격', () => {
  const g = createGame(humans())
  startPlaying(g)
  const a = g.heroes[4] // assassin (red)
  const v = g.heroes[0] // mage (blue)
  a.x = 0
  a.z = 0
  v.x = 12
  v.z = 0
  castSkill(g, a.id)
  assert.ok(Math.hypot(a.x - v.x, a.z - v.z) < 3.5) // 붙었다
  assert.ok(v.hp < v.maxHp)
})

test('탱커 방패막기: 받는 피해가 크게 줄어든다', () => {
  const g = createGame(humans())
  startPlaying(g)
  const t = g.heroes[5] // tank (red)
  // 적 우물 피해로 비교 (같은 위치, 방패 ON/OFF)
  t.x = NEXUS_POS.blue.x + 8
  t.z = NEXUS_POS.blue.z + 6
  run(g, 1)
  const lossNoShield = t.maxHp - t.hp
  t.hp = t.maxHp
  castSkill(g, t.id)
  assert.ok(t.shieldT > 0)
  run(g, 1)
  const lossShield = t.maxHp - t.hp
  assert.ok(lossShield < lossNoShield * 0.55, `${lossShield} vs ${lossNoShield}`)
})

test(`궁극기: 레벨 ${ULT_LEVEL} 전엔 잠겨 있고, 마법사 번개폭풍은 광역 기절`, () => {
  const g = createGame(humans())
  startPlaying(g)
  const a = g.heroes[0] // blue mage
  const b = g.heroes[3] // red healer
  a.x = 0
  a.z = 0
  b.x = 5
  b.z = 0
  castUlt(g, a.id)
  assert.equal(g.fx.length, 0) // 아직 잠김
  a.lvl = ULT_LEVEL
  castUlt(g, a.id)
  assert.ok(g.fx.some((n) => n.kind === 'storm'))
  assert.ok(b.hp < b.maxHp)
  assert.ok(b.stunT > 0)
  assert.ok(a.ultCd > 0)
})

test('암살자 그림자처형: 빈사 적에게 2배 — 처치하면 점멸 초기화', () => {
  const g = createGame(humans())
  startPlaying(g)
  const a = g.heroes[4] // assassin (red)
  const v = g.heroes[0] // mage (blue)
  a.lvl = ULT_LEVEL
  a.x = 0
  a.z = 0
  v.x = 5
  v.z = 0
  v.hp = v.maxHp * 0.2 // 빈사
  a.skillCd = 5
  castUlt(g, a.id)
  assert.ok(v.respawnT > 0) // 처형!
  assert.equal(a.skillCd, 0) // 점멸 초기화
})

test('수풀 은신: 적에겐 안 보이고, 자동 조준에도 안 잡힌다 — 붙거나 공격하면 들킨다', () => {
  const g = createGame(humans())
  startPlaying(g)
  const hider = g.heroes[0] // blue mage
  const seeker = g.heroes[3] // red healer
  const bush = BUSHES[9] // (0, 16) — 강가 수풀
  hider.x = bush.x
  hider.z = bush.z
  step(g, STEP) // bushI 갱신
  assert.ok(hider.bushI >= 0)
  assert.equal(bushIndexAt(bush.x, bush.z), 9)
  // 적이 코앞 시야 거리(수풀 밖)에 있어도 안 보인다
  seeker.x = bush.x + 8
  seeker.z = bush.z
  step(g, STEP)
  assert.equal(isHeroVisible(g, hider, 'red'), false)
  assert.equal(isHeroVisible(g, hider, 'blue'), true) // 우리 팀은 보인다
  // 적의 자동 조준에도 안 잡힌다 (다른 대상이 없으면 불발)
  const before = g.projectiles.length
  castAttack(g, seeker.id)
  assert.equal(g.projectiles.length, before)
  // 바짝 붙으면 들킨다
  seeker.x = bush.x + 3
  step(g, STEP)
  assert.equal(isHeroVisible(g, hider, 'red'), true)
  // 멀어지면 다시 숨고, 숨은 채 공격하면 모습이 드러난다
  seeker.x = bush.x + 8
  step(g, STEP)
  assert.equal(isHeroVisible(g, hider, 'red'), false)
  castAttack(g, hider.id) // seeker가 사거리(10.5) 안
  assert.ok(hider.revealT > 0)
  assert.equal(isHeroVisible(g, hider, 'red'), true)
})

test('전장의 안개: 아군 유닛 시야 밖의 적은 안 보인다', () => {
  const g = createGame(humans())
  startPlaying(g) // 아직 미니언 없음
  const e = g.heroes[3] // red
  e.x = 0
  e.z = 50 // 파랑 유닛(우물/타워)에서 멀리
  step(g, STEP)
  assert.equal(isHeroVisible(g, e, 'blue'), false)
  assert.equal(isUnitVisible(g, e, 'blue'), false)
  // 파랑 영웅이 다가가면 보인다
  g.heroes[0].x = 0
  g.heroes[0].z = 35
  step(g, STEP)
  assert.equal(isHeroVisible(g, e, 'blue'), true)
})

test('영웅 처치: 킬/데스 집계 + 피드 + 부활 후 우물에서 풀피', () => {
  const g = createGame(humans())
  startPlaying(g)
  const a = g.heroes[0] // blue mage
  const b = g.heroes[3] // red healer
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
  const outer = g.towers.find((t) => t.id === 'r-mid-1')
  const inner = g.towers.find((t) => t.id === 'r-mid-2')
  assert.equal(towerVulnerable(g, outer), true)
  assert.equal(towerVulnerable(g, inner), false)
  assert.equal(nexusVulnerable(g, 'red'), false)
  outer.alive = false
  assert.equal(towerVulnerable(g, inner), true)
  inner.alive = false
  assert.equal(nexusVulnerable(g, 'red'), true)
})

test('타워는 미니언 우선 — 단, 우리 영웅을 때린 다이버를 응징한다', () => {
  const g = createGame(humans())
  startPlaying(g)
  const t = g.towers.find((o) => o.id === 'r-top-1')
  const h = g.heroes[0] // blue mage
  h.x = t.x - 8
  h.z = t.z
  const m = plantMinion(g, 'blue', t.x - 6, t.z, 80)
  run(g, 1.5)
  assert.ok(m.hp < 80 || !g.minions.includes(m)) // 미니언이 먼저 맞는다
  assert.equal(h.hp, h.maxHp) // 영웅은 아직 무사
  // 타워 사거리 안에서 적 영웅을 때리면 → 타워가 나를 노린다
  const victim = g.heroes[3] // red healer
  victim.x = t.x - 6
  victim.z = t.z + 2
  plantMinion(g, 'blue', t.x - 6, t.z, 9999) // 미니언 방패가 있어도
  castAttack(g, h.id) // 영웅 우선 자동 조준 → victim 타격
  run(g, 1.5)
  assert.ok(h.hp < h.maxHp, '다이브한 영웅이 타워에 맞아야 한다')
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

test('용을 잡으면 팀 전체가 버프 + 리스폰 대기', () => {
  const g = createGame(humans())
  startPlaying(g)
  const d = g.monsters.find((m) => m.kind === 'dragon')
  d.alive = true
  d.hp = 1
  const h = g.heroes[0] // blue mage
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

test('makeBot: 이탈한 참가자를 봇이 이어받고 빈 레인을 맡는다', () => {
  const g = createGame(humans())
  const h = makeBot(g, 'rat')
  assert.ok(h.isBot)
  assert.ok(LANE_IDS.includes(h.role))
  assert.equal(makeBot(g, 'rat'), null) // 이미 봇
})

test('makeView: JSON 직렬화 가능한 완전한 스냅샷 (직업/수풀 정보 포함)', () => {
  const g = createGame(humans())
  startPlaying(g)
  run(g, 5)
  const v = makeView(g)
  const back = JSON.parse(JSON.stringify(v))
  assert.equal(back.heroes.length, 6)
  assert.equal(back.towers.length, 12)
  assert.ok(back.nexus.blue.hp > 0)
  assert.ok(Array.isArray(back.minions))
  assert.ok(back.timeLeft <= TIME_LIMIT)
  for (const h of back.heroes) {
    assert.ok(CLASS_IDS.includes(h.cls))
    assert.ok('bushI' in h && 'revealT' in h && 'shieldT' in h)
  }
})

test('레벨은 최대 10: 경험치를 쏟아부어도 그 위로 안 오른다', () => {
  const g = createGame(humans())
  startPlaying(g)
  const h = g.heroes[0]
  for (let i = 0; i < 200 && h.lvl < MAX_LEVEL; i++) {
    const m = plantMinion(g, 'red', h.x + 5, h.z, 1)
    castAttack(g, h.id)
    run(g, 1)
    g.minions.length = 0
    h.atkCd = 0
  }
  assert.equal(h.lvl, MAX_LEVEL)
  assert.ok(h.maxHp > CLASSES[h.cls].hp + CLASSES[h.cls].hpLvl * 7)
})

test('성벽: 본진은 막혀 있고, 출입구 3곳은 모두 내곽 타워 사거리 안', () => {
  // 성벽 한가운데는 뚫고 들어갈 수 없다
  const p = { x: -82, z: -50 }
  resolveTerrain(p, 1.3, [])
  assert.ok(Math.hypot(p.x - -82, p.z - -50) >= 3, '성벽 안이면 밀려나야 한다')
  // 파랑 출입구(레인이 성벽을 지나는 곳) 3곳 모두 내곽 타워가 지킨다
  const TOWER_RANGE = 13
  for (const gap of [{ x: -82, z: -36 }, { x: -82, z: 0 }, { x: -82, z: 36 }]) {
    assert.equal(bushIndexAt(gap.x, gap.z), -1) // 출입구에 수풀은 없다
    const guard = TOWER_SPOTS.some(
      (t) => t.team === 'blue' && t.tier === 2 &&
        Math.hypot(t.x - gap.x, t.z - gap.z) <= TOWER_RANGE - 2
    )
    assert.ok(guard, `출입구 (${gap.x},${gap.z})는 내곽 타워 사거리 안이어야 한다`)
  }
  assert.ok(WALLS.length > 50) // 충돌 원들이 깔려 있다
})

test('avoidDir: 길을 막는 타워/성벽이 있으면 접선으로 비켜 간다', () => {
  // 정면에 타워가 있는 직선 경로 → 옆으로 꺾인 방향이 나온다
  const towers = [{ x: -34, z: -56, alive: true }]
  const e = { x: -44, z: -56 }
  const d = avoidDir(e, -24, -56, towers, 0.8)
  assert.ok(Math.abs(d.z) > 0.3, `옆으로 비켜야 한다 (got ${d.x},${d.z})`)
  // 막는 게 없으면 직진
  const d2 = avoidDir({ x: 0, z: 0 }, 10, 0, [], 0.8)
  assert.ok(d2.x > 0.99 && Math.abs(d2.z) < 0.01)
})

test('미니언이 자기 타워에 껴서 못 가는 문제 회귀: 돌아서 전진한다', () => {
  const g = createGame(humans())
  startPlaying(g)
  // 파랑 외곽 타워(-34,-56) 바로 뒤에서 적진 쪽으로 행군하는 미니언
  const m = plantMinion(g, 'blue', -46, -56, 500)
  m.wpI = 4 // (0,-58)을 향해 — 직선 경로가 타워에 막힌다
  run(g, 6)
  assert.ok(m.x > -28, `타워를 돌아서 지나가야 한다 (x=${m.x.toFixed(1)})`)
})

test('공격 모션 신호: 영웅 atkSeq 증가, 원거리 미니언은 화살 투사체를 쏜다', () => {
  const g = createGame(humans())
  startPlaying(g)
  const h = g.heroes[0]
  h.x = 0
  h.z = 0
  plantMinion(g, 'red', 5, 0, 9999)
  const seq0 = h.atkSeq
  castAttack(g, h.id)
  assert.equal(h.atkSeq, seq0 + 1)
  // 원거리 미니언: 사거리 안 적을 만나면 투사체를 쏜다
  const rm = plantMinion(g, 'blue', 12, 0, 9999)
  rm.ranged = true
  rm.dir = 0
  rm.atkSeq = 0
  run(g, 0.1) // 화살이 아직 날아가는 중
  assert.ok(rm.atkSeq > 0, '원거리 미니언이 공격해야 한다')
  assert.ok(g.projectiles.some((p) => p.team === 'blue' && p.kind === 'bolt'))
})

test('지형: 바위/맵 경계를 뚫고 나갈 수 없다', () => {
  const p = { x: -16, z: -38 } // 바위 한복판
  resolveTerrain(p, 1.3, [])
  assert.ok(Math.hypot(p.x - -16, p.z - -38) >= 5.2) // 밀려남
  const q = { x: 9999, z: -9999 }
  resolveTerrain(q, 1.3, [])
  assert.ok(q.x <= WORLD.maxX && q.z >= WORLD.minZ)
  assert.equal(nearestWp('mid', -96, 0), 0)
})

test('봇은 본진을 떠나 레인을 행군한다 (본진 옆 제자리 왕복 회귀 방지)', () => {
  const players = humans().map((p) => ({ ...p, isBot: true }))
  let seed = 7
  const rng = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 4294967296
  }
  const g = createGame(players, rng)
  startPlaying(g)
  run(g, 40)
  for (const team of ['blue', 'red']) {
    const far = g.heroes.filter(
      (h) => h.team === team && Math.abs(h.x - NEXUS_POS[team].x) > 40
    )
    assert.ok(far.length >= 1, `${team}팀 봇이 본진에서 출발해야 한다`)
  }
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
  assert.ok(g.minions.length < 300, '미니언이 무한히 쌓이면 안 된다')
  const v = makeView(g)
  JSON.stringify(v)
  assert.ok(['playing', 'finished'].includes(g.status))
})
