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
    return { x, y: 0, z, dx, dz, nx: -dz, nz: dx }
  })
  return { n: N, samples, halfW, segLen: total / N }
}

// 고도 프로필: [트랙 비율, 높이] 제어점을 코사인 보간해 샘플마다 y를 채운다.
// 점프대(jumps)는 도약 지점 앞 몇 샘플이 쐐기처럼 솟아오른다.
const JUMP_RAMP_H = 1.2 // 점프대 쐐기 높이
const JUMP_RAMP_LEN = 3 // 쐐기 길이 (샘플)
function applyElevation(track, elev, jumps = []) {
  for (let i = 0; i < track.n; i++) {
    const f = i / track.n
    let a = elev[0]
    let b = elev[elev.length - 1]
    for (let p = 0; p < elev.length - 1; p++) {
      if (f >= elev[p][0] && f <= elev[p + 1][0]) {
        a = elev[p]
        b = elev[p + 1]
        break
      }
    }
    const t = Math.min(1, Math.max(0, (f - a[0]) / Math.max(1e-6, b[0] - a[0])))
    track.samples[i].y = a[1] + (b[1] - a[1]) * (0.5 - Math.cos(Math.PI * t) * 0.5)
  }
  for (const j of jumps) {
    for (let k = 0; k <= JUMP_RAMP_LEN; k++) {
      const idx = (j.i - JUMP_RAMP_LEN + k + track.n) % track.n
      track.samples[idx].y += (k / JUMP_RAMP_LEN) * JUMP_RAMP_H
    }
  }
}

// 샘플 인덱스가 낭떠러지(도로 끊김) 구간 안인지
export function inGap(track, ci) {
  return (track.gaps || []).some((g) => ci >= g.from && ci <= g.to)
}

