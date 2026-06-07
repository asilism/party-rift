// 사다리 게임 설정. 맵(발판/열쇠칸)은 게임 시작 시 매번 새로 생성된다(generateBoard).
//
// 칸 번호는 1부터 시작(1 = 시작, tileCount = 골).
// platforms: { 출발칸: 도착칸 }  (도착 > 출발 → 올라감, 도착 < 출발 → 내려감)
//   - 사다리 규칙: 발판은 "항상 바로 윗줄 또는 바로 아랫줄"로만 연결한다.
//   - 생성되는 발판은 모두 수직(같은 칸 위/아래)이라 화살표가 절대 교차하지 않는다.
//   - 골 바로 앞 칸에는 항상 한 줄 내려가는 미끄럼틀(반전)이 들어간다.
// keyTiles: 열쇠카드 칸(줄마다 1개). 밟으면 카드 선택 이벤트 발생.

// 모든 보드가 공유하는 기본값(주사위/인원/규칙 등)
const COMMON = {
  diceCount: 1, // 주사위 1개 (1~6)
  diceSides: 6,
  overshoot: true, // 골 칸 이상이면 골인 처리(초과 허용)
  bonusOnMax: false, // 6 나오면 한 번 더? → 사용 안 함
  minPlayers: 2,
  maxPlayers: 5,
  sound: true,
}

// 시작 화면에서 고를 수 있는 보드 크기
export const BOARD_SIZES = [
  { id: '30', label: '30칸', tileCount: 30, cols: 6, rows: 5 },
  { id: '50', label: '50칸', tileCount: 50, cols: 10, rows: 5 },
]

// (row, col) → 칸 번호. tileCol의 역함수(뱀 배치).
function tileAt(row, col, cols) {
  const c = row % 2 === 1 ? cols - 1 - col : col
  return row * cols + c + 1
}

// 보드(발판/열쇠칸)를 랜덤 생성한다. rng 주입 가능 → 테스트 결정적.
//
// 설계:
//  · 발판은 "이웃한 두 줄(band)"을 잇고, 대각선도 허용한다.
//  · 단, 각 band 안에서 끝점을 좌표순으로 단조 매칭 → 선이 절대 교차하지 않는다.
//  · 가장자리(맨 왼/오른쪽 열) 칸엔 사다리를 두지 않는다(꺾이는 지점이라 어색함).
//  · 한 band(두 줄 사이)에는 같은 종류 발판을 1개까지만(올라감 1 + 내려감 1).
//  · 열쇠카드 칸은 발판을 깐 뒤 남은 칸 중 줄마다 1개를 무작위로 배치한다.
//  · 골 바로 앞 칸(goal-1)엔 항상 한 줄 내려가는 미끄럼틀(반전)을 넣는다.
//  · 오르막(사다리)과 내리막(미끄럼틀) 개수를 비슷하게 맞춘다.
export function generateBoard(size, rng = Math.random) {
  const { tileCount, cols, rows } = size
  const bands = rows - 1
  const pick = (n) => Math.floor(rng() * n)
  // 안쪽 열(가장자리 제외): 사다리는 여기에만 둔다
  const interior = []
  for (let c = 1; c <= cols - 2; c++) interior.push(c)
  // 배열에서 m개 무작위 추출(중복 없음)
  const sample = (arr, m) => {
    const a = [...arr]
    const out = []
    for (let i = 0; i < m && a.length; i++) out.push(a.splice(pick(a.length), 1)[0])
    return out
  }

  const used = new Set([1, tileCount]) // 출발/골은 발판 금지
  const pgCol = tileCol(tileCount - 1, cols) // 골 직전 칸의 열 (안쪽 열)
  used.add(tileCount - 1) // 골 직전 칸 예약

  // 1) band마다 비교차 매칭 생성(대각선 허용). 끝점은 안쪽 열 + 미사용 칸만.
  //    각 band에서 아래/위 열을 좌표순으로 단조 매칭하면 선이 절대 교차하지 않는다.
  //    한 band(두 줄 사이)에는 같은 종류 발판을 1개까지만 → k는 최대 2(올라감1+내려감1).
  const segments = [] // { b, lowCol, hiCol, dir: 'up'|'down'|null }
  for (let b = 0; b < bands; b++) {
    const lowerFree = interior.filter((c) => !used.has(tileAt(b, c, cols)))
    let upperFree = interior.filter((c) => !used.has(tileAt(b + 1, c, cols)))
    // 골 직전 미끄럼틀: 이 band에서 goal-1(윗줄, pgCol)을 반드시 포함시킨다.
    const forcedHi = b === rows - 2 ? pgCol : null
    if (forcedHi != null) upperFree = upperFree.filter((c) => c !== forcedHi)

    const avail = Math.min(lowerFree.length, upperFree.length + (forcedHi != null ? 1 : 0))
    if (avail <= 0) continue
    const k = Math.min(1 + pick(2), avail, 2) // 1 또는 2

    const hi = sample(upperFree, forcedHi != null ? k - 1 : k)
    if (forcedHi != null) hi.push(forcedHi)
    const lo = sample(lowerFree, k)
    hi.sort((x, y) => x - y)
    lo.sort((x, y) => x - y)

    const bandSegs = []
    for (let i = 0; i < k; i++) bandSegs.push({ b, lowCol: lo[i], hiCol: hi[i], dir: null })

    // 같은 종류 1개 제한: 2개면 무조건 하나는 올라감 / 하나는 내려감
    if (k === 2) {
      const downIdx =
        forcedHi != null ? bandSegs.findIndex((s) => s.hiCol === forcedHi) : pick(2)
      bandSegs.forEach((s, i) => (s.dir = i === downIdx ? 'down' : 'up'))
    } else if (forcedHi != null) {
      bandSegs[0].dir = 'down' // 골 앞 단독 → 내려감 고정
    } // 그 외 1개짜리는 null로 두고 아래에서 균형 배정

    for (const s of bandSegs) {
      segments.push(s)
      used.add(tileAt(b, s.lowCol, cols))
      used.add(tileAt(b + 1, s.hiCol, cols))
    }
  }

  // 2) 남은(1개짜리 band) 방향을 정해 오르막/내리막 개수를 비슷하게 맞춘다.
  const downCount = segments.filter((s) => s.dir === 'down').length
  const freeSegs = segments.filter((s) => s.dir == null)
  const targetDowns = Math.round(segments.length / 2)
  let needDown = Math.max(0, Math.min(freeSegs.length, targetDowns - downCount))
  for (const s of sample(freeSegs, freeSegs.length)) s.dir = needDown-- > 0 ? 'down' : 'up'

  // 3) 발판 맵 구성 (down: 윗칸→아랫칸, up: 아랫칸→윗칸)
  const platforms = {}
  for (const s of segments) {
    const lowerTile = tileAt(s.b, s.lowCol, cols)
    const upperTile = tileAt(s.b + 1, s.hiCol, cols)
    if (s.dir === 'down') platforms[upperTile] = lowerTile
    else platforms[lowerTile] = upperTile
  }

  // 4) 열쇠카드 칸: 발판을 다 깐 뒤, 남은 칸 중 줄마다 1개를 무작위로 고른다.
  //    (사다리는 가장자리를 쓰지 않으므로 가장자리는 늘 비어 있어 줄마다 1개가 보장된다.)
  const keyTiles = []
  for (let r = 0; r < rows; r++) {
    const free = []
    for (let c = 0; c < cols; c++) {
      const t = tileAt(r, c, cols)
      if (!used.has(t)) free.push(t)
    }
    if (free.length) {
      const t = free[pick(free.length)]
      keyTiles.push(t)
      used.add(t)
    }
  }

  return { ...COMMON, tileCount, cols, rows, platforms, keyTiles }
}

