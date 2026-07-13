// 조디악 블리츠 맵 데이터 (순수 JS — three.js 의존 없음).
// 좌우 대칭 3개 레인(top/mid/bot) + 정글 구조. 두 가지 크기를 지원한다:
//  · '3v3' — 팀당 3명(원래 맵).
//  · '5v5' — 팀당 5명. 같은 레이아웃을 키운 큰 맵 + 정글 캠프를 늘렸다
//            (탑/미드 솔로, 봇 듀오[원거리+힐러], 정글러가 돌 캠프가 많아진다).
//  - 파랑 진영: 왼쪽(x<0), 빨강 진영: 오른쪽(x>0)
//  - 레인마다 외곽 타워 → 내곽 타워, 본진엔 수호석 (터지면 게임 끝!)
//  - 본진은 성벽으로 둘러싸여 있고, 출입구 3곳은 모두 내곽 타워 사거리 안 —
//    길(레인)을 따라 타워를 뚫지 않고는 수호석에 갈 수 없다.
//  - 정글엔 늑대 캠프, 아래 강가에 용, 위 강가에 이무기
//  - 수풀에 들어가면 적에게 안 보인다 (은신)

// ── 엔티티 크기(모드와 무관한 상수) ──
export const NEXUS_RADIUS = 4.5
export const FOUNTAIN_RADIUS = 11 // 리스폰 존(회복 지대) 반경 — 수호석이 아니라 뒤편에 넉넉하게 둔다
// 수호석 중심 → 리스폰 존 중심 거리. 수호석 위에선 회복이 안 되게 뒤편으로 넉넉히(수호석 지름 이상) 띄운다.
export const RESPAWN_BACK = 40
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
  // 타워 배치. tier 1 = 외곽, tier 2 = 내곽, tier 3 = 수호석 최후의 포탑.
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
  // 정글 캠프 — kind: wolf(표준)/boar(고공격·저체력·빠름)/golem(고체력·고경험치·느림).
  //  180° 회전 대칭이라 팀별 구성이 같다(진영마다 늑대 1·멧돼지 1·골렘 1).
  //  |z|=26: 정글 성벽(z=±12, 높이 4.6)이 남쪽 카메라를 가리는 그림자(벽 북면 뒤 ~4.5)를 벗어난 자리.
  WOLF_CAMPS: [
    { x: -38, z: -26, kind: 'wolf' }, { x: 38, z: 26, kind: 'wolf' },
    { x: 38, z: -26, kind: 'boar' }, { x: -38, z: 26, kind: 'boar' },
    { x: 12, z: -24, kind: 'golem' }, { x: -12, z: 24, kind: 'golem' },
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
  { x: -72, z: -26, kind: 'wolf' }, { x: 72, z: 26, kind: 'wolf' },
  { x: -72, z: 26, kind: 'boar' }, { x: 72, z: -26, kind: 'boar' },
  { x: -26, z: -21, kind: 'golem' }, { x: 26, z: 21, kind: 'golem' },
]

const scalePt = (p, s) => ({ ...p, x: p.x * s.x, z: p.z * s.z })

// 반호(半弧) 성벽 두께의 절반 = 충돌 원 반경. 벽 중심선을 FOUNTAIN_RADIUS 바깥으로 이만큼 띄우면
//  벽 안쪽 면이 회복 원판 가장자리에 딱 맞고, 플레이어(HERO_RADIUS) 표면이 벽 면과 정확히 일치한다.
export const RESPAWN_ARC_HALF = 1.5

// 리스폰 존 뒤쪽 절반(반원) 성벽을 충돌 원 체인으로 깐다. 시각(scene.js)과 반경·각도를 공유한다.
//  backSign<0(블루): -x 절반 / backSign>0(레드): +x 절반. (x=R·sinθ, z=R·cosθ 규칙)
function respawnArcCircles(cx, cz, backSign) {
  const R = FOUNTAIN_RADIUS + RESPAWN_ARC_HALF
  const thetaStart = backSign < 0 ? Math.PI : 0
  const n = Math.max(6, Math.ceil((Math.PI * R) / 2.0)) // 촘촘히 겹쳐 빠져나갈 틈이 없게
  const out = []
  for (let i = 0; i <= n; i++) {
    const th = thetaStart + (Math.PI * i) / n
    out.push({ x: cx + R * Math.sin(th), z: cz + R * Math.cos(th), r: RESPAWN_ARC_HALF })
  }
  return out
}

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

