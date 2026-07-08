// 밸런스 시뮬레이터 — 봇 게임을 헤드리스로 다수 돌려 직업별 승률/KDA를 집계한다.
//
//   node scripts/balance-sim.mjs [판수=200] [워커수=8] [모드=3v3] [시드=1000]
//
// 랜덤 조합(팀 내 중복 없음)의 봇 전 판을 워커 프로세스로 나눠 돌리고 표로 병합한다.
// 시드가 같으면 조합도 같아, 밸런스 패치 전후 승률을 같은 조건에서 비교할 수 있다.
// 판당 실시간 약 20초(게임 내 8~15분) — 200판/8워커면 30분쯤 걸린다.
import { fork } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createGame, makeBot, step, STEP, CLASS_IDS, TEAM_SIZES } from '../src/games/rift/engine.js'

const CAP_SEC = 60 * 25 // 판당 안전 상한(무승부 처리)

// 결정적 RNG — 시드만 같으면 조합/전개가 재현된다
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function sampleTeam(rng, n) {
  const pool = [...CLASS_IDS]
  return Array.from({ length: n }, () => pool.splice(Math.floor(rng() * pool.length), 1)[0])
}

function emptyAgg() {
  const agg = {}
  for (const c of CLASS_IDS) agg[c] = { games: 0, wins: 0, draws: 0, kills: 0, deaths: 0, assists: 0 }
  return agg
}

// ── 워커: 판을 돌리고 원시 카운트 JSON을 stdout으로 ──
function runWorker(games, seed0, mode) {
  const teamN = TEAM_SIZES[mode] || 3
  const agg = emptyAgg()
  let draws = 0
  let totalDur = 0
  for (let gi = 0; gi < games; gi++) {
    const rng = mulberry32((seed0 + gi) * 2654435761)
    const blue = sampleTeam(rng, teamN)
    const red = sampleTeam(rng, teamN)
    const players = [
      ...blue.map((cls, i) => ({ id: `b${i}`, name: `B${i}`, zodiacId: 'rat', color: '#48f', cls, team: 'blue' })),
      ...red.map((cls, i) => ({ id: `r${i}`, name: `R${i}`, zodiacId: 'ox', color: '#f44', cls, team: 'red' })),
    ]
    const g = createGame(players, { rng, mode })
    for (const h of g.heroes) makeBot(g, h.id)
    while (g.status !== 'finished' && g.time < CAP_SEC) step(g, STEP)
    const winner = g.status === 'finished' ? g.winner : null
    if (!winner) draws++
    totalDur += g.time
    for (const h of g.heroes) {
      const a = agg[h.cls]
      a.games++
      if (winner === h.team) a.wins++
      if (!winner) a.draws++
      a.kills += h.kills; a.deaths += h.deaths; a.assists += h.assists
    }
    process.send?.({ done: gi + 1 })
  }
  console.log(JSON.stringify({ games, draws, totalDur, agg }))
}

// ── 부모: 워커를 띄워 나눠 돌리고 병합 표 출력 ──
async function runParent(games, workers, mode, seed0) {
  const self = fileURLToPath(import.meta.url)
  const per = Math.ceil(games / workers)
  let launched = 0
  let finished = 0
  const jobs = []
  for (let w = 0; w < workers && launched < games; w++) {
    const n = Math.min(per, games - launched)
    const seed = seed0 + launched
    launched += n
    jobs.push(new Promise((resolve, reject) => {
      const child = fork(self, ['--worker', String(n), String(seed), mode], { stdio: ['ignore', 'pipe', 'inherit', 'ipc'] })
      let out = ''
      child.stdout.on('data', (d) => { out += d })
      child.on('message', () => {
        finished++
        process.stderr.write(`\r${finished}/${games}판 완료`)
      })
      child.on('exit', (code) => (code === 0 ? resolve(JSON.parse(out)) : reject(new Error(`worker exit ${code}`))))
    }))
  }
  const shards = await Promise.all(jobs)
  process.stderr.write('\n')

  const agg = emptyAgg()
  let total = 0, draws = 0, totalDur = 0
  for (const s of shards) {
    total += s.games; draws += s.draws; totalDur += s.totalDur
    for (const [c, a] of Object.entries(s.agg)) for (const k of Object.keys(a)) agg[c][k] += a[k]
  }
  const rows = CLASS_IDS.map((cls) => {
    const a = agg[cls]
    const decided = a.games - a.draws
    return {
      cls, n: a.games,
      winrate: decided ? +(100 * a.wins / decided).toFixed(1) : null,
      kda: +((a.kills + a.assists) / Math.max(1, a.deaths)).toFixed(2),
      k: +(a.kills / Math.max(1, a.games)).toFixed(1),
      d: +(a.deaths / Math.max(1, a.games)).toFixed(1),
      a: +(a.assists / Math.max(1, a.games)).toFixed(1),
    }
  }).sort((x, y) => (y.winrate ?? -1) - (x.winrate ?? -1))
  console.log(`games=${total} draws=${draws} avgDur=${(totalDur / Math.max(1, total)).toFixed(0)}s mode=${mode} seed=${seed0}`)
  console.table(rows)
}

if (process.argv[2] === '--worker') {
  runWorker(Number(process.argv[3]), Number(process.argv[4]), process.argv[5] || '3v3')
} else {
  const [games = 200, workers = 8, mode = '3v3', seed = 1000] = [
    Number(process.argv[2]) || 200, Number(process.argv[3]) || 8, process.argv[4] || '3v3', Number(process.argv[5]) || 1000,
  ]
  runParent(games, workers, mode, seed)
}
