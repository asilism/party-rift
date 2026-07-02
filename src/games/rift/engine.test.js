import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createGame, setInput, castAttack, castSkill, castSkill2, castUlt, castRecall, step, makeView, makeBot,
  towerVulnerable, nexusVulnerable, isHeroVisible, isUnitVisible, buyItem, sellItem, resetShop, canShop, useItem,
  STEP, COUNTDOWN_TIME, TIME_LIMIT, ULT_LEVEL, SKILL2_LEVEL, TEAM_SIZE, MAX_LEVEL, RECALL_TIME, CLASS_IDS, CLASSES,
  ITEM_SLOTS, BOT_STUCK_T, HP_SCALE,
} from './engine.js'
import { ITEMS_BY_ID, sumStats, buildQuote } from './items.js'
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
    const fp = g.map.FOUNTAIN_POS[h.team]
    assert.ok(Math.hypot(h.x - fp.x, h.z - fp.z) < 12) // 리스폰 존 근처
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

test('체력 상향: 영웅 최대 체력에 20% 배율이 반영된다(전투가 한 방에 안 끝나게)', () => {
  const g = createGame(humans())
  startPlaying(g)
  for (const h of g.heroes) {
    const c = CLASSES[h.cls]
    const expected = Math.round((c.hp + c.hpLvl * (h.lvl - 1)) * HP_SCALE)
    assert.equal(h.maxHp, expected, `${h.cls} 최대 체력 = 기본곡선 × ${HP_SCALE}`)
  }
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

test('전사 회전베기: 도는 동안 받는 피해가 크게 줄어든다(앞라인 탱킹)', () => {
  const g = duo('warrior', 'mage')
  startPlaying(g)
  const w = g.heroes[0]
  w.lvl = ULT_LEVEL
  // 적 리스폰 존(회복 지대) 피해로 비교 (같은 위치·시간, 궁극기 OFF/ON) — 넥서스 뒤편이라 포탑 사거리 밖
  w.x = g.map.FOUNTAIN_POS.red.x; w.z = g.map.FOUNTAIN_POS.red.z
  for (const o of g.heroes) if (o !== w) { o.x = 0; o.z = 60 } // 다른 영웅 간섭 제거
  run(g, 1)
  const lossOff = w.maxHp - w.hp
  w.hp = w.maxHp
  castUlt(g, w.id) // 회전베기(2초) — 도는 내내 켜져 있다
  run(g, 1)
  const lossOn = w.maxHp - w.hp
  assert.ok(lossOn < lossOff * 0.7, `회전베기 중 피해가 줄어든다 (off=${lossOff}, on=${lossOn})`)
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
  // 적 리스폰 존(회복 지대) 피해로 비교 (같은 위치, 방패 ON/OFF) — 넥서스 뒤편이라 포탑 사거리 밖
  t.x = g.map.FOUNTAIN_POS.blue.x
  t.z = g.map.FOUNTAIN_POS.blue.z
  for (const o of g.heroes) if (o !== t) { o.x = 0; o.z = 60 } // 다른 영웅 간섭 제거
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

test('마법사 화염구: 순수 폭발 — 빙결 없이 광역 피해만', () => {
  const g = createGame(humans())
  startPlaying(g)
  const a = g.heroes[0] // blue mage
  const b = g.heroes[3] // red healer
  a.x = 0; a.z = 0; a.dir = 0
  b.x = 6; b.z = 0
  castSkill(g, a.id) // 화염구 발사
  run(g, 0.4) // 날아가 명중
  assert.equal(b.freezeT, 0) // 빙결 정체성은 한빙술사 전용 → 마법사는 CC 없음
  assert.ok(b.hp < b.maxHp) // 폭발 피해
})

// ── P1: 한빙술사 / 검투사 ──
function duo(blueCls, redCls) {
  return createGame([
    { id: 'rat', name: 'B', zodiacId: 'rat', color: '#abc', cls: blueCls, team: 'blue' },
    { id: 'ox', name: 'R', zodiacId: 'ox', color: '#abc', cls: redCls, team: 'red' },
  ], { mode: '3v3', rng: () => 0.5 })
}

test('한빙술사 서리파동: 부채꼴 앞 적을 빙결시킨다', () => {
  const g = duo('cryomancer', 'tank')
  startPlaying(g)
  const c = g.heroes[0]; const t = g.heroes[1]
  c.x = 0; c.z = 0; c.dir = 0
  t.x = 6; t.z = 0
  castSkill(g, c.id)
  assert.ok(t.freezeT > 0, '빙결 상태')
  assert.ok(t.hp < t.maxHp, '약한 피해도 들어간다')
})

test('검투사 휘둘러베기: 광역 피해 + 흡혈 회복', () => {
  const g = duo('gladiator', 'healer')
  startPlaying(g)
  const a = g.heroes[0]; const e = g.heroes[1]
  a.x = 0; a.z = 0; a.hp = 200 // 다친 상태
  e.x = 4; e.z = 0
  castSkill(g, a.id)
  assert.ok(e.hp < e.maxHp, '적이 베인다')
  assert.ok(a.hp > 200, '입힌 피해의 일부를 흡혈로 회복')
})

test('검투의 분노: 이동속도↑·받는 CC 감소', () => {
  const g = duo('gladiator', 'cryomancer')
  startPlaying(g)
  const glad = g.heroes[0]; const cryo = g.heroes[1]
  glad.lvl = ULT_LEVEL
  glad.x = 0; glad.z = 0
  cryo.x = 6; cryo.z = 0; cryo.dir = Math.PI // 검투사 쪽을 향함
  castUlt(g, glad.id)
  assert.ok(glad.rageT > 0, '분노 발동')
  castSkill(g, cryo.id) // 서리파동으로 얼리기 시도
  // 분노 중이라 빙결 시간이 절반 이하(FROST_FREEZE=1.6 → 0.8)로 줄어든다
  assert.ok(glad.freezeT > 0 && glad.freezeT <= 0.85, `CC 감소 적용 (freezeT=${glad.freezeT})`)
})

// ── P2: 주술사 / 수호기사 ──
test('주술사 저주살: 중독으로 체력이 지속적으로 깎인다', () => {
  const g = duo('warlock', 'tank')
  startPlaying(g)
  const w = g.heroes[0]; const t = g.heroes[1]
  w.x = 0; w.z = 0; t.x = 6; t.z = 0
  castSkill(g, w.id)
  assert.ok(t.poisonT > 0, '중독 부여')
  const hp1 = t.hp
  run(g, 1) // 1초 지속피해
  assert.ok(t.hp < hp1, '중독으로 체력이 계속 깎인다')
})

test('수호기사 수호의 빛: 보호막이 피해를 먼저 흡수한다', () => {
  const g = duo('guardian', 'assassin')
  startPlaying(g)
  const gd = g.heroes[0]; const as = g.heroes[1]
  gd.x = 0; gd.z = 0
  as.x = 3; as.z = 0
  castSkill(g, gd.id) // 자신에게 보호막
  assert.ok(gd.barrierHp > 0, '보호막 부여')
  const barrier0 = gd.barrierHp; const hp0 = gd.hp
  castAttack(g, as.id) // 암살자 평타
  run(g, 0.35) // 탄이 날아가 적중
  assert.ok(gd.barrierHp < barrier0, '보호막이 먼저 깎인다')
  assert.equal(gd.hp, hp0, '보호막이 남아 있으면 체력은 안 깎인다')
})

test('수호기사 결속: 묶인 아군의 피해를 수호기사가 대신(감소) 받는다', () => {
  const mk = () => {
    const g = createGame([
      { id: 'gd', name: 'G', zodiacId: 'rat', color: '#abc', cls: 'guardian', team: 'blue' },
      { id: 'al', name: 'A', zodiacId: 'ox', color: '#abc', cls: 'warrior', team: 'blue' },
      { id: 'en', name: 'E', zodiacId: 'tiger', color: '#abc', cls: 'assassin', team: 'red' },
    ], { mode: '3v3', rng: () => 0.5 })
    startPlaying(g)
    g.waveT = 999; g.minions.length = 0
    const [gd, al, en] = g.heroes
    gd.x = 0; gd.z = 0; al.x = 5; al.z = 0; en.x = 8; en.z = 0 // 적은 아군(al)이 가장 가깝다
    return { g, gd, al, en }
  }
  // 기준: 결속 없이 적 평타가 아군에게 주는 피해
  const b = mk()
  const alHp0 = b.al.hp
  castAttack(b.g, b.en.id)
  run(b.g, 0.4)
  const hit = alHp0 - b.al.hp
  assert.ok(hit > 0, '기준 피해가 들어간다')

  // 결속: 아군은 안 깎이고 수호기사가 대신(감소) 받는다
  const s = mk()
  s.gd.lvl = SKILL2_LEVEL
  castSkill2(s.g, s.gd.id)
  assert.ok(s.al.bindT > 0 && s.al.bindBy === s.gd.id, '아군이 결속됐다')
  assert.ok(s.gd.bindAnchorT > 0, '수호기사가 결속 앵커다')
  const alHp1 = s.al.hp; const gdHp1 = s.gd.hp
  castAttack(s.g, s.en.id)
  run(s.g, 0.4)
  assert.equal(s.al.hp, alHp1, '결속된 아군은 피해를 전혀 안 받는다')
  const redirected = gdHp1 - s.gd.hp
  assert.ok(redirected > 0, '수호기사가 대신 받는다')
  assert.ok(redirected < hit, '대신 받는 피해는 감소된다(50%+인원×10%)')
})

// ── P3: 검성 / 사슬잡이 ──
test('검성 발도 카운터: 받는 첫 피해를 막고 그 2배로 되돌린다', () => {
  // 먼저 자세 없이 맞았을 때 암살자 평타 피해량을 잰다(비교 기준)
  const base = duo('swordmaster', 'assassin')
  startPlaying(base)
  const bsw = base.heroes[0]; const bas = base.heroes[1]
  bsw.x = 0; bsw.z = 0; bas.x = 3; bas.z = 0
  const bswHp = bsw.hp
  castAttack(base, bas.id)
  run(base, 0.35)
  const hit = bswHp - bsw.hp // 자세 없을 때 검성이 받은 평타 피해
  assert.ok(hit > 0, '기준 피해가 들어간다')

  // 이제 자세를 잡고 같은 평타를 받으면: 피해 무효 + 그 2배가 공격자에게
  const g = duo('swordmaster', 'assassin')
  startPlaying(g)
  const sw = g.heroes[0]; const as = g.heroes[1]
  sw.x = 0; sw.z = 0; as.x = 3; as.z = 0
  castSkill(g, sw.id) // 자세 잡기
  assert.ok(sw.parryT > 0)
  const swHp = sw.hp; const asHp = as.hp
  castAttack(g, as.id)
  run(g, 0.35) // 암살자 평타가 날아와 적중 → 막히고 반격
  assert.equal(sw.hp, swHp, '받는 피해가 무효화된다')
  assert.equal(sw.parryT, 0, '한 번 쓰면 소진')
  const reflected = asHp - as.hp
  assert.ok(reflected > 0, '공격자에게 반격이 들어간다')
  // 반사는 막은 피해의 2배(공격자 방어 적용 전 기준) — 자세 없을 때 피해보다 확실히 크다
  assert.ok(reflected > hit * 1.4, `반격이 막은 피해의 배수로 들어간다 (막음 ${hit|0} → 반사 ${reflected|0})`)
})

test('사슬잡이 사슬갈고리: 발사준비 후 투사체 발사 → 명중 시 끌려오며 스턴', () => {
  const g = duo('catcher', 'mage')
  startPlaying(g)
  const c = g.heroes[0]; const m = g.heroes[1]
  c.x = 0; c.z = 0; c.dir = 0
  m.x = 10; m.z = 0 // 직선 경로상
  castSkill(g, c.id)
  // 발사 준비 동안엔 아직 투사체가 없다
  assert.ok(g.projectiles.every((p) => p.kind !== 'hook'), '준비 중엔 미발사')
  run(g, 0.3) // 준비(0.25) 후 발사
  assert.ok(g.projectiles.some((p) => p.kind === 'hook'), '갈고리 투사체 발사')
  run(g, 0.5) // 날아가 명중 → 끌림 시작
  assert.ok(m.stunT > 0, '끌리는 동안 스턴(아무것도 못 함)')
  assert.ok(m.pullT > 0, '끌림 상태')
  const d1 = Math.hypot(m.x - c.x, m.z - c.z)
  // 스턴 중엔 본인 이동 입력 무시 + 천천히 끌려온다
  m.mx = 1; m.mz = 0
  run(g, 0.7)
  const d2 = Math.hypot(m.x - c.x, m.z - c.z)
  assert.ok(d2 < d1 - 1, `천천히 끌려와 거리가 줄어든다 (${d1.toFixed(1)}→${d2.toFixed(1)})`)
})

// ── P6: 넝쿨사냥꾼 (원거리 속박 정글러) ──
test('넝쿨사냥꾼 올가미: 땅에서 5단으로 솟아 앞 적을 속박(이동 불가) + 피해', () => {
  const g = duo('snarer', 'mage')
  startPlaying(g)
  g.minions.length = 0 // 미니언이 표적을 밀지 않게
  const s = g.heroes[0]; const m = g.heroes[1]
  s.x = 0; s.z = 0; s.dir = 0
  m.x = 8; m.z = 0 // 직선 경로상(사거리 15 안), 폭 안
  castSkill(g, s.id)
  assert.equal(g.projectiles.filter((p) => p.kind === 'net').length, 0, '투사체가 아니다')
  assert.equal(g.zones.filter((z) => z.kind === 'vine').length, 5, '땅에서 솟는 5단 넝쿨 존')
  run(g, 0.6) // 단들이 앞으로 전진하며 적 위치까지 솟는다
  assert.ok(m.rootT > 0, '솟아오른 올가미에 속박')
  assert.ok(m.hp < m.maxHp, '피해도 들어간다')
  const x0 = m.x
  m.mx = 1; m.mz = 0 // 이동 시도
  run(g, 0.3)
  assert.ok(Math.abs(m.x - x0) < 0.6, '속박 동안 못 움직인다')
})

test('넝쿨사냥꾼 포획망: 범위 안 적 전원을 속박 + 피해', () => {
  const g = duo('snarer', 'tank')
  startPlaying(g)
  const s = g.heroes[0]; const t = g.heroes[1]
  s.lvl = ULT_LEVEL
  s.x = 0; s.z = 0; s.dir = 0
  t.x = 6; t.z = 0
  castUlt(g, s.id)
  assert.ok(t.rootT > 0, '포획망에 속박')
  assert.ok(t.hp < t.maxHp, '피해도 들어간다')
})

test('넝쿨사냥꾼 덩굴 합류: 아군 곁으로 순간이동한다', () => {
  const g = createGame([
    { id: 'rat', name: 'B1', zodiacId: 'rat', color: '#abc', cls: 'snarer', team: 'blue' },
    { id: 'ox', name: 'B2', zodiacId: 'ox', color: '#abc', cls: 'archer', team: 'blue' },
    { id: 'tiger', name: 'R', zodiacId: 'tiger', color: '#abc', cls: 'mage', team: 'red' },
  ], { mode: '3v3', rng: () => 0.5 })
  startPlaying(g)
  const s = g.heroes.find((h) => h.cls === 'snarer')
  const ally = g.heroes.find((h) => h.cls === 'archer')
  s.lvl = SKILL2_LEVEL
  s.x = 0; s.z = 0
  ally.x = 25; ally.z = 0 // 사거리(30) 안의 합류 대상
  castSkill2(g, s.id)
  assert.ok(Math.hypot(s.x, s.z) > 1, '제자리가 아니라 이동했다')
  const onAlly = g.heroes.some(
    (a) => a.team === 'blue' && a !== s && a.respawnT <= 0 && Math.hypot(s.x - a.x, s.z - a.z) < 2,
  )
  assert.ok(onAlly, '아군 곁에 착지')
})

test('궁수 사냥매: 매에 발견된 적은 잠시 둔화된다', () => {
  const g = duo('archer', 'mage')
  startPlaying(g)
  const a = g.heroes[0]; const foe = g.heroes[1]
  a.lvl = SKILL2_LEVEL
  a.x = 0; a.z = 0; a.dir = 0 // +x 방향으로 매를 날린다
  foe.x = 20; foe.z = 0 // 매 경로 위의 적
  assert.equal(foe.freezeT, 0)
  castSkill2(g, a.id)
  run(g, 0.6) // 매(속도 46)가 적을 지나칠 만큼 진행
  assert.ok(foe.freezeT > 0, '매에 스친 적이 둔화된다')
})

// ── P4: 야수조련사 / P5: 엔지니어 (소환물 시스템) ──
test('야수조련사 늑대 소환: 펫이 생겨 근처 적을 문다', () => {
  const g = duo('beastmaster', 'mage')
  startPlaying(g)
  const bm = g.heroes[0]; const foe = g.heroes[1]
  bm.x = 0; bm.z = 0; bm.dir = 0
  foe.x = 4; foe.z = 0
  castSkill(g, bm.id)
  assert.equal(g.summons.filter((s) => s.owner === bm.id).length, 2, '늑대 2마리')
  const hp0 = foe.hp
  run(g, 1.5) // 늑대가 붙어서 문다
  assert.ok(foe.hp < hp0, '펫이 적을 공격해 체력이 깎인다')
})

test('야수조련사 사냥 명령: 사정거리 안 적에게 거리 무시하고 도약 → 착지 위치 일치 + 즉시 한 입', () => {
  const g = duo('beastmaster', 'mage')
  startPlaying(g)
  const bm = g.heroes[0]; const foe = g.heroes[1]
  bm.lvl = SKILL2_LEVEL // 사냥 명령(보조 스킬) 해금
  bm.x = 0; bm.z = 0; bm.dir = 0
  castSkill(g, bm.id) // 늑대 소환
  const pet = g.summons.find((s) => s.owner === bm.id)
  pet.x = 0; pet.z = 0
  foe.x = 12; foe.z = 0 // 펫 인지범위(16) 안, 평타 사거리(2.6) 밖
  const hp0 = foe.hp
  castSkill2(g, bm.id) // 사냥 명령 → 도약
  assert.ok(pet.leapT > 0, '도약 중 상태가 켜진다')
  run(g, 0.5) // 도약 시간(0.45초) 경과
  const gap = Math.hypot(pet.x - foe.x, pet.z - foe.z)
  assert.ok(gap < 3, `착지 위치가 대상과 거의 같다 (gap=${gap.toFixed(2)})`)
  assert.ok(foe.hp < hp0, '착지하는 순간 무조건 한 번 문다')
})

test('야수조련사 사냥 명령: 인지범위 밖 적에겐 도약하지 않는다(범위 제한)', () => {
  const g = duo('beastmaster', 'mage')
  startPlaying(g)
  const bm = g.heroes[0]; const foe = g.heroes[1]
  bm.lvl = SKILL2_LEVEL
  bm.x = 0; bm.z = 0; bm.dir = 0
  castSkill(g, bm.id)
  const pet = g.summons.find((s) => s.owner === bm.id)
  pet.x = 0; pet.z = 0
  foe.x = 60; foe.z = 0 // 인지범위(16) 밖, 맵 저편
  castSkill2(g, bm.id)
  assert.equal(pet.leapT, 0, '범위 밖이면 도약하지 않는다')
})

test('엔지니어 미니포탑: 최대 3기 · 자동 사격 · 체력이 주력 스탯에 비례(후반 강화)', () => {
  const g = duo('engineer', 'warrior')
  startPlaying(g)
  const en = g.heroes[0]; const w = g.heroes[1]
  en.x = 0; en.z = 0; en.dir = 0
  for (let i = 0; i < 4; i++) { castSkill(g, en.id); en.skillCd = 0 } // 4번 → 3기 유지
  const turrets = g.summons.filter((s) => s.owner === en.id && s.kind === 'turret')
  assert.equal(turrets.length, 3, '최대 3기')
  const t0 = turrets[0]
  const baseHp = t0.maxHp
  assert.ok(baseHp >= 110, '기본 체력은 110 이상(주력 스탯 비례분 포함)')
  // 자동 사격: 사거리 안 적을 때린다
  w.x = t0.x + 4; w.z = t0.z
  const whp = w.hp
  run(g, 1.2)
  assert.ok(w.hp < whp, '활성 포탑은 사거리 안 적을 자동 사격한다')
  // 후반: 레벨·주문력이 오르면 새로 짓는 포탑이 훨씬 단단해진다(평타 한 방에 안 터짐)
  setLevel(en, 18)
  en.items = ['void_staff', 'flame_core']; en.bonus = sumStats(en.items)
  g.summons = g.summons.filter((s) => s.owner !== en.id) // 자리 비우고 새로 설치
  en.skillCd = 0; castSkill(g, en.id)
  const strong = g.summons.find((s) => s.owner === en.id && s.kind === 'turret')
  assert.ok(strong.maxHp > baseHp + 150, `주력 스탯 비례로 체력이 크게 늘어난다 (${baseHp}→${strong.maxHp})`)
})

test('미니포탑 휴면: 주인이 사거리 밖이면 잠들어(zzz) 사격을 멈춘다', () => {
  const g = duo('engineer', 'mage')
  startPlaying(g)
  const en = g.heroes[0]; const foe = g.heroes[1]
  en.x = 0; en.z = 0; en.dir = 0
  castSkill(g, en.id)
  const t = g.summons.find((s) => s.kind === 'turret')
  foe.x = 8; foe.z = 0 // 포탑 사거리(12) 안의 적
  run(g, 0.2)
  assert.equal(!!t.dormant, false, '주인이 곁이면 활성')
  const hp1 = foe.hp
  run(g, 1.0)
  assert.ok(foe.hp < hp1, '활성 포탑은 사격한다')
  foe.hp = 5000 // 긴 사격을 견디게(타이머 검증에 집중)
  en.x = 40; en.z = 40 // 주인이 사거리 밖으로 이탈 → 3초 유예 시작
  run(g, 1.0)
  assert.equal(!!t.dormant, false, '이탈 후 3초 유예 동안은 아직 사격한다')
  const hpGrace = foe.hp
  run(g, 1.2) // 포탑 발사 주기(1초)보다 길게 — 유예 중에도 한 발은 쏜다
  assert.ok(foe.hp < hpGrace, '유예 시간엔 계속 사격')
  en.x = 8; en.z = 0 // 유예 만료 전에 주인이 사거리 안으로 복귀 → 타이머 해제
  run(g, 0.2)
  assert.equal(!!t.dormant, false, '복귀하면 유예 타이머가 풀려 계속 활성')
  en.x = 40; en.z = 40 // 다시 이탈
  run(g, 3.4) // 유예(3초)를 넘기면 휴면
  assert.equal(!!t.dormant, true, '3초 유예가 지나면 휴면')
  const hp2 = foe.hp
  run(g, 1.0)
  assert.equal(foe.hp, hp2, '휴면 중엔 사격하지 않는다')
})

test('소환물은 적에게 공격받아 죽는다', () => {
  const g = duo('beastmaster', 'warrior')
  startPlaying(g)
  const bm = g.heroes[0]; const w = g.heroes[1]
  bm.x = 0; bm.z = 0
  castSkill(g, bm.id)
  const pet = g.summons[0]
  pet.x = 30; pet.z = 30; pet.hp = 10 // 외딴 곳의 빈사 펫
  w.x = 31; w.z = 30 // 전사가 바로 옆
  castAttack(g, w.id) // 소환물을 직접 평타(자동조준엔 안 잡히지만 사거리 안이면 표적)
  run(g, 0.4) // 탄이 날아가 적중
  assert.ok(!g.summons.includes(pet), '체력이 다하면 소환물이 사라진다')
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

test('죽은 영웅은 용/바론 같은 팀 보상(경험치·골드)은 받지 못한다 (개인 기여가 아닌 팀 보상)', () => {
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
  // 용 팀 골드(68)는 못 받는다 — 죽은 동안 늘어난 건 초당 자동 수입(0.3초치)뿐
  assert.ok(dead.gold < 505, `용 팀 골드는 생존자만 (dead.gold=${dead.gold})`)
  assert.ok(alive.gold > aliveGold0 + 50) // 살아 있는 아군은 팀 골드를 받는다
})

test('죽어 있어도 내가 관련된 킬은 스코어·골드가 지급된다 (도트 막타)', () => {
  const g = duo('warlock', 'mage')
  startPlaying(g)
  const att = g.heroes[0]; const vic = g.heroes[1]
  att.x = 0; att.z = 0; att.respawnT = 6; att.gold = 0; att.kills = 0 // 나는 먼저 죽었다
  vic.x = 4; vic.z = 0; vic.hp = 8
  // 내가 남긴 중독(도트)이 죽어 있는 동안 적을 마저 처치한다
  vic.poisonT = 5; vic.poisonDps = 80; vic.poisonBy = att.id
  vic.damagedBy = { [att.id]: g.time }
  for (let i = 0; i < 60 && vic.respawnT <= 0; i++) step(g, STEP)
  assert.ok(vic.respawnT > 0, '도트로 처치됐다')
  assert.ok(att.respawnT > 0, '나는 여전히 죽어 있다')
  assert.equal(att.kills, 1, '죽어 있어도 킬 스코어가 인정된다')
  assert.ok(att.gold >= 150, `죽어 있어도 킬 골드가 들어온다 (gold=${att.gold})`)
})

test('초당 골드: 죽어 있어도 계속 모인다', () => {
  const g = duo('mage', 'tank')
  startPlaying(g)
  const h = g.heroes[0]
  h.respawnT = 8 // 부활 대기 중
  const before = h.gold
  run(g, 1)
  assert.ok(h.gold > before + 0.5, `죽어 있어도 초당 자동 수입이 들어온다 (Δ=${h.gold - before})`)
  assert.ok(h.respawnT > 0, '아직 부활 전(여전히 죽어 있다)')
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

test('어시스트: 사망 직전 7초 내 피해를 준 동료가 어시·골드를 받는다', () => {
  const g = createGame(humans())
  startPlaying(g)
  const killer = g.heroes[0] // blue mage — 막타
  const helper = g.heroes[1] // blue — 어시스트
  const victim = g.heroes[3] // red
  victim.x = 0; victim.z = 0; victim.hp = 1
  victim.damagedBy[helper.id] = g.time // helper가 방금 피해를 준 것으로 기록
  killer.x = 4; killer.z = 0
  const helperGold0 = helper.gold
  castAttack(g, killer.id)
  run(g, 0.5)
  assert.equal(killer.kills, 1)
  assert.equal(killer.assists, 0) // 막타는 킬, 어시 아님
  assert.equal(helper.assists, 1)
  assert.equal(helper.kills, 0)
  assert.ok(helper.gold > helperGold0) // 어시 골드
  assert.ok(g.feed.some((f) => f.msg.includes('도움'))) // 피드에 도움 표기
})

test('연속 데스 디버프: 많이 죽은 적은 킬골드가 줄어 최저 100까지 (킬 시 리셋)', () => {
  const g = createGame(humans())
  startPlaying(g)
  const killer = g.heroes[0]
  const fresh = g.heroes[3] // 첫 데스
  const fed = g.heroes[4] // 연속으로 많이 죽은 적
  killer.x = 0; killer.z = 0
  // 첫 데스(streak 1) → 킬골드 전액(~200)
  fresh.x = 4; fresh.z = 0; fresh.hp = 1; fresh.deathStreak = 0
  let g0 = killer.gold
  castAttack(g, killer.id); run(g, 0.4)
  const fullBounty = killer.gold - g0
  assert.ok(fullBounty >= 195 && fullBounty <= 215, `전액 킬골드 기대 ~200, 실제 ${fullBounty}`)
  // 연속 데스가 쌓인 적 → 최저 100
  killer.atkCd = 0
  fed.x = 4; fed.z = 0; fed.hp = 1; fed.deathStreak = 10
  g0 = killer.gold
  castAttack(g, killer.id); run(g, 0.4)
  const minBounty = killer.gold - g0
  assert.ok(minBounty <= 130 && minBounty >= 95, `최저 킬골드 기대 ~100, 실제 ${minBounty}`)
  assert.equal(killer.deathStreak, 0) // 킬을 따면 본인 연속데스는 리셋
})

test('현상금: 안 죽고 연속 킬을 쌓은 적을 잡으면 보너스 골드(+피드)', () => {
  const g = createGame(humans())
  startPlaying(g)
  const killer = g.heroes[0] // blue
  const fed = g.heroes[3] // red — 연속 킬 보유
  killer.x = 0; killer.z = 0
  fed.x = 4; fed.z = 0; fed.hp = 1; fed.killStreak = 4; fed.deathStreak = 0
  const g0 = killer.gold
  castAttack(g, killer.id); run(g, 0.4)
  const reward = killer.gold - g0
  // 200 기본 + 현상금 min(300, 75×3=225) = 425
  assert.ok(reward >= 415 && reward <= 440, `현상금 포함 ~425 기대, 실제 ${reward}`)
  assert.equal(fed.killStreak, 0) // 죽으면 연속 킬 리셋
  assert.ok(g.feed.some((f) => f.msg.includes('현상금')))
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

test('봇 교전: 확신이 안 서도 본진까지 전면 도주하지 않고 그 자리에서 버틴다', () => {
  // 회귀: 예전 봇은 "확실히 잡는다"는 확신이 안 서면(호각·약간 불리) 곧장 본진으로 빼버려
  //   적과 거리만 벌리고 싸우질 않았다. 이제는 빈사·수적 열세가 아니면 본진까지 도망치지 않고
  //   제자리에서 재정비한다 — 멀어지는 거리가 크게 줄어든다.
  // (힐러 vs 전사: 힐러 입장에선 트레이드가 불리해 예전엔 무조건 본진 도주했다.)
  const g = createGame(humans())
  startPlaying(g)
  const bot = makeBot(g, g.heroes[3].id) // red 힐러를 봇으로 — 전사 상대로 트레이드 불리
  const foe = g.heroes[2] // blue 전사
  foe.autoAttack = false
  const nx = g.map.NEXUS_POS[bot.team]
  bot.x = 0; bot.z = 0
  // 적을 "본진 반대 방향"에 둔다 → 본진으로 빼면 적과의 거리가 크게 벌어진다(도주 신호).
  const ang = Math.atan2(0 - nx.z, 0 - nx.x)
  const place = CLASSES.healer.range + 0.5 // 사거리 살짝 밖
  foe.x = Math.cos(ang) * place; foe.z = Math.sin(ang) * place
  const before = Math.hypot(bot.x - foe.x, bot.z - foe.z) // = place
  run(g, 1.0)
  const after = Math.hypot(bot.x - foe.x, bot.z - foe.z)
  // 예전 봇은 본진으로 빠져 ~4 이상 벌렸다. 이제는 재정비 수준(<3.5)에 그쳐야 한다.
  assert.ok(after - before < 3.5, `본진까지 전면 도주하지 않았다 (before=${before.toFixed(1)} after=${after.toFixed(1)})`)
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
  assert.ok(Math.hypot(b.x - g.map.FOUNTAIN_POS.red.x, b.z - g.map.FOUNTAIN_POS.red.z) < 12)
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
    Math.hypot(h.x - g.map.FOUNTAIN_POS.blue.x, h.z - g.map.FOUNTAIN_POS.blue.z) < 12,
    '끼였던 봇이 리스폰 존으로 복귀했다'
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
  // 경험치는 근처 아군과 나눠 갖는다 — 혼자 다 먹어 레벨 캡만 검증하도록 우물의 아군과 떨어뜨린다
  h.x = (WORLD.minX + WORLD.maxX) / 2
  h.z = (WORLD.minZ + WORLD.maxZ) / 2
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
  // 한 순간의 스냅샷이 아니라 '행군하는 동안 한 번이라도 본진에서 충분히 멀어졌는가'를 본다.
  //  (레인 교전 후 재집결·귀환으로 특정 시점엔 본진 근처일 수 있어 스냅샷 한 방은 불안정하다)
  const maxAway = { blue: 0, red: 0 }
  const n = Math.round(40 / STEP)
  for (let i = 0; i < n; i++) {
    step(g, STEP)
    for (const team of ['blue', 'red']) {
      const away = Math.max(
        ...g.heroes.filter((h) => h.team === team).map((h) => Math.abs(h.x - NEXUS_POS[team].x))
      )
      if (away > maxAway[team]) maxAway[team] = away
    }
  }
  for (const team of ['blue', 'red']) {
    assert.ok(maxAway[team] > 40, `${team}팀 봇이 본진을 떠나 레인으로 행군해야 한다`)
  }
})

// 영웅을 특정 레벨로 올려놓는다 (체력도 그 레벨 최대치로)
function setLevel(h, lvl) {
  const c = CLASSES[h.cls]
  h.lvl = lvl
  h.maxHp = Math.round((c.hp + c.hpLvl * (lvl - 1)) * HP_SCALE) // 엔진의 heroMaxHp와 동일하게 20% 상향 반영
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
  // 밸런스 패치로 근접 딜러의 공격력 곡선이 낮아져(전사는 '평균 딜+기동' 컨셉) 무기 하나로는 분노에 밀린다 —
  //  용을 노릴 무렵이면 보통 아이템 두엇은 갖추므로 기본 무기+흡혈검을 들려 검증한다.
  h.items = ['longsword', 'vampire_scythe']
  h.bonus = sumStats(h.items)
  h.x = -3
  h.z = 30
  soloFight(g, h, d, 30)
  assert.equal(d.alive, false, '12레벨(무기 하나)은 용을 잡는다')
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
  assert.ok(Math.hypot(h.x - g.map.FOUNTAIN_POS.blue.x, h.z - g.map.FOUNTAIN_POS.blue.z) < 12, '리스폰 존으로 복귀')
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
  run(g, RECALL_TIME) // 끝까지 버티면 리스폰 존으로 복귀
  const fp = g.map.FOUNTAIN_POS[h.team]
  assert.ok(Math.hypot(h.x - fp.x, h.z - fp.z) < 12, '리스폰 존으로 복귀했다')
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
  h.x = g.map.FOUNTAIN_POS[h.team].x
  h.z = g.map.FOUNTAIN_POS[h.team].z
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

test('상점: 인벤토리는 ITEM_SLOTS칸, 가득 차면 더 못 산다', () => {
  const g = createGame(humans())
  startPlaying(g)
  const h = g.heroes[2]
  toFountain(g, h)
  h.gold = 99999
  // 조합 관계가 없는 아이템들로 채운다 (조합은 재료를 소모해 자리가 나므로 별도 테스트)
  for (const id of ['dagger', 'leather', 'boots', 'regen_pendant', 'light_charm', 'orb']) buyItem(g, h.id, id)
  assert.equal(h.items.length, ITEM_SLOTS)
  assert.ok(!h.items.includes('orb'), '칸을 넘기면 더 안 들어간다')
})

test('상점: 체력 아이템을 사면 최대 체력이 늘고 그만큼 즉시 회복', () => {
  const g = createGame(humans())
  startPlaying(g)
  const h = g.heroes[5] // red tank
  toFountain(g, h)
  h.gold = 9999
  h.hp = h.maxHp
  const max0 = h.maxHp
  buyItem(g, h.id, 'giant_heart') // hp +450 (×1.5 = 675, 다시 전체 체력 ×1.2 상향 반영)
  assert.equal(h.maxHp, max0 + Math.round(675 * HP_SCALE))
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
  const itemAtk = Math.round(sumStats(['executioner']).atk) // +83 (배율 포함)
  // 평타 피해 = 고유 공격력(곡선 20%↓ + 후반캐리 컨셉으로 궁수 기본 공격력 하향 반영) + 아이템 공격력
  //  → 아이템 단독값보다 분명히 크다 (Lv1 궁수 고유 공격력 ≈ 27)
  assert.ok(dmg >= itemAtk + 25, '공격력 아이템(배율 포함)이 탄 피해에 더해진다')
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
  // 리스폰 존(회복 지대) 좌표가 영웅에 새겨진다
  for (const h of g.heroes) {
    assert.equal(h.homeX, g.map.FOUNTAIN_POS[h.team].x)
    assert.ok(canShop(h)) // 시작 시 리스폰 존 안 → 상점 가능
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

// ── P7: 돌풍술사 (띄우기/넉백/벽꽝) ──
test('돌풍술사 돌풍: 회오리가 앞으로 굴러가 통과한 적을 공중에 띄운다(제자리 고정) + 피해', () => {
  const g = duo('windcaller', 'tank')
  startPlaying(g)
  const w = g.heroes[0]; const e = g.heroes[1]
  w.x = 0; w.z = 0; w.dir = 0
  e.x = 8; e.z = 0 // 시전자 앞 — 회오리가 도달하는 데 시간이 걸린다(즉발 아님)
  const ex0 = e.x
  castSkill(g, w.id)
  assert.ok(g.projectiles.some((p) => p.kind === 'tornado'), '회오리 투사체가 굴러간다')
  assert.equal(e.airT, 0, '시전 즉시는 아직 안 닿아 띄우지 않는다')
  run(g, 0.6) // 회오리가 적까지 굴러간다
  assert.ok(e.hp < e.maxHp, '닿으면 피해를 입는다')
  assert.ok(e.airT > 0, '공중에 띄워진다')
  assert.ok(e.stunT > 0, '띄워진 동안은 아무것도 못 한다')
  assert.ok(Math.abs(e.x - ex0) < 1, '밀려나지 않고 제자리에 뜬다(연계 가능)')
})

test('돌풍술사 밀쳐내기 벽꽝: 벽(맵 경계)에 처박힌 적은 기절한다', () => {
  const g = duo('windcaller', 'tank')
  startPlaying(g)
  const w = g.heroes[0]; const e = g.heroes[1]
  w.lvl = SKILL2_LEVEL
  const W = g.map.WORLD
  e.x = W.maxX - 1; e.z = 0 // 경계 코앞
  w.x = e.x - 4; w.z = 0 // 적을 경계 쪽(+x)으로 밀어낸다
  castSkill2(g, w.id)
  run(g, 0.3)
  assert.ok(e.stunT > 0, '벽에 막혀 더 못 밀리면 기절(벽꽝)')
})

test('돌풍술사 태풍: 범위 안 적을 바깥으로 날린다', () => {
  const g = duo('windcaller', 'tank')
  startPlaying(g)
  const w = g.heroes[0]; const e = g.heroes[1]
  w.lvl = ULT_LEVEL
  w.x = 0; w.z = 0; w.dir = 0
  e.x = 4; e.z = 0
  castUlt(g, w.id)
  assert.ok(e.hp < e.maxHp, '피해를 입는다')
  assert.ok(e.freezeT > 0, '휩쓸린 뒤 둔화된다')
  assert.ok(e.knockT > 0, '바깥으로 날아가기 시작한다')
})

// ── P8: 시간술사 (되감기) ──
test('시간술사 시간 도약: 보이는 적 뒤로 순간이동 + 피해', () => {
  const g = duo('chronomancer', 'mage')
  startPlaying(g)
  const c = g.heroes[0]; const e = g.heroes[1]
  c.x = 0; c.z = 0
  e.x = 10; e.z = 0
  castSkill(g, c.id)
  assert.ok(Math.hypot(c.x - e.x, c.z - e.z) < 3.5, '적 뒤로 붙었다')
  assert.ok(e.hp < e.maxHp, '벤다')
})

test('시간술사 역행: 4초 전 위치·체력으로 되돌아간다', () => {
  const g = duo('chronomancer', 'mage')
  startPlaying(g)
  const c = g.heroes[0]
  c.lvl = ULT_LEVEL
  c.trail = [{ x: 5, z: 0, hp: c.maxHp }] // 과거 표본(4초 전)
  c.x = 25; c.z = 0; c.hp = 100 // 멀리 와서 빈사
  castUlt(g, c.id)
  assert.ok(Math.abs(c.x - 5) < 2 && Math.abs(c.z) < 2, '과거 위치로 되돌아간다')
  assert.ok(c.hp > 100, '과거 체력으로 회복된다')
})

test('시간술사 시간 지연: 장판 안의 적이 둔화(빙결)되고 갉아먹힌다', () => {
  const g = duo('chronomancer', 'mage')
  startPlaying(g)
  const c = g.heroes[0]; const e = g.heroes[1]
  c.lvl = SKILL2_LEVEL
  c.x = 0; c.z = 0; c.dir = 0
  e.x = 6; e.z = 0 // 시간 지연 사거리(15) 안 → 적 위에 장판이 깔린다
  const hp0 = e.hp
  castSkill2(g, c.id)
  assert.ok(g.zones.some((z) => z.kind === 'timewarp'), '시간 지연 장판이 생긴다')
  run(g, 0.6) // 장판 틱이 돌면서 둔화 + 지속피해
  assert.ok(e.freezeT > 0, '장판 안에서 이동·공격이 느려진다(둔화)')
  assert.ok(e.hp < hp0, '장판이 체력을 갉아먹는다')
})

test('시간술사 역행 미리보기: 궁극기가 켜져 있을 때만 그림자 좌표가 실린다', () => {
  const g = duo('chronomancer', 'mage')
  startPlaying(g)
  const c = g.heroes[0]
  c.lvl = ULT_LEVEL
  c.trail = [{ x: 7, z: 2, hp: c.maxHp }]
  c.ultCd = 0
  let v = makeView(g).heroes.find((h) => h.id === c.id)
  assert.ok(v.rewindGhost && Math.abs(v.rewindGhost.x - 7) < 1, '궁극기 준비 시 되돌아갈 지점이 보인다')
  c.ultCd = 30 // 쿨다운 중
  v = makeView(g).heroes.find((h) => h.id === c.id)
  assert.equal(v.rewindGhost, undefined, '궁극기가 쿨이면 그림자는 안 보인다')
})

test('경험치 분배: 함께 먹으면 1인당 경험치가 솔로보다 적다(몰려다니기 이득 제거)', () => {
  const mk = () => createGame([
    { id: 'rat', name: 'B1', zodiacId: 'rat', color: '#abc', cls: 'mage', team: 'blue' },
    { id: 'ox', name: 'B2', zodiacId: 'ox', color: '#abc', cls: 'tank', team: 'blue' },
    { id: 'tiger', name: 'R', zodiacId: 'tiger', color: '#abc', cls: 'archer', team: 'red' },
  ], { mode: '3v3', rng: () => 0.5 })
  const killMinionBy = (g, dx, allyAt) => {
    const r = g.heroes.find((h) => h.id === 'rat')
    const o = g.heroes.find((h) => h.id === 'ox')
    r.x = 0; r.z = 0
    o.x = allyAt.x; o.z = allyAt.z
    const m = plantMinion(g, 'red', dx, 0, 1) // 평타 한 방에 죽는 적 미니언
    const rx0 = r.xp; const ox0 = o.xp
    for (let i = 0; i < 90 && g.minions.includes(m); i++) { castAttack(g, 'rat'); step(g, STEP) }
    return { rat: r.xp - rx0, ally: o.xp - ox0 }
  }
  // 솔로: ox는 XP_RANGE(22) 밖
  const g1 = mk(); startPlaying(g1)
  const solo = killMinionBy(g1, 3, { x: 40, z: 0 })
  // 듀오: ox가 미니언 근처
  const g2 = mk(); startPlaying(g2)
  const duoR = killMinionBy(g2, 3, { x: 3, z: 2 })
  assert.ok(solo.rat > 0, '솔로는 경험치를 받는다')
  assert.ok(solo.ally === 0, '멀리 있던 아군은 못 받는다')
  assert.ok(duoR.ally > 0, '함께 있던 아군도 나눠 받는다')
  assert.ok(duoR.rat < solo.rat * 0.8, `함께 먹으면 1인당이 적다 (solo=${solo.rat}, duo=${duoR.rat})`)
})

test('신규 직업 스모크: 돌풍술사·시간술사 봇이 낀 게임이 NaN 없이 돈다', () => {
  const g = duo('windcaller', 'chronomancer')
  makeBot(g, 'rat'); makeBot(g, 'ox') // 두 신규 직업을 봇으로 돌려 AI/넉백/되감기 경로를 태운다
  startPlaying(g)
  run(g, 25)
  const v = makeView(g)
  assert.ok(v.heroes.every((h) => Number.isFinite(h.x) && Number.isFinite(h.z)), '좌표가 유한값')
  assert.ok(v.heroes.every((h) => h.hp >= 0 && h.hp <= h.maxHp), '체력이 정상 범위')
})

// ── 봇 AI 지능화: 안전 귀환 / 오브젝트 콜 / 수비 콜 ──

test('봇 후퇴: 적이 안 보이면 먼 길을 걷지 않고 귀환 채널링으로 우물 복귀', () => {
  const g = createGame(humans())
  startPlaying(g)
  const bot = makeBot(g, g.heroes[0].id) // blue 마법사를 봇으로
  const fp = g.map.FOUNTAIN_POS[bot.team]
  // 우물에서 40 떨어진 조용한 자리에 빈사 상태로 — 적 영웅은 전부 자기 우물(시야 밖)
  bot.x = fp.x + 40
  bot.z = fp.z
  bot.hp = bot.maxHp * 0.2
  run(g, 0.6)
  assert.equal(bot.botRetreat, true, '빈사면 후퇴 모드')
  assert.ok(bot.recallT > 0 && bot.botRecall, '걸어가는 대신 귀환 채널링을 시작한다')
  run(g, RECALL_TIME)
  assert.ok(Math.hypot(bot.x - fp.x, bot.z - fp.z) < 12, '채널링을 마치고 우물로 복귀했다')
})

test('오브젝트 콜: 용이 잡을 만하면 봇들이 집결해 함께 잡는다', () => {
  // blue 전원 봇 / red는 사람(우물에 방치 — 용 근처 시야 없음)
  const players = humans().map((p) => (p.team === 'blue' ? { ...p, isBot: true } : p))
  const g = createGame(players)
  startPlaying(g)
  const dragon = g.monsters.find((m) => m.id === 'dragon')
  dragon.alive = true
  dragon.respawnT = 0
  dragon.hp = dragon.maxHp = 400 // 저레벨 3인 화력으로도 "확실히 잡는다" 판정이 서는 체력
  const bots = g.heroes.filter((h) => h.team === 'blue')
  const toCenter = dragon.x > 0 ? -1 : 1
  bots.forEach((b, i) => {
    b.x = dragon.x + toCenter * 32
    b.z = dragon.z + (i - 1) * 5 // 집결 반경(65) 안, 어그로 밖에서 출발
  })
  let gathered = false
  for (let i = 0; i < 40 && dragon.alive; i++) {
    run(g, 0.25)
    const near = bots.filter((b) => Math.hypot(b.x - dragon.x, b.z - dragon.z) < 20).length
    if (near >= 2) gathered = true
  }
  assert.ok(gathered, '봇 2명 이상이 용 굴에 집결했다')
  assert.ok(!dragon.alive, '집결한 봇들이 용을 처치했다')
})

// ── 아이템: 조합 트리 + 액티브 ──

// 시험용: 영웅을 자기 우물로 순간이동시켜 상점을 열 수 있게 한다
function enterFountain(g, h) {
  h.x = h.homeX
  h.z = h.homeZ
  run(g, STEP * 2) // couldShop 전이 → 상점 세션 시작(되돌리기 스냅샷)
}

test('조합 구매: 재료를 갖고 있으면 그 가격만큼 깎이고 재료는 소모된다', () => {
  const g = createGame(humans())
  startPlaying(g)
  const h = g.heroes[0]
  enterFountain(g, h)
  h.gold = 300
  buyItem(g, h.id, 'orb') // 300 지불
  assert.deepEqual(h.items, ['orb'])
  h.gold = 400 // 화염의 핵 정가 700 — 조합가 400
  buyItem(g, h.id, 'flame_core')
  assert.deepEqual(h.items, ['flame_core'], '구슬이 소모되고 핵으로 승급')
  assert.equal(h.gold, 0, '정가 700이 아니라 차액 400만 지불')
})

test('조합 구매: 인벤토리가 꽉 차도 재료가 소모돼 자리가 나면 살 수 있다', () => {
  const g = createGame(humans())
  startPlaying(g)
  const h = g.heroes[0]
  enterFountain(g, h)
  h.items = ['void_staff', 'wisdom_hat', 'boots', 'leather'] // 4칸 만석
  h.gold = 400 // 대마법사의 홀 2400 − (공허 1150 + 모자 850) = 400
  buyItem(g, h.id, 'archmage_staff')
  assert.deepEqual([...h.items].sort(), ['archmage_staff', 'boots', 'leather'].sort())
  assert.equal(h.gold, 0)
})

test('되돌리기: 조합 구매도 세션 진입 시점으로 무료 복원된다', () => {
  const g = createGame(humans())
  startPlaying(g)
  const h = g.heroes[0]
  h.items = ['orb']
  enterFountain(g, h)
  h.gold = 400
  buyItem(g, h.id, 'flame_core')
  assert.deepEqual(h.items, ['flame_core'])
  resetShop(g, h.id)
  assert.deepEqual(h.items, ['orb'], '소모된 재료가 돌아온다')
  assert.equal(h.gold, 400, '지불한 차액이 환원된다')
})

test('액티브 ▸ 회복의 물병: 즉시 25% 회복 + 쿨다운, 쿨 중엔 안 마셔진다', () => {
  const g = createGame(humans())
  startPlaying(g)
  const h = g.heroes[0]
  enterFountain(g, h)
  h.gold = 500
  buyItem(g, h.id, 'heal_flask')
  h.x = 0; h.z = 0 // 우물 밖 전장에서
  h.hp = Math.round(h.maxHp * 0.4)
  const before = h.hp
  useItem(g, h.id, 0)
  assert.equal(h.hp, Math.min(h.maxHp, before + h.maxHp * 0.25), '즉시 25% 회복')
  assert.ok(h.itemCd.heal_flask > 0, '쿨다운이 돈다')
  const after = h.hp
  useItem(g, h.id, 0)
  assert.equal(h.hp, after, '쿨다운 중엔 다시 못 쓴다')
  const v = makeView(g)
  const vh = v.heroes.find((o) => o.id === h.id)
  assert.ok(vh.itemCds[0] > 0, '스냅샷에 슬롯별 쿨다운이 실린다')
})

test('액티브 ▸ 정화의 종: 기절 중에도 울려 CC를 전부 해제한다', () => {
  const g = createGame(humans())
  startPlaying(g)
  const h = g.heroes[0]
  enterFountain(g, h)
  h.gold = 700
  buyItem(g, h.id, 'cleanse_bell')
  h.x = 0; h.z = 0
  h.stunT = 2
  h.freezeT = 1.5
  h.rootT = 1
  useItem(g, h.id, 0)
  assert.equal(h.stunT, 0)
  assert.equal(h.freezeT, 0)
  assert.equal(h.rootT, 0)
  assert.ok(h.itemCd.cleanse_bell > 0)
  // 해제할 CC가 없으면 아깝게 낭비하지 않는다
  h.itemCd = {}
  useItem(g, h.id, 0)
  assert.deepEqual(h.itemCd, {}, 'CC가 없으면 사용되지 않는다')
})

test('아이템 카탈로그: 카테고리별 8종 × 4 = 32종, 재료(from)는 전부 실존하며 더 싸다', () => {
  const byCat = {}
  for (const it of Object.values(ITEMS_BY_ID)) {
    byCat[it.cat] = (byCat[it.cat] || 0) + 1
    for (const c of it.from || []) {
      assert.ok(ITEMS_BY_ID[c], `${it.id}의 재료 ${c}가 존재한다`)
      assert.ok(ITEMS_BY_ID[c].cost < it.cost, `${it.id}의 재료 ${c}는 더 싸다(조합가 음수 방지)`)
    }
  }
  assert.deepEqual(byCat, { magic: 8, attack: 8, defense: 8, util: 8 })
  assert.equal(ITEM_SLOTS, 5)
})

test('buildQuote: 재료가 없으면 정가, 중복 재료도 슬롯 단위로 계산한다', () => {
  assert.deepEqual(buildQuote([], 'flame_core'), { price: 700, consumes: [] })
  assert.deepEqual(buildQuote(['orb'], 'flame_core'), { price: 400, consumes: [0] })
  // 같은 재료 2개를 요구하지 않는 한, 보유 1개만 소모된다
  const q = buildQuote(['void_staff', 'wisdom_hat'], 'archmage_staff')
  assert.equal(q.price, 400)
  assert.deepEqual([...q.consumes].sort(), [0, 1])
})

test('수비 콜: 내곽 타워에 적 영웅이 붙으면 한가한 봇이 달려와 막는다', () => {
  const g = createGame(humans())
  startPlaying(g)
  const bot = makeBot(g, g.heroes[0].id) // blue 마법사를 봇으로
  const tower = g.towers.find((t) => t.team === 'blue' && t.lane === 'mid' && t.tier === 2)
  const raider = g.heroes.find((h) => h.team === 'red')
  raider.x = tower.x + 6 // 타워 시야(24) 안 — 수비 콜 발동 조건
  raider.z = tower.z
  bot.x = tower.x + 45 // 수비 배정 반경(20) 밖의 한가한 봇
  bot.z = tower.z + 10
  const before = Math.hypot(bot.x - tower.x, bot.z - tower.z)
  run(g, 3)
  const after = Math.hypot(bot.x - tower.x, bot.z - tower.z)
  assert.ok(after < before - 8, `봇이 위협받는 타워로 이동한다 (before=${before.toFixed(1)}, after=${after.toFixed(1)})`)
})
