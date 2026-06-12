// 파티 리프트 순수 게임 로직 (호스트 권위) — 3:3 AOS.
//  - 이동(조이스틱) + 버튼 3개: 기본공격 / 스킬 / 궁극기.
//  - 레벨 최대 10, 미니언·정글·용·바론으로 성장, 넥서스가 터지면 끝.
//  - 호스트가 step()을 60Hz로 돌리고 makeView() 스냅샷을 전파한다.
import {
  WORLD, NEXUS_POS, FOUNTAIN_RADIUS, LANES, TOWER_SPOTS, WOLF_CAMPS,
  DRAGON_PIT, BARON_PIT, enemyOf, nearestWp, resolveTerrain,
} from './map.js'
import { getZodiac } from '../../shared/zodiac.js'

export const STEP = 1 / 60
export const COUNTDOWN_TIME = 3
export const TIME_LIMIT = 600 // 10분 — 넥서스가 안 터지면 점수로 판정
export const MAX_LEVEL = 10
export const ULT_LEVEL = 3 // 궁극기가 열리는 레벨
export const TEAM_SIZE = 3

// ── 영웅 ──
const HERO_RADIUS = 1.3
const HERO_SPEED = 13 // m/s
const ATK_RANGE = 9
const ATK_CD = 0.8
const BOLT_SPEED = 38
const BASE_HP = 520
const HP_PER_LVL = 60
const BASE_ATK = 52
const ATK_PER_LVL = 8
// 스킬: 바라보는 방향으로 날아가 첫 적에게 폭발 (근처 적 휩쓸기)
const SKILL_CD = 5
const SKILL_RANGE = 24
const SKILL_SPEED = 30
const SKILL_AOE = 4
const skillDmg = (lvl) => 70 + 14 * (lvl - 1)
// 궁극기: 내 주변 폭발 — 큰 피해 + 잠깐 스턴
const ULT_CD = 45
export const ULT_RADIUS = 11
const ULT_STUN = 1.2
const ultDmg = (lvl) => 140 + 22 * (lvl - 1)

const REGEN_DELAY = 5 // 전투 이탈 후 자연 회복까지 (초)
const REGEN_RATE = 0.015 // 초당 최대 HP 비율
const FOUNTAIN_HEAL = 0.12
const FOUNTAIN_DMG = 90 // 적 우물에 들어가면 따끔!
const XP_RANGE = 22 // 처치 경험치를 나눠 받는 거리

// ── 미니언 ──
const WAVE_PERIOD = 28
const FIRST_WAVE = 2
const MINION_SPEED = 6.5
const MINION_SIGHT = 11
const MELEE = { hp: 150, dmg: 14, range: 2.4, cd: 1.1 }
const RANGED = { hp: 110, dmg: 11, range: 8, cd: 1.4 }
const MINION_HP_GROWTH = 8 // 분당 체력 증가
const MINION_XP = 28

// ── 타워/넥서스 ──
const TOWER_HP = [0, 900, 1100] // tier 1(외곽) / 2(내곽)
const TOWER_RANGE = 13
const TOWER_CD = 1.2
const TOWER_DMG_HERO = 85
const TOWER_DMG_MINION = 60
const TOWER_XP = 90
const NEXUS_HP = 1700

// ── 정글 ──
const WOLF = { hp: 260, dmg: 18, range: 2.6, cd: 1.2, speed: 7, xp: 70, respawn: 45 }
const DRAGON = { hp: 850, dmg: 26, range: 4, cd: 1.4, speed: 6, xp: 110, spawn: 60, respawn: 100 }
const BARON = { hp: 1500, dmg: 42, range: 5, cd: 1.5, speed: 5, xp: 150, spawn: 210, respawn: 120 }
const CAMP_LEASH = 24 // 캠프에서 이만큼 멀어지면 포기하고 복귀(회복)
export const DRAGON_BUFF_T = 60 // 용 버프: 공격력 +25%
export const BARON_BUFF_T = 75 // 바론 버프: 공격력 +40% + 빠른 회복

const heroMaxHp = (lvl) => BASE_HP + HP_PER_LVL * (lvl - 1)
const heroAtk = (lvl) => BASE_ATK + ATK_PER_LVL * (lvl - 1)
export const xpNeed = (lvl) => 60 + 40 * (lvl - 1)
const respawnTime = (lvl) => 4 + 1.2 * lvl

const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z)
const emojiOf = (zodiacId) => getZodiac(zodiacId)?.emoji || '🙂'

// 진영별 출발 위치 (우물 안에 셋이 나란히)
function spawnPos(team, slot) {
  const n = NEXUS_POS[team]
  const side = team === 'blue' ? 1 : -1
  return { x: n.x + side * 7, z: (slot - 1) * 5 }
}

