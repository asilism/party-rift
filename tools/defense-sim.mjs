// 무한방어 시뮬 — 봇 5인이 파도를 버티다 수호석이 깨질 때까지, 도달 파도 분포.
//  증강은 봇이 자동 선택(botPickAugment)하므로 별도 입력 없이 진행된다.
// 사용: node tools/defense-sim.mjs <판수>
import { createGame, step, CLASS_IDS } from '../src/games/rift/engine.js'

const lcg = (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)

function runOne(seed) {
  const rng = lcg(seed)
  const cls = [...CLASS_IDS].sort(() => rng() - 0.5).slice(0, 5)
  const zod = ['rat', 'ox', 'tiger', 'rabbit', 'dragon']
  const players = cls.map((c, i) => ({ id: `b${i}`, name: `봇${i}`, zodiacId: zod[i], color: '#abc', team: 'blue', cls: c, isBot: true }))
  const st = createGame(players, { mode: 'defense', rng })
  const dt = 1 / 30
  let guard = 0
  while (st.status !== 'finished' && st.time < 45 * 60 && guard < 45 * 60 * 30) {
    step(st, dt)
    guard++
  }
  return { wave: st.wave || 0 }
}

const n = Number(process.argv[2] || 8)
const waves = []
for (let i = 0; i < n; i++) {
  const r = runOne(7000 + i * 137)
  waves.push(r.wave)
  console.log(`#${i}: ${r.wave}파도`)
}
waves.sort((a, b) => a - b)
const median = waves[Math.floor(n / 2)]
const boss2 = waves.filter((w) => w >= 30).length // 보스 2마리 구간(30·40웨) 도달
console.log(`>> [defense] 도달 파도 중앙값 ${median} · 평균 ${(waves.reduce((a, b) => a + b, 0) / n).toFixed(1)} · 30웨+ 도달 ${boss2}/${n}`)
