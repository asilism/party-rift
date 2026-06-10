// 파티 카트 순수 게임 로직 (호스트 권위).
//  - 자동 가속: 출력은 자동, 입력은 조향(steer) / 브레이크(brake) / 아이템 사용뿐.
//  - 호스트가 step()을 60Hz로 돌리고 makeView()로 직렬화 스냅샷을 전파한다.
import { TRACK, BOX_SPOTS, nearestSample, wrapDelta, samplePoint } from './track.js'

export const STEP = 1 / 60 // 물리 틱 (초)
export const LAPS = 3
export const COUNTDOWN_TIME = 3 // 출발 카운트다운 (초)

const MAX_SPEED = 26 // m/s
const ACCEL = 16
const BRAKE_DECEL = 34
const TURN_RATE = 1.7 // rad/s (풀 조향). 아이들이 몰기 쉽게 완만하게.
const EDGE_FACTOR = 0.45 // 트랙 가장자리에 닿았을 때 최고속 비율 (잔디 수준)
const EDGE_ASSIST = 2.4 // 가장자리에서 트랙 방향으로 되돌려주는 회전 속도 (rad/s)
const EDGE_IN_ANGLE = 0.3 // 되돌릴 때 트랙 안쪽으로 트는 각도
const BOOST_FACTOR = 1.5
const BOOST_TIME = 1.7
const STUN_TIME = 1.3
const KART_RADIUS = 1.2 // 카트끼리 충돌 반경
const BOX_RESPAWN = 4 // 아이템 박스 리스폰 (초)
const ROCKET_SPEED = 55 // m/s (센터라인을 따라 날아감)
const ROCKET_LIFE = 4
const END_GRACE = 30 // 1등 골인 후 나머지가 들어올 수 있는 시간 (초)

export function createGame(players, rng = Math.random) {
  const n = TRACK.n
  const karts = players.map((p, i) => {
    const si = (n - 5 - i * 3 + n) % n // 출발선 뒤로 줄지어 배치
    const s = TRACK.samples[si]
    const lat = (i % 2 === 0 ? -1 : 1) * 2.2
    return {
      id: p.id,
      name: p.name,
      zodiacId: p.zodiacId,
      color: p.color,
      x: s.x + s.nx * lat,
      z: s.z + s.nz * lat,
      heading: Math.atan2(s.dz, s.dx),
      speed: 0,
      steer: 0,
      brake: false,
      ci: si, // 가장 가까운 샘플 인덱스
      prog: si - n, // 누적 진행도(샘플 단위). 출발선 통과 시 0을 넘는다.
      item: null, // null | 'boost' | 'banana' | 'rocket'
      boostT: 0,
      stunT: 0,
      spin: 0, // 스턴 중 회전 연출용 각도
      offroad: false,
      finished: false,
      finishTime: null,
    }
  })
  return {
    status: 'countdown', // 'countdown' | 'racing' | 'finished'
    time: 0,
    countdown: COUNTDOWN_TIME,
    karts,
    boxes: BOX_SPOTS.map(() => ({ t: 0 })), // t>0이면 리스폰 대기
    objects: [], // {kind:'banana'|'rocket', id, x, z, ...}
    finishOrder: [],
    endTimer: null,
    nextObjId: 1,
    rng,
  }
}

// 조향/브레이크 입력 (호스트 자신 + 게스트 action 양쪽에서 호출)
export function setInput(state, id, { steer = 0, brake = false } = {}) {
  const k = state.karts.find((p) => p.id === id)
  if (!k) return state
  k.steer = Math.max(-1, Math.min(1, Number(steer) || 0))
  k.brake = !!brake
  return state
}

// 갖고 있는 아이템 사용
export function fireItem(state, id) {
  if (state.status !== 'racing') return state
  const k = state.karts.find((p) => p.id === id)
  if (!k || !k.item || k.finished || k.stunT > 0) return state
  const item = k.item
  k.item = null
  if (item === 'boost') {
    k.boostT = BOOST_TIME
  } else if (item === 'banana') {
    // 내 뒤에 떨어뜨린다
    state.objects.push({
      kind: 'banana',
      id: state.nextObjId++,
      x: k.x - Math.cos(k.heading) * 3,
      z: k.z - Math.sin(k.heading) * 3,
    })
  } else if (item === 'rocket') {
    // 센터라인을 따라 앞으로 날아가는 로켓
    const p = samplePoint(TRACK, k.prog + 2)
    state.objects.push({
      kind: 'rocket',
      id: state.nextObjId++,
      owner: k.id,
      prog: k.prog + 2,
      life: ROCKET_LIFE,
      x: p.x,
      z: p.z,
      heading: Math.atan2(p.dz, p.dx),
    })
  }
  return state
}

