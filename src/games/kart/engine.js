// 파티 카트 순수 게임 로직 (호스트 권위).
//  - 자동 가속: 출력은 자동, 입력은 조향(steer) / 브레이크(brake) / 아이템 사용뿐.
//  - 호스트가 step()을 60Hz로 돌리고 makeView()로 직렬화 스냅샷을 전파한다.
import {
  TRACK, TRACKS, DEFAULT_TRACK_ID, PAD_HALF_W,
  nearestSample, wrapDelta, samplePoint, obstaclePose, obstacleTrackPos, obstacleVisible, onIce, inGap,
} from './track.js'

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
const PAD_BOOST = 1.25 // 가속 발판을 밟았을 때 부스트 시간 (초)
const BOT_SPEED_CAP = 0.97 // CPU 최고속 상한 (아이들이 이길 수 있게 < 1)
const STUN_TIME = 1.3
const KART_RADIUS = 1.2 // 카트끼리 충돌 반경
const BOX_RESPAWN = 4 // 아이템 박스 리스폰 (초)
const BOMB_SPEED = 55 // m/s (폭탄: 센터라인을 따라 날아감)
const BOMB_LIFE = 4
const ROCKET_TIME_MAX = 8 // 로켓 변신 최대 지속 시간 (초)
const ROCKET_RIDE_SPEED = 58 // 로켓 변신 중 속도 (m/s)
const END_GRACE = 30 // 1등 골인 후 나머지가 들어올 수 있는 시간 (초)
const LIGHTNING_STUN = 1.1 // 번개에 맞은 카트의 스턴 시간 (초)
const LIGHTNING_FLASH = 0.6 // 번개 발동 시 하늘이 번쩍이는 시간 (초)
const DRAFT_DIST = 8 // 슬립스트림: 앞 카트와 이 거리(m) 안에서
const DRAFT_LAT = 1.8 // 좌우로 이만큼 가까이 따라붙으면
const DRAFT_TIME = 1.0 // 이 시간(초)만큼 유지 시 부스트 발동
const DRAFT_BOOST = 0.9 // 슬립스트림 부스트 지속 시간 (초)
const DRAFT_MIN_SPEED = 18 // 슬립스트림이 차오르는 최소 속도 (m/s)
const ICE_STEER = 0.45 // 빙판 위 조향 효율 (핸들이 주르륵~)
const DRIFT_MIN_SPEED = 13 // 드리프트 유지에 필요한 최소 속도 (m/s)
const DRIFT_START_STEER = 0.3 // 드리프트 시작에 필요한 조향량
const DRIFT_SLIP = 0.3 // 드리프트 중 차체가 옆으로 미끄러지는 각도 (rad)
const DRIFT_TURN_BASE = 1.0 // 드리프트 기본 회전 배율 (조향으로 깊이 조절)
const DRIFT_TURN_LEAN = 0.55
export const DRIFT_TIERS = [0.7, 1.5, 2.5] // 미니터보 충전 단계 (초) — 아이들도 금방 차게
const DRIFT_BOOSTS = [0.6, 1.0, 1.5] // 단계별 미니터보 지속 시간 (초)
const START_DASH_WINDOW = 1 // 출발 전 이 시간(초) 안에 드리프트를 누르고 있으면
const START_DASH_BOOST = 0.9 // 스타트 대시 부스트 (초)
const GRAV = 22 // 점프 중력 (m/s²) — 만화처럼 살짝 무겁게, 체공이 짧고 경쾌하게
const JUMP_VY = 0.34 // 점프대 발사 수직 속도 = 진입 속도 × 이 값 (빠를수록 멀리!)
const AIR_STEER = 0.3 // 공중 조향 효율
const FALL_SINK = 3 // 도로보다 이만큼 아래로 떨어지면 추락 확정 (m)
const FALL_TIME = 1.4 // 추락 연출 시간 (초)
const RESPAWN_BACK = 8 // 낭떠러지 몇 샘플 앞에서 다시 출발할지
const SNOWMAN_RESPAWN = 7 // 부서진 눈사람이 다시 만들어지는 시간 (초)
const OB_BOUNCE_SLOW = 0.7 // 소/펭귄에 부딪혔을 때 속도 배율
export const FLY_TIME = 1.3 // 회오리에 휘말려 하늘로 붕 떠 있는 시간 (초, 렌더러 공유)
const INV_TIME = 1.6 // 패널티가 끝난 뒤 무적(깜빡임) 시간 (초)

