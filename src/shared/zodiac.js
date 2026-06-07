// 12지신 캐릭터 데이터.
// MVP에서는 이모지로 표현하고, 추후 image 필드(PNG/SVG)로 교체할 수 있게 구조만 둔다.
export const ZODIAC = [
  { id: 'rat', name: '쥐', emoji: '🐭', color: '#9aa7b8' },
  { id: 'ox', name: '소', emoji: '🐮', color: '#caa472' },
  { id: 'tiger', name: '호랑이', emoji: '🐯', color: '#e8a33d' },
  { id: 'rabbit', name: '토끼', emoji: '🐰', color: '#e6c9d6' },
  { id: 'dragon', name: '용', emoji: '🐲', color: '#5fb96a' },
  { id: 'snake', name: '뱀', emoji: '🐍', color: '#7bc47f' },
  { id: 'horse', name: '말', emoji: '🐴', color: '#b07a4f' },
  { id: 'goat', name: '양', emoji: '🐑', color: '#dcd6cc' },
  { id: 'monkey', name: '원숭이', emoji: '🐵', color: '#c79a6b' },
  { id: 'rooster', name: '닭', emoji: '🐔', color: '#e05b5b' },
  { id: 'dog', name: '개', emoji: '🐶', color: '#cda06a' },
  { id: 'pig', name: '돼지', emoji: '🐷', color: '#f0b6c4' },
]

export const getZodiac = (id) => ZODIAC.find((z) => z.id === id)
