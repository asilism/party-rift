// 조디악 블리츠 — 실시간 네트코드 어댑터(서버 권위 + 클라 예측/보간 공용).
import {
  createGame, setInput, castAttack, castSkill, castSkill2, castUlt, castRecall, buyItem, sellItem, resetShop, useItem, enhanceItem, pickAugment,
  step, makeView, makeBot, STEP, TEAM_SIZE, TEAM_SIZES, CLASS_IDS,
} from './engine.js'
import { ZODIAC, getZodiac } from '../../shared/zodiac.js'
import { racers } from '../../net/realtime/roster.js'

export const riftNet = {
  id: 'rift',
  STEP,

  buildParticipants(players, config) {
    const mode = config?.mode || '3v3'

    // 서버 드래프트로 팀·직업이 확정된 풀 로스터를 받으면 그대로 신뢰한다.
    //  (사람+봇이 모두 들어 있고, 같은 팀 직업 중복은 드래프트에서 이미 막혔다)
    if (Array.isArray(config?.roster) && config.roster.length) {
      const list = config.roster.map((p) => ({
        id: p.id || p.zodiacId,
        name: p.name,
        title: p.title || null, // 장착 칭호 — 이름표 표시용
        zodiacId: p.zodiacId,
        color: p.color || getZodiac(p.zodiacId)?.color,
        team: p.team || 'blue',
        cls: p.cls,
        isBot: !!p.isBot,
        deviceId: p.deviceId,
        trophySet: p.trophySet || null, // 보스 전리품 풀세트 — PvE 소효과(엔진이 모드로 게이트)
      }))
      return { players: list, opts: { mode, botLevel: config?.botLevel, bossTier: config?.bossTier, carry: config?.carry, arenaLayout: config?.arenaLayout, arenaPts: config?.arenaPts, arenaDeduct: config?.arenaDeduct, arenaRound: config?.arenaRound } }
    }

    const teams = config?.teams || {}
    const classes = config?.classes || {}
    const teamSize = TEAM_SIZES[mode] || TEAM_SIZE
    const humans = racers(players).map((p) => ({
      id: p.id, name: p.name, zodiacId: p.zodiacId, color: getZodiac(p.zodiacId)?.color,
      team: teams[p.id] || 'blue', cls: classes[p.id],
    }))
    const used = new Set((players || []).map((p) => p.zodiacId))
    const free = ZODIAC.filter((z) => !used.has(z.id))
    const bots = []
    for (const team of ['blue', 'red']) {
      const mine = humans.filter((h) => h.team === team)
      const takenCls = new Set(mine.map((h) => h.cls))
      for (let i = mine.length; i < teamSize; i++) {
        const z = free.shift()
        if (!z) break
        const cls = CLASS_IDS.find((c) => !takenCls.has(c))
        takenCls.add(cls)
        bots.push({
          id: `bot-${z.id}`, name: `${z.name}봇`, zodiacId: z.id, color: z.color,
          team, cls, isBot: true,
        })
      }
    }
    return { players: [...humans, ...bots], opts: { mode, botLevel: config?.botLevel, bossTier: config?.bossTier, carry: config?.carry, arenaLayout: config?.arenaLayout, arenaPts: config?.arenaPts, arenaDeduct: config?.arenaDeduct, arenaRound: config?.arenaRound } }
  },
  createGame: (players, opts) =>
    createGame(players, { mode: opts?.mode, botLevel: opts?.botLevel, bossTier: opts?.bossTier, carry: opts?.carry, arenaLayout: opts?.arenaLayout, arenaPts: opts?.arenaPts, arenaDeduct: opts?.arenaDeduct, arenaRound: opts?.arenaRound, rng: Math.random }),
  setInput,
  applyAction(state, action, pid) {
    if (action.type === 'cast') {
      if (action.slot === 'atk') castAttack(state, pid)
      else if (action.slot === 'skill') castSkill(state, pid)
      else if (action.slot === 'skill2') castSkill2(state, pid)
      else if (action.slot === 'ult') castUlt(state, pid)
      else if (action.slot === 'recall') castRecall(state, pid)
    } else if (action.type === 'buy') buyItem(state, pid, action.itemId)
    else if (action.type === 'sell') sellItem(state, pid, action.slot)
    else if (action.type === 'resetShop') resetShop(state, pid)
    else if (action.type === 'enhance') enhanceItem(state, pid, action.slot)
    else if (action.type === 'pickAugment') pickAugment(state, pid, action.augId)
    else if (action.type === 'useItem') useItem(state, pid, action.slot)
  },
  step,
  makeView,
  makeBot,

  // ── 클라 예측(①): 내 영웅 이동 ──
  localKey: 'heroes',
  angleField: 'dir',
  readInput: (c) => ({ mx: c.mx || 0, mz: c.mz || 0 }),
  inputSig: (c) => `${(c.mx || 0).toFixed(2)}|${(c.mz || 0).toFixed(2)}`,
  predictLocal(pred, ctrl, me, dt) {
    // 사망/기절/정신집중/귀환/발사준비/넉백/공포(강제 도주) 중엔 제자리 → 권위값에 맡김(클라 예측 정지)
    if (me.respawnT > 0 || me.stunT > 0 || me.castT > 0 || me.recallT > 0 || me.hookWindT > 0 || me.knockT > 0 || me.fearT > 0) return
    const len = Math.hypot(ctrl.mx || 0, ctrl.mz || 0)
    if (len <= 0.12) return
    const sp = me.mvSpeed || 8
    pred.ang = Math.atan2(ctrl.mz, ctrl.mx)
    pred.x += (ctrl.mx / len) * sp * dt
    pred.z += (ctrl.mz / len) * sp * dt
  },

  // ── 게스트 보간(③) ──
  interpolate(buf, t) {
    if (!buf.length) return null
    let a = null
    let b = buf[buf.length - 1]
    for (let i = buf.length - 1; i >= 0; i--) {
      if (buf[i].at <= t) {
        a = buf[i]
        b = buf[i + 1] || buf[i]
        break
      }
    }
    if (!a || a === b || b.at <= a.at) return b.v
    const f = Math.min(1, (t - a.at) / (b.at - a.at))
    const lerp = (x, y) => x + (y - x) * f
    const lerpAng = (x, y) => {
      let d = y - x
      while (d > Math.PI) d -= 2 * Math.PI
      while (d < -Math.PI) d += 2 * Math.PI
      return x + d * f
    }
    const lerpList = (la, lb, extra, snap) =>
      lb.map((eb) => {
        const ea = la?.find((o) => o.id === eb.id)
        if (!ea) return eb
        // 순간이동/리스폰: 위치를 보간하면 맵을 가로질러 미끄러진다 → 최신 위치로 스냅
        if (snap && snap(ea, eb)) return eb
        return { ...eb, x: lerp(ea.x, eb.x), z: lerp(ea.z, eb.z), ...(extra ? extra(ea, eb) : null) }
      })
    // 리스폰(사망↔부활 전환) 또는 큰 도약(점멸·순간이동)이면 보간을 끊는다.
    //  안 그러면 부활 순간 시체 위치→분수대로 몸이 미끄러지며 시야를 지나가 "누가 살아났는지" 새어 나간다.
    const TELEPORT2 = 14 * 14
    const heroSnap = (ea, eb) =>
      ea.respawnT > 0 || eb.respawnT > 0 || (eb.x - ea.x) ** 2 + (eb.z - ea.z) ** 2 > TELEPORT2
    return {
      ...b.v,
      time: lerp(a.v.time ?? 0, b.v.time ?? 0),
      heroes: lerpList(a.v.heroes, b.v.heroes, (ea, eb) => ({ dir: lerpAng(ea.dir, eb.dir) }), heroSnap),
      minions: lerpList(a.v.minions, b.v.minions, (ea, eb) => ({ dir: lerpAng(ea.dir || 0, eb.dir || 0) })),
      monsters: lerpList(a.v.monsters, b.v.monsters),
      projectiles: lerpList(a.v.projectiles, b.v.projectiles),
    }
  },
}
