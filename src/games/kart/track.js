// 파티 카트 트랙 데이터 (3종). 닫힌 캣멀롬(Catmull-Rom) 스플라인을 샘플링해
// 센터라인(샘플 점 + 진행방향 + 법선)을 만든다.
// 물리 엔진과 3D 렌더러가 같은 데이터를 공유한다. (three.js 의존 없음 → node 테스트 가능)
//
// 트랙마다 테마(하늘/땅/장식)와 "웃긴 장애물"이 다르다.
// 움직이는 장애물의 위치는 시간의 순수 함수(obstaclePose)라서
// 호스트/게스트가 별도 동기화 없이 같은 자리에 그린다.

const N = 400 // 센터라인 샘플 수 (sample 0 = 출발선). 모든 트랙 공통.

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t
  const t3 = t2 * t
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  )
}

function buildGeom(ctrl, scale, halfW) {
  const pts0 = ctrl.map(([x, z]) => [x * scale, z * scale])
  const m = pts0.length
  const pts = []
  for (let i = 0; i < N; i++) {
    const f = (i / N) * m
    const seg = Math.floor(f)
    const t = f - seg
    const p0 = pts0[(seg - 1 + m) % m]
    const p1 = pts0[seg % m]
    const p2 = pts0[(seg + 1) % m]
    const p3 = pts0[(seg + 2) % m]
    pts.push([catmull(p0[0], p1[0], p2[0], p3[0], t), catmull(p0[1], p1[1], p2[1], p3[1], t)])
  }
  let total = 0
  const samples = pts.map(([x, z], i) => {
    const [px, pz] = pts[(i - 1 + N) % N]
    const [qx, qz] = pts[(i + 1) % N]
    let dx = qx - px
    let dz = qz - pz
    const len = Math.hypot(dx, dz) || 1
    dx /= len
    dz /= len
    total += Math.hypot(qx - x, qz - z)
    // 법선 = 진행방향을 왼쪽으로 90도 돌린 벡터
    return { x, z, dx, dz, nx: -dz, nz: dx }
  })
  return { n: N, samples, halfW, segLen: total / N }
}

// 아이템 박스 위치: 트랙 위 3곳 × 가로 3개 (모든 트랙 공통 비율)
const BOX_FRACS = [0.22, 0.5, 0.8]
function makeBoxes(track) {
  const rows = BOX_FRACS.map((f) => Math.round(N * f))
  const spots = rows.flatMap((i) =>
    [-3.5, 0, 3.5].map((lat) => {
      const s = track.samples[i]
      return { x: s.x + s.nx * lat, z: s.z + s.nz * lat }
    })
  )
  return { rows, spots }
}

// 가속 발판 (밟으면 부스트). 아이템 박스 구역과 겹치지 않게 배치.
// 폭은 딱 카트 한 대 크기, 좌우 위치는 트랙 안에서 무작위 —
// 고정 시드 의사난수라 모든 기기에서 같은 자리에 보인다.
export const PAD_HALF_W = 1.2 // 발판 절반 폭 (전체 약 2.4 ≈ 카트 한 대)
function makePads(track, seed) {
  return [0.1, 0.42, 0.68, 0.92].map((f, idx) => {
    const r = Math.sin(idx * 127.1 + seed) * 43758.5453
    const frac = r - Math.floor(r) // 0..1 결정적 난수
    const maxLat = track.halfW - PAD_HALF_W - 0.8 // 트랙 밖으로 안 나가게
    return { i: Math.round(N * f), lat: (frac * 2 - 1) * maxLat }
  })
}

// ── 트랙 3종 ─────────────────────────────────────────────────────────
// 장애물 정의:
//  - 움직임: {kind, i(기준 샘플), period(초), phase, span(좌우 진폭), drift?(샘플/초 전진), r}
//  - 고정:   {kind, i, lat, r}  (snowman은 부서졌다 리스폰)

// 🌳 초원 서킷 — 입문용. 소들이 한가롭게 트랙을 가로질러 다닌다.
const MEADOW_CTRL = [
  [6, -40], [34, -40], [54, -28], [58, -6],
  [46, 14], [26, 10], [16, 26], [26, 42],
  [10, 54], [-16, 50], [-40, 44], [-56, 24],
  [-58, -2], [-48, -24], [-26, -38],
]