// 아이템 박스 위치: 트랙 위 3곳 × 가로 3개 (모든 트랙 공통 비율)
const BOX_FRACS = [0.22, 0.5, 0.8]
function makeBoxes(track) {
  const rows = BOX_FRACS.map((f) => Math.round(N * f))
  const spots = rows.flatMap((i) =>
    [-3.5, 0, 3.5].map((lat) => {
      const s = track.samples[i]
      return { x: s.x + s.nx * lat, y: s.y || 0, z: s.z + s.nz * lat }
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

// 🏜️ 사막 협곡 — 유턴 헤어핀 3개 + S자/시케인이 이어지는 최고난도 코스.
const DESERT_CTRL = [
  [-6, -48], [18, -50], [38, -46], [52, -34],
  [56, -18], [44, -12], [34, -22], [24, -32], // 헤어핀1 (오른쪽 아래 유턴)
  [12, -26], [14, -12], [28, -4], [44, 0],
  [54, 10], [48, 24], [34, 28], [28, 16], // 헤어핀2 (오른쪽 위 유턴)
  [16, 8], [4, 16], [8, 30], [18, 40], // S자 상승
  [8, 50], [-10, 46], [-16, 32], [-28, 24], // 시케인
  [-44, 30], [-56, 20], [-54, 2], [-40, -6], // 헤어핀3 (왼쪽 유턴)
  [-30, -18], [-44, -28], [-34, -42],
]

// ❄️ 눈꽃 빙판 — 큰 스윕 사이사이 유턴 헤어핀 2개 + 시케인.
const SNOW_CTRL = [
  [0, -50], [26, -46], [46, -34], [56, -16],
  [50, 4], [36, 12], [30, 0], [20, -10], // 헤어핀1 (오른쪽 중앙 유턴)
  [8, -2], [12, 14], [24, 26], [36, 34],
  [28, 46], [10, 48], [-2, 38], [-14, 28], // 내려오는 시케인
  [-28, 36], [-44, 42], [-56, 30], [-52, 12],
  [-36, 8], [-46, -6], [-54, -20], // 헤어핀2 (왼쪽 유턴)
  [-42, -34], [-22, -44],
]

// 🌋 화산 협곡 — 시리즈 첫 입체 코스! 오르막으로 산허리에 올라
// 점프대로 용암 협곡을 건너뛴다. 느리면 풍덩~ (리스폰), 내리막 언덕에선 신나는 점프!
const VOLCANO_CTRL = [
  [4, -46], [26, -48], [46, -40], [56, -22],
  [52, -2], [40, 14], [30, 28], // 오르막
  [16, 38], [0, 46], // 협곡 점프 직선
  [-18, 48], [-34, 42], [-44, 30], [-56, 18],
  [-56, 0], [-46, -12], // 언덕 점프 진입
  [-50, -26], [-40, -38], // 내리막
  [-26, -44], [-14, -47], [-6, -40], // 가벼운 S
]

// 🚂 칙칙폭폭 철길 — 시리즈 최대·최고난도 코스.
// 기차가 트랙을 가로지르는 건널목 2곳(치이면 하늘로 펑!), 강 위 끊어진 다리 점프,
// 공사 구간 바리케이드, 건너다니는 트랙터, 증기 분출구까지.
const RAIL_CTRL = [
  [0, -44], [22, -46], [40, -42], [52, -30], // 출발 직선 → 우상향
  [56, -14], [48, -2], [36, -8], [30, 2], // 헤어핀 A (S자 유턴)
  [38, 14], [50, 22], [48, 36], [34, 44], // 오른쪽 위 스윕
  [16, 46], [-2, 44], [-20, 46], [-38, 42], // 윗쪽 직선 (다리 점프)
  [-50, 30], [-44, 16], [-56, 6], [-54, -10], // 왼쪽 내리막 + 헤어핀 B
  [-42, -20], [-50, -32], [-34, -42], // 헤어핀 C
  [-16, -38], [-8, -46], // 마지막 시케인
]

const fi = (f) => Math.round(N * f) // 트랙 비율 → 샘플 인덱스

function finishTrack(track, def) {
  if (def.elev) applyElevation(track, def.elev, def.jumps) // 고도는 박스 배치 전에
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
    // 소는 한 방향으로만 건너간다 (cross): 코스 밖으로 나가면 사라졌다가
    // 반대편에서 다시 나타난다 — 뒷걸음질 없음!
    obstacles: [
      { kind: 'cow', i: fi(0.3), cross: true, period: 11, phase: 0.2, dir: 1, span: 9.5, r: 1.6 },
      { kind: 'cow', i: fi(0.58), cross: true, period: 9, phase: 0.55, dir: -1, span: 9.5, r: 1.6 },
      { kind: 'cow', i: fi(0.86), cross: true, period: 13, phase: 0.8, dir: 1, span: 9.5, r: 1.6 },
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
    desc: '유턴 헤어핀 3개의 최고난도 코스. 선인장은 따갑고 회오리는 하늘로 붕!',
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
  volcano: finishTrack(buildGeom(VOLCANO_CTRL, 2, 6), {
    id: 'volcano',
    name: '화산 협곡',
    emoji: '🌋',
    desc: '오르막을 달려 용암 협곡을 점프! 느리면 풍덩~ 불덩이는 앗 뜨거!',
    difficulty: '보통',
    padSeed: 911.3,
    // 고도 프로필: 오르막 → 산허리 평지(협곡 점프) → 내리막 → 점프 언덕
    elev: [
      [0, 0], [0.16, 0], [0.26, 6], [0.5, 6], [0.6, 0],
      [0.66, 0], [0.715, 2.5], [0.78, 0], [1, 0],
    ],
    // 점프대: 협곡 직전 + 내리막 언덕 꼭대기 (재미 점프)
    jumps: [{ i: fi(0.36) }, { i: fi(0.715) }],
    // 용암 협곡: 도로가 끊겨 있다 — 점프로 건너야 한다!
    gaps: [{ from: fi(0.36) + 1, to: fi(0.36) + 5 }],
    obstacles: [
      { kind: 'magma', i: fi(0.08), period: 5, phase: 0.6, span: 5, r: 1.3 },
      { kind: 'magma', i: fi(0.55), period: 6, phase: 2.2, span: 5.5, r: 1.3 },
      { kind: 'magma', i: fi(0.88), period: 4.5, phase: 4.0, span: 5, r: 1.3 },
    ],
    theme: {
      sky: 0xe5b48a, dusk: 0xb3543f, ground: 0x8a6852, road: 0x3a363f,
      treeLeaf: 0x9a5a34, treeTrunk: 0x4a3328, treeCount: 26,
      flora: ['🪨', '🔥', '🌶️', '🦴', '🌋'],
      lava: 0xff5a1f, // 협곡 아래 용암 / 화산 분화구 색
    },
  }),
  rails: finishTrack(buildGeom(RAIL_CTRL, 2.4, 6), {
    id: 'rails',
    name: '칙칙폭폭 철길',
    emoji: '🚂',
    desc: '시리즈 최대 코스! 건널목에서 기차에 치이면 하늘로 펑~ 다리는 점프로!',
    difficulty: '최고난도',
    padSeed: 333.7,
    // 강 위 끊어진 다리: 살짝 오르막 → 점프로 건넌다 (+ 가벼운 언덕 하나)
    elev: [
      [0, 0], [0.28, 0], [0.34, 2], [0.4, 0],
      [0.44, 0], [0.485, 3.5], [0.56, 3.5], [0.62, 0], [1, 0],
    ],
    jumps: [{ i: fi(0.5) }],
    gaps: [{ from: fi(0.5) + 1, to: fi(0.5) + 5 }],
    // 기차 건널목: 기차가 도로 법선 방향으로 가로질러 달린다 (치이면 펑!)
    trains: [
      { i: fi(0.3), period: 8, phase: 0.35, dir: 1, span: 60, cars: 4, carGap: 6.5, r: 2.2 },
      { i: fi(0.9), period: 10, phase: 0.75, dir: -1, span: 60, cars: 5, carGap: 6.5, r: 2.2 },
    ],
    obstacles: [
      { kind: 'barrier', i: fi(0.18), lat: -2.5, r: 1.3 },
      { kind: 'barrier', i: fi(0.63), lat: 2.4, r: 1.3 },
      { kind: 'tractor', i: fi(0.4), cross: true, period: 10, phase: 0.3, dir: 1, span: 9.5, r: 1.7 },
      { kind: 'tractor', i: fi(0.74), cross: true, period: 12, phase: 0.7, dir: -1, span: 9.5, r: 1.7 },
      { kind: 'steam', i: fi(0.26), period: 7, phase: 1.4, span: 4.5, r: 1.7 },
      { kind: 'steam', i: fi(0.68), period: 8, phase: 4.2, span: 4.5, r: 1.7 },
    ],
    theme: {
      sky: 0xa9d3ec, dusk: 0xf09a5e, ground: 0x86a85c, road: 0x4a4a52,
      treeLeaf: 0x4f9a4a, treeTrunk: 0x6e4f33, treeCount: 56,
      flora: ['🌾', '🌻', '🪨', '🐓', '🌼', '🛤️'],
      pool: 0x3e7bd6, // 다리 아래 강물
    },
  }),
}

export const TRACK_LIST = [TRACKS.meadow, TRACKS.desert, TRACKS.snow, TRACKS.volcano, TRACKS.rails]
export const DEFAULT_TRACK_ID = 'meadow'

// 이전 호환(테스트 등): 기본 트랙과 그 배치
export const TRACK = TRACKS.meadow
export const BOX_ROWS = TRACKS.meadow.boxRows
export const BOX_SPOTS = TRACKS.meadow.boxSpots
export const PADS = TRACKS.meadow.pads

// 장애물의 현재 위치 — 시간의 순수 함수라 엔진(충돌)과 렌더러(그리기)가
// 같은 결과를 얻는다. 트랙 좌표(진행도 + 좌우 offset). 봇의 회피 조향에도 쓰인다.
//  - cross: 한 방향으로 건너가고(소), 끝에 닿으면 반대편에서 다시 시작
//  - period(cross 아님): 좌우 사인 진동(펭귄/회오리) + 선택적 전진 drift
export function obstacleTrackPos(track, ob, time) {
  const prog = ob.drift ? (ob.i + time * ob.drift) % track.n : ob.i
  let lat
  if (ob.cross) {
    const f = (((time / ob.period + ob.phase) % 1) + 1) % 1
    lat = (f * 2 - 1) * ob.span * (ob.dir || 1)
  } else if (ob.period) {
    lat = Math.sin((time * Math.PI * 2) / ob.period + (ob.phase || 0)) * ob.span
  } else {
    lat = ob.lat
  }
  return { prog, lat }
}

// 건너가는 장애물(소)이 코스 밖으로 나가 있는 동안은 보이지도 않고
// 부딪히지도 않는다 (사라졌다 반대편 리스폰 연출)
export function obstacleVisible(track, ob, time) {
  if (!ob.cross) return true
  const { lat } = obstacleTrackPos(track, ob, time)
  return Math.abs(lat) <= track.halfW + 1.5
}

export function obstaclePose(track, ob, time) {
  const { prog, lat } = obstacleTrackPos(track, ob, time)
  const p = samplePoint(track, prog)
  return { x: p.x + p.nx * lat, y: p.y, z: p.z + p.nz * lat }
}

// 기차의 현재 객차 위치들 — 시간의 순수 함수라 엔진(충돌)과 렌더러(그리기)가
// 같은 결과를 얻는다. 기관차(head)가 도로 법선 방향으로 -span → +span을 주기마다 가로지른다.
export function trainCars(track, tr, time) {
  const f = (((time / tr.period + tr.phase) % 1) + 1) % 1
  const head = (f * 2 - 1) * tr.span * tr.dir
  const s = track.samples[tr.i]
  const out = []
  for (let c = 0; c < tr.cars; c++) {
    const lat = head - tr.dir * c * tr.carGap
    if (Math.abs(lat) > tr.span) continue
    out.push({ x: s.x + s.nx * lat, z: s.z + s.nz * lat, lat, c, engine: c === 0 })
  }
  return out
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
    y: (a.y || 0) + ((b.y || 0) - (a.y || 0)) * f,
    z: a.z + (b.z - a.z) * f,
    dx: a.dx,
    dz: a.dz,
    nx: a.nx,
    nz: a.nz,
  }
}