// players: [{ id, name, zodiacId, color, team: 'blue'|'red', isBot? }]
export function createGame(players, rng = Math.random) {
  const slotCount = { blue: 0, red: 0 }
  const botRoles = { blue: ['top', 'bot', 'jungle'], red: ['top', 'bot', 'jungle'] }
  // 사람이 없는 역할부터 봇에게 맡긴다 (사람은 자유롭게 다님)
  const heroes = players.map((p) => {
    const slot = slotCount[p.team]++
    const pos = spawnPos(p.team, slot)
    return {
      id: p.id,
      name: p.name,
      zodiacId: p.zodiacId,
      color: p.color,
      team: p.team,
      isBot: !!p.isBot,
      role: p.isBot ? botRoles[p.team].shift() || 'top' : null,
      x: pos.x,
      z: pos.z,
      mx: 0, // 이동 입력 (-1~1)
      mz: 0,
      dir: p.team === 'blue' ? 0 : Math.PI, // 바라보는 방향 (적 본진 쪽)
      lvl: 1,
      xp: 0,
      hp: heroMaxHp(1),
      maxHp: heroMaxHp(1),
      atkCd: 0,
      skillCd: 0,
      ultCd: 0,
      stunT: 0,
      respawnT: 0, // >0이면 사망 중
      lastHurt: -99,
      lastHitBy: null, // 마지막으로 나를 때린 영웅 (킬 크레딧)
      dragonT: 0, // 용 버프 남은 시간
      baronT: 0, // 바론 버프 남은 시간
      kills: 0,
      deaths: 0,
      // 봇 상태
      botRetreat: false,
      botWp: nearestWp('top', pos.x, pos.z),
      botLane: null,
      botStrafe: rng() * Math.PI * 2,
    }
  })
  const monsters = [
    ...WOLF_CAMPS.map((c, i) => ({
      id: `wolf${i}`, kind: 'wolf', camp: c, x: c.x, z: c.z,
      hp: WOLF.hp, maxHp: WOLF.hp, alive: true, respawnT: 0, aggro: null,
    })),
    {
      id: 'dragon', kind: 'dragon', camp: DRAGON_PIT, x: DRAGON_PIT.x, z: DRAGON_PIT.z,
      hp: DRAGON.hp, maxHp: DRAGON.hp, alive: false, respawnT: DRAGON.spawn, aggro: null,
    },
    {
      id: 'baron', kind: 'baron', camp: BARON_PIT, x: BARON_PIT.x, z: BARON_PIT.z,
      hp: BARON.hp, maxHp: BARON.hp, alive: false, respawnT: BARON.spawn, aggro: null,
    },
  ]
  return {
    status: 'countdown', // 'countdown' | 'playing' | 'finished'
    time: 0,
    countdown: COUNTDOWN_TIME,
    winner: null, // 'blue' | 'red' | null(무승부)
    heroes,
    minions: [],
    monsters,
    towers: TOWER_SPOTS.map((t) => ({
      ...t, hp: TOWER_HP[t.tier], maxHp: TOWER_HP[t.tier], alive: true, cd: 0,
    })),
    nexus: {
      blue: { hp: NEXUS_HP, maxHp: NEXUS_HP },
      red: { hp: NEXUS_HP, maxHp: NEXUS_HP },
    },
    projectiles: [], // {id, kind:'bolt'|'skill'|'towerbolt', ...}
    novas: [], // 궁극기 폭발 연출 {id, x, z, t, team}
    kills: { blue: 0, red: 0 },
    towersDown: { blue: 0, red: 0 }, // 그 팀이 "부순" 적 타워 수
    feed: [], // 킬/오브젝트 피드 {seq, t, msg}
    feedSeq: 0,
    waveT: FIRST_WAVE, // 다음 미니언 웨이브까지
    nextId: 1,
    rng,
  }
}

export function setInput(state, id, { mx = 0, mz = 0 } = {}) {
  const h = state.heroes.find((p) => p.id === id)
  if (!h) return state
  h.mx = Math.max(-1, Math.min(1, Number(mx) || 0))
  h.mz = Math.max(-1, Math.min(1, Number(mz) || 0))
  return state
}

// 연결이 끊긴 참가자의 영웅은 봇이 이어받는다
export function makeBot(state, id) {
  const h = state.heroes.find((p) => p.id === id)
  if (!h || h.isBot) return null
  h.isBot = true
  h.mx = 0
  h.mz = 0
  // 비어 있는 레인부터 맡는다
  const taken = state.heroes.filter((o) => o.isBot && o.team === h.team && o !== h).map((o) => o.role)
  h.role = ['top', 'bot', 'jungle'].find((r) => !taken.includes(r)) || 'top'
  h.botStrafe = state.rng() * Math.PI * 2
  return h
}

function pushFeed(state, t, msg) {
  state.feed.push({ seq: ++state.feedSeq, t, msg })
  if (state.feed.length > 8) state.feed.shift()
}

const canAct = (h) => h.respawnT <= 0 && h.stunT <= 0

// 버프 포함 공격력
function atkOf(h) {
  const mult = h.baronT > 0 ? 1.4 : h.dragonT > 0 ? 1.25 : 1
  return heroAtk(h.lvl) * mult
}

// 이 타워를 지금 공격할 수 있나 (외곽 → 내곽 → 넥서스 순서)
export function towerVulnerable(state, tower) {
  if (tower.tier === 1) return true
  const outer = state.towers.find((t) => t.team === tower.team && t.lane === tower.lane && t.tier === 1)
  return !outer?.alive
}
export function nexusVulnerable(state, team) {
  return state.towers.some((t) => t.team === team && t.tier === 2 && !t.alive)
}

