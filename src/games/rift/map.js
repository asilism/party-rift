// 파티 리프트 맵 데이터 (순수 JS — three.js 의존 없음).
// 좌우 대칭 3개 레인(top/mid/bot) + 정글 구조.
//  - 파랑 진영: 왼쪽(x<0), 빨강 진영: 오른쪽(x>0)
//  - 레인마다 외곽 타워 → 내곽 타워, 본진엔 넥서스 (터지면 게임 끝!)
//  - 본진은 성벽으로 둘러싸여 있고, 출입구 3곳은 모두 내곽 타워 사거리 안 —
//    길(레인)을 따라 타워를 뚫지 않고는 넥서스에 갈 수 없다.
//  - 정글엔 늑대 캠프 4곳, 아래 강가에 용, 위 강가에 바론
//  - 수풀에 들어가면 적에게 안 보인다 (은신)

export const WORLD = { minX: -108, maxX: 108, minZ: -66, maxZ: 66 }

export const NEXUS_POS = {
  blue: { x: -100, z: 0 },
  red: { x: 100, z: 0 },
}
export const NEXUS_RADIUS = 4.5
export const FOUNTAIN_RADIUS = 13 // 넥서스 주변 회복 지대

// 레인 경유지 (파랑 본진 → 빨강 본진 순서)
export const LANES = {
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
}
export const LANE_IDS = ['top', 'mid', 'bot']

// 타워 배치. tier 1 = 외곽, tier 2 = 내곽.
// 내곽은 같은 레인 외곽이 부서져야, 넥서스는 내곽이 하나라도 부서져야 공격 가능.
// 내곽 타워는 성벽 출입구 바로 앞 — 출입구 전체가 사거리(13) 안에 들어온다.
export const TOWER_SPOTS = [
  { id: 'b-top-1', team: 'blue', lane: 'top', tier: 1, x: -34, z: -56 },
  { id: 'b-top-2', team: 'blue', lane: 'top', tier: 2, x: -78, z: -40 },
  { id: 'b-mid-1', team: 'blue', lane: 'mid', tier: 1, x: -34, z: 0 },
  { id: 'b-mid-2', team: 'blue', lane: 'mid', tier: 2, x: -74, z: 0 },
  { id: 'b-bot-1', team: 'blue', lane: 'bot', tier: 1, x: -34, z: 56 },
  { id: 'b-bot-2', team: 'blue', lane: 'bot', tier: 2, x: -78, z: 40 },
  { id: 'r-top-1', team: 'red', lane: 'top', tier: 1, x: 34, z: -56 },
  { id: 'r-top-2', team: 'red', lane: 'top', tier: 2, x: 78, z: -40 },
  { id: 'r-mid-1', team: 'red', lane: 'mid', tier: 1, x: 34, z: 0 },
  { id: 'r-mid-2', team: 'red', lane: 'mid', tier: 2, x: 74, z: 0 },
  { id: 'r-bot-1', team: 'red', lane: 'bot', tier: 1, x: 34, z: 56 },
  { id: 'r-bot-2', team: 'red', lane: 'bot', tier: 2, x: 78, z: 40 },
  // 넥서스 바로 앞 최후의 포탑 (tier 3) — 부서지기 전엔 넥서스 공격 불가
  { id: 'b-final', team: 'blue', lane: 'mid', tier: 3, x: -90, z: 0 },
  { id: 'r-final', team: 'red', lane: 'mid', tier: 3, x: 90, z: 0 },
]
export const TOWER_RADIUS = 2.4 // 통행 막는 몸통 반경

