// 파티 리프트 맵 데이터 (순수 JS — three.js 의존 없음).
// 좌우 대칭 3개 레인(top/mid/bot) + 정글 구조. 두 가지 크기를 지원한다:
//  · '3v3' — 팀당 3명(원래 맵).
//  · '5v5' — 팀당 5명. 같은 레이아웃을 키운 큰 맵 + 정글 캠프를 늘렸다
//            (탑/미드 솔로, 봇 듀오[원거리+힐러], 정글러가 돌 캠프가 많아진다).
//  - 파랑 진영: 왼쪽(x<0), 빨강 진영: 오른쪽(x>0)
//  - 레인마다 외곽 타워 → 내곽 타워, 본진엔 넥서스 (터지면 게임 끝!)
//  - 본진은 성벽으로 둘러싸여 있고, 출입구 3곳은 모두 내곽 타워 사거리 안 —
//    길(레인)을 따라 타워를 뚫지 않고는 넥서스에 갈 수 없다.
//  - 정글엔 늑대 캠프, 아래 강가에 용, 위 강가에 바론
//  - 수풀에 들어가면 적에게 안 보인다 (은신)

// ── 엔티티 크기(모드와 무관한 상수) ──
export const NEXUS_RADIUS = 4.5
export const FOUNTAIN_RADIUS = 13 // 넥서스 주변 회복 지대
export const TOWER_RADIUS = 2.4 // 통행 막는 몸통 반경
export const WALL_RADIUS = 3 // 벽 두께(충돌 원 반경)
export const LANE_IDS = ['top', 'mid', 'bot']
export const enemyOf = (team) => (team === 'blue' ? 'red' : 'blue')