// ── 공격 대상 찾기 (영웅 우선, 다음 가까운 유닛) ──
function findAttackTarget(state, h, range = ATK_RANGE) {
  const r2 = range * range
  let best = null
  let bd = r2
  for (const e of state.heroes) {
    if (e.team === h.team || e.respawnT > 0) continue
    const d = dist2(h, e)
    if (d < bd) {
      bd = d
      best = { tk: 'hero', id: e.id }
    }
  }
  if (best) return best
  bd = r2
  for (const m of state.minions) {
    if (m.team === h.team) continue
    const d = dist2(h, m)
    if (d < bd) {
      bd = d
      best = { tk: 'minion', id: m.id }
    }
  }
  for (const m of state.monsters) {
    if (!m.alive) continue
    const d = dist2(h, m)
    if (d < bd) {
      bd = d
      best = { tk: 'monster', id: m.id }
    }
  }
  for (const t of state.towers) {
    if (!t.alive || t.team === h.team || !towerVulnerable(state, t)) continue
    const d = dist2(h, t)
    if (d < bd) {
      bd = d
      best = { tk: 'tower', id: t.id }
    }
  }
  const en = enemyOf(h.team)
  if (nexusVulnerable(state, en) && state.nexus[en].hp > 0) {
    const d = dist2(h, NEXUS_POS[en])
    if (d < bd) best = { tk: 'nexus', id: en }
  }
  return best
}

function targetEntity(state, ref) {
  if (!ref) return null
  if (ref.tk === 'hero') {
    const e = state.heroes.find((h) => h.id === ref.id)
    return e && e.respawnT <= 0 ? e : null
  }
  if (ref.tk === 'minion') return state.minions.find((m) => m.id === ref.id) || null
  if (ref.tk === 'monster') {
    const m = state.monsters.find((o) => o.id === ref.id)
    return m?.alive ? m : null
  }
  if (ref.tk === 'tower') {
    const t = state.towers.find((o) => o.id === ref.id)
    return t?.alive ? t : null
  }
  if (ref.tk === 'nexus') {
    return state.nexus[ref.id].hp > 0 ? { ...NEXUS_POS[ref.id], team: ref.id } : null
  }
  return null
}

// ── 기본공격: 사거리 안 가장 가까운 적에게 자동 조준 ──
export function castAttack(state, id) {
  if (state.status !== 'playing') return state
  const h = state.heroes.find((p) => p.id === id)
  if (!h || !canAct(h) || h.atkCd > 0) return state
  const ref = findAttackTarget(state, h)
  if (!ref) return state
  const tgt = targetEntity(state, ref)
  h.atkCd = ATK_CD
  h.dir = Math.atan2(tgt.z - h.z, tgt.x - h.x)
  state.projectiles.push({
    id: state.nextId++, kind: 'bolt', team: h.team, owner: h.id,
    x: h.x, z: h.z, target: ref, dmg: atkOf(h), speed: BOLT_SPEED,
  })
  return state
}

// ── 스킬: 가까운 적 영웅 쪽(없으면 바라보는 방향)으로 폭발탄 발사 ──
export function castSkill(state, id) {
  if (state.status !== 'playing') return state
  const h = state.heroes.find((p) => p.id === id)
  if (!h || !canAct(h) || h.skillCd > 0) return state
  let dir = h.dir
  const aim = findAttackTarget(state, h, SKILL_RANGE)
  if (aim?.tk === 'hero') {
    const e = targetEntity(state, aim)
    dir = Math.atan2(e.z - h.z, e.x - h.x)
  }
  h.skillCd = SKILL_CD
  h.dir = dir
  state.projectiles.push({
    id: state.nextId++, kind: 'skill', team: h.team, owner: h.id,
    x: h.x, z: h.z, vx: Math.cos(dir) * SKILL_SPEED, vz: Math.sin(dir) * SKILL_SPEED,
    dmg: skillDmg(h.lvl) * (h.baronT > 0 ? 1.4 : h.dragonT > 0 ? 1.25 : 1),
    travel: 0,
  })
  return state
}

// ── 궁극기: 내 주변 큰 폭발 + 스턴 (레벨 3부터) ──
export function castUlt(state, id) {
  if (state.status !== 'playing') return state
  const h = state.heroes.find((p) => p.id === id)
  if (!h || !canAct(h) || h.ultCd > 0 || h.lvl < ULT_LEVEL) return state
  h.ultCd = ULT_CD
  const mult = h.baronT > 0 ? 1.4 : h.dragonT > 0 ? 1.25 : 1
  const dmg = ultDmg(h.lvl) * mult
  state.novas.push({ id: state.nextId++, x: h.x, z: h.z, t: 0, team: h.team })
  const r2 = ULT_RADIUS * ULT_RADIUS
  for (const e of state.heroes) {
    if (e.team === h.team || e.respawnT > 0 || dist2(h, e) > r2) continue
    e.stunT = Math.max(e.stunT, ULT_STUN)
    damageHero(state, e, dmg, h)
  }
  for (const m of [...state.minions]) {
    if (m.team !== h.team && dist2(h, m) <= r2) damageMinion(state, m, dmg, h)
  }
  for (const m of state.monsters) {
    if (m.alive && dist2(h, m) <= r2) damageMonster(state, m, dmg, h)
  }
  return state
}

// ── 피해 처리 ──
function damageHero(state, victim, amount, attacker) {
  if (victim.respawnT > 0 || state.status !== 'playing') return
  victim.hp -= amount
  victim.lastHurt = state.time
  if (attacker?.id) victim.lastHitBy = attacker.id
  if (victim.hp > 0) return
  // 사망!
  victim.hp = 0
  victim.deaths++
  victim.respawnT = respawnTime(victim.lvl)
  victim.stunT = 0
  victim.dragonT = 0
  victim.baronT = 0
  const killer = state.heroes.find((h) => h.id === victim.lastHitBy && h.team !== victim.team)
  if (killer) {
    killer.kills++
    state.kills[killer.team]++
    awardXp(state, killer.team, victim, 90 + 15 * victim.lvl, killer)
    pushFeed(state, 'kill', `${emojiOf(killer.zodiacId)} ${killer.name} ⚔️ ${emojiOf(victim.zodiacId)} ${victim.name} 처치!`)
  } else {
    state.kills[enemyOf(victim.team)]++
    pushFeed(state, 'kill', `${emojiOf(victim.zodiacId)} ${victim.name} 쓰러짐!`)
  }
}

