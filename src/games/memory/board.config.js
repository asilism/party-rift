// 12지신 메모리 설정값. 난이도(그리드 크기)와 플레이어 색을 데이터로 분리.
// 가로 와이드 화면에 맞게 cols >= rows 로 구성. cols*rows = pairs*2.

export const DIFFICULTIES = [
  { id: 'easy', label: '쉬움', emoji: '🙂', pairs: 6, cols: 4, rows: 3 }, // 12장
  { id: 'normal', label: '보통', emoji: '😀', pairs: 9, cols: 6, rows: 3 }, // 18장
  { id: 'hard', label: '어려움', emoji: '😎', pairs: 12, cols: 6, rows: 4 }, // 24장
]
