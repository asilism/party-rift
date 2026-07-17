import { t } from '../shared/i18n.js'
import { CLASS_IDS, BOSS_IDS, CLASSES, TEAM_SIZE, TEAM_SIZES } from '../games/rift/engine.js'
import { ZODIAC, getZodiac } from '../shared/zodiac.js'
import { loadEquippedTitle } from '../shared/storage.js'

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
// 보스전 보스 이름 — 타입별 고유 네임드
const BOSS_NAMES = { boss_colossus: '카르곤', boss_archmage: '아르케인', boss_shadow: '녹스' }

export function buildSoloRoster({ zodiacId, cls, mode }) {
  const size = TEAM_SIZES[mode] || TEAM_SIZE
  const me = getZodiac(zodiacId)
  const freeZ = shuffle(ZODIAC.filter((z) => z.id !== zodiacId))
  const takenCls = new Set([cls]) // 매치 전체 공용 — 팀별이 아니다
  const roster = [
    // title: 장착 칭호 — 여기서 현지화해 두면 씬(이름표)은 그대로 그리기만 한다
    { id: 'solo', name: t(me?.name) || t('나'), zodiacId, color: me?.color, team: 'blue', cls, deviceId: 'solo', title: t(loadEquippedTitle()) || null },
  ]
  if (mode === 'boss') {
    // 보스전: 아군 봇 4 + 무작위 타입의 보스 1 (zodiacId=클래스 id → 얼굴/피드 아이콘이 보스 아이콘)
    for (let i = 1; i < size; i++) {
      const botCls = shuffle(CLASS_IDS.filter((c) => !takenCls.has(c)))[0]
      const z = freeZ.shift()
      if (!botCls || !z) break
      takenCls.add(botCls)
      roster.push({ id: `bot-${z.id}`, name: `${t(z.name)}${t('봇')}`, zodiacId: z.id, color: z.color, team: 'blue', cls: botCls, isBot: true })
    }
    const bossCls = BOSS_IDS[Math.floor(Math.random() * BOSS_IDS.length)]
    roster.push({
      id: 'boss', name: t(BOSS_NAMES[bossCls]) || t(CLASSES[bossCls].name),
      zodiacId: bossCls, color: '#ff5555', team: 'red', cls: bossCls, isBot: true,
    })
    return roster
  }
  if (mode === 'defense') {
    // 무한 방어: 아군 5인뿐 — 레드는 영웅 없이 엔진이 소환하는 파도(병사·그림자 정예)가 전부
    for (let i = 1; i < size; i++) {
      const botCls = shuffle(CLASS_IDS.filter((c) => !takenCls.has(c)))[0]
      const z = freeZ.shift()
      if (!botCls || !z) break
      takenCls.add(botCls)
      roster.push({ id: `bot-${z.id}`, name: `${t(z.name)}${t('봇')}`, zodiacId: z.id, color: z.color, team: 'blue', cls: botCls, isBot: true })
    }
    return roster
  }
  for (const team of ['blue', 'red']) {
    for (let i = team === 'blue' ? 1 : 0; i < size; i++) {
      const botCls = shuffle(CLASS_IDS.filter((c) => !takenCls.has(c)))[0]
      if (!botCls) break
      takenCls.add(botCls)
      const z = freeZ.shift()
      if (!z) break
      roster.push({ id: `bot-${z.id}`, name: `${t(z.name)}${t('봇')}`, zodiacId: z.id, color: z.color, team, cls: botCls, isBot: true })
    }
  }
  return roster
}