function damageMinion(state, m, amount, attacker) {
  m.hp -= amount
  if (m.hp > 0) return
  state.minions = state.minions.filter((o) => o !== m)
  if (attacker?.team) awardXp(state, attacker.team, m, MINION_XP, attacker)
}

function damageMonster(state, m, amount, attacker) {
  if (!m.alive) return
  m.hp -= amount
  m.lastHurt = state.time
  if (attacker?.id) m.aggro = attacker.id
  if (m.hp > 0) return
  m.alive = false
  m.aggro = null
  const spec = m.kind === 'wolf' ? WOLF : m.kind === 'dragon' ? DRAGON : BARON
  m.respawnT = spec.respawn
  if (!attacker?.team) return
  if (m.kind === 'wolf') {
    awardXp(state, attacker.team, m, WOLF.xp, attacker)
  } else {
    // 용/바론: 팀 전체 경험치 + 버프
    for (const h of state.heroes) {
      if (h.team !== attacker.team) continue
      giveXp(h, spec.xp)
      if (h.respawnT > 0) continue
      if (m.kind === 'dragon') h.dragonT = DRAGON_BUFF_T
      else h.baronT = BARON_BUFF_T
    }
    pushFeed(
      state,
      m.kind,
      m.kind === 'dragon'
        ? `🐉 ${attacker.team === 'blue' ? '파랑팀' : '빨강팀'}이 용을 잡았다! 공격력 UP!`
        : `👹 ${attacker.team === 'blue' ? '파랑팀' : '빨강팀'}이 바론을 잡았다! 강해졌다!!`
    )
  }
}

function damageTower(state, t, amount, attacker) {
  if (!t.alive || !towerVulnerable(state, t)) return
  t.hp -= amount
  if (t.hp > 0) return
  t.hp = 0
  t.alive = false
  const team = attacker?.team || enemyOf(t.team)
  state.towersDown[team]++
  for (const h of state.heroes) if (h.team === team) giveXp(h, TOWER_XP)
  pushFeed(state, 'tower', `💥 ${t.team === 'blue' ? '파랑' : '빨강'} ${t.tier === 1 ? '외곽' : '내곽'} 타워 파괴!`)
}

function damageNexus(state, team, amount, attacker) {
  if (!nexusVulnerable(state, team)) return
  const nx = state.nexus[team]
  if (nx.hp <= 0) return
  nx.hp -= amount
  if (nx.hp > 0) return
  nx.hp = 0
  finish(state, attacker?.team || enemyOf(team))
}

function finish(state, winner) {
  state.status = 'finished'
  state.winner = winner
  pushFeed(
    state, 'nexus',
    winner ? `🏆 ${winner === 'blue' ? '파랑팀' : '빨강팀'} 승리!!` : '🤝 무승부!'
  )
}

// 종류 불문 피해 적용 (투사체 도착 등)
function applyDamage(state, ref, amount, attacker) {
  const e = targetEntity(state, ref)
  if (!e) return
  if (ref.tk === 'hero') damageHero(state, e, amount, attacker)
  else if (ref.tk === 'minion') damageMinion(state, e, amount, attacker)
  else if (ref.tk === 'monster') damageMonster(state, e, amount, attacker)
  else if (ref.tk === 'tower') damageTower(state, e, amount, attacker)
  else if (ref.tk === 'nexus') damageNexus(state, ref.id, amount, attacker)
}

// 처치 지점 근처의 같은 팀 영웅 모두에게 경험치 (킬러는 어디 있든 받는다)
function awardXp(state, team, at, amount, killer) {
  const r2 = XP_RANGE * XP_RANGE
  for (const h of state.heroes) {
    if (h.team !== team) continue
    if (h === killer || dist2(h, at) <= r2) giveXp(h, amount)
  }
}

function giveXp(h, amount) {
  if (h.lvl >= MAX_LEVEL) return
  h.xp += amount
  while (h.lvl < MAX_LEVEL && h.xp >= xpNeed(h.lvl)) {
    h.xp -= xpNeed(h.lvl)
    h.lvl++
    h.maxHp = heroMaxHp(h.lvl)
    h.hp = Math.min(h.maxHp, h.hp + HP_PER_LVL + h.maxHp * 0.15) // 레벨업 보너스 회복
  }
  if (h.lvl >= MAX_LEVEL) h.xp = 0
}

// ── 물리 1틱 ──
export function step(state, dt) {
  state.time += dt
  if (state.status === 'countdown') {
    state.countdown = Math.max(0, COUNTDOWN_TIME - state.time)
    if (state.time >= COUNTDOWN_TIME) {
      state.status = 'playing'
      state.countdown = 0
    }
    return state
  }
  if (state.status === 'finished') return state

  stepWaves(state, dt)
  stepBots(state, dt)
  for (const h of state.heroes) stepHero(state, h, dt)
  stepMinions(state, dt)
  stepMonsters(state, dt)
  stepTowers(state, dt)
  stepProjectiles(state, dt)
  state.novas = state.novas.filter((n) => (n.t += dt) < 0.7)
  // 시간 초과: 부순 타워 → 킬 → 넥서스 체력으로 판정
  if (state.status === 'playing' && state.time >= COUNTDOWN_TIME + TIME_LIMIT) {
    const d = state.towersDown
    const k = state.kills
    const nx = state.nexus
    let w = null
    if (d.blue !== d.red) w = d.blue > d.red ? 'blue' : 'red'
    else if (k.blue !== k.red) w = k.blue > k.red ? 'blue' : 'red'
    else if (nx.blue.hp !== nx.red.hp) w = nx.blue.hp > nx.red.hp ? 'blue' : 'red'
    finish(state, w)
  }
  return state
}

