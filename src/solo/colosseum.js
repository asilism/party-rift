import { CLASS_IDS } from '../games/rift/engine.js'
import { ZODIAC } from '../shared/zodiac.js'
import { t } from '../shared/i18n.js'

// ── 콜로세움 토너먼트 — 12지신 12인, 2v2 6팀, 포인트 서바이벌 ──
//  시작 10포인트, 패배 시 라운드별 차감(3, 5, 7…), 0이 되면 탈락.
//  2팀이 남으면 잔여 포인트와 무관하게 데스매치 결승. 홀수면 최소 부전 팀이 휴식.
//  유저 경기만 실제 시뮬 — 봇팀끼리는 즉시 판정(50/50 랜덤).

export const ARENA_START_PTS = 10
// 차감 2, 4, 6, 8… — 3 시작은 중앙값 5라운드로 "생각보다 빨리 끝나" 2로 하향(중앙값 6라운드)
export const arenaDeduction = (round) => 2 + (round - 1) * 2
export const ARENA_PLACE_COIN = { 1: 80, 2: 50, 3: 35, 4: 25, 5: 15, 6: 10 }

const shuffle = (arr, rng = Math.random) => {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// 토너먼트 생성 — 유저(수호 지신·직업 선택) + 11봇, 지신·직업 모두 중복 없음
export function createTournament(userZodiacId, userCls, rng = Math.random) {
  const zs = shuffle(ZODIAC.filter((z) => z.id !== userZodiacId), rng)
  const clses = shuffle(CLASS_IDS.filter((c) => c !== userCls), rng)
  const member = (id, z, cls, isBot) => ({ id, zodiacId: z.id, cls, name: `${t(z.name)}${isBot ? t('봇') : ''}`, emoji: z.emoji, isBot })
  const teams = []
  for (let i = 0; i < 6; i++) {
    const members = i === 0
      ? [
        { id: 'solo', zodiacId: userZodiacId, cls: userCls, name: t(ZODIAC.find((z) => z.id === userZodiacId)?.name) || t('나'), emoji: ZODIAC.find((z) => z.id === userZodiacId)?.emoji, isBot: false },
        member('ally', zs.shift(), clses.shift(), true),
      ]
      : [member(`t${i}a`, zs.shift(), clses.shift(), true), member(`t${i}b`, zs.shift(), clses.shift(), true)]
    teams.push({ idx: i, isUser: i === 0, members, pts: ARENA_START_PTS, byes: 0, alive: true, elimRound: null })
  }
  return { teams, round: 0, over: false, champion: null, lastResults: null }
}

const aliveTeams = (tour) => tour.teams.filter((tm) => tm.alive)

// 다음 라운드 대진 — 스위스식 무작위(생존 팀), 홀수면 최소 부전 팀 휴식.
//  2팀이면 데스매치 결승. 반환: { round, deduction, pairs, bye, myPair, isFinal }
export const ARENA_LAYOUT_META = {
  pit: { icon: '🗿', name: '기둥의 숲', hint: '근접 유리 — 시야가 끊기고 부쉬가 많다' },
  field: { icon: '🏹', name: '모래벌판', hint: '원거리 유리 — 숨을 곳이 없다' },
  canyon: { icon: '🌀', name: '술사의 협로', hint: '마법 유리 — 좁은 통로로 싸움이 몰린다' },
}

export function nextRound(tour, rng = Math.random) {
  tour.round++
  const pairKey = (a, b) => [a.idx, b.idx].sort((x, y) => x - y).join('-')
  // 직전 라운드와 동일한 매치가 반복되지 않게 셔플을 재시도한다(최대 40회).
  //  4팀+ 생존이면 수학적으로 항상 무반복 페어링이 존재. 2팀(결승)은 어차피 강제 재대결.
  const prev = tour.prevPairs || new Set()
  let best = null
  for (let attempt = 0; attempt < 40; attempt++) {
    const alive = shuffle(aliveTeams(tour), rng)
    let bye = null
    if (alive.length % 2 === 1) {
      // 최소 부전 팀이 쉰다(동률이면 셔플 순서상 첫 팀)
      bye = alive.reduce((a, b) => (b.byes < a.byes ? b : a))
      alive.splice(alive.indexOf(bye), 1)
    }
    const pairs = []
    for (let i = 0; i + 1 < alive.length; i += 2) pairs.push([alive[i], alive[i + 1]])
    const repeats = pairs.filter((p) => prev.has(pairKey(p[0], p[1]))).length
    if (!best || repeats < best.repeats) best = { pairs, bye, repeats }
    if (repeats === 0) break
  }
  const { pairs, bye } = best
  if (bye) bye.byes++
  const isFinal = aliveTeams(tour).length === 2
  const myPair = pairs.find((p) => p[0].isUser || p[1].isUser) || null
  const layouts = Object.keys(ARENA_LAYOUT_META)
  const layout = layouts[Math.floor(rng() * layouts.length)] // 이번 라운드의 경기장 내부 구조
  tour.prevPairs = new Set(pairs.map((p) => pairKey(p[0], p[1])))
  tour.current = { round: tour.round, deduction: arenaDeduction(tour.round), pairs, bye, myPair, isFinal, layout }
  return tour.current
}

// 라운드 판정 — 유저 경기 결과(userWon)는 시뮬에서, 봇전은 50/50.
//  반환: { results: [{a, b, winner}], eliminated: [team], over, champion, myResult }
export function resolveRound(tour, userWon, rng = Math.random) {
  const { pairs, deduction, isFinal, bye } = tour.current
  const results = []
  const eliminated = []
  for (const [a, b] of pairs) {
    const isMine = a.isUser || b.isUser
    const winner = isMine
      ? (a.isUser === userWon ? a : b)
      : (rng() < 0.5 ? a : b)
    const loser = winner === a ? b : a
    loser.pts = Math.max(0, loser.pts - deduction)
    // 결승 데스매치: 잔여 포인트와 무관하게 패자 탈락
    if (isFinal || loser.pts <= 0) {
      loser.alive = false
      loser.elimRound = tour.round
      eliminated.push(loser)
    }
    results.push({ a, b, winner, loser, isMine })
  }
  const alive = aliveTeams(tour)
  if (alive.length === 1) {
    tour.over = true
    tour.champion = alive[0]
  }
  tour.lastResults = { round: tour.round, deduction, results, eliminated, bye }
  return { ...tour.lastResults, over: tour.over, champion: tour.champion }
}

// 유저 팀 순위 — 탈락 시점에 살아 있던 팀 수 + 1, 우승이면 1
export function userPlacement(tour) {
  const me = tour.teams.find((tm) => tm.isUser)
  if (me.alive && tour.over) return 1
  if (me.alive) return null // 진행 중
  // 나보다 늦게 탈락했거나 생존 중인 팀 수 + 1
  const better = tour.teams.filter((tm) => !tm.isUser && (tm.alive || tm.elimRound > me.elimRound)).length
  return better + 1
}

// 유저 라운드 레벨 — 5에서 시작해 라운드마다 +3 (상한은 엔진 MAX_LEVEL이 지킨다)
export const arenaLevelFor = (round) => 5 + (round - 1) * 3