// ── 기준(3v3) 레이아웃 ──
// 5v5 맵은 아래 좌표를 일정 배율로 키우고(아래 MODE_SCALE) 정글 캠프를 더 얹어 만든다.
const BASE = {
  WORLD: { minX: -108, maxX: 108, minZ: -66, maxZ: 66 },
  NEXUS_POS: { blue: { x: -100, z: 0 }, red: { x: 100, z: 0 } },
  LANES: {
    top: [
      { x: -96, z: 0 }, { x: -88, z: -30 }, { x: -70, z: -48 }, { x: -42, z: -56 },
      { x: 0, z: -58 },
      { x: 42, z: -56 }, { x: 70, z: -48 }, { x: 88, z: -30 }, { x: 96, z: 0 },
    ],
    mid: [
      { x: -96, z: 0 }, { x: -64, z: 0 }, { x: -34, z: 0 }, { x: 0, z: 0 },
      { x: 34, z: 0 }, { x: 64, z: 0 }, { x: 96, z: 0 },
    ],
    bot: [
      { x: -96, z: 0 }, { x: -88, z: 30 }, { x: -70, z: 48 }, { x: -42, z: 56 },
      { x: 0, z: 58 },
      { x: 42, z: 56 }, { x: 70, z: 48 }, { x: 88, z: 30 }, { x: 96, z: 0 },
    ],
  },
  // 타워 배치. tier 1 = 외곽, tier 2 = 내곽, tier 3 = 넥서스 최후의 포탑.
  TOWER_SPOTS: [
    { id: 'b-top-1', team: 'blue', lane: 'top', tier: 1, x: -34, z: -56 },
    { id: 'b-top-2', team: 'blue', lane: 'top', tier: 2, x: -78, z: -36 },
    { id: 'b-mid-1', team: 'blue', lane: 'mid', tier: 1, x: -34, z: 0 },
    { id: 'b-mid-2', team: 'blue', lane: 'mid', tier: 2, x: -74, z: 0 },
    { id: 'b-bot-1', team: 'blue', lane: 'bot', tier: 1, x: -34, z: 56 },
    { id: 'b-bot-2', team: 'blue', lane: 'bot', tier: 2, x: -78, z: 36 },
    { id: 'r-top-1', team: 'red', lane: 'top', tier: 1, x: 34, z: -56 },
    { id: 'r-top-2', team: 'red', lane: 'top', tier: 2, x: 78, z: -36 },
    { id: 'r-mid-1', team: 'red', lane: 'mid', tier: 1, x: 34, z: 0 },
    { id: 'r-mid-2', team: 'red', lane: 'mid', tier: 2, x: 74, z: 0 },
    { id: 'r-bot-1', team: 'red', lane: 'bot', tier: 1, x: 34, z: 56 },
    { id: 'r-bot-2', team: 'red', lane: 'bot', tier: 2, x: 78, z: 36 },
    { id: 'b-final', team: 'blue', lane: 'mid', tier: 3, x: -90, z: 0 },
    { id: 'r-final', team: 'red', lane: 'mid', tier: 3, x: 90, z: 0 },
  ],
  // 본진 성벽(x=±82): 레인이 지나는 출입구 3곳만 뚫려 있다.
  // 미드 협곡 벽(z=±12): 미드 레인을 골짜기로 만든다.
  WALL_LINES: [
    { x1: -82, z1: -66, x2: -82, z2: -46 },
    { x1: -82, z1: -26, x2: -82, z2: -10 },
    { x1: -82, z1: 10, x2: -82, z2: 26 },
    { x1: -82, z1: 46, x2: -82, z2: 66 },
    { x1: 82, z1: -66, x2: 82, z2: -46 },
    { x1: 82, z1: -26, x2: 82, z2: -10 },
    { x1: 82, z1: 10, x2: 82, z2: 26 },
    { x1: 82, z1: 46, x2: 82, z2: 66 },
    { x1: -60, z1: -12, x2: -16, z2: -12 },
    { x1: 16, z1: -12, x2: 60, z2: -12 },
    { x1: -60, z1: 12, x2: -16, z2: 12 },
    { x1: 16, z1: 12, x2: 60, z2: 12 },
  ],
  ROCKS: [
    { x: -16, z: -38, r: 4 }, { x: 16, z: -38, r: 4 },
    { x: -16, z: 38, r: 4 }, { x: 16, z: 38, r: 4 },
    { x: -54, z: -25, r: 3.5 }, { x: 54, z: 25, r: 3.5 },
    { x: -54, z: 25, r: 3.5 }, { x: 54, z: -25, r: 3.5 },
  ],
  BUSHES: [
    { x: -22, z: -46, r: 4.5 }, { x: 22, z: 46, r: 4.5 },
    { x: 22, z: -46, r: 4.5 }, { x: -22, z: 46, r: 4.5 },
    { x: -40, z: -32, r: 4.5 }, { x: 40, z: 32, r: 4.5 },
    { x: 40, z: -32, r: 4.5 }, { x: -40, z: 32, r: 4.5 },
    { x: 0, z: -16, r: 4.5 }, { x: 0, z: 16, r: 4.5 },
  ],
  WOLF_CAMPS: [
    { x: -38, z: -22 }, { x: -38, z: 22 }, { x: 38, z: -22 }, { x: 38, z: 22 },
  ],
  DRAGON_PIT: { x: 0, z: 30 }, // 아래 강가
  BARON_PIT: { x: 0, z: -30 }, // 위 강가
}

// 모드별 맵 배율 — 5v5는 좌표를 키워 더 넓은 전장을 만든다(엔티티 크기는 그대로 → 공간 여유 ↑).
const MODE_SCALE = {
  '3v3': { x: 1, z: 1 },
  '5v5': { x: 1.3, z: 1.32 },
}
// 5v5 전용 추가 정글 캠프(이미 배율이 적용된 좌표). 180° 회전 대칭.
//  · 깊은 정글(레인 사이 안쪽)에 늑대를 더 둬 정글러가 돌 곳을 늘린다.
const EXTRA_CAMPS_5V5 = [
  { x: -72, z: -14 }, { x: 72, z: 14 },
  { x: -72, z: 14 }, { x: 72, z: -14 },
  { x: -20, z: 0 }, { x: 20, z: 0 },
]

const scalePt = (p, s) => ({ ...p, x: p.x * s.x, z: p.z * s.z })

// 선분(성벽)을 따라 충돌용 원을 깐다.
function wallCircles(lines) {
  return lines.flatMap((w) => {
    const len = Math.hypot(w.x2 - w.x1, w.z2 - w.z1)
    const n = Math.max(1, Math.ceil(len / 2.5))
    const out = []
    for (let i = 0; i <= n; i++) {
      out.push({
        x: w.x1 + ((w.x2 - w.x1) * i) / n,
        z: w.z1 + ((w.z2 - w.z1) * i) / n,
        r: WALL_RADIUS,
      })
    }
    return out
  })
}

