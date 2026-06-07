// 사다리 게임 설정값. 1차 MVP에서는 고정값이지만,
// 향후 "설정패널"에서 이 값들을 바꿀 수 있도록 모두 데이터로 분리해 둔다.
//
// 칸 번호는 1부터 시작(1 = 시작, tileCount = 골).
// platforms: { 출발칸: 도착칸 }  (도착 > 출발 → 올라감, 도착 < 출발 → 내려감)
//   - 내려가는 발판은 하강 폭을 작게(−1 ~ −3) 유지해 아이들이 너무 속상하지 않게.

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
export const DEFAULT_CONFIG = {
  ...COMMON,
  tileCount: 30,
  cols: 6,
  rows: 5,
  // 모든 발판은 "다른 줄"로 연결되도록 배치(같은 줄 안에서 끝나지 않게 → 표시가 깔끔).
  // 줄 구분(cols=6): 1~6 / 7~12 / 13~18 / 19~24 / 25~30
  platforms: {
    // 올라가는 발판 (사다리) — 한 줄 위로
    3: 9, //  r0 → r1
    10: 16, // r1 → r2
    14: 20, // r2 → r3
    21: 27, // r3 → r4
    // 내려가는 발판 (미끄럼틀) — 한 줄 아래로, 하강 폭 작게(-2)
    13: 11, // r2 → r1
    19: 17, // r3 → r2
    25: 23, // r4 → r3
  },
}

// 50칸 보드 (cols=10, rows=5)
export const CONFIG_50 = {
  ...COMMON,
  tileCount: 50,
  cols: 10,
  rows: 5,
  // 줄 구분(cols=10): 1~10 / 11~20 / 21~30 / 31~40 / 41~50
  platforms: {
    // 올라가는 발판 (사다리) — 한 줄 위로
    3: 14, //  r0 → r1
    9: 19, //  r0 → r1
    16: 26, // r1 → r2
    24: 34, // r2 → r3
    29: 39, // r2 → r3
    37: 47, // r3 → r4
    // 내려가는 발판 (미끄럼틀) — 한 줄 아래로, 하강 폭 작게(-2)
    13: 11, // r1 → r0
    22: 20, // r2 → r1
    32: 30, // r3 → r2
    42: 40, // r4 → r3
  },
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