// ── 성벽 ──
// 본진 성벽(x=±82): 레인이 지나는 출입구 3곳(z≈-36/0/36)만 뚫려 있다.
// 미드 협곡 벽(z=±9): 미드 레인을 골짜기로 만든다 (강/정글 입구는 열림).
export const WALL_LINES = [
  // 파랑 본진 성벽
  { x1: -82, z1: -66, x2: -82, z2: -44 },
  { x1: -82, z1: -28, x2: -82, z2: -8 },
  { x1: -82, z1: 8, x2: -82, z2: 28 },
  { x1: -82, z1: 44, x2: -82, z2: 66 },
  // 빨강 본진 성벽
  { x1: 82, z1: -66, x2: 82, z2: -44 },
  { x1: 82, z1: -28, x2: 82, z2: -8 },
  { x1: 82, z1: 8, x2: 82, z2: 28 },
  { x1: 82, z1: 44, x2: 82, z2: 66 },
  // 미드 협곡 벽 (가운데 강 구간 x∈[-16,16]과 본진 근처는 열림)
  { x1: -60, z1: -9, x2: -16, z2: -9 },
  { x1: 16, z1: -9, x2: 60, z2: -9 },
  { x1: -60, z1: 9, x2: -16, z2: 9 },
  { x1: 16, z1: 9, x2: 60, z2: 9 },
]
export const WALL_RADIUS = 3 // 벽 두께(충돌 원 반경)