export function createGame(players, rng = Math.random, trackId = DEFAULT_TRACK_ID) {
  const track = TRACKS[trackId] || TRACK
  const n = track.n
  const karts = players.map((p, i) => {
    const si = (n - 5 - i * 3 + n) % n // 출발선 뒤로 줄지어 배치
    const s = track.samples[si]
    const lat = (i % 2 === 0 ? -1 : 1) * 2.2
    return {
      id: p.id,
      name: p.name,
      zodiacId: p.zodiacId,
      color: p.color,
      isBot: !!p.isBot,
      botSpeed: p.isBot ? 0.85 + rng() * 0.07 : 1, // CPU 기본 속도 (아이 수준)
      botPhase: rng() * Math.PI * 2, // CPU 조향 흔들림 위상
      botItemT: null, // CPU 아이템 사용 대기 시간
      speedFactor: 1,
      x: s.x + s.nx * lat,
      z: s.z + s.nz * lat,
      lat,
      heading: Math.atan2(s.dz, s.dx),
      speed: 0,
      steer: 0,
      brake: false,
      drift: false, // 드리프트 버튼 입력
      driftDir: 0, // 드리프트 중인 방향 (-1 | 0 | 1)
      driftT: 0, // 미니터보 충전 시간 (드리프트 유지 누적)
      turboSeq: 0, // 미니터보 발동 횟수 (HUD 배너 트리거)
      startDash: false, // 출발 직전 드리프트를 누르고 있었나 (스타트 대시)
      ky: s.y || 0, // 월드 높이 (도로 고도 + 점프)
      vy: 0, // 수직 속도 (점프/낙하)
      air: false, // 점프대/낭떠러지로 공중에 떠 있는 상태
      fallT: 0, // 추락(용암 풍덩) 연출 남은 시간
      respawnI: si, // 추락 후 다시 출발할 샘플
      jumpSeq: 0, // 점프대 발사 횟수 (HUD/효과음 트리거)
      fallSeq: 0, // 추락 횟수 (HUD/효과음 트리거)
      ci: si, // 가장 가까운 샘플 인덱스
      prog: si - n, // 누적 진행도(샘플 단위). 출발선 통과 시 0을 넘는다.
      item: null, // null | 'boost' | 'banana' | 'bomb' | 'rocket' | 'lightning'
      itemSeq: 0, // 아이템을 새로 뽑을 때마다 +1 (슬롯머신 연출 트리거)
      boostT: 0,
      draftT: 0, // 슬립스트림 게이지 (앞 카트 뒤에 붙은 누적 시간)
      draftSeq: 0, // 슬립스트림 부스트 발동 횟수 (HUD 배너 트리거)
      bumpSeq: 0, // 장애물에 부딪힌 횟수 (HUD 배너/효과음 트리거)
      bumpKind: null, // 마지막으로 부딪힌 장애물 종류
      bumpCool: 0, // 장애물 연속 충돌 방지 쿨다운 (밀고 들어오는 소 대응)
      rocketT: 0, // 로켓 변신 남은 시간
      rocketGoal: null, // 로켓 변신이 끝나는 목표 진행도
      stunT: 0,
      flyT: 0, // 회오리에 휘말려 공중에 떠 있는 남은 시간
      invT: 0, // 패널티 후 무적(깜빡임) 남은 시간
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
    track,
    trackId: track.id,
    karts,
    boxes: track.boxSpots.map(() => ({ t: 0 })), // t>0이면 리스폰 대기
    obsT: (track.obstacles || []).map(() => 0), // 부서진 눈사람 리스폰 타이머
    objects: [], // {kind:'banana'|'rocket', id, x, z, ...}
    finishOrder: [],
    endTimer: null,
    nextObjId: 1,
    lightningT: 0, // 번개 발동 후 하늘이 번쩍이는 남은 시간
    rng,
  }
}

// 조향/브레이크/드리프트 입력 (호스트 자신 + 게스트 action 양쪽에서 호출)
export function setInput(state, id, { steer = 0, brake = false, drift = false } = {}) {
  const k = state.karts.find((p) => p.id === id)
  if (!k) return state
  k.steer = Math.max(-1, Math.min(1, Number(steer) || 0))
  k.brake = !!brake
  k.drift = !!drift
  return state
}

// 미니터보 충전 단계 (0 = 아직, 1~3 = 파랑/주황/보라)
export function driftLevel(t) {
  let lvl = 0
  for (let i = 0; i < DRIFT_TIERS.length; i++) if (t >= DRIFT_TIERS[i]) lvl = i + 1
  return lvl
}

// 드리프트 종료. reward면 충전된 단계만큼 미니터보가 터진다.
function releaseDrift(k, reward = true) {
  const lvl = reward ? driftLevel(k.driftT) : 0
  k.driftDir = 0
  k.driftT = 0
  if (lvl > 0) {
    k.boostT = Math.max(k.boostT, DRIFT_BOOSTS[lvl - 1])
    k.turboSeq++
  }
}

// 연결이 끊긴 참가자의 카트를 CPU가 이어받는다 (레이스는 멈추지 않는다)
export function makeBot(state, id) {
  const k = state.karts.find((p) => p.id === id)
  if (!k || k.isBot) return null
  k.isBot = true
  k.botSpeed = 0.85 + state.rng() * 0.07
  k.botPhase = state.rng() * Math.PI * 2
  k.botItemT = null
  k.drift = false
  k.brake = false
  releaseDrift(k, false)
  return k
}

// 갖고 있는 아이템 사용
export function fireItem(state, id) {
  if (state.status !== 'racing') return state
  const k = state.karts.find((p) => p.id === id)
  if (!k || !k.item || k.finished || k.stunT > 0 || k.flyT > 0 || k.rocketT > 0 || k.fallT > 0) {
    return state
  }
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
  } else if (item === 'bomb') {
    // 센터라인을 따라 앞으로 날아가는 폭탄
    const p = samplePoint(state.track, k.prog + 2)
    state.objects.push({
      kind: 'bomb',
      id: state.nextObjId++,
      owner: k.id,
      prog: k.prog + 2,
      life: BOMB_LIFE,
      x: p.x,
      z: p.z,
      heading: Math.atan2(p.dz, p.dx),
    })
  } else if (item === 'lightning') {
    // 꼴찌의 대역전 카드: 내 앞의 모든 카트가 번개에 맞아 잠깐 스턴!
    state.lightningT = LIGHTNING_FLASH
    for (const o of state.karts) {
      if (o === k || o.finished || o.rocketT > 0 || o.invT > 0 || o.flyT > 0 || o.fallT > 0) continue
      if (o.prog > k.prog) {
        stunKart(o, LIGHTNING_STUN)
        o.boostT = 0
      }
    }
  } else if (item === 'rocket') {
    // 카트가 로켓으로 변신해 트랙을 따라 자동 질주.
    // 1등이 억울하지 않게 "격차의 절반"까지만 따라잡는다.
    const others = state.karts.filter((o) => o !== k)
    const leaderProg = others.length ? Math.max(...others.map((o) => o.prog)) : k.prog
    const gain = Math.max(20, (leaderProg - k.prog) / 2)
    k.rocketGoal = k.prog + gain
    k.rocketT = Math.min(ROCKET_TIME_MAX, (gain * state.track.segLen) / ROCKET_RIDE_SPEED + 0.3)
    k.stunT = 0
    k.spin = 0
  }
  return state
}

// 물리 1틱
export function step(state, dt) {
  state.time += dt
  if (state.status === 'countdown') {
    state.countdown = Math.max(0, COUNTDOWN_TIME - state.time)
    // 스타트 대시: 출발 직전부터 드리프트 버튼을 누르고 있으면 출발 부스트!
    // (일찍 눌러도 패널티 없음 — 그냥 계속 누르고 있으면 된다)
    if (state.countdown <= START_DASH_WINDOW) {
      for (const k of state.karts) if (k.drift && !k.isBot) k.startDash = true
    }
    if (state.time >= COUNTDOWN_TIME) {
      state.status = 'racing'
      state.countdown = 0
      for (const k of state.karts) if (k.startDash) k.boostT = START_DASH_BOOST
    }
    return state
  }
  if (state.status === 'finished') return state

  stepBots(state, dt)
  for (const k of state.karts) stepKart(state, k, dt)
  collideKarts(state.karts)
  stepPads(state)
  stepDraft(state, dt)
  stepObstacles(state, dt)
  stepBoxes(state, dt)
  stepObjects(state, dt)
  checkFinish(state, dt)
  state.lightningT = Math.max(0, state.lightningT - dt)
  return state
}

// CPU 카트 운전 (아이 수준: 흔들리는 조향 + 낮은 최고속 + 가벼운 고무줄)
function stepBots(state, dt) {
  const leader = Math.max(...state.karts.map((o) => o.prog))
  const track = state.track
  for (const k of state.karts) {
    if (!k.isBot || k.finished || k.rocketT > 0) continue
    // 트랙 앞쪽 샘플을 향해 조향. 앞에 장애물이 보이면 "내가 도착할 시점"의
    // 장애물 위치를 예측해 반대쪽으로 비켜 간다 (움직이는 소/펭귄 대응).
    let aimLat = 0
    for (const ob of track.obstacles || []) {
      const now = obstacleTrackPos(track, ob, state.time)
      const ahead = wrapDelta(Math.round(now.prog) - k.ci, track.n)
      if (ahead < 0 || ahead > 26) continue
      const eta = (ahead * track.segLen) / Math.max(10, k.speed)
      const op = obstacleTrackPos(track, ob, state.time + eta)
      if (Math.abs(op.lat - k.lat) > 4.5) continue
      const side = op.lat > 0 ? -1 : 1 // 장애물이 오른쪽이면 왼쪽으로
      aimLat = Math.max(-track.halfW + 1.6, Math.min(track.halfW - 1.6, op.lat + side * 5))
      break
    }
    const s = track.samples[(k.ci + 10) % track.n]
    const t = { x: s.x + s.nx * aimLat, z: s.z + s.nz * aimLat }
    const desired = Math.atan2(t.z - k.z, t.x - k.x)
    let d = desired - k.heading
    while (d > Math.PI) d -= 2 * Math.PI
    while (d < -Math.PI) d += 2 * Math.PI
    k.steer = Math.max(-1, Math.min(1, d * 1.6 + Math.sin(state.time * 1.7 + k.botPhase) * 0.1))
    k.brake = Math.abs(d) > 1 && k.speed > 16 // 급코너에서만 살짝
    // 뒤처지면 살짝 빨라진다 (상한은 사람보다 낮게 → 이기기 쉬움)
    const gap = Math.max(0, leader - k.prog)
    k.speedFactor = Math.min(BOT_SPEED_CAP, k.botSpeed + gap * 0.0012)
    // 아이템은 잠깐 있다가 사용
    if (k.item) {
      if (k.botItemT == null) k.botItemT = 0.8 + state.rng() * 1.6
      k.botItemT -= dt
      if (k.botItemT <= 0) {
        k.botItemT = null
        fireItem(state, k.id)
      }
    } else {
      k.botItemT = null
    }
  }
}

// 가속 발판: 카트 한 대 폭, 트랙 안 무작위 위치 — 밟으면 버섯처럼 순간 부스트
function stepPads(state) {
  for (const k of state.karts) {
    if (k.finished || k.stunT > 0 || k.flyT > 0 || k.rocketT > 0 || k.air || k.fallT > 0) continue
    for (const pad of state.track.pads) {
      const d = wrapDelta(k.ci - pad.i, state.track.n)
      if (d >= -1 && d <= 3 && Math.abs(k.lat - pad.lat) <= PAD_HALF_W) {
        k.boostT = Math.max(k.boostT, PAD_BOOST)
      }
    }
  }
}

// 슬립스트림: 앞 카트 꽁무니에 바짝 붙어 달리면 게이지가 차고,
// 다 차면 부스트가 터지며 추월 찬스! (봇도 동일하게 적용)
function stepDraft(state, dt) {
  for (const k of state.karts) {
    if (
      k.finished || k.stunT > 0 || k.flyT > 0 || k.rocketT > 0 || k.air || k.fallT > 0 ||
      k.boostT > 0 || k.speed < DRAFT_MIN_SPEED
    ) {
      k.draftT = 0
      continue
    }
    const tail = state.karts.some((o) => {
      if (o === k || o.finished) return false
      const gap = wrapDelta(o.ci - k.ci, state.track.n) * state.track.segLen
      return gap > 1 && gap < DRAFT_DIST && Math.abs(o.lat - k.lat) < DRAFT_LAT
    })
    if (!tail) {
      k.draftT = Math.max(0, k.draftT - dt * 2) // 떨어지면 게이지가 빠르게 줄어든다
      continue
    }
    k.draftT += dt
    if (k.draftT >= DRAFT_TIME) {
      k.draftT = 0
      k.draftSeq++
      k.boostT = Math.max(k.boostT, DRAFT_BOOST)
    }
  }
}

// 맵별 명물 장애물 (위치는 시간의 순수 함수 → obstaclePose).
//  - 🐄 소 / 🐧 펭귄: 부딪히면 통! 튕겨나며 감속 (스턴 없음, 웃긴 사고)
//  - 🌵 선인장: 따가워서 스턴 / 🌪️ 회오리: 휘말려서 빙글빙글 스턴
//  - ⛄ 눈사람: 박으면 와장창 부서지고(잠시 후 복구) 속도가 뚝
function stepObstacles(state, dt) {
  const track = state.track
  if (!track.obstacles?.length) return
  track.obstacles.forEach((ob, idx) => {
    if (ob.kind === 'snowman' && state.obsT[idx] > 0) {
      state.obsT[idx] = Math.max(0, state.obsT[idx] - dt) // 부서짐 → 리스폰 대기 후 재생성
      return
    }
    if (!obstacleVisible(track, ob, state.time)) return // 코스 밖으로 나간 소
    const pos = obstaclePose(track, ob, state.time)
    for (const k of state.karts) {
      if (
        k.finished || k.rocketT > 0 || k.stunT > 0 || k.flyT > 0 || k.invT > 0 ||
        k.air || k.fallT > 0 // 점프로 장애물을 뛰어넘을 수 있다!
      ) continue
      const r = ob.r + 1 // 카트 반경 고려
      let dx = k.x - pos.x
      let dz = k.z - pos.z
      const d2 = dx * dx + dz * dz
      if (d2 >= r * r) continue
      // 장애물 밖으로 밀어내기
      const d = Math.sqrt(d2) || 0.001
      dx /= d
      dz /= d
      k.x = pos.x + dx * r
      k.z = pos.z + dz * r
      // 소가 옆에서 밀고 들어오면 닿아 있는 동안 틱마다 충돌이 나므로
      // 효과(감속/카운트)는 쿨다운 한 번에 한 번만
      if (k.bumpCool > 0) continue
      k.bumpCool = 0.8
      k.bumpSeq++
      k.bumpKind = ob.kind
      if (ob.kind === 'cactus' || ob.kind === 'snowman') {
        // 고정 장애물에 정면으로 박으면 옆으로 튕겨낸다 —
        // 저속에선 조향이 약해 같은 자리로 재돌진(무한 스턴)하기 때문
        const s = track.samples[ob.i]
        const side = Math.sign(k.lat - ob.lat) || (ob.lat > 0 ? -1 : 1)
        const maxLat = track.halfW - 0.8
        const tl = Math.max(-maxLat, Math.min(maxLat, ob.lat + side * (ob.r + 1.6)))
        k.x = s.x + s.nx * tl
        k.z = s.z + s.nz * tl
      }
      if (ob.kind === 'cactus' || ob.kind === 'magma') {
        stunKart(k, 1.0) // 따갑거나 앗 뜨겁거나!
      } else if (ob.kind === 'tornado') {
        // 토네이도처럼 카트를 하늘로 붕! 날려버린다 (착지 후 잠시 무적)
        k.flyT = FLY_TIME
        k.invT = Math.max(k.invT, FLY_TIME + INV_TIME)
        k.speed *= 0.6
      } else if (ob.kind === 'snowman') {
        k.speed *= 0.45
        state.obsT[idx] = SNOWMAN_RESPAWN
        break // 부서졌으니 이번 틱은 끝
      } else {
        k.speed *= OB_BOUNCE_SLOW // 소/펭귄: 통통 바운스
      }
    }
  })
}

function stepKart(state, k, dt) {
  const track = state.track
  // 추락(용암 풍덩): 빙글 돌며 가라앉았다가 낭떠러지 앞에서 다시 출발
  if (k.fallT > 0) {
    k.fallT = Math.max(0, k.fallT - dt)
    k.spin += dt * 8
    k.ky -= dt * 2.5
    k.speed = 0
    if (k.fallT === 0) {
      const s = track.samples[k.respawnI]
      k.x = s.x
      k.z = s.z
      k.heading = Math.atan2(s.dz, s.dx)
      k.prog += wrapDelta(k.respawnI - k.ci, track.n)
      k.ci = k.respawnI
      k.ky = s.y || 0
      k.vy = 0
      k.air = false
      k.speed = 6
      k.stunT = 0
      k.spin = 0
      k.invT = Math.max(k.invT, INV_TIME)
    }
    return
  }
  // 로켓 변신: 센터라인을 따라 자동 질주, 모든 공격에 면역.
  // 목표(격차의 절반)에 닿거나 시간이 다 되면 변신이 풀린다.
  if (k.rocketT > 0) {
    releaseDrift(k, false)
    k.rocketT = Math.max(0, k.rocketT - dt)
    k.spin = 0
    k.stunT = 0
    k.offroad = false
    k.lat = 0
    const aim = samplePoint(track, k.prog + 10)
    k.heading = Math.atan2(aim.z - k.z, aim.x - k.x)
    k.speed = ROCKET_RIDE_SPEED
    k.x += Math.cos(k.heading) * k.speed * dt
    k.z += Math.sin(k.heading) * k.speed * dt
    const rci = nearestSample(track, k.x, k.z, k.ci)
    k.prog += wrapDelta(rci - k.ci, track.n)
    k.ci = rci
    k.ky = track.samples[k.ci].y || 0 // 로켓은 협곡도 그냥 날아서 건넌다
    k.air = false
    k.vy = 0
    if (k.rocketGoal != null && k.prog >= k.rocketGoal) k.rocketT = 0
    if (k.rocketT === 0) k.speed = MAX_SPEED // 변신 해제 → 카트 속도로 복귀
    return
  }
  if (k.flyT > 0) {
    // 회오리에 휘말려 공중에! 조향 불가, 빙글 돌며 관성으로 날아간다
    releaseDrift(k, false)
    k.flyT = Math.max(0, k.flyT - dt)
    k.spin += dt * 7
    k.speed = Math.max(6, k.speed - 8 * dt)
  } else if (k.stunT > 0) {
    // 스턴: 빙글 돌며 미끄러진다 (충전 중이던 미니터보도 날아간다)
    releaseDrift(k, false)
    k.stunT = Math.max(0, k.stunT - dt)
    k.spin += dt * 9
    k.speed = Math.max(0, k.speed - 26 * dt)
  } else {
    k.spin = 0
    // 드리프트: 버튼을 누른 채 조향하면 옆으로 미끄러지며 돌고, 유지한 만큼
    // 미니터보가 충전된다(파랑→주황→보라). 버튼을 떼는 순간 부스트!
    // 저연령 배려: 잔디에 닿거나 속도가 떨어져도 그동안 모은 터보는 터뜨려 준다.
    if (k.driftDir === 0) {
      if (
        k.drift && !k.finished && !k.offroad && !k.air &&
        k.speed >= DRIFT_MIN_SPEED && Math.abs(k.steer) >= DRIFT_START_STEER
      ) {
        k.driftDir = Math.sign(k.steer)
      }
    } else if (!k.drift || k.finished || k.offroad || k.air || k.speed < DRIFT_MIN_SPEED * 0.75) {
      releaseDrift(k, !k.finished)
    } else {
      k.driftT += dt
    }
    if (!k.air) {
      // 공중에선 가속/브레이크가 안 듣는다 (수평 속도 유지)
      const edge = k.offroad ? EDGE_FACTOR : 1
      const boost = k.boostT > 0 ? BOOST_FACTOR : 1
      const target = k.finished ? 0 : MAX_SPEED * edge * boost * (k.speedFactor || 1)
      if (k.brake && !k.finished) {
        k.speed = Math.max(0, k.speed - BRAKE_DECEL * dt)
      } else if (k.speed < target) {
        k.speed = Math.min(target, k.speed + ACCEL * boost * dt)
      } else {
        k.speed = Math.max(target, k.speed - 14 * dt) // 가장자리/부스트 종료 시 감속
      }
    }
    // 조이스틱 중앙 부근은 미세 조향(제곱 커브), 저속에선 덜 돌고,
    // 브레이크 중엔 코너링이 좋아진다. 빙판 위에선 핸들이 주르륵~, 공중에선 살짝만
    const ice = onIce(track, k.ci) ? ICE_STEER : 1
    const steerEff =
      Math.min(1, k.speed / 8) * (k.brake ? 1.3 : 1) * ice * (k.air ? AIR_STEER : 1)
    if (k.driftDir) {
      // 드리프트 중엔 도는 방향이 유지되고, 조향은 깊이만 조절한다
      const lean = Math.max(-1, Math.min(1, k.steer * k.driftDir))
      k.heading += k.driftDir * (DRIFT_TURN_BASE + lean * DRIFT_TURN_LEAN) * TURN_RATE * steerEff * dt
    } else {
      k.heading += k.steer * Math.abs(k.steer) * TURN_RATE * steerEff * dt
    }
  }
  k.boostT = Math.max(0, k.boostT - dt)
  k.bumpCool = Math.max(0, k.bumpCool - dt)
  k.invT = Math.max(0, k.invT - dt)

  // 드리프트 중엔 차체가 향한 곳보다 살짝 바깥쪽으로 미끄러진다
  const mh = k.heading - k.driftDir * DRIFT_SLIP
  k.x += Math.cos(mh) * k.speed * dt
  k.z += Math.sin(mh) * k.speed * dt

  // 트랙 기준 위치: 가장자리에 닿으면 잔디만큼 감속 + 트랙을 벗어나지 않게
  // 위치를 잡아주고, 진행 방향(살짝 안쪽)으로 부드럽게 되돌려준다 (공중에선 자유 비행)
  const ci = nearestSample(track, k.x, k.z, k.ci)
  const s = track.samples[ci]
  const lat = (k.x - s.x) * s.nx + (k.z - s.z) * s.nz
  k.lat = lat // 가속 발판 판정 등에서 재사용
  const edge = track.halfW - 0.6 // 카트 폭 고려
  k.offroad = !k.air && Math.abs(lat) >= edge // 가장자리 접촉 (감속용 플래그)
  if (!k.air && Math.abs(lat) > edge) {
    const cl = Math.sign(lat) * edge
    k.x -= s.nx * (lat - cl)
    k.z -= s.nz * (lat - cl)
    const desired = Math.atan2(s.dz, s.dx) - Math.sign(lat) * EDGE_IN_ANGLE
    let d = desired - k.heading
    while (d > Math.PI) d -= 2 * Math.PI
    while (d < -Math.PI) d += 2 * Math.PI
    k.heading += Math.max(-EDGE_ASSIST * dt, Math.min(EDGE_ASSIST * dt, d))
  }
  k.prog += wrapDelta(ci - k.ci, track.n)
  k.ci = ci

  // ── 수직(고도) 물리: 도로는 언덕을 오르내리고, 점프대에선 하늘로! ──
  const gy = track.samples[k.ci].y || 0
  if (k.air) {
    k.vy -= GRAV * dt
    k.ky += k.vy * dt
    if (k.vy <= 0 && k.ky <= gy) {
      if (inGap(track, k.ci)) {
        // 협곡 위 — 도로가 없다! 계속 떨어지다 바닥에 풍덩
        if (k.ky <= gy - FALL_SINK) startFall(state, k)
      } else {
        k.air = false // 착지!
        k.ky = gy
        k.vy = 0
      }
    }
  } else if (k.flyT > 0) {
    k.ky = gy // 회오리 비행의 높이는 렌더러가 따로 그린다
  } else {
    const jp = (track.jumps || []).find((j) => {
      const d = wrapDelta(k.ci - j.i, track.n)
      return d >= 0 && d <= 1
    })
    if (jp && k.speed > 5) {
      // 점프대 발사! 빠를수록 멀리 난다. 드리프트 중이었다면 터보도 함께 터진다.
      releaseDrift(k)
      k.air = true
      k.vy = k.speed * JUMP_VY
      k.jumpSeq++
    } else if (inGap(track, k.ci)) {
      k.air = true // 절벽에서 데굴 — 떨어지기 시작
      k.vy = 0
    } else {
      k.ky = gy
    }
  }
}

// 용암/협곡 바닥으로 추락 — 잠시 후 낭떠러지 앞에서 다시 출발한다
function startFall(state, k) {
  const track = state.track
  k.fallT = FALL_TIME
  k.fallSeq++
  k.air = false
  k.vy = 0
  k.boostT = 0
  releaseDrift(k, false)
  const gap = (track.gaps || []).find((g) => k.ci >= g.from - 2 && k.ci <= g.to + 2)
  k.respawnI = (((gap ? gap.from : k.ci) - RESPAWN_BACK) % track.n + track.n) % track.n
}

// 카트끼리 충돌: 밀어내기 + 박치기(다가오는 속도만큼 서로 주고받음).
// 로켓 변신 카트는 부딪힌 상대를 스턴시키며 그대로 뚫고 지나간다.
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
      // 공중에 뜨거나 추락 중인 카트는 부딪히지 않는다
      if (a.flyT > 0 || b.flyT > 0 || a.air || b.air || a.fallT > 0 || b.fallT > 0) continue
      const aRocket = a.rocketT > 0
      const bRocket = b.rocketT > 0
      if (aRocket !== bRocket) {
        const victim = aRocket ? b : a
        const out = aRocket ? 1 : -1
        if (victim.stunT <= 0 && victim.invT <= 0) stunKart(victim)
        victim.x += dx * out * (minD - d)
        victim.z += dz * out * (minD - d)
        continue
      }
      // 위치 분리
      const push = (minD - d) / 2
      a.x -= dx * push
      a.z -= dz * push
      b.x += dx * push
      b.z += dz * push
      // 속도 전달: 뒤에서 받으면 앞 카트가 튕겨나가고 내가 느려진다
      const va = a.speed * (Math.cos(a.heading) * dx + Math.sin(a.heading) * dz)
      const vb = b.speed * (Math.cos(b.heading) * dx + Math.sin(b.heading) * dz)
      const closing = va - vb
      if (closing > 0) {
        const t = closing * 0.4
        a.speed = Math.max(0, a.speed - t)
        b.speed = Math.min(MAX_SPEED * BOOST_FACTOR, b.speed + t * 0.8)
      }
    }
  }
}