// ── 맵 헬퍼 (geo = 그 맵의 지형 데이터) ──
function bushIndexAtFor(geo, x, z) {
  const B = geo.BUSHES
  for (let i = 0; i < B.length; i++) {
    const b = B[i]
    if ((x - b.x) ** 2 + (z - b.z) ** 2 <= b.r * b.r) return i
  }
  return -1
}

// (x,z)에서 가장 가까운 레인 경유지 인덱스
function nearestWpFor(geo, lane, x, z) {
  const wps = geo.LANES[lane]
  let bi = 0
  let bd = Infinity
  for (let i = 0; i < wps.length; i++) {
    const d = (wps[i].x - x) ** 2 + (wps[i].z - z) ** 2
    if (d < bd) {
      bd = d
      bi = i
    }
  }
  return bi
}

// 지형 충돌: 성벽/바위/살아있는 타워/넥서스 원에서 밀어내고 맵 밖으로 못 나가게.
// towers는 [{x, z, alive}] 형태 (엔진 상태를 그대로 받는다).
function resolveTerrainFor(geo, p, radius, towers) {
  const push = (cx, cz, cr) => {
    const r = cr + radius
    let dx = p.x - cx
    let dz = p.z - cz
    const d2 = dx * dx + dz * dz
    if (d2 >= r * r) return
    const d = Math.sqrt(d2)
    if (d < 1e-6) {
      dx = 1
      dz = 0
    } else {
      dx /= d
      dz /= d
    }
    p.x = cx + dx * r
    p.z = cz + dz * r
  }
  for (const o of geo.WALLS) push(o.x, o.z, o.r)
  for (const o of geo.ROCKS) push(o.x, o.z, o.r)
  for (const t of towers) if (t.alive) push(t.x, t.z, TOWER_RADIUS)
  push(geo.NEXUS_POS.blue.x, geo.NEXUS_POS.blue.z, NEXUS_RADIUS)
  push(geo.NEXUS_POS.red.x, geo.NEXUS_POS.red.z, NEXUS_RADIUS)
  p.x = Math.max(geo.WORLD.minX, Math.min(geo.WORLD.maxX, p.x))
  p.z = Math.max(geo.WORLD.minZ, Math.min(geo.WORLD.maxZ, p.z))
}

// 장애물 회피 조향: (tx,tz)로 가는 직선 경로를 성벽/바위/타워/넥서스가 막으면
// 원의 접선 쪽으로 방향을 꺾어 준다. 반환: 정규화된 이동 방향 {x, z}.
function avoidDirFor(geo, e, tx, tz, towers, selfR = 1) {
  let dx = tx - e.x
  let dz = tz - e.z
  const d = Math.hypot(dx, dz)
  if (d < 1e-6) return { x: 0, z: 0 }
  const ux = dx / d
  const uz = dz / d
  let steer = 0
  const consider = (cx, cz, cr) => {
    const reach = cr + selfR + 0.4
    if ((tx - cx) ** 2 + (tz - cz) ** 2 <= (reach + 1.2) ** 2) return
    const rx = cx - e.x
    const rz = cz - e.z
    const t = rx * ux + rz * uz
    if (t <= -reach || t >= Math.min(d, reach + 8)) return
    const lat = ux * rz - uz * rx
    if (Math.abs(lat) >= reach + 0.6) return
    const closeness = 1 - Math.max(0, t) / (reach + 8)
    const lateral = reach + 0.6 - Math.abs(lat)
    const side = lat >= 0 ? -1 : 1
    steer += side * lateral * (0.5 + closeness)
  }
  for (const o of geo.WALLS) consider(o.x, o.z, o.r)
  for (const o of geo.ROCKS) consider(o.x, o.z, o.r)
  for (const t of towers) if (t.alive) consider(t.x, t.z, TOWER_RADIUS)
  consider(geo.NEXUS_POS.blue.x, geo.NEXUS_POS.blue.z, NEXUS_RADIUS)
  consider(geo.NEXUS_POS.red.x, geo.NEXUS_POS.red.z, NEXUS_RADIUS)
  if (steer === 0) return { x: ux, z: uz }
  const s = Math.max(-2.5, Math.min(2.5, steer))
  const fwd = 1 / (1 + 0.4 * Math.abs(s))
  const nx = ux * fwd + -uz * s
  const nz = uz * fwd + ux * s
  const nd = Math.hypot(nx, nz) || 1
  return { x: nx / nd, z: nz / nd }
}