// 미니언 웨이브: 레인마다 근접 2 + 원거리 1
function stepWaves(state, dt) {
  state.waveT -= dt
  if (state.waveT > 0) return
  state.waveT += WAVE_PERIOD
  const grow = MINION_HP_GROWTH * (state.time / 60)
  for (const team of ['blue', 'red']) {
    for (const lane of ['top', 'bot']) {
      for (let i = 0; i < 3; i++) {
        const spec = i === 2 ? RANGED : MELEE
        const wps = LANES[lane]
        // 넥서스 충돌체에 끼지 않게, 본진에서 레인 쪽으로 살짝 나간 곳에서 출발
        const a = team === 'blue' ? wps[0] : wps[wps.length - 1]
        const b = team === 'blue' ? wps[1] : wps[wps.length - 2]
        const d = Math.hypot(b.x - a.x, b.z - a.z) || 1
        state.minions.push({
          id: state.nextId++,
          team,
          lane,
          ranged: i === 2,
          x: a.x + ((b.x - a.x) / d) * 8 + (state.rng() - 0.5) * 3,
          z: a.z + ((b.z - a.z) / d) * 8 + (state.rng() - 0.5) * 3,
          hp: spec.hp + grow,
          maxHp: spec.hp + grow,
          atkCd: i * 0.3, // 줄지어 공격하게 살짝 어긋나게
          wpI: team === 'blue' ? 1 : wps.length - 2,
        })
      }
    }
  }
}

function stepHero(state, h, dt) {
  h.atkCd = Math.max(0, h.atkCd - dt)
  h.skillCd = Math.max(0, h.skillCd - dt)
  h.ultCd = Math.max(0, h.ultCd - dt)
  h.dragonT = Math.max(0, h.dragonT - dt)
  h.baronT = Math.max(0, h.baronT - dt)
  // 부활 대기 → 우물에서 부활
  if (h.respawnT > 0) {
    h.respawnT = Math.max(0, h.respawnT - dt)
    if (h.respawnT === 0) {
      const slot = state.heroes.filter((o) => o.team === h.team).indexOf(h)
      const pos = spawnPos(h.team, slot)
      h.x = pos.x
      h.z = pos.z
      h.hp = h.maxHp
      h.lastHitBy = null
      h.dir = h.team === 'blue' ? 0 : Math.PI
    }
    return
  }
  h.stunT = Math.max(0, h.stunT - dt)
  // 이동
  if (h.stunT <= 0) {
    const len = Math.hypot(h.mx, h.mz)
    if (len > 0.12) {
      const sp = HERO_SPEED * Math.min(1, len)
      h.dir = Math.atan2(h.mz, h.mx)
      h.x += (h.mx / len) * sp * dt
      h.z += (h.mz / len) * sp * dt
    }
  }
  resolveTerrain(h, HERO_RADIUS, state.towers)
  // 우물: 우리 편이면 회복, 적이면 따끔!
  for (const team of ['blue', 'red']) {
    if (dist2(h, NEXUS_POS[team]) > FOUNTAIN_RADIUS * FOUNTAIN_RADIUS) continue
    if (team === h.team) h.hp = Math.min(h.maxHp, h.hp + h.maxHp * FOUNTAIN_HEAL * dt)
    else damageHero(state, h, FOUNTAIN_DMG * dt, null)
  }
  // 자연 회복 (전투 이탈 시) + 바론 버프 회복
  if (state.time - h.lastHurt > REGEN_DELAY) {
    h.hp = Math.min(h.maxHp, h.hp + h.maxHp * REGEN_RATE * dt)
  }
  if (h.baronT > 0) h.hp = Math.min(h.maxHp, h.hp + h.maxHp * 0.02 * dt)
}

