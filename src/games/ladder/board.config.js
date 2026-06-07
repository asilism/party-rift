// 사다리 게임 설정값. 1차 MVP에서는 고정값이지만,
// 향후 "설정패널"에서 이 값들을 바꿀 수 있도록 모두 데이터로 분리해 둔다.
//
// 칸 번호는 1부터 시작(1 = 시작, tileCount = 골).
// platforms: { 출발칸: 도착칸 }  (도착 > 출발 → 올라감, 도착 < 출발 → 내려감)
//   - 사다리 규칙: 발판은 "항상 바로 윗줄 또는 바로 아랫줄"로만 연결한다.
//     같은 줄 안에서 끝나는 발판은 금지(validateBoards로 강제).
//   - 내려가는 발판은 하강 폭을 작게(−1 ~ −3) 유지해 아이들이 너무 속상하지 않게.
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

// 30칸 보드 (cols=6, rows=5)
// 발판은 한 줄 위/아래로만 이어지고, 같은 줄 묶음(band) 안에서 가로 위치가 겹치지
// 않도록 배치해 화살표가 서로 cross 되지 않게 했다. (대부분 수직선)
export const DEFAULT_CONFIG = {
  ...COMMON,
  tileCount: 30,
  cols: 6,
  rows: 5,
  // 줄 구분(cols=6): 1~6 / 7~12 / 13~18 / 19~24 / 25~30
  platforms: {
    // 올라가는 발판 (사다리)
    3: 9, //  r0 → r1
    5: 8, //  r0 → r1 (수직)
    10: 16, // r1 → r2
    15: 22, // r2 → r3 (수직)
    21: 27, // r3 → r4
    // 내려가는 발판 (미끄럼틀)
    14: 11, // r2 → r1 (수직)
    19: 17, // r3 → r2
    29: 20, // r4 → r3 — 골(30) 바로 앞 반전!
  },
  // 열쇠카드 칸 — 줄마다 1개 (발판/출발/골 칸과 겹치지 않게)
  keyTiles: [4, 7, 13, 24, 26],
}

// 50칸 보드 (cols=10, rows=5)
export const CONFIG_50 = {
  ...COMMON,
  tileCount: 50,
  cols: 10,
  rows: 5,
  // 줄 구분(cols=10): 1~10 / 11~20 / 21~30 / 31~40 / 41~50
  platforms: {
    // 올라가는 발판 (사다리)
    3: 17, //  r0 → r1
    7: 14, //  r0 → r1 (수직)
    16: 25, // r1 → r2 (수직)
    24: 37, // r2 → r3 (수직)
    28: 33, // r2 → r3 (수직)
    35: 46, // r3 → r4 (수직)
    // 내려가는 발판 (미끄럼틀)
    12: 9, //  r1 → r0 (수직)
    22: 19, // r2 → r1 (수직)
    38: 23, // r3 → r2 (수직)
    49: 32, // r4 → r3 — 골(50) 바로 앞 반전!
  },
  // 열쇠카드 칸 — 줄마다 1개 (발판/출발/골 칸과 겹치지 않게)
  keyTiles: [5, 15, 27, 36, 44],
}

// 시작 화면에서 고를 수 있는 보드 목록
export const BOARDS = [
  { id: '30', label: '30칸', config: DEFAULT_CONFIG },
  { id: '50', label: '50칸', config: CONFIG_50 },
]

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