// 물리 1틱
export function step(state, dt) {
  state.time += dt
  if (state.status === 'countdown') {
    state.countdown = Math.max(0, COUNTDOWN_TIME - state.time)
    if (state.time >= COUNTDOWN_TIME) {
      state.status = 'racing'
      state.countdown = 0
    }
    return state
  }
  if (state.status === 'finished') return state

  for (const k of state.karts) stepKart(k, dt)
  collideKarts(state.karts)
  stepBoxes(state)
  stepObjects(state, dt)
  checkFinish(state, dt)
  return state
}

function stepKart(k, dt) {
  if (k.stunT > 0) {
    // 스턴: 빙글 돌며 미끄러진다
    k.stunT = Math.max(0, k.stunT - dt)
    k.spin += dt * 9
    k.speed = Math.max(0, k.speed - 26 * dt)
  } else {
    k.spin = 0
    const edge = k.offroad ? EDGE_FACTOR : 1
    const boost = k.boostT > 0 ? BOOST_FACTOR : 1
    const target = k.finished ? 0 : MAX_SPEED * edge * boost
    if (k.brake && !k.finished) {
      k.speed = Math.max(0, k.speed - BRAKE_DECEL * dt)
    } else if (k.speed < target) {
      k.speed = Math.min(target, k.speed + ACCEL * boost * dt)
    } else {
      k.speed = Math.max(target, k.speed - 14 * dt) // 가장자리/부스트 종료 시 감속
    }
    // 조이스틱 중앙 부근은 미세 조향(제곱 커브), 저속에선 덜 돌고,
    // 브레이크 중엔 코너링이 좋아진다
    const steerEff = Math.min(1, k.speed / 8) * (k.brake ? 1.3 : 1)
    k.heading += k.steer * Math.abs(k.steer) * TURN_RATE * steerEff * dt
  }
  k.boostT = Math.max(0, k.boostT - dt)

  k.x += Math.cos(k.heading) * k.speed * dt
  k.z += Math.sin(k.heading) * k.speed * dt

  // 트랙 기준 위치: 가장자리에 닿으면 잔디만큼 감속 + 트랙을 벗어나지 않게
  // 위치를 잡아주고, 진행 방향(살짝 안쪽)으로 부드럽게 되돌려준다
  const ci = nearestSample(TRACK, k.x, k.z, k.ci)
  const s = TRACK.samples[ci]
  const lat = (k.x - s.x) * s.nx + (k.z - s.z) * s.nz
  const edge = TRACK.halfW - 0.6 // 카트 폭 고려
  k.offroad = Math.abs(lat) >= edge // 가장자리 접촉 (감속용 플래그)
  if (Math.abs(lat) > edge) {
    const cl = Math.sign(lat) * edge
    k.x -= s.nx * (lat - cl)
    k.z -= s.nz * (lat - cl)
    const desired = Math.atan2(s.dz, s.dx) - Math.sign(lat) * EDGE_IN_ANGLE
    let d = desired - k.heading
    while (d > Math.PI) d -= 2 * Math.PI
    while (d < -Math.PI) d += 2 * Math.PI
    k.heading += Math.max(-EDGE_ASSIST * dt, Math.min(EDGE_ASSIST * dt, d))
  }
  k.prog += wrapDelta(ci - k.ci, TRACK.n)
  k.ci = ci
}

// 카트끼리 가볍게 밀어내기
function collideKarts(karts) {
  const minD = KART_RADIUS * 2
  for (let i = 0; i < karts.length; i++) {
    for (let j = i + 1; j < karts.length; j++) {
      const a = karts[i]
      const b = karts[j]
      let dx = b.x - a.x
      let dz = b.z - a.z
      const d = Math.hypot(dx, dz)
      if (d >= minD || d === 0) continue
      dx /= d
      dz /= d
      const push = (minD - d) / 2
      a.x -= dx * push
      a.z -= dz * push
      b.x += dx * push
      b.z += dz * push
    }
  }
}

// 아이템 박스: 줍기 + 리스폰
function stepBoxes(state) {
  state.boxes.forEach((b, i) => {
    if (b.t > 0) return
    const spot = BOX_SPOTS[i]
    for (const k of state.karts) {
      if (k.item || k.finished || k.stunT > 0) continue
      const dx = k.x - spot.x
      const dz = k.z - spot.z
      if (dx * dx + dz * dz < 2 * 2) {
        k.item = rollItem(state, k)
        b.t = BOX_RESPAWN
        break
      }
    }
  })
}