// 아이템 박스: 줍기 + 일정 시간 후 리스폰.
// 이미 아이템이 있어도 다시 뽑는다(리셋 후 재추첨).
function stepBoxes(state, dt) {
  state.boxes.forEach((b, i) => {
    if (b.t > 0) {
      b.t = Math.max(0, b.t - dt)
      return
    }
    const spot = state.track.boxSpots[i]
    for (const k of state.karts) {
      if (k.finished || k.stunT > 0 || k.flyT > 0 || k.rocketT > 0 || k.air || k.fallT > 0) continue
      const dx = k.x - spot.x
      const dz = k.z - spot.z
      if (dx * dx + dz * dz < 2 * 2) {
        k.item = rollItem(state, k)
        k.itemSeq++
        b.t = BOX_RESPAWN
        break
      }
    }
  })
}

// 순위에 따라 아이템 확률이 달라진다.
// 1등과 격차가 크게 벌어지면 따라잡기용 로켓 찬스!
function rollItem(state, k) {
  const order = ranking(state)
  const idx = order.findIndex((o) => o.id === k.id)
  if (idx > 0 && order[0].prog - k.prog > state.track.n / 2) {
    const pool = ['rocket', 'rocket', 'boost']
    return pool[Math.floor(state.rng() * pool.length)]
  }
  const pool =
    idx === 0 && order.length > 1
      ? ['banana', 'banana', 'bomb']
      : idx === order.length - 1 && order.length > 1
        ? ['boost', 'lightning', 'bomb'] // 꼴찌에겐 대역전 번개 찬스
        : ['boost', 'banana', 'bomb']
  return pool[Math.floor(state.rng() * pool.length)]
}

