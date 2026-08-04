// 3v3 봇 대전 시뮬 — 특정 직업의 팀 승률 측정(신규 직업 밸런스 게이트).
// 사용: node tools/pvp-sim.mjs <직업id> [판수]   예) node tools/pvp-sim.mjs runescribe 200
//   직업id를 생략하면 전 직업을 한 바퀴 돌며 승률표를 뽑는다(느림).
// 판정: 대상 직업을 blue 1번 슬롯에 고정하고 나머지 5자리를 무작위로 채운 뒤 승패를 센다.
//   ⚠️ 단일 밴드(45~55%)로 판단하지 말 것 — 역할마다 기준선이 다르다(2026-08-04 실측, 40판 동일 시드):
//     딜러 마법사 55% · 한빙 57.5% / 브루저 혈기사 57.5% / 소환형 야수조련사 60%
//     서포터 힐러 32.5% ← 봇은 서포터 킷의 가치를 구조적으로 못 살린다
//   즉 "같은 역할의 기존 직업"과 비교해야 한다. 표본 40판이면 ±10%p는 노이즈.
import { createGame, step, CLASS_IDS, RELEASED_CLASSES } from '../src/games/rift/engine.js'

const lcg = (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
const ZS = ['rat', 'ox', 'tiger', 'rabbit', 'dragon', 'snake', 'horse', 'goat', 'monkey', 'rooster', 'dog', 'pig']
const POOL = RELEASED_CLASSES // 상대·아군 봇은 출시된 직업 중에서만 뽑는다(정상 환경 기준 측정)

function runOne(seed, testCls) {
  const rng = lcg(seed)
  const others = [...POOL].filter((c) => c !== testCls).sort(() => rng() - 0.5)
  const cls = [testCls, others[0], others[1], others[2], others[3], others[4]]
  const zs = [...ZS].sort(() => rng() - 0.5)
  const players = cls.map((c, i) => ({
    id: `b${i}`, name: zs[i], zodiacId: zs[i], color: '#abc',
    team: i < 3 ? 'blue' : 'red', cls: c, isBot: true,
  }))
  const st = createGame(players, { mode: '3v3', rng })
  st.status = 'playing'
  const dt = 1 / 30
  let guard = 0
  while (st.status !== 'finished' && guard < 25 * 60 * 30) { // 25분 가드
    step(st, dt)
    guard++
  }
  return { win: st.winner === 'blue', finished: st.status === 'finished', time: st.time }
}

function measure(testCls, n, seed0 = 4200) {
  let wins = 0
  let unfinished = 0
  const times = []
  for (let i = 0; i < n; i++) {
    const r = runOne(seed0 + i * 137, testCls)
    if (r.win) wins++
    if (!r.finished) unfinished++
    times.push(r.time)
  }
  times.sort((a, b) => a - b)
  return { wins, n, rate: (wins / n) * 100, unfinished, med: times[Math.floor(n / 2)] / 60 }
}

const arg = process.argv[2]
const n = Number(process.argv[3] || 100)
if (arg && CLASS_IDS.includes(arg)) {
  const r = measure(arg, n)
  console.log(`${arg}: ${r.wins}승/${r.n}판 = ${r.rate.toFixed(1)}% · 판 길이 중앙 ${r.med.toFixed(1)}분 · 미종료 ${r.unfinished}`)
  console.log(r.rate >= 45 && r.rate <= 55 ? '>> 밴드 통과(45~55%)' : '>> 밴드 이탈 — 조정 필요')
} else {
  for (const c of CLASS_IDS) {
    const r = measure(c, n)
    console.log(`${c}: ${r.rate.toFixed(1)}% (${r.wins}/${r.n})`)
  }
}