function stepMinions(state, dt) {
  for (const m of [...state.minions]) {
    m.atkCd = Math.max(0, m.atkCd - dt)
    const spec = m.ranged ? RANGED : MELEE
    // 시야 안 가장 가까운 적 (미니언 → 영웅 → 타워/넥서스 순으로 자연 타게팅)
    let tgt = null
    let bd = MINION_SIGHT * MINION_SIGHT
    for (const o of state.minions) {
      if (o.team === m.team) continue
      const d = dist2(m, o)
      if (d < bd) {
        bd = d
        tgt = { ref: { tk: 'minion', id: o.id }, e: o }
      }
    }
    if (!tgt) {
      for (const o of state.heroes) {
        if (o.team === m.team || o.respawnT > 0) continue
        const d = dist2(m, o)
        if (d < bd) {
          bd = d
          tgt = { ref: { tk: 'hero', id: o.id }, e: o }
        }
      }
    }
    if (!tgt) {
      for (const t of state.towers) {
        if (!t.alive || t.team === m.team || !towerVulnerable(state, t)) continue
        const d = dist2(m, t)
        if (d < bd) {
          bd = d
          tgt = { ref: { tk: 'tower', id: t.id }, e: t }
        }
      }
      const en = enemyOf(m.team)
      if (nexusVulnerable(state, en) && state.nexus[en].hp > 0) {
        const d = dist2(m, NEXUS_POS[en])
        if (d < bd) tgt = { ref: { tk: 'nexus', id: en }, e: NEXUS_POS[en] }
      }
    }
    if (tgt) {
      const d = dist(m, tgt.e)
      if (d <= spec.range + 0.5) {
        if (m.atkCd <= 0) {
          m.atkCd = spec.cd
          applyDamage(state, tgt.ref, spec.dmg, { team: m.team })
        }
      } else {
        moveToward(m, tgt.e, MINION_SPEED, dt)
      }
    } else {
      // 레인 행군
      const wps = LANES[m.lane]
      const dirI = m.team === 'blue' ? 1 : -1
      const wp = wps[m.wpI]
      if (wp) {
        if (dist(m, wp) < 3) m.wpI += dirI
        else moveToward(m, wp, MINION_SPEED, dt)
      }
    }
    resolveTerrain(m, 0.8, state.towers)
  }
  // 같은 자리에 겹치지 않게 서로 살짝 밀어내기
  const ms = state.minions
  for (let i = 0; i < ms.length; i++) {
    for (let j = i + 1; j < ms.length; j++) {
      const a = ms[i]
      const b = ms[j]
      let dx = b.x - a.x
      let dz = b.z - a.z
      const d = Math.hypot(dx, dz)
      if (d >= 1.6 || d === 0) continue
      const push = (1.6 - d) / 2
      dx /= d
      dz /= d
      a.x -= dx * push
      a.z -= dz * push
      b.x += dx * push
      b.z += dz * push
    }
  }
}

function moveToward(e, to, speed, dt) {
  const d = dist(e, to) || 0.001
  e.x += ((to.x - e.x) / d) * speed * dt
  e.z += ((to.z - e.z) / d) * speed * dt
}

// 정글몹: 평소엔 얌전 — 맞으면 반격, 캠프에서 멀어지면 포기하고 복귀(회복)
function stepMonsters(state, dt) {
  for (const m of state.monsters) {
    if (!m.alive) {
      m.respawnT = Math.max(0, m.respawnT - dt)
      if (m.respawnT === 0) {
        m.alive = true
        m.hp = m.maxHp
        m.x = m.camp.x
        m.z = m.camp.z
        if (m.kind === 'dragon') pushFeed(state, 'spawn', '🐉 용이 나타났다! (아래 강가)')
        else if (m.kind === 'baron') pushFeed(state, 'spawn', '👹 바론이 나타났다! (위 강가)')
      }
      continue
    }
    const spec = m.kind === 'wolf' ? WOLF : m.kind === 'dragon' ? DRAGON : BARON
    m.atkCd = Math.max(0, (m.atkCd || 0) - dt)
    const tgt = m.aggro ? state.heroes.find((h) => h.id === m.aggro && h.respawnT <= 0) : null
    const far = dist(m, m.camp) > CAMP_LEASH
    if (!tgt || far || dist(m, tgt) > CAMP_LEASH) {
      m.aggro = null
      if (dist(m, m.camp) > 1) {
        moveToward(m, m.camp, spec.speed * 1.5, dt)
        m.hp = Math.min(m.maxHp, m.hp + m.maxHp * 0.5 * dt) // 복귀 중 쑥쑥 회복
      }
      continue
    }
    if (dist(m, tgt) <= spec.range + 1) {
      if (m.atkCd <= 0) {
        m.atkCd = spec.cd
        damageHero(state, tgt, spec.dmg, null)
      }
    } else {
      moveToward(m, tgt, spec.speed, dt)
    }
  }
}

// 타워: 미니언 우선, 없으면 영웅 — 투사체로 공격
function stepTowers(state, dt) {
  const r2 = TOWER_RANGE * TOWER_RANGE
  for (const t of state.towers) {
    if (!t.alive) continue
    t.cd = Math.max(0, t.cd - dt)
    if (t.cd > 0) continue
    let ref = null
    let bd = r2
    for (const m of state.minions) {
      if (m.team === t.team) continue
      const d = dist2(t, m)
      if (d < bd) {
        bd = d
        ref = { tk: 'minion', id: m.id }
      }
    }
    if (!ref) {
      for (const h of state.heroes) {
        if (h.team === t.team || h.respawnT > 0) continue
        const d = dist2(t, h)
        if (d < bd) {
          bd = d
          ref = { tk: 'hero', id: h.id }
        }
      }
    }
    if (!ref) continue
    t.cd = TOWER_CD
    state.projectiles.push({
      id: state.nextId++, kind: 'towerbolt', team: t.team,
      x: t.x, z: t.z, target: ref,
      dmg: ref.tk === 'hero' ? TOWER_DMG_HERO : TOWER_DMG_MINION,
      speed: 34,
    })
  }
}

