import { CLASS_IDS, TEAM_SIZE, TEAM_SIZES } from '../games/rift/engine.js'
import { ZODIAC, getZodiac } from '../shared/zodiac.js'

const shuffle = (arr) => {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// 온라인 드래프트가 만드는 것과 같은 완성 로스터 — 봇은 매판 랜덤 조디악·직업.
// 온라인과 같은 규칙으로 "매치 전체에서 같은 직업은 한 명뿐" — 내가 고른 직업을
// 적팀 봇이 들고나오는 거울 매치가 생기지 않는다.
export function buildSoloRoster({ zodiacId, cls, mode }) {
  const size = TEAM_SIZES[mode] || TEAM_SIZE
  const me = getZodiac(zodiacId)
  const freeZ = shuffle(ZODIAC.filter((z) => z.id !== zodiacId))
  const takenCls = new Set([cls]) // 매치 전체 공용 — 팀별이 아니다
  const roster = [
    { id: 'solo', name: me?.name || '나', zodiacId, color: me?.color, team: 'blue', cls, deviceId: 'solo' },
  ]
  for (const team of ['blue', 'red']) {
    for (let i = team === 'blue' ? 1 : 0; i < size; i++) {
      const botCls = shuffle(CLASS_IDS.filter((c) => !takenCls.has(c)))[0]
      if (!botCls) break
      takenCls.add(botCls)
      const z = freeZ.shift()
      if (!z) break
      roster.push({ id: `bot-${z.id}`, name: `${z.name}봇`, zodiacId: z.id, color: z.color, team, cls: botCls, isBot: true })
    }
  }
  return roster
}