// 충돌용 원 목록 (선분을 따라 원을 깐다)
export const WALLS = WALL_LINES.flatMap((w) => {
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

// 정글 캠프 (늑대) — 양 팀 진영에 2곳씩
export const WOLF_CAMPS = [
  { x: -38, z: -22 }, { x: -38, z: 22 }, { x: 38, z: -22 }, { x: 38, z: 22 },
]
export const DRAGON_PIT = { x: 0, z: 30 } // 아래 강가
export const BARON_PIT = { x: 0, z: -30 } // 위 강가

// 통행을 막는 바위 (정글 지형). 레인은 비워 둔다.
export const ROCKS = [
  { x: -16, z: -38, r: 4 }, { x: 16, z: -38, r: 4 },
  { x: -16, z: 38, r: 4 }, { x: 16, z: 38, r: 4 },
  { x: -54, z: -20, r: 3.5 }, { x: 54, z: 20, r: 3.5 },
  { x: -54, z: 20, r: 3.5 }, { x: 54, z: -20, r: 3.5 },
]

// 수풀 — 안에 들어가면 적에게 안 보인다 (180° 회전 대칭 배치)
export const BUSHES = [
  { x: -22, z: -46, r: 4.5 }, { x: 22, z: 46, r: 4.5 },
  { x: 22, z: -46, r: 4.5 }, { x: -22, z: 46, r: 4.5 },
  { x: -40, z: -32, r: 4.5 }, { x: 40, z: 32, r: 4.5 },
  { x: 40, z: -32, r: 4.5 }, { x: -40, z: 32, r: 4.5 },
  { x: 0, z: -16, r: 4.5 }, { x: 0, z: 16, r: 4.5 },
]

// (x,z)가 들어 있는 수풀 인덱스 (없으면 -1)
export function bushIndexAt(x, z) {
  for (let i = 0; i < BUSHES.length; i++) {
    const b = BUSHES[i]
    if ((x - b.x) ** 2 + (z - b.z) ** 2 <= b.r * b.r) return i
  }
  return -1
}

export const enemyOf = (team) => (team === 'blue' ? 'red' : 'blue')

// (x,z)에서 가장 가까운 레인 경유지 인덱스
export function nearestWp(lane, x, z) {
  const wps = LANES[lane]
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
export function resolveTerrain(p, radius, towers) {
  const push = (cx, cz, cr) => {
    const r = cr + radius
    let dx = p.x - cx
    let dz = p.z - cz
    const d2 = dx * dx + dz * dz
    if (d2 >= r * r) return
    const d = Math.sqrt(d2)
    if (d < 1e-6) {
      // 정중앙에 박혔으면 방향이 없다 → 아무 쪽으로나 밀어낸다
      dx = 1
      dz = 0
    } else {
      dx /= d
      dz /= d
    }
    p.x = cx + dx * r
    p.z = cz + dz * r
  }
  for (const o of WALLS) push(o.x, o.z, o.r)
  for (const o of ROCKS) push(o.x, o.z, o.r)
  for (const t of towers) if (t.alive) push(t.x, t.z, TOWER_RADIUS)
  push(NEXUS_POS.blue.x, NEXUS_POS.blue.z, NEXUS_RADIUS)
  push(NEXUS_POS.red.x, NEXUS_POS.red.z, NEXUS_RADIUS)
  p.x = Math.max(WORLD.minX, Math.min(WORLD.maxX, p.x))
  p.z = Math.max(WORLD.minZ, Math.min(WORLD.maxZ, p.z))
}

// 장애물 회피 조향: (tx,tz)로 가는 직선 경로를 성벽/바위/타워/넥서스가 막으면
// 원의 접선 쪽으로 방향을 꺾어 준다 (미니언이 자기 타워에 껴서 못 가는 문제 방지).
// 길목의 장애물 "하나"만 보고 꺾으면 벽과 타워 틈에 끼었을 때 반대쪽에 다시 박혀
// 제자리걸음을 한다 → 전방의 모든 장애물에서 받는 회피력을 합산해 한 번에 비껴 간다.
// 반환: 정규화된 이동 방향 {x, z}.
export function avoidDir(e, tx, tz, towers, selfR = 1) {
  let dx = tx - e.x
  let dz = tz - e.z
  const d = Math.hypot(dx, dz)
  if (d < 1e-6) return { x: 0, z: 0 }
  const ux = dx / d
  const uz = dz / d
  let steer = 0 // 진행 방향 기준 좌우로 꺾는 힘의 합 (부호 = 방향)
  const consider = (cx, cz, cr) => {
    const reach = cr + selfR + 0.4
    // 목적지 자체가 그 원이면(타워를 때리러 가는 길) 피하지 않는다
    if ((tx - cx) ** 2 + (tz - cz) ** 2 <= (reach + 1.2) ** 2) return
    const rx = cx - e.x
    const rz = cz - e.z
    const t = rx * ux + rz * uz // 진행 방향으로의 거리
    if (t <= -reach || t >= Math.min(d, reach + 8)) return // 등 뒤거나 아직 멀다
    const lat = ux * rz - uz * rx // 경로에서 원 중심까지의 옆 거리 (부호 = 방향)
    if (Math.abs(lat) >= reach + 0.6) return
    // 가까울수록(전방 거리 작을수록), 경로에 가까울수록 더 세게 비킨다
    const closeness = 1 - Math.max(0, t) / (reach + 8)
    const lateral = reach + 0.6 - Math.abs(lat)
    const side = lat >= 0 ? -1 : 1 // 중심이 왼쪽이면 오른쪽으로 꺾는다
    steer += side * lateral * (0.5 + closeness)
  }
  for (const o of WALLS) consider(o.x, o.z, o.r)
  for (const o of ROCKS) consider(o.x, o.z, o.r)
  for (const t of towers) if (t.alive) consider(t.x, t.z, TOWER_RADIUS)
  consider(NEXUS_POS.blue.x, NEXUS_POS.blue.z, NEXUS_RADIUS)
  consider(NEXUS_POS.red.x, NEXUS_POS.red.z, NEXUS_RADIUS)
  if (steer === 0) return { x: ux, z: uz }
  // 접선(좌우) 방향 + 전진 방향을 합친다. 많이 꺾을수록 전진 비중은 줄인다.
  const s = Math.max(-2.5, Math.min(2.5, steer))
  const fwd = 1 / (1 + 0.4 * Math.abs(s))
  const nx = ux * fwd + -uz * s
  const nz = uz * fwd + ux * s
  const nd = Math.hypot(nx, nz) || 1
  return { x: nx / nd, z: nz / nd }
}