function stepProjectiles(state, dt) {
  const remove = new Set()
  for (const p of state.projectiles) {
    if (p.kind === 'skill') {
      // 직선 비행 — 적 영웅/미니언/정글몹에 닿으면 폭발 (주변 휩쓸기)
      p.x += p.vx * dt
      p.z += p.vz * dt
      p.travel += SKILL_SPEED * dt
      let hit = p.travel >= SKILL_RANGE
      const owner = state.heroes.find((h) => h.id === p.owner)
      const touches = (e) => dist2(p, e) < 2.6 * 2.6
      if (!hit) {
        hit =
          state.heroes.some((e) => e.team !== p.team && e.respawnT <= 0 && touches(e)) ||
          state.minions.some((e) => e.team !== p.team && touches(e)) ||
          state.monsters.some((e) => e.alive && touches(e))
      }
      if (hit) {
        remove.add(p.id)
        const r2a = SKILL_AOE * SKILL_AOE
        for (const e of state.heroes) {
          if (e.team !== p.team && e.respawnT <= 0 && dist2(p, e) <= r2a) {
            damageHero(state, e, p.dmg, owner)
          }
        }
        for (const e of [...state.minions]) {
          if (e.team !== p.team && dist2(p, e) <= r2a) damageMinion(state, e, p.dmg, owner)
        }
        for (const e of state.monsters) {
          if (e.alive && dist2(p, e) <= r2a) damageMonster(state, e, p.dmg, owner)
        }
      }
      continue
    }
    // 유도탄 (기본공격/타워) — 대상이 사라지면 같이 사라진다
    const e = targetEntity(state, p.target)
    if (!e) {
      remove.add(p.id)
      continue
    }
    const d = dist(p, e)
    if (d < 1.4) {
      remove.add(p.id)
      const owner = state.heroes.find((h) => h.id === p.owner) || { team: p.team }
      applyDamage(state, p.target, p.dmg, owner)
      continue
    }
    p.x += ((e.x - p.x) / d) * p.speed * dt
    p.z += ((e.z - p.z) / d) * p.speed * dt
  }
  if (remove.size) state.projectiles = state.projectiles.filter((p) => !remove.has(p.id))
}

// ── 봇 AI ──
// 체력이 낮으면 우물로 후퇴, 적 영웅이 보이면 거리를 재며 교전,
// 평소엔 맡은 레인을 행군(정글 봇은 캠프 사냥). 타워 다이브는 미니언이 있을 때만.
const BOT_SIGHT = 18
const BOT_KITE = 7.5

function stepBots(state, dt) {
  for (const h of state.heroes) {
    if (!h.isBot || h.respawnT > 0) continue
    if (h.stunT > 0) {
      h.mx = 0
      h.mz = 0
      continue
    }
    // 후퇴 판단
    if (h.hp < h.maxHp * 0.3) h.botRetreat = true
    if (h.botRetreat && h.hp > h.maxHp * 0.85) h.botRetreat = false
    if (h.botRetreat) {
      steerToward(h, NEXUS_POS[h.team])
      castAttack(state, h.id) // 도망치면서도 사거리 안이면 반격
      continue
    }
    // 가장 가까운 적 영웅
    let foe = null
    let bd = BOT_SIGHT * BOT_SIGHT
    let nearCount = 0
    for (const e of state.heroes) {
      if (e.team === h.team || e.respawnT > 0) continue
      const d = dist2(h, e)
      if (d < 9 * 9) nearCount++
      if (d < bd) {
        bd = d
        foe = e
      }
    }
    if (foe) {
      const d = Math.sqrt(bd)
      // 거리 유지(카이팅): 가까우면 물러서고 멀면 다가가고, 옆으로도 살짝
      h.botStrafe += dt * 0.7
      const away = Math.atan2(h.z - foe.z, h.x - foe.x)
      const to = Math.atan2(foe.z - h.z, foe.x - h.x)
      const ang = d < BOT_KITE - 1.5 ? away : d > BOT_KITE + 1.5 ? to : away + Math.PI / 2
      h.mx = Math.cos(ang) * 0.9 + Math.cos(h.botStrafe) * 0.25
      h.mz = Math.sin(ang) * 0.9 + Math.sin(h.botStrafe) * 0.25
      castAttack(state, h.id)
      if (h.skillCd <= 0 && d < SKILL_RANGE - 4) castSkill(state, h.id)
      if (
        h.ultCd <= 0 && h.lvl >= ULT_LEVEL &&
        (nearCount >= 2 || (d < ULT_RADIUS - 2 && foe.hp < foe.maxHp * 0.45))
      ) {
        castUlt(state, h.id)
      }
      continue
    }
    // 교전 상대가 없으면 임무 수행
    castAttack(state, h.id) // 미니언/정글/타워 등 사거리 안 아무거나
    if (h.role === 'jungle' && botJungleMove(state, h)) continue
    botLaneMove(state, h)
  }
}

function steerToward(h, to) {
  const d = dist(h, to) || 0.001
  h.mx = (to.x - h.x) / d
  h.mz = (to.z - h.z) / d
}

// 정글 봇: 우리 진영 늑대 → 용/바론 기웃 → 캠프가 없으면 레인 합류
function botJungleMove(state, h) {
  const side = h.team === 'blue' ? -1 : 1
  // 아군이 근처에 있으면 용/바론 도전
  for (const big of state.monsters) {
    if (!big.alive || big.kind === 'wolf') continue
    const allies = state.heroes.filter(
      (o) => o.team === h.team && o.respawnT <= 0 && dist(o, big) < 28
    ).length
    if (allies >= 2 && h.hp > h.maxHp * 0.55) {
      if (dist(h, big) > ATK_RANGE - 2) steerToward(h, big)
      else {
        h.mx = 0
        h.mz = 0
      }
      return true
    }
  }
  let camp = null
  let bd = Infinity
  for (const m of state.monsters) {
    if (!m.alive || m.kind !== 'wolf') continue
    const mySide = Math.sign(m.camp.x) === side
    const d = dist2(h, m) - (mySide ? 1e6 : 0) // 우리 쪽 캠프 우선
    if (d < bd) {
      bd = d
      camp = m
    }
  }
  if (!camp) return false
  if (dist(h, camp) > ATK_RANGE - 2) steerToward(h, camp)
  else {
    h.mx = 0
    h.mz = 0
  }
  return true
}