// 발판 종류 분리 헬퍼 (렌더링/연출용)
export function classifyPlatforms(config) {
  const ups = []
  const downs = []
  for (const [fromStr, to] of Object.entries(config.platforms)) {
    const from = Number(fromStr)
    if (to > from) ups.push({ from, to })
    else downs.push({ from, to })
  }
  return { ups, downs }
}

// 칸 번호 → 줄(row) 번호 (0 = 맨 아래줄)
export function tileRow(tile, cols) {
  return Math.floor((tile - 1) / cols)
}

// 사다리 규칙 검증: 모든 발판은 바로 윗줄/아랫줄로만 연결되어야 한다.
// (같은 줄 또는 두 줄 이상 건너뛰는 발판이 있으면 오류 메시지를 반환)
export function validateBoard(config) {
  const errs = []
  for (const [fromStr, to] of Object.entries(config.platforms)) {
    const from = Number(fromStr)
    const diff = Math.abs(tileRow(to, config.cols) - tileRow(from, config.cols))
    if (diff !== 1) {
      errs.push(`발판 ${from}→${to}: ${diff === 0 ? '같은 줄' : `${diff}줄 차이`} (줄간 1칸 이동만 허용)`)
    }
  }
  return errs
}

// 칸 번호 → 보드상의 가로 위치(col). 뱀 배치라 줄마다 방향이 뒤집힌다.
function tileCol(tile, cols) {
  const i = tile - 1
  const row = Math.floor(i / cols)
  const col = i % cols
  return row % 2 === 1 ? cols - 1 - col : col
}

// 화살표 교차 검증: 같은 band(이웃한 두 줄 사이)에 있는 두 발판이
// 가로 순서가 뒤바뀌면 선이 X자로 교차한다 → 오류로 본다.
export function validateNoCrossings(config) {
  const errs = []
  const { cols } = config
  const segs = Object.entries(config.platforms).map(([fromStr, to]) => {
    const from = Number(fromStr)
    const lowRow = Math.min(tileRow(from, cols), tileRow(to, cols))
    const lowTile = tileRow(from, cols) < tileRow(to, cols) ? from : to
    const highTile = lowTile === from ? to : from
    return { from, to, band: lowRow, low: tileCol(lowTile, cols), high: tileCol(highTile, cols) }
  })
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const a = segs[i]
      const b = segs[j]
      if (a.band !== b.band) continue
      // 아래줄에서의 좌우 순서와 윗줄에서의 좌우 순서가 반대면 교차
      if ((a.low - b.low) * (a.high - b.high) < 0) {
        errs.push(`발판 ${a.from}→${a.to} 와 ${b.from}→${b.to} 가 교차`)
      }
    }
  }
  return errs
}