// 🏜️ 사막 협곡 — 헤어핀과 S자가 이어지는 고난도 코스.
const DESERT_CTRL = [
  [-8, -46], [20, -48], [42, -42], [52, -26],
  [44, -10], [26, -14], [18, 2], [30, 14],
  [46, 12], [54, 26], [40, 38], [18, 34],
  [2, 44], [-20, 48], [-38, 38], [-32, 20],
  [-48, 12], [-58, -6], [-46, -28], [-22, -36],
]

// ❄️ 눈꽃 빙판 — 시원하게 도는 코스지만 빙판 구간에선 핸들이 미끄러진다!
const SNOW_CTRL = [
  [0, -48], [28, -44], [48, -28], [56, -4],
  [46, 22], [24, 38], [-2, 44], [-20, 32],
  [-38, 44], [-54, 28], [-58, 2], [-48, -22],
  [-26, -40],
]

const fi = (f) => Math.round(N * f) // 트랙 비율 → 샘플 인덱스

function finishTrack(track, def) {
  const { rows, spots } = makeBoxes(track)
  return { ...track, ...def, boxRows: rows, boxSpots: spots, pads: makePads(track, def.padSeed) }
}

export const TRACKS = {
  meadow: finishTrack(buildGeom(MEADOW_CTRL, 2, 6), {
    id: 'meadow',
    name: '초원 서킷',
    emoji: '🌳',
    desc: '한가로운 초원 코스. 단, 소들이 트랙을 건너다닌다?!',
    difficulty: '쉬움',
    padSeed: 311.7,
    obstacles: [
      { kind: 'cow', i: fi(0.3), period: 9, phase: 0.4, span: 6.5, r: 1.6 },
      { kind: 'cow', i: fi(0.58), period: 7, phase: 2.6, span: 6.5, r: 1.6 },
      { kind: 'cow', i: fi(0.86), period: 11, phase: 4.4, span: 6.5, r: 1.6 },
    ],
    theme: {
      sky: 0x8ecdf5, dusk: 0xff9e6b, ground: 0x68b95c, road: 0x474d59,
      treeLeaf: 0x2e8b46, treeTrunk: 0x7a5230, treeCount: 80,
      flora: ['🌼', '🌸', '🌷', '🍄', '🌻', '🪨', '🦋'],
    },
  }),
  desert: finishTrack(buildGeom(DESERT_CTRL, 2, 6), {
    id: 'desert',
    name: '사막 협곡',
    emoji: '🏜️',
    desc: '헤어핀 가득 고난도 코스. 선인장은 따갑고 회오리는 빙글빙글!',
    difficulty: '어려움',
    padSeed: 73.3,
    obstacles: [
      { kind: 'cactus', i: fi(0.16), lat: -2.6, r: 1.3 },
      { kind: 'cactus', i: fi(0.34), lat: 2.6, r: 1.3 },
      { kind: 'cactus', i: fi(0.62), lat: -2.2, r: 1.3 },
      { kind: 'cactus', i: fi(0.76), lat: 2.4, r: 1.3 },
      { kind: 'tornado', i: fi(0.26), period: 5, phase: 1.1, span: 4, drift: 5, r: 1.8 },
      { kind: 'tornado', i: fi(0.7), period: 6.5, phase: 3.9, span: 4, drift: 4, r: 1.8 },
    ],
    theme: {
      sky: 0xbcd9ea, dusk: 0xff8a50, ground: 0xddbb77, road: 0x6b5d4a,
      treeLeaf: 0x8aa55a, treeTrunk: 0x8a6a40, treeCount: 18,
      flora: ['🌵', '🪨', '🦂', '🌾', '💀'],
    },
  }),
  snow: finishTrack(buildGeom(SNOW_CTRL, 2, 7), {
    id: 'snow',
    name: '눈꽃 빙판',
    emoji: '❄️',
    desc: '파란 빙판에선 핸들이 주르륵~ 눈사람은 박으면 와장창!',
    difficulty: '보통',
    padSeed: 521.9,
    // 빙판 구간 (샘플 범위): 이 위에선 조향이 잘 안 듣는다
    ice: [
      { from: fi(0.05), to: fi(0.17) },
      { from: fi(0.44), to: fi(0.58) },
      { from: fi(0.7), to: fi(0.78) },
    ],
    obstacles: [
      { kind: 'snowman', i: fi(0.3), lat: -3, r: 1.4 },
      { kind: 'snowman', i: fi(0.55), lat: 2.6, r: 1.4 },
      { kind: 'snowman', i: fi(0.84), lat: -2.4, r: 1.4 },
      { kind: 'penguin', i: fi(0.38), period: 6, phase: 0.8, span: 7.5, r: 1.4 },
      { kind: 'penguin', i: fi(0.64), period: 5, phase: 2.9, span: 7.5, r: 1.4 },
      { kind: 'penguin', i: fi(0.96), period: 7.5, phase: 5.1, span: 7.5, r: 1.4 },
    ],
    theme: {
      sky: 0xcfe4f4, dusk: 0xe8a8c8, ground: 0xeef6fb, road: 0x5a6470,
      treeLeaf: 0xd8ecf4, treeTrunk: 0x6b4f38, treeCount: 70,
      flora: ['❄️', '🧊', '🪨', '🌨️'],
    },
  }),
}