// 지형 충돌: 성벽/바위/살아있는 타워/수호석 원에서 밀어내고 맵 밖으로 못 나가게.
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

// 장애물 회피 조향: (tx,tz)로 가는 직선 경로를 성벽/바위/타워/수호석이 막으면
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

// ── 내비게이션 (봇 경로탐색) ──
// 국소 회피(avoidDir)는 볼록한 장애물 하나는 잘 비켜 가지만, 본진 성벽·미드 협곡처럼
// 길게 이어진 오목한 지형에선 좌우 밀치기가 서로 상쇄돼 벽에 직진하며 갇힌다.
// 정적 지형(성벽/바위/수호석)만 구운 격자 위에서 A*로 길을 찾아 그 문제를 없앤다.
// (타워는 부서지는 동적 장애물 + 반경이 작아 경로탐색에서 빼고 국소 회피에 맡긴다)
const NAV_CELL = 2 // 격자 한 칸(월드 단위)
const NAV_CLEAR = 1.5 // 영웅 몸통 반경(1.3) + 여유 — 이만큼 지형에서 떨어진 칸만 걷는다

// 경로탐색이 보는 정적 충돌 원 목록 (성벽 + 바위 + 양 팀 수호석)
function navCircles(geo) {
  if (!geo._navCircles) {
    geo._navCircles = [
      ...geo.WALLS, ...geo.ROCKS,
      { x: geo.NEXUS_POS.blue.x, z: geo.NEXUS_POS.blue.z, r: NEXUS_RADIUS },
      { x: geo.NEXUS_POS.red.x, z: geo.NEXUS_POS.red.z, r: NEXUS_RADIUS },
    ]
  }
  return geo._navCircles
}

// (x1,z1)→(x2,z2) 직선 보행이 정적 지형에 막히지 않는가 (선분-원 최소거리 검사)
function lineFreeFor(geo, x1, z1, x2, z2, pad = 1.4) {
  const dx = x2 - x1
  const dz = z2 - z1
  const len2 = dx * dx + dz * dz || 1e-9
  for (const c of navCircles(geo)) {
    const r = c.r + pad
    let t = ((c.x - x1) * dx + (c.z - z1) * dz) / len2
    t = t < 0 ? 0 : t > 1 ? 1 : t
    const px = x1 + dx * t - c.x
    const pz = z1 + dz * t - c.z
    if (px * px + pz * pz < r * r) return false
  }
  return true
}

// 격자 굽기: 정적 원에서 NAV_CLEAR 안쪽인 칸을 막힘으로 표시 (맵당 1회, 첫 findPath 때)
function buildNavGrid(geo) {
  const minX = geo.WORLD.minX
  const minZ = geo.WORLD.minZ
  const w = Math.round((geo.WORLD.maxX - minX) / NAV_CELL) + 1
  const h = Math.round((geo.WORLD.maxZ - minZ) / NAV_CELL) + 1
  const blocked = new Uint8Array(w * h)
  for (const c of navCircles(geo)) {
    const rr = c.r + NAV_CLEAR
    const rr2 = rr * rr
    const i0 = Math.max(0, Math.floor((c.x - rr - minX) / NAV_CELL))
    const i1 = Math.min(w - 1, Math.ceil((c.x + rr - minX) / NAV_CELL))
    const j0 = Math.max(0, Math.floor((c.z - rr - minZ) / NAV_CELL))
    const j1 = Math.min(h - 1, Math.ceil((c.z + rr - minZ) / NAV_CELL))
    for (let j = j0; j <= j1; j++) {
      const dz = minZ + j * NAV_CELL - c.z
      for (let i = i0; i <= i1; i++) {
        const dx = minX + i * NAV_CELL - c.x
        if (dx * dx + dz * dz <= rr2) blocked[j * w + i] = 1
      }
    }
  }
  return { w, h, minX, minZ, blocked }
}

