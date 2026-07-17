import { loadAchState, saveAchState, addCoins, loadRiftRecords, loadOwnedHats, loadOwnedCostumes, loadOwnedWeapons, loadArenaRecords } from '../shared/storage.js'
import { unlockedCount } from './unlocks.js'

// 업적 — 누적 카운터(경기 종료마다 갱신) 기준으로 판정하고, 달성 즉시 코인을 지급한다.
//  미션과 달리 평생 1회. 시리즈(Ⅰ/Ⅱ/Ⅲ)로 "다음 목표가 항상 보이는 상태"를 유지한다.
//  cnt 키가 없는 것(직업/꾸미기 수집)은 판정 시점에 저장소에서 직접 센다(라이브 게터).
//  title이 있는 업적은 달성 시 칭호도 함께 얻는다(장착은 프로필 화면).

// 판정 재료 카운터 (achState.cnt)
//  games, wins, wins3v3, wins5v5, kills, assists, jungle, soldiers, dragons, barons,
//  bestStreak(최대), maxKillsGame(최대), bossClears, bossHard, bossNightmare,
//  bossFast(5분 내 토벌 수), bossNoDeath(노데스 토벌 수), defenseBestWave(최대 — ⑧에서 사용)

export const ACHIEVEMENTS = [
  // ── 전투 ──
  { id: 'kills_1', icon: '⚔️', name: '첫 사냥', desc: '적 영웅을 처음으로 처치', get: (c) => c.kills || 0, target: 1, reward: 50 },
  { id: 'kills_50', icon: '⚔️', name: '사냥꾼 Ⅰ', desc: '누적 50킬', get: (c) => c.kills || 0, target: 50, reward: 80 },
  { id: 'kills_300', icon: '⚔️', name: '사냥꾼 Ⅱ', desc: '누적 300킬', get: (c) => c.kills || 0, target: 300, reward: 150 },
  { id: 'kills_1000', icon: '⚔️', name: '사냥꾼 Ⅲ', desc: '누적 1000킬', get: (c) => c.kills || 0, target: 1000, reward: 300, title: '전장의 지배자' },
  { id: 'streak_3', icon: '🔥', name: '연속 처치', desc: '한 번도 안 죽고 3연속 킬', get: (c) => c.bestStreak || 0, target: 3, reward: 60 },
  { id: 'streak_5', icon: '🔥', name: '멈출 수 없어', desc: '한 번도 안 죽고 5연속 킬', get: (c) => c.bestStreak || 0, target: 5, reward: 120, title: '전장의 폭풍' },
  { id: 'game_kills_8', icon: '💥', name: '하드캐리', desc: '한 판에 8킬', get: (c) => c.maxKillsGame || 0, target: 8, reward: 100 },
  { id: 'assists_30', icon: '🤝', name: '함께 싸우는 법', desc: '누적 어시스트 30', get: (c) => c.assists || 0, target: 30, reward: 60 },
  { id: 'assists_150', icon: '🤝', name: '든든한 지원군', desc: '누적 어시스트 150', get: (c) => c.assists || 0, target: 150, reward: 120, title: '든든한 지원군' },

  // ── 승리 ──
  { id: 'win_1', icon: '🏆', name: '첫 승리', desc: '첫 승리를 거두다', get: (c) => c.wins || 0, target: 1, reward: 50 },
  { id: 'wins_10', icon: '🏆', name: '승리자 Ⅰ', desc: '누적 10승', get: (c) => c.wins || 0, target: 10, reward: 80 },
  { id: 'wins_50', icon: '🏆', name: '승리자 Ⅱ', desc: '누적 50승', get: (c) => c.wins || 0, target: 50, reward: 150, title: '역전의 용사' },
  { id: 'wins_150', icon: '🏆', name: '승리자 Ⅲ', desc: '누적 150승', get: (c) => c.wins || 0, target: 150, reward: 300 },
  { id: 'wins3v3_25', icon: '🗡️', name: '작은 전장의 왕', desc: '3대3 25승', get: (c) => c.wins3v3 || 0, target: 25, reward: 100 },
  { id: 'wins5v5_25', icon: '🐉', name: '큰 전장의 왕', desc: '5대5 25승', get: (c) => c.wins5v5 || 0, target: 25, reward: 100 },

  // ── 보스 ──
  { id: 'boss_first', icon: '👹', name: '토벌 개시', desc: '보스를 처음으로 토벌', get: (c) => c.bossClears || 0, target: 1, reward: 100 },
  { id: 'boss_10', icon: '👹', name: '토벌대장', desc: '보스 누적 10회 토벌', get: (c) => c.bossClears || 0, target: 10, reward: 150 },
  { id: 'boss_hard', icon: '💀', name: '더 어두운 곳으로', desc: '악몽 난이도 토벌', get: (c) => c.bossHard || 0, target: 1, reward: 120 },
  { id: 'boss_nightmare', icon: '🔥', name: '지옥 정복', desc: '지옥 난이도 토벌', get: (c) => c.bossNightmare || 0, target: 1, reward: 200, title: '지옥 정복자' },
  { id: 'boss_fast', icon: '⚡', name: '번개 토벌', desc: '5분 안에 보스 토벌', get: (c) => c.bossFast || 0, target: 1, reward: 150, title: '번개 사냥꾼' },
  { id: 'boss_nodeath', icon: '🛡️', name: '무결점 토벌', desc: '한 번도 안 죽고 보스 토벌', get: (c) => c.bossNoDeath || 0, target: 1, reward: 150, title: '불사신' },

  // ── 오브젝트·정글 ──
  { id: 'dragon_1', icon: '🐉', name: '용의 숨통', desc: '용 막타 1회', get: (c) => c.dragons || 0, target: 1, reward: 60 },
  { id: 'dragon_5', icon: '🐉', name: '용 사냥꾼', desc: '용 막타 5회', get: (c) => c.dragons || 0, target: 5, reward: 100, title: '용 사냥꾼' },
  { id: 'baron_3', icon: '👹', name: '이무기 사냥꾼', desc: '이무기 막타 3회', get: (c) => c.barons || 0, target: 3, reward: 100 },
  { id: 'jungle_100', icon: '🌲', name: '정글의 주인', desc: '정글몹 100마리', get: (c) => c.jungle || 0, target: 100, reward: 80 },
  { id: 'soldiers_500', icon: '🪖', name: '파도를 거슬러 Ⅰ', desc: '병사 500명 처치', get: (c) => c.soldiers || 0, target: 500, reward: 80 },
  { id: 'soldiers_2000', icon: '🪖', name: '파도를 거슬러 Ⅱ', desc: '병사 2000명 처치', get: (c) => c.soldiers || 0, target: 2000, reward: 150 },

  // ── 수집·여정 (라이브 게터 — 저장소에서 직접 센다) ──
  { id: 'classes_10', icon: '🎭', name: '넓어지는 선택지', desc: '직업 10종 열기', get: liveClassCount, target: 10, reward: 100 },
  { id: 'classes_20', icon: '🎭', name: '만능 지휘관', desc: '모든 직업 열기', get: liveClassCount, target: 20, reward: 250, title: '만능 지휘관' },
  { id: 'cosmetics_5', icon: '🎩', name: '멋 내기 시작', desc: '꾸미기 5종 보유', get: liveCosmeticCount, target: 5, reward: 80 },
  { id: 'cosmetics_15', icon: '🎩', name: '패셔니스타', desc: '꾸미기 15종 보유', get: liveCosmeticCount, target: 15, reward: 150, title: '패셔니스타' },
  { id: 'games_30', icon: '📅', name: '단골 손님', desc: '30판 출전', get: (c) => c.games || 0, target: 30, reward: 80 },
  { id: 'games_100', icon: '📅', name: '베테랑', desc: '100판 출전', get: (c) => c.games || 0, target: 100, reward: 150 },
  { id: 'games_300', icon: '📅', name: '조디악의 전설', desc: '300판 출전', get: (c) => c.games || 0, target: 300, reward: 300, title: '조디악의 전설' },

  // ── 콜로세움 (라이브 게터 — 토너먼트 완주 기록에서 직접 센다) ──
  { id: 'arena_first', icon: '🏟️', name: '검투사 데뷔', desc: '콜로세움 토너먼트 완주', get: () => loadArenaRecords().runs, target: 1, reward: 80 },
  { id: 'arena_final', icon: '🥈', name: '결승의 모래바람', desc: '콜로세움 2위 이내', get: () => (loadArenaRecords().best != null && loadArenaRecords().best <= 2 ? 1 : 0), target: 1, reward: 150 },
  { id: 'arena_champion', icon: '👑', name: '콜로세움 챔피언', desc: '콜로세움 우승', get: () => loadArenaRecords().wins, target: 1, reward: 250, title: '콜로세움 챔피언' },

  // ── 무한 방어 ──
  { id: 'defense_10', icon: '🌊', name: '방파제', desc: '한 판에 10번째 파도 도달', get: (c) => c.defenseBestWave || 0, target: 10, reward: 80 },
  { id: 'defense_20', icon: '🌊', name: '거센 물살을 넘어', desc: '한 판에 20번째 파도 도달', get: (c) => c.defenseBestWave || 0, target: 20, reward: 150 },
  { id: 'defense_30', icon: '🌊', name: '철벽 수호자', desc: '한 판에 30번째 파도 도달', get: (c) => c.defenseBestWave || 0, target: 30, reward: 250, title: '철벽 수호자' },
]