// 순위에 따라 아이템 확률이 달라진다 (꼴찌는 부스트가 잘 나옴)
function rollItem(state, k) {
  const order = ranking(state)
  const idx = order.findIndex((o) => o.id === k.id)
  const pool =
    idx === 0 && order.length > 1
      ? ['banana', 'banana', 'rocket']
      : idx === order.length - 1 && order.length > 1
        ? ['boost', 'boost', 'rocket']
        : ['boost', 'banana', 'rocket']
  return pool[Math.floor(state.rng() * pool.length)]
}

function stunKart(k) {
  k.stunT = STUN_TIME
  k.speed *= 0.25
}

// 바나나/로켓 이동 + 충돌
function stepObjects(state, dt) {
  const remove = new Set()
  for (const o of state.objects) {
    if (o.kind === 'rocket') {
      o.prog += (ROCKET_SPEED / TRACK.segLen) * dt
      o.life -= dt
      const p = samplePoint(TRACK, o.prog)
      o.x = p.x
      o.z = p.z
      o.heading = Math.atan2(p.dz, p.dx)
      if (o.life <= 0) remove.add(o.id)
    }
    for (const k of state.karts) {
      if (k.finished || k.stunT > 0) continue
      if (o.kind === 'rocket' && k.id === o.owner) continue
      const r = o.kind === 'rocket' ? 2 : 1.6
      const dx = k.x - o.x
      const dz = k.z - o.z
      if (dx * dx + dz * dz < r * r) {
        stunKart(k)
        remove.add(o.id)
        break
      }
    }
  }
  if (remove.size) state.objects = state.objects.filter((o) => !remove.has(o.id))
}

// 골인 판정 + 1등 골인 후 제한시간
function checkFinish(state, dt) {
  const goal = TRACK.n * LAPS
  for (const k of state.karts) {
    if (!k.finished && k.prog >= goal) {
      k.finished = true
      k.finishTime = state.time
      state.finishOrder.push(k.id)
      if (state.endTimer == null) state.endTimer = END_GRACE
    }
  }
  if (state.endTimer != null) state.endTimer -= dt
  if (state.karts.every((k) => k.finished) || (state.endTimer != null && state.endTimer <= 0)) {
    state.status = 'finished'
  }
}

// 현재 순위 (골인 순서 우선, 나머지는 진행도 순)
export function ranking(state) {
  const fo = state.finishOrder
  return [...state.karts].sort((a, b) => {
    const ai = fo.indexOf(a.id)
    const bi = fo.indexOf(b.id)
    if (ai !== -1 || bi !== -1) {
      if (ai === -1) return 1
      if (bi === -1) return -1
      return ai - bi
    }
    return b.prog - a.prog
  })
}

// 표시용 랩 (1 ~ LAPS)
export function displayLap(k) {
  return Math.max(1, Math.min(LAPS, Math.floor(k.prog / TRACK.n) + 1))
}

const r2 = (v) => Math.round(v * 100) / 100
const r3 = (v) => Math.round(v * 1000) / 1000

// 게스트에게 보낼 직렬화 스냅샷 (렌더러도 이 형태만 본다)
export function makeView(state) {
  const order = ranking(state)
  const rankOf = new Map(order.map((k, i) => [k.id, i + 1]))
  return {
    phase: 'play',
    status: state.status,
    time: r2(state.time),
    countdown: Math.ceil(state.countdown),
    go: state.status === 'racing' && state.time < COUNTDOWN_TIME + 1,
    endTimer: state.endTimer == null ? null : Math.max(0, Math.ceil(state.endTimer)),
    karts: state.karts.map((k) => ({
      id: k.id,
      name: k.name,
      zodiacId: k.zodiacId,
      color: k.color,
      x: r2(k.x),
      z: r2(k.z),
      heading: r3(k.heading),
      speed: r2(k.speed),
      lap: displayLap(k),
      rank: rankOf.get(k.id),
      item: k.item,
      boostT: r2(k.boostT),
      stunT: r2(k.stunT),
      spin: r3(k.spin),
      offroad: k.offroad,
      finished: k.finished,
    })),
    objects: state.objects.map((o) => ({
      kind: o.kind,
      id: o.id,
      x: r2(o.x),
      z: r2(o.z),
      heading: o.heading ? r3(o.heading) : 0,
    })),
    boxes: state.boxes.map((b) => b.t <= 0),
    finishOrder: [...state.finishOrder],
  }
}
