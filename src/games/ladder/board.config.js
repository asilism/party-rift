// 사다리 게임 설정값. 1차 MVP에서는 고정값이지만,
// 향후 "설정패널"에서 이 값들을 바꿀 수 있도록 모두 데이터로 분리해 둔다.
//
// 칸 번호는 1부터 시작(1 = 시작, tileCount = 골).
// platforms: { 출발칸: 도착칸 }  (도착 > 출발 → 올라감, 도착 < 출발 → 내려감)
//   - 내려가는 발판은 하강 폭을 작게(−1 ~ −3) 유지해 아이들이 너무 속상하지 않게.

export const DEFAULT_CONFIG = {
  tileCount: 30, // 추후 설정패널에서 선택 가능
  cols: 6,
  rows: 5,
  diceCount: 1, // 주사위 1개 (1~6)
  diceSides: 6,
  overshoot: true, // 골 칸 이상이면 골인 처리(초과 허용)
  bonusOnMax: false, // 6 나오면 한 번 더? → 사용 안 함
  minPlayers: 2,
  maxPlayers: 5,
  sound: true,
  platforms: {
    // 올라가는 발판 (사다리)
    3: 9, //  +6
    8: 14, // +6
    11: 18, // +7
    20: 26, // +6
    // 내려가는 발판 (미끄럼틀) — 하강 폭 제한
    16: 13, // -3
    23: 21, // -2
    27: 25, // -2
  },
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