// 모드별 맵 객체를 만든다. 지형 데이터 + 그 지형에 묶인 헬퍼 메서드를 함께 담는다.
export function buildMap(mode = '3v3') {
  const s = MODE_SCALE[mode] || MODE_SCALE['3v3']
  const WORLD = {
    minX: BASE.WORLD.minX * s.x, maxX: BASE.WORLD.maxX * s.x,
    minZ: BASE.WORLD.minZ * s.z, maxZ: BASE.WORLD.maxZ * s.z,
  }
  const NEXUS_POS = {
    blue: scalePt(BASE.NEXUS_POS.blue, s),
    red: scalePt(BASE.NEXUS_POS.red, s),
  }
  const LANES = {
    top: BASE.LANES.top.map((p) => scalePt(p, s)),
    mid: BASE.LANES.mid.map((p) => scalePt(p, s)),
    bot: BASE.LANES.bot.map((p) => scalePt(p, s)),
  }
  const TOWER_SPOTS = BASE.TOWER_SPOTS.map((t) => ({ ...t, x: t.x * s.x, z: t.z * s.z }))
  const WALL_LINES = BASE.WALL_LINES.map((w) => ({
    x1: w.x1 * s.x, z1: w.z1 * s.z, x2: w.x2 * s.x, z2: w.z2 * s.z,
  }))
  const ROCKS = BASE.ROCKS.map((r) => ({ ...r, x: r.x * s.x, z: r.z * s.z }))
  const BUSHES = BASE.BUSHES.map((b) => ({ ...b, x: b.x * s.x, z: b.z * s.z }))
  const WOLF_CAMPS = BASE.WOLF_CAMPS.map((c) => scalePt(c, s))
  if (mode === '5v5') WOLF_CAMPS.push(...EXTRA_CAMPS_5V5)
  const DRAGON_PIT = scalePt(BASE.DRAGON_PIT, s)
  const BARON_PIT = scalePt(BASE.BARON_PIT, s)
  const WALLS = wallCircles(WALL_LINES)

  const geo = {
    mode, WORLD, NEXUS_POS, LANES, LANE_IDS, TOWER_SPOTS, WALL_LINES, WALLS,
    ROCKS, BUSHES, WOLF_CAMPS, DRAGON_PIT, BARON_PIT,
    NEXUS_RADIUS, FOUNTAIN_RADIUS, TOWER_RADIUS, WALL_RADIUS, enemyOf,
  }
  geo.bushIndexAt = (x, z) => bushIndexAtFor(geo, x, z)
  geo.nearestWp = (lane, x, z) => nearestWpFor(geo, lane, x, z)
  geo.resolveTerrain = (p, radius, towers) => resolveTerrainFor(geo, p, radius, towers)
  geo.avoidDir = (e, tx, tz, towers, selfR) => avoidDirFor(geo, e, tx, tz, towers, selfR)
  return geo
}

// ── 기본(3v3) 맵을 모듈 상수로도 노출 (기존 import 경로 호환) ──
const M3 = buildMap('3v3')
export const WORLD = M3.WORLD
export const NEXUS_POS = M3.NEXUS_POS
export const LANES = M3.LANES
export const TOWER_SPOTS = M3.TOWER_SPOTS
export const WALL_LINES = M3.WALL_LINES
export const WALLS = M3.WALLS
export const ROCKS = M3.ROCKS
export const BUSHES = M3.BUSHES
export const WOLF_CAMPS = M3.WOLF_CAMPS
export const DRAGON_PIT = M3.DRAGON_PIT
export const BARON_PIT = M3.BARON_PIT

export const bushIndexAt = (x, z) => bushIndexAtFor(M3, x, z)
export const nearestWp = (lane, x, z) => nearestWpFor(M3, lane, x, z)
export const resolveTerrain = (p, radius, towers) => resolveTerrainFor(M3, p, radius, towers)
export const avoidDir = (e, tx, tz, towers, selfR) => avoidDirFor(M3, e, tx, tz, towers, selfR)