function stunKart(k, t = STUN_TIME) {
  releaseDrift(k, false)
  k.stunT = Math.max(k.stunT, t)
  k.speed *= 0.25
  // 스턴이 풀린 뒤 잠깐 무적(깜빡임) — 연속 패널티로 게임이 끊기지 않게
  k.invT = Math.max(k.invT, t + INV_TIME)
}

// 바나나/폭탄 이동 + 충돌 (로켓 변신 중인 카트는 면역)
function stepObjects(state, dt) {
  const remove = new Set()
  for (const o of state.objects) {
    if (o.kind === 'bomb') {
      o.prog += (BOMB_SPEED / state.track.segLen) * dt
      o.life -= dt
      const p = samplePoint(state.track, o.prog)
      o.x = p.x
      o.z = p.z
      o.heading = Math.atan2(p.dz, p.dx)
      if (o.life <= 0) remove.add(o.id)
    }
    for (const k of state.karts) {
      if (
        k.finished || k.stunT > 0 || k.flyT > 0 || k.invT > 0 || k.rocketT > 0 ||
        k.air || k.fallT > 0
      ) continue
      if (o.kind === 'bomb' && k.id === o.owner) continue
      const r = o.kind === 'bomb' ? 2 : 1.6
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
  const goal = state.track.n * LAPS
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
export function displayLap(k, n = TRACK.n) {
  return Math.max(1, Math.min(LAPS, Math.floor(k.prog / n) + 1))
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
    trackId: state.trackId, // 게스트가 어떤 트랙을 그릴지
    time: r2(state.time),
    countdown: Math.ceil(state.countdown),
    go: state.status === 'racing' && state.time < COUNTDOWN_TIME + 1,
    endTimer: state.endTimer == null ? null : Math.max(0, Math.ceil(state.endTimer)),
    // 선두가 마지막 바퀴에 들어서면 하늘이 노을빛으로 (연출용)
    finalLap: state.karts.some((k) => k.prog >= state.track.n * (LAPS - 1)),
    lightning: state.lightningT > 0, // 번개 발동 중 (하늘 번쩍 연출)
    karts: state.karts.map((k) => ({
      id: k.id,
      name: k.name,
      zodiacId: k.zodiacId,
      color: k.color,
      isBot: k.isBot,
      x: r2(k.x),
      z: r2(k.z),
      heading: r3(k.heading),
      speed: r2(k.speed),
      lap: displayLap(k, state.track.n),
      rank: rankOf.get(k.id),
      item: k.item,
      itemSeq: k.itemSeq,
      draftSeq: k.draftSeq,
      bumpSeq: k.bumpSeq,
      bumpKind: k.bumpKind,
      drift: k.driftDir, // 드리프트 중인 방향 (-1 | 0 | 1)
      driftLvl: driftLevel(k.driftT), // 미니터보 충전 단계 (0~3)
      turboSeq: k.turboSeq,
      startDash: k.startDash,
      y: r2(k.ky), // 월드 높이 (언덕 + 점프)
      air: k.air,
      fallT: r2(k.fallT),
      jumpSeq: k.jumpSeq,
      fallSeq: k.fallSeq,
      boostT: r2(k.boostT),
      rocketT: r2(k.rocketT),
      stunT: r2(k.stunT),
      flyT: r2(k.flyT),
      invT: r2(k.invT),
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
    obs: state.obsT.map((t) => t <= 0), // 장애물 표시 여부 (부서진 눈사람은 false)
    finishOrder: [...state.finishOrder],
  }
}