function liveClassCount() {
  const records = loadRiftRecords()
  const totalWins = Object.values(records).reduce((a, r) => a + r.wins, 0)
  return unlockedCount(totalWins)
}

function liveCosmeticCount() {
  return loadOwnedHats().length + loadOwnedCostumes().length + loadOwnedWeapons().length
}

// def의 현재 진행값 — 카운터형은 cnt에서, 라이브형은 저장소에서
function progressOf(def, cnt) {
  return def.get.length === 0 ? def.get() : def.get(cnt)
}

// 경기 결과를 누적하고 새로 달성한 업적을 돌려준다(보상 코인은 즉시 지급).
//  me: 내 영웅 최종 스냅샷, view: 종료 뷰, win: 승리 여부
export function recordMatchForAchievements({ view, me, win }) {
  const st = loadAchState()
  const c = st.cnt
  c.games = (c.games || 0) + 1
  if (win) {
    c.wins = (c.wins || 0) + 1
    if (view.mode === '3v3') c.wins3v3 = (c.wins3v3 || 0) + 1
    if (view.mode === '5v5') c.wins5v5 = (c.wins5v5 || 0) + 1
  }
  c.kills = (c.kills || 0) + (me.kills || 0)
  c.assists = (c.assists || 0) + (me.assists || 0)
  c.jungle = (c.jungle || 0) + (me.jungleKills || 0)
  c.soldiers = (c.soldiers || 0) + (me.soldierKills || 0)
  c.dragons = (c.dragons || 0) + (me.dragonKills || 0)
  c.barons = (c.barons || 0) + (me.baronKills || 0)
  c.bestStreak = Math.max(c.bestStreak || 0, me.bestStreak || 0)
  c.maxKillsGame = Math.max(c.maxKillsGame || 0, me.kills || 0)
  if (view.mode === 'defense') {
    c.defenseBestWave = Math.max(c.defenseBestWave || 0, view.wave || 0)
  }
  if (view.mode === 'boss' && win) {
    c.bossClears = (c.bossClears || 0) + 1
    const tier = view.bossTier || 'normal'
    if (tier === 'hard') c.bossHard = (c.bossHard || 0) + 1
    if (tier === 'nightmare') {
      c.bossHard = (c.bossHard || 0) + 1 // 악몽은 어려움 업적도 함께 충족(상위 티어 포함 원칙)
      c.bossNightmare = (c.bossNightmare || 0) + 1
    }
    if ((view.timePlayed || 1e9) < 300) c.bossFast = (c.bossFast || 0) + 1
    if ((me.deaths || 0) === 0) c.bossNoDeath = (c.bossNoDeath || 0) + 1
  }
  // 판정 — 새로 달성한 것만 보상
  const newly = []
  for (const def of ACHIEVEMENTS) {
    if (st.done[def.id]) continue
    if (progressOf(def, c) >= def.target) {
      st.done[def.id] = Date.now()
      addCoins(def.reward)
      newly.push(def)
    }
  }
  saveAchState(st)
  return newly
}

// 카운터 갱신 없이 판정만 — 경기 밖 이벤트(토너먼트 완주 등) 직후 라이브 게터 업적을 즉시 지급
export function evaluateAchievements() {
  const st = loadAchState()
  const newly = []
  for (const def of ACHIEVEMENTS) {
    if (st.done[def.id]) continue
    if (progressOf(def, st.cnt) >= def.target) {
      st.done[def.id] = Date.now()
      addCoins(def.reward)
      newly.push(def)
    }
  }
  if (newly.length) saveAchState(st)
  return newly
}

// 업적 화면용 — 정의 + 현재 진행/달성 여부
export function achievementRows() {
  const st = loadAchState()
  return ACHIEVEMENTS.map((def) => ({
    ...def,
    cur: Math.min(def.target, progressOf(def, st.cnt)),
    done: !!st.done[def.id],
    doneAt: st.done[def.id] || null,
  }))
}

// 달성으로 얻은 칭호 목록 (PR-D 칭호 장착에서 사용)
export function earnedTitles() {
  const st = loadAchState()
  return ACHIEVEMENTS.filter((d) => d.title && st.done[d.id]).map((d) => d.title)
}
