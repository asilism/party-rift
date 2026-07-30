// 대난투 시뮬 — 8봇 FFA 완주 검증: 판 길이·순위 완성·직업별 우승 분포.
// 사용: node tools/brawl-sim.mjs <판수>
import { createGame, step, CLASS_IDS } from '../src/games/rift/engine.js'

const lcg = (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
const ZS = ['rat', 'ox', 'tiger', 'rabbit', 'dragon', 'snake', 'horse', 'goat']

function runOne(seed) {
  const rng = lcg(seed)
  const cls = [...CLASS_IDS].sort(() => rng() - 0.5).slice(0, 8)
  const players = ZS.map((z, i) => ({
    id: `b${i}`, name: z, zodiacId: z, color: '#abc', team: `t${i}`, cls: cls[i], isBot: true,
  }))
  const st = createGame(players, { mode: 'brawl', rng })
  st.status = 'playing'
  const dt = 1 / 30
  let guard = 0
  while (st.status !== 'finished' && guard < 20 * 60 * 30) {
    step(st, dt)
    guard++
  }
  const winner = st.brawlRanks.find((r) => r.place === 1)
  const winCls = winner ? st.heroes.find((h) => h.id === winner.id)?.cls : null
  return { time: st.time, ranks: st.brawlRanks.length, finished: st.status === 'finished', winCls, ring: st.brawlR }
}

const n = Number(process.argv[2] || 8)
const times = []
const winners = {}
let fails = 0
for (let i = 0; i < n; i++) {
  const r = runOne(5500 + i * 173)
  if (!r.finished || r.ranks !== 8) fails++
  times.push(r.time)
  if (r.winCls) winners[r.winCls] = (winners[r.winCls] || 0) + 1
  console.log(`#${i}: ${(r.time / 60).toFixed(1)}분 · 순위 ${r.ranks}/8 · ${r.finished ? '완주' : '미종료!'} · 우승 ${r.winCls} · 링 ${r.ring.toFixed(0)}`)
}
times.sort((a, b) => a - b)
console.log(`>> [brawl] 판 길이 중앙 ${(times[Math.floor(n / 2)] / 60).toFixed(1)}분 · 미완주 ${fails}/${n} · 우승 분포 ${JSON.stringify(winners)}`)
