// 파티 리프트 맵 데이터 (순수 JS — three.js 의존 없음).
// 좌우 대칭 2개 레인(top/bot) + 가운데 정글 구조.
//  - 파랑 진영: 왼쪽(x<0), 빨강 진영: 오른쪽(x>0)
//  - 레인마다 외곽 타워 → 내곽 타워, 본진엔 넥서스 (터지면 게임 끝!)
//  - 정글엔 늑대 캠프 4곳, 아래 강가에 용, 위 강가에 바론

export const WORLD = { minX: -108, maxX: 108, minZ: -76, maxZ: 76 }

export const NEXUS_POS = {
  blue: { x: -96, z: 0 },
  red: { x: 96, z: 0 },
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
  bot: [
    { x: -96, z: 0 }, { x: -88, z: 30 }, { x: -70, z: 48 }, { x: -42, z: 56 },
    { x: 0, z: 58 },
    { x: 42, z: 56 }, { x: 70, z: 48 }, { x: 88, z: 30 }, { x: 96, z: 0 },
  ],
}

// 타워 배치. tier 1 = 외곽, tier 2 = 내곽.
// 내곽은 같은 레인 외곽이 부서져야, 넥서스는 내곽이 하나라도 부서져야 공격 가능.
export const TOWER_SPOTS = [
  { id: 'b-top-1', team: 'blue', lane: 'top', tier: 1, x: -34, z: -56 },
  { id: 'b-top-2', team: 'blue', lane: 'top', tier: 2, x: -74, z: -45 },
  { id: 'b-bot-1', team: 'blue', lane: 'bot', tier: 1, x: -34, z: 56 },
  { id: 'b-bot-2', team: 'blue', lane: 'bot', tier: 2, x: -74, z: 45 },
  { id: 'r-top-1', team: 'red', lane: 'top', tier: 1, x: 34, z: -56 },
  { id: 'r-top-2', team: 'red', lane: 'top', tier: 2, x: 74, z: -45 },
  { id: 'r-bot-1', team: 'red', lane: 'bot', tier: 1, x: 34, z: 56 },
  { id: 'r-bot-2', team: 'red', lane: 'bot', tier: 2, x: 74, z: 45 },
]
export const TOWER_RADIUS = 2.4 // 통행 막는 몸통 반경

// 정글 캠프 (늑대) — 양 팀 진영에 2곳씩
export const WOLF_CAMPS = [
  { x: -38, z: -20 }, { x: -38, z: 20 }, { x: 38, z: -20 }, { x: 38, z: 20 },
]
export const DRAGON_PIT = { x: 0, z: 30 } // 아래 강가
export const BARON_PIT = { x: 0, z: -30 } // 위 강가

// 통행을 막는 바위 (정글 지형). 레인은 비워 둔다.
export const ROCKS = [
  { x: -16, z: -38, r: 4 }, { x: 16, z: -38, r: 4 },
  { x: -16, z: 38, r: 4 }, { x: 16, z: 38, r: 4 },
  { x: -56, z: -18, r: 3.5 }, { x: -56, z: 18, r: 3.5 },
  { x: 56, z: -18, r: 3.5 }, { x: 56, z: 18, r: 3.5 },
  { x: -12, z: 0, r: 3.5 }, { x: 12, z: 0, r: 3.5 },
]

// 수풀 (장식용 — 숨기 기능은 없음)
export const BUSHES = [
  { x: -26, z: -12 }, { x: 26, z: 12 }, { x: -26, z: 12 }, { x: 26, z: -12 },
  { x: 0, z: -46 }, { x: 0, z: 46 },
]

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

// 지형 충돌: 바위/살아있는 타워/넥서스 원에서 밀어내고 맵 밖으로 못 나가게.
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
  for (const o of ROCKS) push(o.x, o.z, o.r)
  for (const t of towers) if (t.alive) push(t.x, t.z, TOWER_RADIUS)
  push(NEXUS_POS.blue.x, NEXUS_POS.blue.z, NEXUS_RADIUS)
  push(NEXUS_POS.red.x, NEXUS_POS.red.z, NEXUS_RADIUS)
  p.x = Math.max(WORLD.minX, Math.min(WORLD.maxX, p.x))
  p.z = Math.max(WORLD.minZ, Math.min(WORLD.maxZ, p.z))
}
