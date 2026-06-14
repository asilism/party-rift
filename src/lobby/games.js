// 게임 컬렉션 목록. 오프라인 로비와 온라인 로비가 공유한다.
// 게임이 늘어나면 여기에 추가한다.
export const GAMES = [
  {
    id: 'ladder',
    title: '사다리 게임',
    emoji: '🎲',
    desc: '주사위를 굴려 먼저 골인!',
    minPlayers: 2,
    maxPlayers: 5,
    ready: true,
  },
  {
    id: 'memory',
    title: '12지신 메모리',
    emoji: '🃏',
    desc: '같은 동물 짝을 많이 찾아요',
    minPlayers: 1,
    maxPlayers: 5,
    ready: true,
  },
  {
    id: 'dobble',
    title: '도블',
    emoji: '🔍',
    desc: '같은 문양을 먼저 찾아요!',
    minPlayers: 2,
    maxPlayers: 4,
    ready: true,
  },
  {
    id: 'thrillpang',
    title: '스릴팡',
    emoji: '💣',
    desc: '폭탄 터지기 직전 아슬아슬하게!',
    minPlayers: 2,
    maxPlayers: 4,
    ready: true,
  },
  {
    id: 'race',
    title: '달리기 경주',
    emoji: '🏁',
    desc: '버튼을 마구 눌러 1등!',
    minPlayers: 2,
    maxPlayers: 5,
    ready: true,
  },
  {
    id: 'whack',
    title: '두더지 잡기',
    emoji: '🔨',
    desc: '내 칸 두더지를 빨리 톡!',
    minPlayers: 1,
    maxPlayers: 5,
    ready: true,
  },
  {
    id: 'traffic',
    title: '신호등 반응',
    emoji: '🚦',
    desc: '초록불에 제일 빨리!',
    minPlayers: 2,
    maxPlayers: 5,
    ready: true,
  },
  {
    id: 'kart',
    title: '파티 카트',
    emoji: '🏎️',
    desc: '3D 서킷 아이템 레이싱! CPU와 4인 경주',
    minPlayers: 1,
    maxPlayers: 5,
    onlineOnly: true, // 기기마다 조이스틱이 필요 → 온라인 방 전용
    ready: true,
  },
  {
    id: 'rift',
    title: '파티 리프트',
    emoji: '⚔️',
    desc: '3D 3:3 / 5:5 전장! 타워를 부수고 넥서스를 터뜨려요',
    minPlayers: 1,
    maxPlayers: 10,
    onlineOnly: true, // 기기마다 조이스틱이 필요 → 온라인 방 전용
    ready: true,
  },
]

// 참가 인원으로 게임 선택 가능 여부 판단. 가능하면 null, 불가면 사유 문자열.
export function blockedReason(game, playerCount, online = false) {
  if (!game.ready) return '준비 중'
  if (game.onlineOnly && !online) return '온라인 방 전용'
  if (playerCount < game.minPlayers) return `${game.minPlayers}명 이상 필요`
  if (game.maxPlayers && playerCount > game.maxPlayers) return `최대 ${game.maxPlayers}명`
  return null
}
