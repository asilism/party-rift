import { loadMissionState, saveMissionState } from '../shared/storage.js'

// 일일 미션 — 매일(로컬 날짜) 풀에서 3개를 결정적으로 뽑는다(같은 날 = 같은 미션).
// 진행도는 경기 결과(onFinish view)에서 누적하고, 완료하면 코인으로 수령한다.
export const MISSION_POOL = [
  { id: 'play3', name: '3판 플레이', goal: 3, reward: 30, stat: 'games' },
  { id: 'win1', name: '1승 거두기', goal: 1, reward: 40, stat: 'wins' },
  { id: 'kill5', name: '적 영웅 5명 처치', goal: 5, reward: 30, stat: 'kills' },
  { id: 'assist3', name: '어시스트 3회', goal: 3, reward: 30, stat: 'assists' },
  { id: 'jungle8', name: '정글몹 8마리 사냥', goal: 8, reward: 40, stat: 'jungle' },
  { id: 'play5', name: '5판 플레이', goal: 5, reward: 50, stat: 'games' },
]

const today = () => new Date().toISOString().slice(0, 10)

// 날짜 문자열 → 간단 해시(결정적 미션 선택용)
function dayHash(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

// 오늘의 미션 상태를 불러온다 — 날짜가 바뀌었으면 새 3개로 리셋
export function getTodayMissions() {
  const date = today()
  let st = loadMissionState()
  if (!st || st.date !== date) {
    const h = dayHash(date)
    const picks = []
    // 결정적 셔플: 해시에서 서로 다른 인덱스 3개
    for (let i = 0; picks.length < 3 && i < 24; i++) {
      const idx = (h >>> (i * 3)) % MISSION_POOL.length // 부호 없는 시프트 — 음수 인덱스 방지
      if (!picks.includes(idx)) picks.push(idx)
    }
    for (let i = 0; picks.length < 3; i++) if (!picks.includes(i)) picks.push(i) // 안전망
    st = { date, ids: picks.map((i) => MISSION_POOL[i].id), progress: {}, claimed: [] }
    saveMissionState(st)
  }
  return st
}

// 경기 결과를 미션 진행도에 누적 — { win, kills, assists, jungle }
export function recordMissionProgress({ win, kills, assists, jungle }) {
  const st = getTodayMissions()
  const p = st.progress
  p.games = (p.games || 0) + 1
  p.wins = (p.wins || 0) + (win ? 1 : 0)
  p.kills = (p.kills || 0) + (kills || 0)
  p.assists = (p.assists || 0) + (assists || 0)
  p.jungle = (p.jungle || 0) + (jungle || 0)
  saveMissionState(st)
  return st
}

// 화면 표시용: 오늘 미션 3개를 진행도·완료·수령 상태와 함께
export function missionRows() {
  const st = getTodayMissions()
  return st.ids.map((id) => {
    const def = MISSION_POOL.find((m) => m.id === id)
    const cur = Math.min(def.goal, st.progress[def.stat] || 0)
    return {
      ...def,
      cur,
      done: cur >= def.goal,
      claimed: st.claimed.includes(id),
    }
  })
}

// 완료한 미션 보상 수령 — 성공 시 보상 코인 수를 반환(중복/미완료는 0)
export function claimMission(id) {
  const st = getTodayMissions()
  const def = MISSION_POOL.find((m) => m.id === id)
  if (!def || st.claimed.includes(id)) return 0
  const cur = st.progress[def.stat] || 0
  if (cur < def.goal) return 0
  st.claimed.push(id)
  saveMissionState(st)
  return def.reward
}