// 레인 봇: 경유지를 따라 적 본진 쪽으로. 목표 타워 근처에선
// 아군 미니언이 받아주고 있을 때만 들어간다 (타워 다이브 금지).
function botLaneMove(state, h) {
  const lane = h.role === 'bot' ? 'bot' : 'top'
  const en = enemyOf(h.team)
  const objective =
    state.towers.find((t) => t.team === en && t.lane === lane && t.tier === 1 && t.alive) ||
    state.towers.find((t) => t.team === en && t.lane === lane && t.tier === 2 && t.alive) ||
    NEXUS_POS[en]
  // 타워가 살아있고 아군 미니언 방패가 없으면 사거리 밖에서 대기
  const dObj = dist(h, objective)
  if (objective.id && dObj < TOWER_RANGE + 2) {
    const shield = state.minions.some((m) => m.team === h.team && dist(m, objective) < TOWER_RANGE)
    if (!shield) {
      const away = Math.atan2(h.z - objective.z, h.x - objective.x)
      h.mx = Math.cos(away) * 0.7
      h.mz = Math.sin(away) * 0.7
      return
    }
    if (dObj <= ATK_RANGE - 1.5) {
      h.mx = 0
      h.mz = 0
      return
    }
    steerToward(h, objective)
    return
  }
  // 경유지 행군: 목표에 가까운 다음 경유지로
  const wps = LANES[lane]
  const dirI = h.team === 'blue' ? 1 : -1
  let wpI = nearestWp(lane, h.x, h.z)
  // 이미 그 경유지에 도착해 있으면 다음 칸으로
  if (dist(h, wps[wpI]) < 6) wpI += dirI
  wpI = Math.max(0, Math.min(wps.length - 1, wpI))
  const wp = wps[wpI]
  // 경유지보다 목표가 더 가까우면 목표로 직행
  steerToward(h, dist(h, objective) < dist(h, wp) + 6 ? objective : wp)
}

const r1 = (v) => Math.round(v * 10) / 10
const r2d = (v) => Math.round(v * 100) / 100

// 게스트에게 보낼 직렬화 스냅샷 (렌더러도 이 형태만 본다)
export function makeView(state) {
  return {
    phase: 'play',
    status: state.status,
    time: r2d(state.time),
    countdown: Math.ceil(state.countdown),
    go: state.status === 'playing' && state.time < COUNTDOWN_TIME + 1.2,
    timeLeft: Math.max(0, Math.ceil(COUNTDOWN_TIME + TIME_LIMIT - state.time)),
    winner: state.winner,
    kills: { ...state.kills },
    heroes: state.heroes.map((h) => ({
      id: h.id,
      name: h.name,
      zodiacId: h.zodiacId,
      color: h.color,
      team: h.team,
      isBot: h.isBot,
      x: r1(h.x),
      z: r1(h.z),
      dir: r2d(h.dir),
      hp: Math.ceil(h.hp),
      maxHp: h.maxHp,
      lvl: h.lvl,
      xp: Math.floor(h.xp),
      xpNeed: h.lvl >= MAX_LEVEL ? 0 : xpNeed(h.lvl),
      atkCd: r2d(h.atkCd),
      skillCd: r2d(h.skillCd),
      ultCd: r2d(h.ultCd),
      ultLocked: h.lvl < ULT_LEVEL,
      stunT: r2d(h.stunT),
      respawnT: r2d(h.respawnT),
      dragonT: r1(h.dragonT),
      baronT: r1(h.baronT),
      kills: h.kills,
      deaths: h.deaths,
    })),
    minions: state.minions.map((m) => ({
      id: m.id,
      team: m.team,
      ranged: m.ranged,
      x: r1(m.x),
      z: r1(m.z),
      hp: Math.ceil(m.hp),
      maxHp: Math.ceil(m.maxHp),
    })),
    monsters: state.monsters.map((m) => ({
      id: m.id,
      kind: m.kind,
      alive: m.alive,
      x: r1(m.x),
      z: r1(m.z),
      hp: Math.ceil(m.hp),
      maxHp: m.maxHp,
      respawnT: m.alive ? 0 : Math.ceil(m.respawnT),
    })),
    towers: state.towers.map((t) => ({
      id: t.id,
      team: t.team,
      lane: t.lane,
      tier: t.tier,
      x: t.x,
      z: t.z,
      hp: Math.ceil(t.hp),
      maxHp: t.maxHp,
      alive: t.alive,
      vuln: t.alive && towerVulnerable(state, t),
    })),
    nexus: {
      blue: { hp: Math.ceil(state.nexus.blue.hp), maxHp: NEXUS_HP, vuln: nexusVulnerable(state, 'blue') },
      red: { hp: Math.ceil(state.nexus.red.hp), maxHp: NEXUS_HP, vuln: nexusVulnerable(state, 'red') },
    },
    projectiles: state.projectiles.map((p) => ({
      id: p.id,
      kind: p.kind,
      team: p.team,
      x: r1(p.x),
      z: r1(p.z),
    })),
    novas: state.novas.map((n) => ({ id: n.id, x: r1(n.x), z: r1(n.z), t: r2d(n.t), team: n.team })),
    feed: state.feed.slice(-5),
  }
}