export const TRACK_LIST = [TRACKS.meadow, TRACKS.desert, TRACKS.snow]
export const DEFAULT_TRACK_ID = 'meadow'

// 이전 호환(테스트 등): 기본 트랙과 그 배치
export const TRACK = TRACKS.meadow
export const BOX_ROWS = TRACKS.meadow.boxRows
export const BOX_SPOTS = TRACKS.meadow.boxSpots
export const PADS = TRACKS.meadow.pads

// 장애물의 현재 위치 — 시간의 순수 함수라 엔진(충돌)과 렌더러(그리기)가
// 같은 결과를 얻는다. 움직이는 장애물은 좌우 사인 진동(+선택적 전진 drift).
// 트랙 좌표(진행도 + 좌우 offset). 봇의 회피 조향에도 쓰인다.
export function obstacleTrackPos(track, ob, time) {
  const prog = ob.drift ? (ob.i + time * ob.drift) % track.n : ob.i
  const lat = ob.period
    ? Math.sin((time * Math.PI * 2) / ob.period + (ob.phase || 0)) * ob.span
    : ob.lat
  return { prog, lat }
}

export function obstaclePose(track, ob, time) {
  const { prog, lat } = obstacleTrackPos(track, ob, time)
  const p = samplePoint(track, prog)
  return { x: p.x + p.nx * lat, z: p.z + p.nz * lat }
}

// 샘플 인덱스가 빙판 구간 안인지 (눈꽃 빙판 전용)
export function onIce(track, ci) {
  if (!track.ice) return false
  return track.ice.some((zn) => ci >= zn.from && ci <= zn.to)
}

// 가장 가까운 센터라인 샘플 인덱스. hint가 있으면 그 주변만 탐색(프레임당 비용 절감).
export function nearestSample(track, x, z, hint = -1) {
  const { samples, n } = track
  let best = 0
  let bd = Infinity
  const scan = (i) => {
    const s = samples[i]
    const d = (x - s.x) * (x - s.x) + (z - s.z) * (z - s.z)
    if (d < bd) {
      bd = d
      best = i
    }
  }
  if (hint < 0) {
    for (let i = 0; i < n; i++) scan(i)
  } else {
    for (let o = -14; o <= 14; o++) scan((((hint + o) % n) + n) % n)
  }
  return best
}

// 샘플 인덱스 차이를 [-n/2, n/2) 범위로 감아서(랩 경계 넘김) 반환
export function wrapDelta(d, n) {
  const m = ((d % n) + n) % n
  return m >= n / 2 ? m - n : m
}

// 누적 진행도(prog, 샘플 단위 실수) → 센터라인 위 보간 위치
export function samplePoint(track, prog) {
  const { samples, n } = track
  const p = ((prog % n) + n) % n
  const i = Math.floor(p)
  const f = p - i
  const a = samples[i]
  const b = samples[(i + 1) % n]
  return {
    x: a.x + (b.x - a.x) * f,
    z: a.z + (b.z - a.z) * f,
    dx: a.dx,
    dz: a.dz,
    nx: a.nx,
    nz: a.nz,
  }
}