// A* 경로탐색 (8방향, 대각선 모서리 끼임 방지). 반환: 경유 좌표 배열(마지막은 목표) 또는 null.
// 경로는 직선 시야(lineFree)가 닿는 구간을 건너뛰어(string pulling) 매끈하게 다듬는다.
function findPathFor(geo, sx, sz, tx, tz) {
  const grid = geo._nav || (geo._nav = buildNavGrid(geo))
  const { w, h, minX, minZ, blocked } = grid
  const clampI = (x) => Math.max(0, Math.min(w - 1, Math.round((x - minX) / NAV_CELL)))
  const clampJ = (z) => Math.max(0, Math.min(h - 1, Math.round((z - minZ) / NAV_CELL)))
  // 시작/목표가 막힌 칸(지형에 밀착·수호석 중심 등)이면 가까운 열린 칸으로 스냅
  const snap = (i, j) => {
    if (!blocked[j * w + i]) return j * w + i
    for (let r = 1; r <= 6; r++) {
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue
          const ii = i + di
          const jj = j + dj
          if (ii < 0 || jj < 0 || ii >= w || jj >= h) continue
          if (!blocked[jj * w + ii]) return jj * w + ii
        }
      }
    }
    return -1
  }
  const start = snap(clampI(sx), clampJ(sz))
  const goal = snap(clampI(tx), clampJ(tz))
  if (start < 0 || goal < 0) return null
  if (start === goal) return [{ x: tx, z: tz }]
  const n = w * h
  const came = new Int32Array(n).fill(-1)
  const gCost = new Float32Array(n).fill(Infinity)
  const fCost = new Float32Array(n).fill(Infinity)
  const closed = new Uint8Array(n)
  const gi = goal % w
  const gj = (goal / w) | 0
  const hEst = (idx) => {
    const di = Math.abs((idx % w) - gi)
    const dj = Math.abs(((idx / w) | 0) - gj)
    return di + dj + (Math.SQRT2 - 2) * Math.min(di, dj) // octile 거리
  }
  // f값 기준 이진 힙
  const heap = [start]
  const heapPush = (idx) => {
    heap.push(idx)
    let i = heap.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (fCost[heap[p]] <= fCost[heap[i]]) break
      ;[heap[p], heap[i]] = [heap[i], heap[p]]
      i = p
    }
  }
  const heapPop = () => {
    const top = heap[0]
    const last = heap.pop()
    if (heap.length) {
      heap[0] = last
      let i = 0
      for (;;) {
        const l = i * 2 + 1
        const r = l + 1
        let m = i
        if (l < heap.length && fCost[heap[l]] < fCost[heap[m]]) m = l
        if (r < heap.length && fCost[heap[r]] < fCost[heap[m]]) m = r
        if (m === i) break
        ;[heap[m], heap[i]] = [heap[i], heap[m]]
        i = m
      }
    }
    return top
  }
  gCost[start] = 0
  fCost[start] = hEst(start)
  const DIRS = [
    [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
    [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
  ]
  let found = false
  while (heap.length) {
    const cur = heapPop()
    if (closed[cur]) continue
    closed[cur] = 1
    if (cur === goal) {
      found = true
      break
    }
    const ci = cur % w
    const cj = (cur / w) | 0
    for (const [di, dj, cost] of DIRS) {
      const ii = ci + di
      const jj = cj + dj
      if (ii < 0 || jj < 0 || ii >= w || jj >= h) continue
      const ni = jj * w + ii
      if (blocked[ni] || closed[ni]) continue
      if (di && dj && (blocked[cj * w + ii] || blocked[jj * w + ci])) continue // 대각선 모서리 컷 방지
      const ng = gCost[cur] + cost
      if (ng >= gCost[ni]) continue
      gCost[ni] = ng
      came[ni] = cur
      fCost[ni] = ng + hEst(ni)
      heapPush(ni)
    }
  }
  if (!found) return null
  // 복원(칸 중심 좌표) + 목표 정확 좌표로 마무리
  const cells = []
  for (let cur = goal; cur >= 0 && cur !== start; cur = came[cur]) {
    cells.push({ x: minX + (cur % w) * NAV_CELL, z: minZ + ((cur / w) | 0) * NAV_CELL })
  }
  cells.reverse()
  cells.push({ x: tx, z: tz })
  // string pulling: 현 위치에서 직선으로 닿는 가장 먼 노드만 남긴다
  const out = []
  let cx = sx
  let cz = sz
  let i = 0
  while (i < cells.length) {
    let k = i
    for (let j = cells.length - 1; j > i; j--) {
      if (lineFreeFor(geo, cx, cz, cells[j].x, cells[j].z)) {
        k = j
        break
      }
    }
    out.push(cells[k])
    cx = cells[k].x
    cz = cells[k].z
    i = k + 1
  }
  return out
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
  // 리스폰(회복) 존 — 수호석 뒤편(맵 중앙 반대쪽)으로 한 수호석만큼 떨어뜨린다.
  //  부활·귀환·HP리필이 여기서만 일어나므로, 수호석에 붙어 무한 회복하며 버티지 못한다.
  const FOUNTAIN_POS = {
    blue: { x: NEXUS_POS.blue.x - RESPAWN_BACK, z: NEXUS_POS.blue.z },
    red: { x: NEXUS_POS.red.x + RESPAWN_BACK, z: NEXUS_POS.red.z },
  }
  // 리스폰 존이 맵 밖으로 삐져나가지 않게 뒤편 경계를 넓힌다.
  const backPad = FOUNTAIN_RADIUS + 6
  WORLD.minX = Math.min(WORLD.minX, FOUNTAIN_POS.blue.x - backPad)
  WORLD.maxX = Math.max(WORLD.maxX, FOUNTAIN_POS.red.x + backPad)
  const LANES = {
    top: BASE.LANES.top.map((p) => scalePt(p, s)),
    mid: BASE.LANES.mid.map((p) => scalePt(p, s)),
    bot: BASE.LANES.bot.map((p) => scalePt(p, s)),
  }
  let TOWER_SPOTS = BASE.TOWER_SPOTS.map((t) => ({ ...t, x: t.x * s.x, z: t.z * s.z }))
  // 보스전: 레드 진영은 보스 하나뿐 — 타워 없이 보스 소환 병사만 라인을 민다
  if (mode === 'boss') TOWER_SPOTS = TOWER_SPOTS.filter((t) => t.team === 'blue')
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
  // 리스폰 존 뒤쪽 절반을 감싸는 반호 성벽을 물리 장벽으로 등록 (블루 -x / 레드 +x 절반).
  WALLS.push(
    ...respawnArcCircles(FOUNTAIN_POS.blue.x, FOUNTAIN_POS.blue.z, -1),
    ...respawnArcCircles(FOUNTAIN_POS.red.x, FOUNTAIN_POS.red.z, 1),
  )

  const geo = {
    mode, WORLD, NEXUS_POS, FOUNTAIN_POS, LANES, LANE_IDS, TOWER_SPOTS, WALL_LINES, WALLS,
    ROCKS, BUSHES, WOLF_CAMPS, DRAGON_PIT, BARON_PIT,
    NEXUS_RADIUS, FOUNTAIN_RADIUS, TOWER_RADIUS, WALL_RADIUS, enemyOf,
  }
  geo.bushIndexAt = (x, z) => bushIndexAtFor(geo, x, z)
  geo.nearestWp = (lane, x, z) => nearestWpFor(geo, lane, x, z)
  geo.resolveTerrain = (p, radius, towers) => resolveTerrainFor(geo, p, radius, towers)
  geo.avoidDir = (e, tx, tz, towers, selfR) => avoidDirFor(geo, e, tx, tz, towers, selfR)
  geo.lineFree = (x1, z1, x2, z2) => lineFreeFor(geo, x1, z1, x2, z2)
  geo.findPath = (sx, sz, tx, tz) => findPathFor(geo, sx, sz, tx, tz)
  return geo
}

// ── 기본(3v3) 맵을 모듈 상수로도 노출 (기존 import 경로 호환) ──
const M3 = buildMap('3v3')
export const WORLD = M3.WORLD
export const NEXUS_POS = M3.NEXUS_POS
export const FOUNTAIN_POS = M3.FOUNTAIN_POS
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
export const lineFree = (x1, z1, x2, z2) => lineFreeFor(M3, x1, z1, x2, z2)
export const findPath = (sx, sz, tx, tz) => findPathFor(M3, sx, sz, tx, tz)
