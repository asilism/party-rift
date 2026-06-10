// 파티 카트 트랙 데이터. 닫힌 캣멀롬(Catmull-Rom) 스플라인을 샘플링해
// 센터라인(샘플 점 + 진행방향 + 법선)을 만든다.
// 물리 엔진과 3D 렌더러가 같은 데이터를 공유한다. (three.js 의존 없음 → node 테스트 가능)

// 컨트롤 포인트 (x, z). 아래쪽 직선(출발선) → 오른쪽 위로 → S자 → 윗변 → 왼쪽 아래로.
const SCALE = 2 // 서킷 전체 크기 배율
const CTRL = [
  [6, -40], [34, -40], [54, -28], [58, -6],
  [46, 14], [26, 10], [16, 26], [26, 42],
  [10, 54], [-16, 50], [-40, 44], [-56, 24],
  [-58, -2], [-48, -24], [-26, -38],
].map(([x, z]) => [x * SCALE, z * SCALE])

const N = 400 // 센터라인 샘플 수 (sample 0 = 출발선)

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

function buildTrack() {
  const m = CTRL.length
  const pts = []
  for (let i = 0; i < N; i++) {
    const f = (i / N) * m
    const seg = Math.floor(f)
    const t = f - seg
    const p0 = CTRL[(seg - 1 + m) % m]
    const p1 = CTRL[seg % m]
    const p2 = CTRL[(seg + 1) % m]
    const p3 = CTRL[(seg + 2) % m]
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
  return { n: N, samples, halfW: 6, segLen: total / N }
}

export const TRACK = buildTrack()

// 아이템 박스 위치: 트랙 위 3곳 × 가로 3개
export const BOX_ROWS = [0.22, 0.5, 0.8].map((f) => Math.round(N * f))
export const BOX_SPOTS = BOX_ROWS.flatMap((i) =>
  [-3.5, 0, 3.5].map((lat) => {
    const s = TRACK.samples[i]
    return { x: s.x + s.nx * lat, z: s.z + s.nz * lat }
  })
)

// 가속 발판 위치 (밟으면 부스트). 아이템 박스 구역과 겹치지 않게 배치.
// 폭은 딱 카트 한 대 크기 — 잘 조준해서 밟아야 한다.
export const PAD_ROWS = [0.1, 0.42, 0.68, 0.92].map((f) => Math.round(N * f))
export const PAD_HALF_W = 1.2 // 발판 절반 폭 (전체 약 2.4 ≈ 카트 한 대)

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
