// 소환사 밸런스 시뮬 — 3v3 봇: blue팀에 대상 직업 포함, 승률 측정
// 사용: node summon-sim.mjs <판수> <직업(beastmaster|engineer)> [모드=3v3]
import { createGame, step, makeBot, CLASS_IDS, TEAM_SIZES } from '../src/games/rift/engine.js'

const lcg = (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
const n = Number(process.argv[2] || 100)
const target = process.argv[3] || 'beastmaster'
const mode = process.argv[4] || '3v3'
const size = TEAM_SIZES[mode] || 3

function runOne(seed) {
  const rng = lcg(seed)
  const pool = CLASS_IDS.filter((c) => c !== target).sort(() => rng() - 0.5)
  const players = []
  players.push({ id: 'b0', name: '대상', zodiacId: 'rat', color: '#abc', team: 'blue', cls: target, isBot: true })
  for (let i = 1; i < size; i++) players.push({ id: `b${i}`, name: `블${i}`, zodiacId: 'ox', color: '#abc', team: 'blue', cls: pool[i - 1], isBot: true })
  for (let i = 0; i < size; i++) players.push({ id: `r${i}`, name: `레${i}`, zodiacId: 'pig', color: '#f55', team: 'red', cls: pool[size - 1 + i], isBot: true })
  const st = createGame(players, { mode, rng })
  const dt = 1 / 30
  // 소환물 계측: 생존시간 합/개체수 + 평균 최대체력
  let sumLife = 0
  let sumCount = 0
  let sumHp = 0
  const seen = new Map() // id → spawn time
  while (st.status !== 'finished' && st.time < 20 * 60) {
    step(st, dt)
    for (const s of st.summons || []) {
      if (!seen.has(s.id)) { seen.set(s.id, st.time); sumCount++; sumHp += s.maxHp }
    }
    for (const [id, t0] of [...seen]) {
      if (!(st.summons || []).some((s) => s.id === id)) { sumLife += st.time - t0; seen.delete(id) }
    }
  }
  return { win: st.winner === 'blue', time: st.time, avgLife: sumCount ? sumLife / sumCount : 0, avgHp: sumCount ? sumHp / sumCount : 0, count: sumCount }
}

let wins = 0
let life = 0
let hp = 0
let cnt = 0
for (let i = 0; i < n; i++) {
  const r = runOne(9100 + i * 131)
  wins += r.win ? 1 : 0
  life += r.avgLife
  hp += r.avgHp
  cnt += r.count
  if ((i + 1) % 10 === 0) console.log(`.. ${i + 1}/${n}판 (승 ${wins})`)
}
console.log(`>> [${target}/${mode}] 승률 ${wins}/${n} (${Math.round((wins / n) * 100)}%) | 소환물 평균 생존 ${(life / n).toFixed(1)}s · 평균 체력 ${(hp / n).toFixed(0)} · 판당 ${(cnt / n).toFixed(1)}마리`)
