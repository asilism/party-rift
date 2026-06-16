// 파티 카트 — 실시간 네트코드 어댑터(서버 권위 시뮬 + 클라 예측/보간 공용).
// 게임 로직은 engine.js 그대로 쓰고, 여기서는 "네트워크 레이어가 게임을 굴리는 데
// 필요한 것들"만 표준 계약으로 노출한다. (다른 게임도 같은 모양으로 얹으면 된다.)
import { createGame, setInput, fireItem, step, makeView, makeBot, STEP } from './engine.js'
import { ZODIAC, getZodiac } from '../../shared/zodiac.js'
import { racers } from '../../net/realtime/roster.js'

const RACE_SIZE = 4 // 레이스 정원 — 모자라면 CPU가 채운다
const TURN_RATE = 1.7 // engine.js와 동일(예측 회전율)

export const kartNet = {
  id: 'kart',
  STEP,

  // ── 서버: 방 인원/설정 → createGame 참가자 구성 ──
  buildParticipants(players, config) {
    const humans = racers(players).map((p) => ({
      id: p.id, name: p.name, zodiacId: p.zodiacId, color: getZodiac(p.zodiacId)?.color,
    }))
    const used = new Set((players || []).map((p) => p.zodiacId))
    const free = ZODIAC.filter((z) => !used.has(z.id)).sort(() => Math.random() - 0.5)
    const bots = free.slice(0, Math.max(0, RACE_SIZE - humans.length)).map((z) => ({
      id: `bot-${z.id}`, name: `${z.name}봇`, zodiacId: z.id, color: z.color, isBot: true,
    }))
    return { players: [...humans, ...bots], opts: { trackId: config?.trackId } }
  },
  createGame: (players, opts) => createGame(players, Math.random, opts?.trackId),
  setInput,
  applyAction(state, action, pid) {
    if (action.type === 'item') fireItem(state, pid)
  },
  step,
  makeView,
  makeBot,

  // ── 클라: 내 엔티티 위치 예측(①) ──
  localKey: 'karts',
  angleField: 'heading',
  readInput: (c) => ({ steer: c.steer || 0, brake: !!c.brake, drift: !!c.drift }),
  inputSig: (c) => `${(c.steer || 0).toFixed(2)}|${!!c.brake}|${!!c.drift}`,
  predictLocal(pred, ctrl, me, dt) {
    // 핸들 조작은 즉시 반영(엔진과 같은 규약: heading 회전 + 전방 전진).
    pred.ang += (ctrl.steer || 0) * TURN_RATE * dt
    const sp = me.speed || 0
    pred.x += Math.cos(pred.ang) * sp * dt
    pred.z += Math.sin(pred.ang) * sp * dt
  },

  // ── 게스트 보간(③): 남의 카트/오브젝트를 두 스냅샷 사이로 부드럽게 ──
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
    const time = lerp(a.v.time ?? 0, b.v.time ?? 0)
    const karts = b.v.karts.map((kb) => {
      const ka = a.v.karts.find((k) => k.id === kb.id)
      if (!ka) return kb
      return {
        ...kb,
        x: lerp(ka.x, kb.x),
        z: lerp(ka.z, kb.z),
        y: lerp(ka.y || 0, kb.y || 0),
        heading: lerp(ka.heading, kb.heading),
        spin: lerp(ka.spin || 0, kb.spin || 0),
        flyT: lerp(ka.flyT || 0, kb.flyT || 0),
      }
    })
    const objects = (b.v.objects || []).map((ob) => {
      const oa = a.v.objects?.find((o) => o.id === ob.id)
      if (!oa) return ob
      return { ...ob, x: lerp(oa.x, ob.x), z: lerp(oa.z, ob.z) }
    })
    return { ...b.v, time, karts, objects }
  },
}
