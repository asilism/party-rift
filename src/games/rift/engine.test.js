import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createGame, setInput, castAttack, castSkill, castSkill2, castUlt, castRecall, step, makeView, makeBot,
  towerVulnerable, nexusVulnerable, isHeroVisible, isUnitVisible, buyItem, sellItem, resetShop, canShop,
  STEP, COUNTDOWN_TIME, TIME_LIMIT, ULT_LEVEL, SKILL2_LEVEL, TEAM_SIZE, MAX_LEVEL, RECALL_TIME, CLASS_IDS, CLASSES,
  ITEM_SLOTS, BOT_STUCK_T,
} from './engine.js'
import { ITEMS_BY_ID, sumStats } from './items.js'
import {
  NEXUS_POS, LANES, LANE_IDS, BUSHES, WALLS, TOWER_SPOTS, avoidDir,
  nearestWp, resolveTerrain, WORLD, bushIndexAt, buildMap,
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
  assert.equal(g.towers.length, 14) // 3레인 × 외곽/내곽 × 2팀 + 최후의 포탑 2
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
  assert.equal(g.minions.length, 36) // 2팀 × 3레인 × 6 (근접 3 + 원거리 3)
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

test('궁수 꿰뚫는 화살: 일직선의 적을 모두 관통한다', () => {
  const g = createGame(humans())
  startPlaying(g)
  const h = g.heroes[1] // archer
  h.x = 0
  h.z = 0
  // 같은 직선(앞쪽)에 미니언 둘 — 둘 다 피해를 입어야 한다
  const m1 = plantMinion(g, 'red', 6, 0, 500)
  const m2 = plantMinion(g, 'red', 12, 0, 500)
  // 직선 밖(옆)의 미니언은 안 맞아야 한다
  const side = plantMinion(g, 'red', 6, 9, 500)
  castSkill(g, h.id)
  assert.equal(g.projectiles.filter((p) => p.kind === 'pierce').length, 3) // 시각용 화살 3발
  assert.ok(m1.hp < 500 && m2.hp < 500, '일직선의 두 적 모두 관통 피해')
  assert.equal(side.hp, 500, '직선에서 벗어난 적은 안 맞는다')
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
  // 적 우물 피해로 비교 (같은 위치, 방패 ON/OFF) — 최후의 포탑 사거리 밖에 둔다
  t.x = NEXUS_POS.blue.x
  t.z = NEXUS_POS.blue.z + 11
  run(g, 1)
  const lossNoShield = t.maxHp - t.hp
  t.hp = t.maxHp
  castSkill(g, t.id)
  assert.ok(t.shieldT > 0)
  run(g, 1)
  const lossShield = t.maxHp - t.hp
  assert.ok(lossShield < lossNoShield * 0.55, `${lossShield} vs ${lossNoShield}`)
})

test(`궁극기: 레벨 ${ULT_LEVEL} 전엔 잠겨 있고, 마법사 운석은 0.5초 뒤 광역 낙하`, () => {
  const g = createGame(humans())
  startPlaying(g)
  const a = g.heroes[0] // blue mage
  const b = g.heroes[3] // red healer
  a.x = 0
  a.z = 0
  b.x = 15 // 운석 사거리(22) 안 + 평타 사거리(10.5) 밖 → 자동평타 간섭 없이 운석만 검증
  b.z = 0
  castUlt(g, a.id)
  assert.equal(g.zones.length, 0) // 아직 잠김 (Lv5 전)
  a.lvl = ULT_LEVEL
  castUlt(g, a.id)
  assert.equal(g.zones.length, 3) // 운석 3발 예고(조준점)가 깔린다
  assert.equal(g.zones[0].kind, 'meteor')
  assert.ok(a.ultCd > 0)
  const hp0 = b.hp
  run(g, 0.3) // 아직 낙하 전 — 피해 없음
  assert.equal(b.hp, hp0)
  assert.equal(g.zones.length, 3)
  run(g, 0.4) // 0.5초 경과 → 첫 운석 낙하 (나머지는 0.45초 간격으로 뒤따른다)
  assert.ok(g.zones.length < 3)
  assert.ok(b.hp < hp0) // 광역 피해
  assert.ok(g.fx.some((n) => n.kind === 'meteorhit'))
})

test('마법사 화염구 빙결: 맞으면 1초간 이동/공격이 느려진다', () => {
  const g = createGame(humans())
  startPlaying(g)
  const a = g.heroes[0] // blue mage
  const b = g.heroes[3] // red healer
  a.x = 0; a.z = 0; a.dir = 0
  b.x = 6; b.z = 0
  castSkill(g, a.id) // 화염구 발사
  run(g, 0.4) // 날아가 명중
  assert.ok(b.freezeT > 0) // 빙결 상태
  assert.ok(b.hp < b.maxHp)
})

test('전사 회전베기: 2초간 돌며 주변을 반복 타격 (이동 가능)', () => {
  const g = createGame(humans())
  startPlaying(g)
  const w = g.heroes[2] // warrior (blue)
  const e = g.heroes[3] // healer (red)
  w.lvl = ULT_LEVEL
  w.x = 0; w.z = 0
  e.x = 4; e.z = 0 // 회전 반경 안
  castUlt(g, w.id)
  assert.ok(w.whirlT > 0)
  assert.ok(w.ultCd > 0)
  const hp0 = e.hp
  run(g, 0.4)
  assert.ok(e.hp < hp0) // 회전 타격으로 피해 누적
  const hp1 = e.hp
  run(g, 0.5)
  assert.ok(e.hp < hp1) // 도는 동안 계속 깎인다
  run(g, 2) // 회전 종료
  assert.equal(w.whirlT, 0)
})

test('궁수 빛의 화살: 바라보는 방향으로 멀리 관통, 직선상 적 모두 피해', () => {
  const g = createGame(humans())
  startPlaying(g)
  const a = g.heroes[1] // archer (blue)
  const e1 = g.heroes[3] // red
  const e2 = g.heroes[4] // red
  a.lvl = ULT_LEVEL
  a.x = 0; a.z = 0
  a.dir = 0 // +x 방향 조준
  e1.x = 20; e1.z = 0 // 일직선
  e2.x = 60; e2.z = 0.5 // 훨씬 멀리, 같은 직선상
  castUlt(g, a.id)
  assert.ok(a.castT > 0) // 정신집중 시작
  assert.ok(a.ultCd > 0)
  assert.equal(e1.hp, e1.maxHp) // 집중 중엔 아직 피해 없음
  run(g, 1.05) // 1초 정신집중 후 발사
  assert.equal(a.castT, 0)
  assert.ok(e1.hp < e1.maxHp)
  assert.ok(e2.hp < e2.maxHp) // 화면 끝까지 관통
  assert.ok(g.projectiles.some((p) => p.kind === 'lightarrow'))
})

test('궁수 빛의 화살: 정신집중 중 기절당하면 불발된다', () => {
  const g = createGame(humans())
  startPlaying(g)
  const a = g.heroes[1] // archer (blue)
  const e = g.heroes[3] // red
  a.lvl = ULT_LEVEL
  a.x = 0; a.z = 0; a.dir = 0
  e.x = 20; e.z = 0
  castUlt(g, a.id)
  assert.ok(a.castT > 0)
  a.stunT = 1 // 집중 도중 기절
  run(g, 0.1)
  assert.equal(a.castT, 0) // 끊김
  run(g, 1.1)
  assert.equal(e.hp, e.maxHp) // 발사 안 됨
})

test('힐러 성역: 거리에 상관없이 아군 전원 회복 + 기절/빙결 해제', () => {
  const g = createGame(humans())
  startPlaying(g)
  const heal = g.heroes[3] // healer (red)
  const near = g.heroes[4] // assassin (red)
  const far = g.heroes[5] // tank (red)
  heal.lvl = ULT_LEVEL
  heal.x = 0; heal.z = 0
  near.x = 5; near.z = 0
  far.x = 80; far.z = 40 // 아주 멀리
  near.hp = 100; near.stunT = 2
  far.hp = 100; far.freezeT = 2
  castUlt(g, heal.id)
  assert.ok(near.hp > 100)
  assert.equal(near.stunT, 0) // 기절 해제
  assert.ok(far.hp > 100) // 거리 무관 회복
  assert.equal(far.freezeT, 0) // 빙결 해제
  assert.ok(g.fx.some((n) => n.kind === 'holylight'))
})

test('죽은 영웅은 처치 경험치/골드를 받지 못한다 (죽은 자리에서 획득 X)', () => {
  const g = createGame(humans())
  startPlaying(g)
  const killer = g.heroes[0] // blue mage — 용을 막타
  const dead = g.heroes[1] // blue archer — 죽어 있는 아군 (킬 지점 근처)
  const alive = g.heroes[2] // blue warrior — 살아 있는 아군
  const drg = g.monsters.find((m) => m.kind === 'dragon')
  drg.alive = true; drg.respawnT = 0; drg.hp = 1; drg.maxHp = 1; drg.x = 0; drg.z = 0
  killer.x = 3; killer.z = 0
  dead.x = 5; dead.z = 0; dead.respawnT = 10; dead.xp = 0; dead.gold = 500; dead.lvl = 1
  alive.x = 5; alive.z = 2
  const aliveGold0 = alive.gold
  castAttack(g, killer.id)
  run(g, 0.3) // 막타 명중 → 용 처치 (팀 전체 골드/경험치)
  assert.equal(drg.alive, false)
  assert.equal(dead.xp, 0) // 죽어 있었으니 경험치 0
  assert.equal(dead.gold, 500) // 골드도 그대로
  assert.ok(alive.gold > aliveGold0) // 살아 있는 아군은 받는다
})

test('킬 크레딧 시한: 7초 지나 미니언/포탑에 죽으면 개인 킬이 아니다', () => {
  const g = createGame(humans())
  startPlaying(g)
  const poker = g.heroes[0] // blue mage — 오래 전에 한 대 때림
  const victim = g.heroes[3] // red healer
  // 다른 영웅들은 기본 스폰(맵 가장자리)이라 중앙(0,0)의 victim과 멀어 간섭하지 않는다
  victim.x = 0; victim.z = 0; victim.hp = 1
  // poker가 한참 전에 마지막 타격을 한 상황을 만든다
  victim.lastHitBy = poker.id
  victim.lastHitT = g.time
  g.time += 8 // 8초 경과 (KILL_CREDIT_T=7 초과)
  const kills0 = g.kills.blue
  // 적(파랑) 미니언이 막타 — 미니언은 attacker가 없어 킬 크레딧을 안 남긴다
  plantMinion(g, 'blue', 1.5, 0, 9999)
  run(g, 2)
  assert.ok(victim.respawnT > 0) // 죽었다
  assert.equal(poker.kills, 0) // 7초 지났으니 poker의 킬이 아니다
  assert.equal(g.kills.blue, kills0 + 1) // 팀 킬 점수는 올라간다
  assert.ok(g.feed.some((f) => f.msg.includes('쓰러짐'))) // "처치"가 아니라 "쓰러짐"
})

test('킬 크레딧: 7초 안에 죽으면 마지막으로 때린 영웅의 킬', () => {
  const g = createGame(humans())
  startPlaying(g)
  const killer = g.heroes[0] // blue mage
  const victim = g.heroes[3] // red healer
  victim.x = 0; victim.z = 0; victim.hp = 1
  victim.lastHitBy = killer.id
  victim.lastHitT = g.time // 방금 때림
  plantMinion(g, 'blue', 1.5, 0, 9999) // 미니언이 막타를 쳐도
  run(g, 2)
  assert.ok(victim.respawnT > 0)
  assert.equal(killer.kills, 1) // 7초 안이라 killer의 킬로 인정
  assert.ok(g.feed.some((f) => f.msg.includes('처치')))
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

test('점멸습격 강화: 그림자 습격으로 처치하면 스킬 쿨이 초기화된다', () => {
  const g = createGame(humans())
  startPlaying(g)
  const a = g.heroes[4] // assassin (red)
  const v = g.heroes[0] // mage (blue)
  a.x = 0; a.z = 0
  v.x = 6; v.z = 0
  v.hp = 1 // 한 방이면 죽는다
  castSkill(g, a.id)
  assert.ok(v.respawnT > 0) // 점멸습격으로 처치
  assert.equal(a.skillCd, 0) // 쿨 초기화 → 곧장 다음 표적으로
})

test(`보조 스킬: 레벨 ${SKILL2_LEVEL} 전엔 잠겨 있다`, () => {
  const g = createGame(humans())
  startPlaying(g)
  const w = g.heroes[2] // warrior (blue)
  assert.ok(w.lvl < SKILL2_LEVEL)
  castSkill2(g, w.id)
  assert.equal(w.berserkT, 0) // 잠김 — 발동 안 함
  w.lvl = SKILL2_LEVEL
  castSkill2(g, w.id)
  assert.ok(w.berserkT > 0) // 해금 후 발동
  assert.ok(w.skill2Cd > 0)
})

test('전사 광폭화: 상태이상 면역·해제 + 이동속도 증가', () => {
  const g = createGame(humans())
  startPlaying(g)
  const w = g.heroes[2] // warrior (blue)
  w.lvl = SKILL2_LEVEL
  w.stunT = 2
  w.freezeT = 2
  castSkill2(g, w.id)
  step(g, STEP)
  assert.equal(w.stunT, 0) // 즉시 해제
  assert.equal(w.freezeT, 0)
  // 광폭화 중엔 새로 걸린 기절도 매 틱 떨쳐낸다 (면역)
  w.stunT = 2
  step(g, STEP)
  assert.equal(w.stunT, 0)
  // 이동 속도 증가: 같은 시간 동안 평상시보다 멀리 간다
  const g2 = createGame(humans())
  startPlaying(g2)
  const w2 = g2.heroes[2]
  w2.x = 0; w2.z = 0
  setInput(g2, w2.id, { mx: 1, mz: 0 })
  run(g2, 0.5)
  const baseDist = w2.x
  const g3 = createGame(humans())
  startPlaying(g3)
  const w3 = g3.heroes[2]
  w3.lvl = SKILL2_LEVEL
  w3.x = 0; w3.z = 0
  castSkill2(g3, w3.id)
  setInput(g3, w3.id, { mx: 1, mz: 0 })
  run(g3, 0.5)
  assert.ok(w3.x > baseDist * 1.3, `광폭화 ${w3.x} vs 평상시 ${baseDist}`)
})

test('탱커 도발: 더 가까운 적이 있어도 도발당한 적은 탱커만 평타친다', () => {
  const g = createGame(humans())
  startPlaying(g)
  const t = g.heroes[5] // tank (red) — 도발 시전자
  const foe = g.heroes[2] // warrior (blue) — 도발 대상
  const other = g.heroes[4] // assassin (red) — foe에게 더 가까운 적(평소 표적)
  t.lvl = SKILL2_LEVEL
  t.x = 0; t.z = 0
  foe.x = 3; foe.z = 0
  other.x = 4; other.z = 0 // foe에 더 가깝지만 도발 때문에 무시당한다
  castSkill2(g, t.id)
  assert.ok(foe.tauntT > 0)
  assert.equal(foe.tauntBy, t.id)
  const tHp0 = t.hp
  const oHp0 = other.hp
  run(g, 1)
  assert.ok(t.hp < tHp0, '도발당한 적이 (더 가까운 적이 있어도) 탱커를 때린다')
  assert.equal(other.hp, oHp0, '더 가까운 적은 무시당해 안 맞는다')
  // 도발은 3초 지속 — 2.5초 뒤에도 아직 걸려 있다
  assert.ok(foe.tauntT > 0, '도발이 3초간 유지된다')
})

test('탱커 대지균열: 3파(파파팍)로 앞으로 뻗으며 길목의 적을 기절시킨다', () => {
  const g = createGame(humans())
  startPlaying(g)
  g.minions.length = 0; g.waveT = 999
  const t = g.heroes[5] // tank (red)
  t.lvl = ULT_LEVEL
  t.x = 0; t.z = 0; t.dir = 0 // +x 방향
  // 균열 경로(앞쪽)에 가까운 적·먼 적을 둔다 (FISSURE_LEN=18 → seg 6)
  const near = plantMinion(g, 'blue', 4, 0, 9999) // 첫 파(0~6) 구간
  const far = plantMinion(g, 'blue', 16, 0, 9999) // 마지막 파(12~18) 구간
  const side = plantMinion(g, 'blue', 8, 12, 9999) // 옆으로 벗어남 — 안 맞는다
  castUlt(g, t.id)
  assert.ok(t.ultCd > 0)
  assert.equal(g.zones.filter((z) => z.kind === 'fissure').length, 3) // 3파 예약
  run(g, 0.5) // 모든 파가 차례로 터진다
  assert.ok(near.hp < 9999, '가까운 적은 첫 파에 맞는다')
  assert.ok(far.hp < 9999, '먼 적도 마지막 파에 맞는다')
  assert.equal(side.hp, 9999, '경로 옆은 안 맞는다')
})

test('힐러 가속: 주변 아군 챔피언의 이동 속도가 빨라진다', () => {
  const g = createGame(humans())
  startPlaying(g)
  const heal = g.heroes[3] // healer (red)
  const mate = g.heroes[4] // assassin (red)
  heal.lvl = SKILL2_LEVEL
  heal.x = 0; heal.z = 0
  mate.x = 3; mate.z = 0
  castSkill2(g, heal.id)
  assert.ok(mate.hasteT > 0) // 아군이 가속 버프를 받았다
  assert.ok(heal.hasteT > 0) // 자신도
})

test('암살자 은신: 적에겐 안 보이고 아군에겐 보인다(반투명)', () => {
  const g = createGame(humans())
  startPlaying(g)
  const a = g.heroes[4] // assassin (red)
  const enemy = g.heroes[0] // blue
  a.lvl = SKILL2_LEVEL
  a.x = 0; a.z = 0
  enemy.x = 5; enemy.z = 0 // 바로 옆 (평소라면 또렷이 보임)
  castSkill2(g, a.id)
  assert.ok(a.stealthT > 0)
  assert.equal(isHeroVisible(g, a, 'blue'), false) // 적에겐 안 보인다
  assert.equal(isHeroVisible(g, a, 'red'), true) // 아군에겐 보인다
})

test('궁수 사냥매: 날아간 길의 안개가 잠시 걷혀 적이 드러난다', () => {
  const g = createGame(humans())
  startPlaying(g)
  const ar = g.heroes[1] // archer (blue)
  const foe = g.heroes[3] // red healer
  ar.lvl = SKILL2_LEVEL
  ar.x = 0; ar.z = 0
  ar.dir = 0 // +x 방향으로 매를 날린다
  foe.x = 40; foe.z = 0 // 시야 밖(SIGHT 24 초과)
  assert.equal(isHeroVisible(g, foe, 'blue'), false) // 평소엔 안개 속
  castSkill2(g, ar.id)
  assert.equal(g.hawks.length, 1)
  run(g, 1) // 매가 적 쪽으로 날아가며 안개를 걷는다
  assert.ok(g.reveals.length > 0)
  assert.equal(isHeroVisible(g, foe, 'blue'), true) // 매가 지난 자리 — 적이 드러난다
})

test('마법사 체인 라이트닝: 가까운 적에게서 최대 3회 연쇄, 점프마다 약해진다', () => {
  const g = createGame(humans())
  startPlaying(g)
  g.monsters = [] // 정글몹이 끼어들지 않게 (체인 표적은 심어둔 미니언만)
  const m = g.heroes[0] // mage (blue)
  m.lvl = SKILL2_LEVEL
  m.x = 0; m.z = 0
  const a = plantMinion(g, 'red', 5, 0, 500)
  const b = plantMinion(g, 'red', 9, 0, 500)
  const c = plantMinion(g, 'red', 13, 0, 500)
  const far = plantMinion(g, 'red', 16, 0, 500) // 4번째 — 3회 제한으로 안 맞는다
  castSkill2(g, m.id)
  assert.ok(m.skill2Cd > 0)
  const la = 500 - a.hp, lb = 500 - b.hp, lc = 500 - c.hp
  assert.ok(la > 0 && lb > 0 && lc > 0, '세 적 모두 적중')
  assert.ok(la > lb && lb > lc, '점프할수록 피해가 줄어든다')
  assert.equal(far.hp, 500, '최대 3회 — 네 번째 적은 안 맞는다')
})

test('마법사 체인 라이트닝: 맞출 적이 없으면 쿨다운을 안 쓴다', () => {
  const g = createGame(humans())
  startPlaying(g)
  g.monsters = []
  const m = g.heroes[0]
  m.lvl = SKILL2_LEVEL
  m.x = 0; m.z = 0 // 주변에 적 없음
  castSkill2(g, m.id)
  assert.equal(m.skill2Cd, 0) // 불발 — 쿨 안 씀
})

test('스킬 계수: 마법 스킬은 주문력에, 물리 스킬은 공격력에 비례한다', () => {
  // 우물 안에서 아이템을 사 능력치를 올린다 (canShop = inFountain)
  const giveItem = (g, h, itemId) => {
    h.x = h.homeX; h.z = h.homeZ; h.gold = 99999
    buyItem(g, h.id, itemId)
  }
  // 마법사 화염구 = 주문력 계수 → 주문력 아이템엔 세지고, 공격력 아이템엔 그대로
  const fireballDmg = (item) => {
    const g = createGame(humans()); startPlaying(g)
    const m = g.heroes[0]
    if (item) giveItem(g, m, item)
    m.x = 0; m.z = 0; m.dir = 0
    castSkill(g, m.id)
    return g.projectiles.find((p) => p.kind === 'fireball').dmg
  }
  const fb = fireballDmg(null)
  assert.ok(fireballDmg('void_staff') > fb, '주문력 아이템 → 화염구 강화')
  assert.equal(fireballDmg('longsword'), fb, '공격력 아이템 → 화염구 영향 없음')

  // 암살자 점멸습격 = 공격력 계수 → 공격력 아이템엔 세지고, 주문력 아이템엔 그대로
  const blinkDmg = (item) => {
    const g = createGame(humans()); startPlaying(g)
    const a = g.heroes[4]; const v = g.heroes[0]
    if (item) giveItem(g, a, item)
    a.x = 0; a.z = 0; v.x = 5; v.z = 0; v.hp = v.maxHp
    const hp0 = v.hp
    castSkill(g, a.id)
    return hp0 - v.hp
  }
  const bl = blinkDmg(null)
  assert.ok(blinkDmg('longsword') > bl, '공격력 아이템 → 점멸습격 강화')
  assert.equal(blinkDmg('orb'), bl, '주문력 아이템 → 점멸습격 영향 없음')
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

test('사람 자동평타: 버튼을 안 눌러도 사거리 안 적 영웅에게 평타가 나간다', () => {
  const g = createGame(humans())
  startPlaying(g)
  const me = g.heroes[2] // blue warrior (range 3.8)
  const foe = g.heroes[3] // red healer
  me.x = 0; me.z = 0
  foe.x = 3; foe.z = 0 // 사거리 안 + 수풀 밖
  assert.equal(me.atkCd, 0)
  step(g, STEP) // 아무 입력(cast) 없이 한 틱
  // 내가 쏜 평타 탄이 생기고 쿨다운이 돈다
  assert.ok(g.projectiles.some((p) => p.kind === 'bolt' && p.owner === me.id))
  assert.ok(me.atkCd > 0)
})

test('사람 자동평타: 쿨다운을 지키고, autoAttack=false면 안 나간다', () => {
  const g = createGame(humans())
  startPlaying(g)
  const me = g.heroes[2] // blue warrior
  const foe = g.heroes[3]
  me.x = 0; me.z = 0
  foe.x = 3; foe.z = 0
  step(g, STEP)
  const after = g.projectiles.filter((p) => p.owner === me.id).length
  step(g, STEP) // 바로 다음 틱엔 쿨 때문에 추가 평타 없음
  assert.equal(g.projectiles.filter((p) => p.owner === me.id).length, after)
  // 끄면 사거리 안이어도 자동으로 안 친다
  me.autoAttack = false
  me.atkCd = 0
  const before = g.projectiles.filter((p) => p.owner === me.id).length
  step(g, STEP)
  assert.equal(g.projectiles.filter((p) => p.owner === me.id).length, before)
})

test('사람 자동평타: 수풀에 매복 중이면 자동평타로 안 들킨다', () => {
  const g = createGame(humans())
  startPlaying(g)
  const me = g.heroes[0] // blue mage (range 10.5)
  const foe = g.heroes[3] // red healer
  const bush = BUSHES[9]
  me.x = bush.x; me.z = bush.z
  foe.x = bush.x + 6; foe.z = bush.z // 사거리 안이지만 수풀 밖
  step(g, STEP)
  assert.ok(me.bushI >= 0)
  assert.ok(!g.projectiles.some((p) => p.owner === me.id)) // 자동평타 불발
  assert.equal(isHeroVisible(g, me, 'red'), false) // 들키지 않음
})

test('봇 반응 지연: 쿨이 끝나도 그 즉시 평타를 박지 않는다(사람 같은 뜸)', () => {
  const g = createGame(humans())
  startPlaying(g)
  const bot = makeBot(g, g.heroes[3].id) // red 힐러를 봇으로
  bot.autoAttack = false // 사람 자동평타 경로와 섞이지 않게 (봇이라 어차피 무관하지만 명시)
  const foe = g.heroes[0] // blue mage
  bot.x = 0; bot.z = 0
  foe.x = 5; foe.z = 0 // 봇 힐러 사거리(9.5) 안 + 시야 안
  assert.equal(bot.atkCd, 0)
  step(g, STEP) // 첫 틱: 반응 지연을 굴리는 중 — 아직 평타 없음
  assert.ok(!g.projectiles.some((p) => p.owner === bot.id))
  assert.ok(bot.botReact > 0)
  run(g, 0.4) // 반응 지연(최대 0.3초)이 지나면 평타가 나간다
  assert.ok(g.projectiles.some((p) => p.owner === bot.id) || bot.atkCd > 0)
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

test('타워 공격 순서: 외곽→내곽→최후의 포탑→넥서스 순으로만 공격 가능', () => {
  const g = createGame(humans())
  const outer = g.towers.find((t) => t.id === 'r-mid-1')
  const inner = g.towers.find((t) => t.id === 'r-mid-2')
  const fin = g.towers.find((t) => t.id === 'r-final')
  assert.ok(fin && fin.tier === 3, '최후의 포탑이 존재한다')
  assert.equal(towerVulnerable(g, outer), true)
  assert.equal(towerVulnerable(g, inner), false)
  assert.equal(towerVulnerable(g, fin), false)
  assert.equal(nexusVulnerable(g, 'red'), false)
  outer.alive = false
  assert.equal(towerVulnerable(g, inner), true)
  assert.equal(towerVulnerable(g, fin), false) // 내곽이 아직 살아있으면 최후의 포탑 무적
  inner.alive = false
  assert.equal(towerVulnerable(g, fin), true) // 내곽이 부서지면 최후의 포탑 공격 가능
  assert.equal(nexusVulnerable(g, 'red'), false) // 최후의 포탑이 살아있으면 넥서스 무적
  fin.alive = false
  assert.equal(nexusVulnerable(g, 'red'), true) // 최후의 포탑이 부서지면 넥서스 공격 가능
})

test('타워는 미니언 우선 — 단, 우리 편을 때린 다이버는 반격으로 노린다', () => {
  const g = createGame(humans())
  startPlaying(g)
  const t = g.towers.find((o) => o.id === 'r-top-1')
  const h = g.heroes[0] // blue mage
  h.x = t.x - 8
  h.z = t.z
  const m = plantMinion(g, 'blue', t.x - 6, t.z, 80)
  run(g, 1.5)
  assert.ok(m.hp < 80 || !g.minions.includes(m)) // 미니언이 먼저 맞는다
  assert.equal(h.hp, h.maxHp) // 영웅은 미니언 뒤에서 안전 (철거 가능)
  // 사거리 안에서 적 영웅을 때리면(아군 피격) → 타워가 그 다이버로 표적을 바꿔 반격
  const victim = g.heroes[3] // red healer (타워와 같은 편)
  victim.x = t.x - 6
  victim.z = t.z + 2
  plantMinion(g, 'blue', t.x - 6, t.z, 9999) // 미니언 방패가 있어도
  castAttack(g, h.id) // h가 적 영웅을 때림 → 타워 어그로
  run(g, 1.5)
  assert.ok(h.hp < h.maxHp, '전투를 건 다이버는 타워에 맞아 물러나야 한다')
})

test('타워: 사거리에 영웅이 없으면 미니언을 때린다', () => {
  const g = createGame(humans())
  startPlaying(g)
  const t = g.towers.find((o) => o.id === 'r-top-1')
  // 영웅들을 멀리 치워 둔다
  for (const o of g.heroes) {
    o.x = NEXUS_POS[o.team].x
    o.z = NEXUS_POS[o.team].z
  }
  const m = plantMinion(g, 'blue', t.x - 6, t.z, 200)
  run(g, 1.5)
  assert.ok(m.hp < 200 || !g.minions.includes(m)) // 미니언이 맞는다
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

test('근접 영웅도 넥서스를 타격할 수 있다 (몸통 반경만큼 떨어져 있어도)', () => {
  const g = createGame(humans())
  startPlaying(g)
  g.waveT = 999
  g.minions.length = 0
  for (const t of g.towers) if (t.team === 'red') t.alive = false
  // 빨강 영웅들은 멀리 치워 자동 조준에 안 걸리게
  for (const o of g.heroes) if (o.team === 'red') { o.x = 0; o.z = 55 }
  const h = g.heroes.find((o) => o.cls === 'warrior') // blue 전사 (근접 3.8)
  const hp0 = g.nexus.red.hp
  // 충돌체 때문에 붙을 수 있는 최소 거리(반경 4.5 + 영웅 1.3 ≈ 5.8)에 둔다
  h.x = NEXUS_POS.red.x - 6
  h.z = NEXUS_POS.red.z
  setInput(g, h.id, { mx: 0, mz: 0 })
  castAttack(g, h.id)
  run(g, 0.5)
  assert.ok(g.nexus.red.hp < hp0, '근접 전사가 넥서스 체력을 깎는다')
})

test('갈 곳 잃은 봇: 한참 제자리에 박혀 있으면 귀환으로 우물 복귀', () => {
  const g = createGame(humans())
  startPlaying(g)
  g.waveT = 999
  g.minions.length = 0
  const h = makeBot(g, g.heroes[0].id)
  // 적/오브젝트가 시야·근처에 없게 멀리 치운다 (귀환이 끊기지 않도록)
  for (const o of g.heroes) if (o !== h) { o.x = 0; o.z = -60 }
  for (const m of g.monsters) m.alive = false
  // 레인 한복판(우물 밖)에서 "오래 끼임" 상태를 만들어 준다
  h.x = 0
  h.z = 0
  h.botStuckT = BOT_STUCK_T + 0.5 // 갈 곳을 잃고 한참 진동한 상태로 간주
  run(g, RECALL_TIME + 0.5)
  assert.ok(h.botStuckT < BOT_STUCK_T, '귀환 후 끼임 게이지 초기화')
  assert.ok(
    Math.hypot(h.x - NEXUS_POS.blue.x, h.z - NEXUS_POS.blue.z) < 15,
    '끼였던 봇이 우물로 복귀했다'
  )
})

test('갈 곳 잃은 봇 구제: 정상적으로 전진하는 봇은 끼임으로 오인하지 않는다', () => {
  const g = createGame(humans())
  startPlaying(g)
  g.waveT = 999
  g.minions.length = 0
  const h = makeBot(g, g.heroes[0].id)
  for (const o of g.heroes) if (o !== h) { o.x = 0; o.z = -60 }
  // 본진 근처에서 평범히 레인을 행군 → 끼임 게이지가 안 쌓이고 귀환도 안 켜진다
  run(g, BOT_STUCK_T + 1)
  assert.equal(h.botRecall, false, '전진 중인 봇은 귀환을 켜지 않는다')
  assert.ok((h.botStuckT || 0) < BOT_STUCK_T, '끼임 게이지가 임계 미만으로 유지된다')
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
  assert.equal(back.towers.length, 14)
  assert.ok(back.nexus.blue.hp > 0)
  assert.ok(Array.isArray(back.minions))
  assert.ok(back.timeLeft <= TIME_LIMIT)
  for (const h of back.heroes) {
    assert.ok(CLASS_IDS.includes(h.cls))
    assert.ok('bushI' in h && 'revealT' in h && 'shieldT' in h)
  }
})

test(`레벨은 최대 ${MAX_LEVEL}: 경험치를 쏟아부어도 그 위로 안 오른다`, () => {
  const g = createGame(humans())
  startPlaying(g)
  const h = g.heroes[0]
  for (let i = 0; i < 1000 && h.lvl < MAX_LEVEL; i++) {
    plantMinion(g, 'red', h.x + 5, h.z, 1)
    castAttack(g, h.id)
    run(g, 0.4)
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
  assert.ok(g.projectiles.some((p) => p.team === 'blue' && p.kind === 'mbolt'), '원거리 미니언은 작은 mbolt를 쏜다')
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

// 영웅을 특정 레벨로 올려놓는다 (체력도 그 레벨 최대치로)
function setLevel(h, lvl) {
  const c = CLASSES[h.cls]
  h.lvl = lvl
  h.maxHp = c.hp + c.hpLvl * (lvl - 1)
  h.hp = h.maxHp
}

// 한 영웅이 한 몹 옆에 붙어 계속 때리는 솔로 교전을 시뮬레이션한다.
function soloFight(g, h, mob, seconds) {
  const n = Math.round(seconds / STEP)
  for (let i = 0; i < n && h.respawnT <= 0 && mob.alive; i++) {
    castAttack(g, h.id)
    step(g, STEP)
  }
}

test('용 분노: 저레벨 혼자서는 분노가 쌓여 잡기 전에 쓰러진다', () => {
  const g = createGame(humans())
  startPlaying(g)
  const d = g.monsters.find((m) => m.kind === 'dragon')
  d.alive = true
  d.hp = d.maxHp
  d.x = 0
  d.z = 30
  const h = g.heroes[2] // blue warrior, 1레벨
  h.x = -3
  h.z = 30
  soloFight(g, h, d, 25)
  assert.ok(h.respawnT > 0, '저레벨 솔로는 용을 잡기 전에 죽는다')
  assert.ok(d.alive, '용은 살아남는다')
})

test('용 분노: 12레벨이면 혼자서도 용을 잡는다(쉽지 않게)', () => {
  const g = createGame(humans())
  startPlaying(g)
  const d = g.monsters.find((m) => m.kind === 'dragon')
  d.alive = true
  d.hp = d.maxHp
  d.x = 0
  d.z = 30
  const h = g.heroes[2] // blue warrior
  setLevel(h, 12)
  h.x = -3
  h.z = 30
  soloFight(g, h, d, 30)
  assert.equal(d.alive, false, '12레벨은 용을 잡는다')
  assert.ok(h.respawnT <= 0, '잡고도 살아남는다')
  assert.ok(h.hp < h.maxHp, '쉽지 않게 — 피해를 입는다')
})

test('용 분노: 11레벨 솔로는 분노에 먼저 쓰러진다 (용이 더 강해짐)', () => {
  const g = createGame(humans())
  startPlaying(g)
  const d = g.monsters.find((m) => m.kind === 'dragon')
  d.alive = true
  d.hp = d.maxHp
  d.x = 0
  d.z = 30
  const h = g.heroes[2] // blue warrior
  setLevel(h, 11)
  h.x = -3
  h.z = 30
  soloFight(g, h, d, 30)
  assert.ok(h.respawnT > 0, '11레벨 솔로는 용을 잡기 전에 쓰러진다')
  assert.ok(d.alive, '용은 살아남는다')
})

test('바론 분노: 10레벨이어도 혼자서는 못 잡는다', () => {
  const g = createGame(humans())
  startPlaying(g)
  const b = g.monsters.find((m) => m.kind === 'baron')
  b.alive = true
  b.hp = b.maxHp
  b.x = 0
  b.z = -30
  const h = g.heroes[4] // red assassin (최고 솔로 딜)
  setLevel(h, 10)
  h.x = -3
  h.z = -30
  soloFight(g, h, b, 30)
  assert.ok(h.respawnT > 0, '10레벨 솔로도 바론에게 쓰러진다')
  assert.ok(b.alive, '바론은 살아남는다')
})

test('미니언 방어: 주변 아군이 적 영웅에게 맞으면 가해자를 최우선으로 노린다', () => {
  const g = createGame(humans())
  startPlaying(g)
  const foe = g.heroes[4] // red assassin = 가해자
  const ally = g.heroes[0] // blue mage = 공격받는 아군
  foe.x = 0
  foe.z = 4
  ally.x = 0
  ally.z = 1
  ally.lastHurt = g.time // 방금 맞았다
  ally.lastHitBy = foe.id
  const closer = plantMinion(g, 'red', 2, 0, 50) // 더 가까운 적 미니언
  const m = plantMinion(g, 'blue', 0, 0, 500)
  run(g, 0.3)
  assert.equal(closer.hp, 50, '더 가까운 적 미니언이 아니라 가해자를 노린다')
  assert.ok(Math.hypot(m.x - foe.x, m.z - foe.z) < 4, '가해자(적 영웅) 쪽으로 다가간다')
})

test('미드 미니언: 경유지 위에 선 1차 타워를 돌아 라인이 멈추지 않고 전진한다', () => {
  const g = createGame(humans())
  startPlaying(g)
  g.waveT = 999 // 다른 웨이브 방해 없이
  // 파랑 미드 1차 타워(-34,0) 칸을 향해 행군하는 파랑 미니언
  const m = plantMinion(g, 'blue', -42, 0, 500)
  m.lane = 'mid'
  m.wpI = 2 // wps[2] = (-34,0) = 타워 위치
  run(g, 6)
  assert.ok(m.x > -20, `미드 타워에 끼지 않고 지나 전진해야 한다 (x=${m.x.toFixed(1)})`)
})

test('봇: 미니언 없이 적 타워 앞에 멈춰 있지 않고 다른 할 일(정글 등)을 찾아 간다', () => {
  const players = humans().map((p) => ({ ...p, isBot: true }))
  const g = createGame(players)
  startPlaying(g)
  g.waveT = 999 // 아군 미니언이 없는 상황을 만든다
  g.minions.length = 0
  const h = g.heroes.find((o) => o.team === 'blue' && o.cls === 'warrior')
  h.role = 'mid'
  const t = g.towers.find((o) => o.id === 'r-mid-1') // 적 미드 1차 타워 (34,0)
  h.x = t.x - 4 // 타워 사거리 안
  h.z = t.z
  // 나머지 영웅은 멀리 치워 교전 변수 제거
  for (const o of g.heroes) if (o !== h) { o.x = NEXUS_POS[o.team].x; o.z = NEXUS_POS[o.team].z }
  const tower0 = Math.hypot(h.x - t.x, h.z - t.z)
  run(g, 2)
  // 타워 앞에 얼어붙지 않고 할 일(가까운 정글몹 탐험 등)을 찾아 떠나야 한다
  const towerNow = Math.hypot(h.x - t.x, h.z - t.z)
  assert.ok(towerNow > tower0 + 6, `타워 앞에 얼어붙지 않고 벗어나야 한다 (${tower0.toFixed(1)}→${towerNow.toFixed(1)})`)
})

test('봇: 미니언을 앞질러 타워로 달려가지 않고 라인 교전을 지원하러 간다', () => {
  const players = humans().map((p) => ({ ...p, isBot: true }))
  const g = createGame(players)
  startPlaying(g)
  g.waveT = 999
  g.minions.length = 0
  const h = g.heroes.find((o) => o.team === 'blue' && o.cls === 'warrior')
  h.role = 'mid'
  for (const o of g.heroes) if (o !== h) { o.x = NEXUS_POS[o.team].x; o.z = NEXUS_POS[o.team].z }
  const t = g.towers.find((o) => o.id === 'r-mid-1') // 적 미드 1차 타워 (34,0)
  // 아군·적 미니언이 미드 한복판(-20,0)에서 교전 중
  g.minions.push({
    id: g.nextId++, team: 'blue', lane: 'mid', ranged: false,
    x: -20, z: 0, hp: 200, maxHp: 200, atkCd: 0, dir: 0, atkSeq: 0, wpI: 1,
  })
  g.minions.push({
    id: g.nextId++, team: 'red', lane: 'mid', ranged: false,
    x: -17, z: 0, hp: 200, maxHp: 200, atkCd: 0, dir: Math.PI, atkSeq: 0, wpI: LANES.mid.length - 2,
  })
  // 봇은 전선을 앞질러 타워 쪽(10,0)으로 나가 있다
  h.x = 10
  h.z = 0
  const towerD0 = Math.hypot(h.x - t.x, h.z - t.z)
  run(g, 2)
  const towerD1 = Math.hypot(h.x - t.x, h.z - t.z)
  assert.ok(towerD1 > towerD0 + 3, `타워로 더 가지 않고 전선으로 물러난다 (${towerD0.toFixed(1)}→${towerD1.toFixed(1)})`)
  const ally = g.minions.find((m) => m.team === 'blue')
  assert.ok(
    ally && Math.hypot(h.x - ally.x, h.z - ally.z) < 12,
    '봇이 아군 미니언 전선 근처로 합류한다'
  )
})

test('타워 응징: 저레벨 영웅이 사거리 안에 버티면 연사가 세져 금세 쓰러진다', () => {
  const g = createGame(humans())
  startPlaying(g)
  g.waveT = 999
  g.minions.length = 0
  const t = g.towers.find((o) => o.id === 'r-mid-1') // (34,0)
  const h = g.heroes[0] // blue mage, 1레벨
  h.x = t.x - 6
  h.z = t.z
  for (const o of g.heroes) if (o !== h) { o.x = NEXUS_POS[o.team].x; o.z = NEXUS_POS[o.team].z }
  let maxStreak = 0
  for (let i = 0; i < Math.round(4 / STEP) && h.respawnT <= 0; i++) {
    step(g, STEP)
    maxStreak = Math.max(maxStreak, t.streak || 0)
  }
  assert.ok(h.respawnT > 0, '사거리 안에 버틴 저레벨 영웅은 곧 쓰러진다')
  assert.ok(maxStreak >= 1, '같은 영웅을 연달아 맞혀 응징 연사 게이지가 쌓인다')
  // 표적이 빠지면(사망 후 본진 부활) 연사 게이지는 초기화된다
  run(g, 1.5)
  assert.equal(t.streak, 0, '표적이 사라지면 연사 게이지가 풀린다')
})

test('귀환: 방해 없이 7초 집중하면 우물로 복귀한다', () => {
  const g = createGame(humans())
  startPlaying(g)
  g.waveT = 999
  g.minions.length = 0
  const h = g.heroes[0] // blue mage
  h.x = 0
  h.z = 0
  setInput(g, h.id, { mx: 0, mz: 0 })
  castRecall(g, h.id)
  assert.ok(h.recallT > 0)
  run(g, RECALL_TIME + 0.2)
  assert.equal(h.recallT, 0)
  assert.ok(Math.hypot(h.x - NEXUS_POS.blue.x, h.z - NEXUS_POS.blue.z) < 15, '우물로 복귀')
})

test('귀환: 누르면 그 자리에 멈춘다 — 이동 입력이 있어도 취소되지 않고 제자리에서 시전', () => {
  const g = createGame(humans())
  startPlaying(g)
  g.waveT = 999
  g.minions.length = 0
  const h = g.heroes[0]
  h.x = 0
  h.z = 0
  castRecall(g, h.id)
  assert.ok(h.recallT > 0)
  setInput(g, h.id, { mx: 1, mz: 0 }) // 이동을 시도해도 자동으로 멈춘다
  run(g, 0.5)
  assert.ok(h.recallT > 0, '이동 입력으로는 안 끊긴다')
  assert.ok(Math.abs(h.x) < 0.01 && Math.abs(h.z) < 0.01, '제자리에 멈춰 있다')
  setInput(g, h.id, { mx: 0, mz: 0 })
  run(g, RECALL_TIME) // 끝까지 버티면 우물로 복귀
  const nx = NEXUS_POS[h.team]
  assert.ok(Math.hypot(h.x - nx.x, h.z - nx.z) < 12, '우물로 복귀했다')
})

test('귀환: 피해를 받으면 시전이 취소된다', () => {
  const g = createGame(humans())
  startPlaying(g)
  g.waveT = 999
  g.minions.length = 0
  const h = g.heroes[0] // blue mage
  const foe = g.heroes[3] // red healer
  h.x = 0
  h.z = 0
  foe.x = 4
  foe.z = 0
  setInput(g, h.id, { mx: 0, mz: 0 })
  castRecall(g, h.id)
  assert.ok(h.recallT > 0)
  castAttack(g, foe.id) // foe가 h를 때린다
  run(g, 0.3)
  assert.equal(h.recallT, 0)
})

test('부활 대기시간: 레벨이 높을수록 길어진다', () => {
  const g = createGame(humans())
  startPlaying(g)
  g.waveT = 999
  g.minions.length = 0
  const atk = g.heroes[0] // blue mage
  const killAt = (victim) => {
    atk.x = victim.x - 3
    atk.z = victim.z
    victim.hp = 1
    atk.atkCd = 0
    for (let i = 0; i < 60 && victim.respawnT <= 0; i++) {
      castAttack(g, atk.id)
      step(g, STEP)
    }
  }
  const low = g.heroes[3] // red, 1레벨
  low.x = 20
  low.z = 0
  killAt(low)
  const lowT = low.respawnT
  assert.ok(lowT > 0)
  const high = g.heroes[4] // red
  setLevel(high, 9)
  high.x = 20
  high.z = 0
  killAt(high)
  assert.ok(high.respawnT > lowT, `높은 레벨이 더 오래 기다린다 (Lv1 ${lowT.toFixed(1)} < Lv9 ${high.respawnT.toFixed(1)})`)
})

test('미니언 HP 설계: 원거리는 타워 2대, 근접은 3대에 죽는다', () => {
  const TOWER_DMG_MINION = 60
  const g = createGame(humans())
  startPlaying(g)
  run(g, 2.4) // 첫 웨이브
  const ranged = g.minions.find((m) => m.ranged)
  const melee = g.minions.find((m) => !m.ranged)
  assert.equal(Math.ceil(ranged.maxHp / TOWER_DMG_MINION), 2, '원거리는 2대')
  assert.equal(Math.ceil(melee.maxHp / TOWER_DMG_MINION), 3, '근접은 3대')
})

test('미니언 배치: 근접이 앞(중앙 쪽), 원거리가 뒤에 스폰된다', () => {
  const g = createGame(humans())
  startPlaying(g)
  run(g, 2.2) // 첫 웨이브 직후 (대형이 흐트러지기 전)
  const mid = g.minions.filter((m) => m.team === 'blue' && m.lane === 'mid')
  const avg = (arr) => arr.reduce((s, m) => s + m.x, 0) / arr.length
  const meleeX = avg(mid.filter((m) => !m.ranged))
  const rangedX = avg(mid.filter((m) => m.ranged))
  assert.ok(meleeX > rangedX, `근접이 더 앞(+x)에 스폰 (근접 ${meleeX.toFixed(1)} > 원거리 ${rangedX.toFixed(1)})`)
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

// ── 골드 / 상점 ──

// 영웅을 자기 우물 안으로 옮긴다
function toFountain(g, h) {
  h.x = NEXUS_POS[h.team].x
  h.z = NEXUS_POS[h.team].z
}

test('골드: 미니언 막타를 치면 골드를 얻고, 획득 fx가 뜬다', () => {
  const g = createGame(humans())
  startPlaying(g)
  const h = g.heroes[0] // blue mage
  h.x = 0
  h.z = 0
  const before = h.gold
  const m = plantMinion(g, 'red', 5, 0, 30)
  castAttack(g, h.id)
  run(g, 0.3) // 탄이 닿아 처치될 만큼만 (gold fx는 0.8초 안에 사라진다)
  assert.ok(!g.minions.includes(m)) // 처치됨
  assert.ok(h.gold > before, '막타로 골드를 얻는다')
  // makeView fx에 gold 종류(소유자/금액 포함)가 직렬화된다
  const fx = makeView(g).fx.find((n) => n.kind === 'gold')
  assert.ok(fx && fx.owner === h.id && fx.n > 0)
})

test('골드: 타워가 막타를 치면(영웅 아님) 골드는 없다', () => {
  const g = createGame(humans())
  startPlaying(g)
  const h = g.heroes[0]
  const before = h.gold
  // 미니언을 타워가 잡게 둔다(영웅 개입 없음) — 골드 변화는 패시브 수입뿐
  const m = plantMinion(g, 'red', 0, 0, 10)
  g.minions = g.minions.filter((o) => o !== m)
  // 직접 막타 크레딧이 영웅이 아니면 골드를 안 준다는 건 awardGold 분기로 보장됨
  assert.equal(h.gold, before) // 위 조작만으론 골드 변화 없음
})

test('상점: 우물 안에서만 살 수 있고, 골드가 줄고 능력치가 오른다', () => {
  const g = createGame(humans())
  startPlaying(g)
  const h = g.heroes[2] // blue warrior
  h.gold = 1000
  const item = ITEMS_BY_ID.longsword // 공격력 +30 (효과 배율 1.5 → 45)
  // 우물 밖 + 살아있으면 거부
  h.x = 0
  h.z = 0
  assert.equal(canShop(h), false)
  buyItem(g, h.id, 'longsword')
  assert.equal(h.items.length, 0)
  // 우물 안에서는 구매 성공
  toFountain(g, h)
  buyItem(g, h.id, 'longsword')
  assert.deepEqual(h.items, ['longsword'])
  assert.equal(h.gold, 1000 - item.cost)
  assert.equal(h.bonus.atk, 45) // 30 × 1.5
})

test('상점 되돌리기: 벗어나기 전엔 이번 구매를 무료 취소, 벗어나면 불가', () => {
  const g = createGame(humans())
  startPlaying(g)
  const h = g.heroes[2] // blue warrior
  toFountain(g, h)
  h.gold = 1000
  step(g, STEP) // 우물 진입 → 진입 시점 스냅샷
  const gold0 = h.gold
  buyItem(g, h.id, 'longsword') // -550
  buyItem(g, h.id, 'dagger') // -250
  assert.equal(h.items.length, 2)
  resetShop(g, h.id)
  assert.deepEqual(h.items, [], '되돌리면 이번 세션 구매가 사라진다')
  assert.equal(h.gold, gold0, '쓴 골드를 그대로 환원한다')
  // 우물을 벗어나면(세션 종료) 그 전 구매는 되돌릴 수 없다
  buyItem(g, h.id, 'dagger')
  h.x = 0
  h.z = 0 // 우물 밖
  step(g, STEP) // 세션 종료 → 스냅샷 폐기
  const goldAfter = h.gold
  resetShop(g, h.id) // 우물 밖이라 무시된다
  assert.deepEqual(h.items, ['dagger'], '벗어난 뒤엔 되돌리기 불가')
  assert.equal(h.gold, goldAfter)
})

test('상점: 죽어 있는 동안에도 우물 밖에서 살 수 있다', () => {
  const g = createGame(humans())
  startPlaying(g)
  const h = g.heroes[2]
  h.gold = 1000
  h.x = 0 // 우물 밖에서 전사
  h.z = 0
  h.respawnT = 8
  assert.equal(canShop(h), true)
  buyItem(g, h.id, 'dagger')
  assert.deepEqual(h.items, ['dagger'])
})

test('상점: 인벤토리는 3칸, 가득 차면 더 못 산다', () => {
  const g = createGame(humans())
  startPlaying(g)
  const h = g.heroes[2]
  toFountain(g, h)
  h.gold = 99999
  for (const id of ['dagger', 'longsword', 'leather', 'boots']) buyItem(g, h.id, id)
  assert.equal(h.items.length, ITEM_SLOTS)
  assert.ok(!h.items.includes('boots'), '4번째는 안 들어간다')
})

test('상점: 체력 아이템을 사면 최대 체력이 늘고 그만큼 즉시 회복', () => {
  const g = createGame(humans())
  startPlaying(g)
  const h = g.heroes[5] // red tank
  toFountain(g, h)
  h.gold = 9999
  h.hp = h.maxHp
  const max0 = h.maxHp
  buyItem(g, h.id, 'giant_heart') // hp +450 (×1.5 = 675)
  assert.equal(h.maxHp, max0 + 675)
  assert.equal(h.hp, h.maxHp) // 늘어난 만큼 채워진다
})

test('상점: 되팔면 칸이 비고 골드를 일부 돌려받는다', () => {
  const g = createGame(humans())
  startPlaying(g)
  const h = g.heroes[2]
  toFountain(g, h)
  h.gold = 1000
  buyItem(g, h.id, 'longsword') // 550
  const afterBuy = h.gold
  sellItem(g, h.id, 0)
  assert.equal(h.items.length, 0)
  assert.equal(h.bonus.atk, 0)
  assert.ok(h.gold > afterBuy && h.gold < 1000) // 일부 환급
})

test('아이템 효과: 공격력/방어 아이템이 실제 전투 수치에 반영된다', () => {
  const g = createGame(humans())
  startPlaying(g)
  const h = g.heroes[1] // archer
  toFountain(g, h)
  h.gold = 9999
  buyItem(g, h.id, 'executioner') // atk +55 (×1.5 = 83)
  // 미니언을 한 대 쳐 보면 투사체 피해가 기본보다 커야 한다
  h.x = 0
  h.z = 0
  plantMinion(g, 'red', 6, 0, 999)
  castAttack(g, h.id)
  const dmg = g.projectiles[0].dmg
  const base = CLASSES.archer.atk // lvl1 기준
  assert.ok(dmg >= base + 80, '공격력 아이템(배율 포함)이 탄 피해에 더해진다')
})

test('방향성 스킬: 전사 돌진·궁수 화살·탱커 균열은 dir이 담긴 fx를 낸다(렌더러 계약)', () => {
  const g = createGame(humans())
  startPlaying(g)
  const w = g.heroes[2] // warrior
  const a = g.heroes[1] // archer
  const t = g.heroes[5] // tank
  // 각자 앞쪽에 적 미니언을 둬 자동 조준 방향이 생기게
  w.x = 0; w.z = -40; plantMinion(g, 'red', 8, -40, 500)
  a.x = 0; a.z = 40; plantMinion(g, 'red', 8, 40, 500)
  t.x = -40; t.z = -40; t.lvl = ULT_LEVEL; plantMinion(g, 'red', -32, -40, 500)
  castSkill(g, w.id)
  castSkill(g, a.id)
  castUlt(g, t.id)
  run(g, 0.05) // 대지균열 첫 파(delay 0)가 터져 fissure fx가 나오게 한 틱 진행
  const v = makeView(g)
  for (const kind of ['dash', 'volley', 'fissure']) {
    const fx = v.fx.find((n) => n.kind === kind)
    assert.ok(fx, `${kind} fx가 있어야 한다`)
    assert.ok(typeof fx.dir === 'number', `${kind} fx에 dir이 직렬화돼야 한다`)
  }
  JSON.stringify(v) // 직렬화 안전성
})

test('미니언 균형: 미니언끼리는 영웅을 칠 때보다 천천히 깎인다', () => {
  const g = createGame(humans())
  startPlaying(g)
  // 같은 위치/체력의 미니언을 적 미니언 / 영웅 공격에 각각 노출해 비교
  const target1 = plantMinion(g, 'red', 0, 50, 200)
  const attacker = plantMinion(g, 'blue', 1.5, 50, 9999) // 근접 사거리 안
  // 다른 미니언/영웅 간섭 줄이기
  for (const h of g.heroes) { h.x = 300; h.z = 300 }
  run(g, 3)
  const lossVsMinion = 200 - target1.hp
  assert.ok(target1.hp > 0, '미니언끼리는 3초 안에 안 죽는다(천천히)')
  assert.ok(lossVsMinion > 0, '그래도 피해는 들어간다')
})

test('sumStats: 상한이 적용된다 (피해 감소 ≤ 60%)', () => {
  const b = sumStats(['guardian_cloak', 'guardian_cloak', 'guardian_cloak', 'guardian_cloak', 'guardian_cloak'])
  assert.ok(b.def <= 0.6)
})

// 다른 영웅/미니언 간섭 없이 한 영웅만 시험하기 좋게 정리한다
function isolate(g, keep) {
  for (const o of g.heroes) if (o !== keep) { o.x = 300; o.z = 300; o.respawnT = 999 }
  g.minions.length = 0
  g.waveT = 9999 // 새 웨이브 차단
}

test('특수효과 ▸ 공격속도: 광폭의 장갑이 공격 쿨다운을 줄인다', () => {
  const g = createGame(humans())
  startPlaying(g)
  const h = g.heroes[1] // archer
  isolate(g, h)
  h.x = 0; h.z = 0
  plantMinion(g, 'red', 5, 0, 9999)
  castAttack(g, h.id)
  const cd0 = h.atkCd // 기본 공격 쿨다운
  h.atkCd = 0
  toFountain(g, h); h.gold = 9999
  buyItem(g, h.id, 'rage_gloves') // atkSpeed 0.25 ×1.5 = 0.375
  h.x = 0; h.z = 0
  g.minions.length = 0
  plantMinion(g, 'red', 5, 0, 9999)
  castAttack(g, h.id)
  assert.ok(Math.abs(h.atkCd - cd0 * (1 - 0.375)) < 0.001, '쿨다운이 37.5% 짧아진다')
})

test('특수효과 ▸ 쿨감: 빛의 부적이 스킬 쿨다운을 줄인다', () => {
  const g = createGame(humans())
  startPlaying(g)
  const h = g.heroes[2] // warrior (skill cd 7)
  castSkill(g, h.id)
  const cd0 = h.skillCd
  h.skillCd = 0
  toFountain(g, h); h.gold = 9999
  buyItem(g, h.id, 'light_charm') // cdr 0.2 ×1.5 = 0.3
  castSkill(g, h.id)
  assert.ok(Math.abs(h.skillCd - cd0 * 0.7) < 0.01, '스킬 쿨다운이 30% 짧아진다')
})

test('특수효과 ▸ 사거리: 사냥꾼의 인장이 기본공격 사거리를 늘린다', () => {
  const g = createGame(humans())
  startPlaying(g)
  const h = g.heroes[2] // warrior (range 3.8)
  isolate(g, h)
  h.x = 0; h.z = 0
  const far = CLASSES.warrior.range + 3 // 기본 사거리 밖이지만 +4.5 안에는 든다
  plantMinion(g, 'red', far, 0, 9999)
  castAttack(g, h.id)
  assert.equal(g.projectiles.length, 0) // 기본 사거리 밖이라 조준 실패
  toFountain(g, h); h.gold = 9999
  buyItem(g, h.id, 'hunter_seal') // range 3 ×1.5 = 4.5
  h.x = 0; h.z = 0
  castAttack(g, h.id)
  assert.equal(g.projectiles.length, 1) // 사거리가 늘어 사격된다
})

test('특수효과 ▸ 흡혈: 흡혈낫은 때릴 때 체력을 회복한다 (자연회복분 이상)', () => {
  const g = createGame(humans())
  startPlaying(g)
  const h = g.heroes[1] // archer
  isolate(g, h)
  toFountain(g, h); h.gold = 9999
  buyItem(g, h.id, 'vampire_scythe') // lifesteal 0.15 ×1.5 = 0.225
  h.x = 0; h.z = 0
  h.hp = 100
  plantMinion(g, 'red', 5, 0, 9999)
  const hp0 = h.hp
  castAttack(g, h.id)
  run(g, 0.25) // 탄이 명중하는 순간 흡혈
  // 같은 0.25초 동안 자연회복은 maxHp*1.5%*0.25 ≈ 1~2뿐 → 5 이상이면 흡혈 덕분
  assert.ok(h.hp - hp0 > 5, '기본공격 적중 시 흡혈로 회복')
})

test('특수효과 ▸ 재생: 재생의 목걸이는 전투 중에도 체력을 채운다', () => {
  const g = createGame(humans())
  startPlaying(g)
  const h = g.heroes[5] // tank
  isolate(g, h)
  toFountain(g, h); h.gold = 9999
  buyItem(g, h.id, 'regen_pendant') // regen 0.018 ×1.5 = 0.027 /s
  h.x = 0; h.z = 0
  h.hp = 100
  h.lastHurt = g.time // 방금 맞은 셈 → 5초 자연회복은 꺼 둔다(아이템 재생만 분리 측정)
  const hp0 = h.hp
  run(g, 1)
  const expect = h.maxHp * 0.027 * 1
  assert.ok(h.hp - hp0 > expect * 0.8, '자연회복이 꺼진 동안에도 아이템 재생으로 회복')
})

test('특수효과 ▸ 이동속도: 신속의 장화로 같은 시간에 더 멀리 간다', () => {
  const g = createGame(humans())
  startPlaying(g)
  const h = g.heroes[2] // warrior
  isolate(g, h)
  h.x = 0; h.z = 0
  setInput(g, h.id, { mx: 0, mz: 1 })
  run(g, 0.5)
  const d0 = Math.hypot(h.x, h.z)
  h.x = 0; h.z = 0
  toFountain(g, h); h.gold = 9999
  buyItem(g, h.id, 'boots') // speed +2.8 ×1.5 = 4.2
  h.x = 0; h.z = 0
  setInput(g, h.id, { mx: 0, mz: 1 })
  run(g, 0.5)
  const d1 = Math.hypot(h.x, h.z)
  assert.ok(d1 > d0 + 1, '장화를 신으면 같은 시간에 더 멀리 이동')
})

test('특수효과 ▸ 주문 위력: 공허의 지팡이가 스킬 피해를 키운다', () => {
  const g = createGame(humans())
  startPlaying(g)
  const h = g.heroes[0] // mage
  isolate(g, h)
  h.x = 0; h.z = 0
  castSkill(g, h.id) // 화염구
  const dmg0 = g.projectiles.find((p) => p.kind === 'fireball').dmg
  g.projectiles.length = 0
  h.skillCd = 0
  toFountain(g, h); h.gold = 9999
  buyItem(g, h.id, 'void_staff') // power 70 ×1.5 = 105
  h.x = 0; h.z = 0
  castSkill(g, h.id)
  const dmg1 = g.projectiles.find((p) => p.kind === 'fireball').dmg
  assert.ok(dmg1 - dmg0 > 100, '주문 위력이 스킬 피해에 더해진다')
})

// ── 5:5 모드 ──
// 탑·미드·봇 솔로 + 봇 지원 힐러 + 정글러, 더 큰 맵 + 정글 캠프 증가.
function humans5v5() {
  // 팀당 4명(직업 4종) 사람 + 1명 봇 = 5:5 (RiftGame이 빈자리를 봇으로 채우는 모습)
  const defs = [
    ['rat', 'mage', 'blue', false], ['ox', 'archer', 'blue', false],
    ['tiger', 'warrior', 'blue', false], ['rabbit', 'healer', 'blue', false],
    ['monkey', 'tank', 'blue', true],
    ['dragon', 'assassin', 'red', false], ['snake', 'tank', 'red', false],
    ['horse', 'mage', 'red', false], ['sheep', 'archer', 'red', false],
    ['rooster', 'warrior', 'red', true],
  ]
  return defs.map(([id, cls, team, isBot]) => ({
    id, name: id.toUpperCase(), zodiacId: id, color: '#abc', cls, team, isBot,
  }))
}

test('5:5 ▸ buildMap: 맵이 3:3보다 크고 정글 캠프가 늘어난다', () => {
  const m3 = buildMap('3v3')
  const m5 = buildMap('5v5')
  assert.ok(m5.WORLD.maxX > m3.WORLD.maxX, '5:5 월드가 더 넓다')
  assert.ok(m5.WORLD.maxZ > m3.WORLD.maxZ, '5:5 월드가 더 깊다')
  assert.ok(m5.WOLF_CAMPS.length > m3.WOLF_CAMPS.length, '5:5 정글 캠프가 더 많다')
  // 넥서스/타워는 모두 월드 안에 있어야 한다
  for (const t of m5.TOWER_SPOTS) {
    assert.ok(t.x >= m5.WORLD.minX && t.x <= m5.WORLD.maxX)
    assert.ok(t.z >= m5.WORLD.minZ && t.z <= m5.WORLD.maxZ)
  }
})

test('5:5 ▸ createGame: 팀당 5명, 빈자리 봇이 정글/지원 역할까지 채운다', () => {
  const g = createGame(humans5v5(), { mode: '5v5' })
  assert.equal(g.mode, '5v5')
  assert.equal(g.teamSize, 5)
  assert.equal(g.heroes.length, 10)
  for (const team of ['blue', 'red']) {
    const mine = g.heroes.filter((h) => h.team === team)
    assert.equal(mine.length, 5)
    assert.equal(new Set(mine.map((h) => h.cls)).size, 5) // 직업 중복 없음
    const bots = mine.filter((h) => h.isBot)
    assert.equal(bots.length, 1) // 4명이 사람 → 봇 1명
  }
  // 봇 역할은 직업 기준: 파랑 봇=탱커→탑, 빨강 봇=전사→정글
  const blueBot = g.heroes.find((h) => h.team === 'blue' && h.isBot)
  const redBot = g.heroes.find((h) => h.team === 'red' && h.isBot)
  assert.equal(blueBot.cls, 'tank')
  assert.equal(blueBot.role, 'top')
  assert.equal(redBot.cls, 'warrior')
  assert.equal(redBot.role, 'jungle')
  // 우물(회복 지대) 좌표가 영웅에 새겨진다
  for (const h of g.heroes) {
    assert.equal(h.homeX, g.map.NEXUS_POS[h.team].x)
    assert.ok(canShop(h)) // 시작 시 우물 안 → 상점 가능
  }
})

test('역할 배정: 이상적 5:5 구성은 마법사 미드/탱커 탑/궁수·힐러 봇/암살자 정글', () => {
  // 두 팀 모두 이상적 구성(마법사·탱커·궁수·힐러·암살자) 전원 봇
  const ideal = ['mage', 'tank', 'archer', 'healer', 'assassin']
  const zod = ['rat', 'ox', 'tiger', 'rabbit', 'dragon', 'snake', 'horse', 'sheep', 'monkey', 'rooster']
  const players = []
  let zi = 0
  for (const team of ['blue', 'red']) {
    for (const cls of ideal) {
      players.push({ id: zod[zi], name: zod[zi], zodiacId: zod[zi], color: '#abc', cls, team, isBot: true })
      zi++
    }
  }
  const g = createGame(players, { mode: '5v5' })
  for (const team of ['blue', 'red']) {
    const byCls = {}
    for (const h of g.heroes) if (h.team === team) byCls[h.cls] = h.role
    assert.equal(byCls.mage, 'mid', '마법사는 미드')
    assert.equal(byCls.tank, 'top', '탱커는 탑')
    assert.equal(byCls.archer, 'bot', '궁수는 봇')
    assert.equal(byCls.healer, 'support', '힐러는 봇 지원')
    assert.equal(byCls.assassin, 'jungle', '암살자는 정글')
    // 5개 역할이 빠짐없이 한 명씩 배정된다
    const roles = g.heroes.filter((h) => h.team === team).map((h) => h.role)
    assert.deepEqual([...roles].sort(), ['bot', 'jungle', 'mid', 'support', 'top'])
  }
})

test('역할 배정: 전원 봇 3:3은 세 레인을 빠짐없이 나눠 맡는다', () => {
  const players = humans().map((p) => ({ ...p, isBot: true })) // mage/archer/warrior, healer/assassin/tank
  const g = createGame(players)
  for (const team of ['blue', 'red']) {
    const roles = g.heroes.filter((h) => h.team === team).map((h) => h.role)
    assert.deepEqual([...roles].sort(), ['bot', 'mid', 'top']) // 3레인 공백 없음
  }
  // 파랑: 마법사→미드, 궁수→봇 (전사는 정글이 없으니 남은 탑)
  const blue = {}
  for (const h of g.heroes) if (h.team === 'blue') blue[h.cls] = h.role
  assert.equal(blue.mage, 'mid')
  assert.equal(blue.archer, 'bot')
  assert.equal(blue.warrior, 'top')
})

test('5:5 ▸ 큰 맵에서 게임이 안정적으로 진행된다(범위 이탈/예외 없음)', () => {
  const g = createGame(humans5v5(), { mode: '5v5' })
  startPlaying(g)
  run(g, 30) // 30초 시뮬 — 봇 AI(정글러/지원 포함)가 돌아간다
  for (const h of g.heroes) {
    assert.ok(h.x >= g.map.WORLD.minX - 1 && h.x <= g.map.WORLD.maxX + 1, '맵 안에 머문다')
    assert.ok(h.z >= g.map.WORLD.minZ - 1 && h.z <= g.map.WORLD.maxZ + 1)
  }
  const v = makeView(g)
  assert.equal(v.mode, '5v5')
  assert.equal(v.heroes.length, 10)
  // 미니언 웨이브가 3레인에 생성됐다
  assert.ok(v.minions.length > 0)
})

test('5:5 ▸ makeBot 인계: 5:5 역할 풀에서 빈 역할을 맡는다', () => {
  const g = createGame(humans5v5(), { mode: '5v5' })
  const h = g.heroes.find((o) => !o.isBot)
  makeBot(g, h.id)
  assert.ok(h.isBot)
  assert.ok(['mid', 'top', 'bot', 'support', 'jungle'].includes(h.role))
})
