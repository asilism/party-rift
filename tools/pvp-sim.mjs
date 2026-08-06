// 봇 대전 시뮬 — 특정 직업의 팀 승률 측정(신규 직업 밸런스 게이트). 3v3 / 5v5 모두 지원.
// 사용: node tools/pvp-sim.mjs <직업id> [판수] [모드]   예) node tools/pvp-sim.mjs runescribe 40 5v5
//   직업id를 생략하면 전 직업을 한 바퀴 돌며 승률표를 뽑는다(느림).
// 판정: 대상 직업을 blue 1번 슬롯에 고정하고 나머지 5자리를 무작위로 채운 뒤 승패를 센다.
//   ⚠️ 단일 밴드(45~55%)로 판단하지 말 것 — 역할마다 기준선이 다르다(2026-08-04 실측, 40판 동일 시드):
//     딜러 마법사 55% · 한빙 57.5% / 브루저 혈기사 57.5% / 소환형 야수조련사 60%
//     서포터 힐러 32.5% ← 봇은 서포터 킷의 가치를 구조적으로 못 살린다
//   즉 "같은 역할의 기존 직업"과 비교해야 한다. 표본 40판이면 ±10%p는 노이즈.
import { createGame, step, CLASS_IDS, RELEASED_CLASSES, TEAM_SIZES } from '../src/games/rift/engine.js'

const lcg = (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
const ZS = ['rat', 'ox', 'tiger', 'rabbit', 'dragon', 'snake', 'horse', 'goat', 'monkey', 'rooster', 'dog', 'pig']
const POOL = RELEASED_CLASSES // 상대·아군 봇은 출시된 직업 중에서만 뽑는다(정상 환경 기준 측정)

function runOne(seed, testCls, mode) {
  const rng = lcg(seed)
  const n = TEAM_SIZES[mode] // 팀당 인원(3v3=3, 5v5=5)
  const others = [...POOL].filter((c) => c !== testCls).sort(() => rng() - 0.5)
  const cls = [testCls, ...others.slice(0, n * 2 - 1)] // 테스트 직업을 blue 1번 슬롯에 고정
  const zs = [...ZS].sort(() => rng() - 0.5)
  const players = cls.map((c, i) => ({
    id: `b${i}`, name: zs[i % ZS.length], zodiacId: zs[i % ZS.length], color: '#abc',
    team: i < n ? 'blue' : 'red', cls: c, isBot: true,
  }))
  const st = createGame(players, { mode, rng })
  st.status = 'playing'
  const dt = 1 / 30
  let guard = 0
  while (st.status !== 'finished' && guard < 25 * 60 * 30) { // 25분 가드
    step(st, dt)
    guard++
  }
  return { win: st.winner === 'blue', finished: st.status === 'finished', time: st.time }
}

function measure(testCls, n, mode = '3v3', seed0 = 4200) {
  let wins = 0
  let unfinished = 0
  const times = []
  for (let i = 0; i < n; i++) {
    const r = runOne(seed0 + i * 137, testCls, mode)
    if (r.win) wins++
    if (!r.finished) unfinished++
    times.push(r.time)
  }
  times.sort((a, b) => a - b)
  return { wins, n, rate: (wins / n) * 100, unfinished, med: times[Math.floor(n / 2)] / 60 }
}

const arg = process.argv[2]
const n = Number(process.argv[3] || 100)
const mode = TEAM_SIZES[process.argv[4]] ? process.argv[4] : '3v3'
if (arg && CLASS_IDS.includes(arg)) {
  const r = measure(arg, n, mode)
  console.log(`[${mode}] ${arg}: ${r.wins}승/${r.n}판 = ${r.rate.toFixed(1)}% · 판 길이 중앙 ${r.med.toFixed(1)}분 · 미종료 ${r.unfinished}`)
} else {
  for (const c of CLASS_IDS) {
    const r = measure(c, n, mode)
    console.log(`[${mode}] ${c}: ${r.rate.toFixed(1)}% (${r.wins}/${r.n})`)
  }
}
