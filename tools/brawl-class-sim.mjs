// 난투전 직업별 승률 + 원인 진단 — 8인 FFA에서 한 자리를 고정 직업으로 채우고 나머지는 무작위.
//  균형점은 1/8 = 12.5%(평균 순위 4.5). 승률만 보면 '왜 센지'를 모르므로 세 축을 함께 잰다:
//   - 킬로 이기는가      → kills (판당 처치 수)
//   - 유지력으로 버티는가 → hp% (생존 중 평균 체력 비율) · deaths
//   - 소환물이 공짜 딜인가 → 소환물이 '맞아 죽은 비율'(낮으면 아무도 못 때린다는 뜻)
// 사용: node tools/brawl-class-sim.mjs <classId> [판수]
import { createGame, step, RELEASED_CLASSES } from '../src/games/rift/engine.js'

const lcg = (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
const ZS = ['rat', 'ox', 'tiger', 'rabbit', 'dragon', 'snake', 'horse', 'goat']

function runOne(seed, cls) {
  const rng = lcg(seed)
  const pool = RELEASED_CLASSES.filter((c) => c !== cls).sort(() => rng() - 0.5)
  const players = ZS.map((z, i) => ({
    id: `b${i}`, name: z, zodiacId: z, color: '#abc', team: `t${i}`, isBot: true,
    cls: i === 0 ? cls : pool[(i - 1) % pool.length],
  }))
  const st = createGame(players, { mode: 'brawl', rng })
  st.status = 'playing'
  const me = st.heroes[0]
  const dt = 1 / 30

  let hpSum = 0
  let hpN = 0
  let deaths = 0
  let wasDead = false
  let sumUptime = 0 // 내 소환물이 살아 있던 총 시간(기[基]·초)
  let sumKilled = 0 // 맞아 죽은 소환물 수
  let sumExpired = 0 // 수명이 다해 사라진 소환물 수
  let sumOwner = 0 // 주인이 쓰러져 함께 사라진 수(강령술사는 이 경로가 커서 따로 뺀다)
  const lastLife = new Map() // 소환물 id → 직전 프레임 남은 수명(사라진 이유를 가리려고)

  let guard = 0
  while (st.status !== 'finished' && guard < 20 * 60 * 30) {
    step(st, dt)
    guard++
    if (me.respawnT > 0 || me.hp <= 0) {
      if (!wasDead) { deaths++; wasDead = true }
    } else {
      wasDead = false
      hpSum += me.hp / me.maxHp
      hpN++
    }
    const seen = new Set()
    for (const s of st.summons) {
      if (s.owner !== me.id) continue
      seen.add(s.id)
      lastLife.set(s.id, s.life)
      sumUptime += dt
    }
    const ownerDown = me.respawnT > 0 || me.hp <= 0
    for (const [id, life] of lastLife) {
      if (seen.has(id)) continue
      if (life <= 0.2) sumExpired++ // 수명이 다했다
      else if (ownerDown) sumOwner++ // 주인이 쓰러져 함께 스러졌다 — 피격사가 아니다
      else sumKilled++ // 수명이 남았고 주인도 멀쩡한데 사라졌다 = 맞아 죽었다
      lastLife.delete(id)
    }
  }
  const rank = st.brawlRanks.find((r) => r.id === me.id)
  return {
    finished: st.status === 'finished',
    place: rank ? rank.place : 8,
    kills: me.kills || 0,
    deaths,
    hpFrac: hpN ? hpSum / hpN : 0,
    sumUptime,
    sumKilled,
    sumExpired,
    sumOwner,
    time: st.time,
  }
}

const cls = process.argv[2]
const n = Number(process.argv[3] || 24)
if (!cls || !RELEASED_CLASSES.includes(cls)) {
  console.error(`직업을 지정하세요: ${RELEASED_CLASSES.join(', ')}`)
  process.exit(1)
}
const acc = { win: 0, place: 0, kills: 0, deaths: 0, hp: 0, up: 0, k: 0, e: 0, o: 0, fail: 0 }
const times = []
for (let i = 0; i < n; i++) {
  const r = runOne(7700 + i * 211, cls)
  if (!r.finished) acc.fail++
  if (r.place === 1) acc.win++
  acc.place += r.place
  acc.kills += r.kills
  acc.deaths += r.deaths
  acc.hp += r.hpFrac
  acc.up += r.sumUptime
  acc.k += r.sumKilled
  acc.e += r.sumExpired
  acc.o += r.sumOwner
  times.push(r.time)
}
times.sort((a, b) => a - b)
const pct = (v) => `${(v * 100).toFixed(1)}%`
const gone = acc.k + acc.e + acc.o
console.log(`[brawl] ${cls}: 우승 ${acc.win}/${n} = ${pct(acc.win / n)} (균형점 12.5%) · 평균 순위 ${(acc.place / n).toFixed(2)}/8 (균형점 4.5)`)
console.log(`  판당 처치 ${(acc.kills / n).toFixed(2)} · 사망 ${(acc.deaths / n).toFixed(2)} · 생존 중 평균 체력 ${pct(acc.hp / n)}`)
if (gone) console.log(`  소환물 ${gone}기 최후: 피격사 ${pct(acc.k / gone)} · 수명만료 ${pct(acc.e / gone)} · 주인사망 ${pct(acc.o / gone)} (판당 유지 ${(acc.up / n).toFixed(1)}기·초)`)
console.log(`  판 길이 중앙 ${(times[Math.floor(n / 2)] / 60).toFixed(1)}분 · 미종료 ${acc.fail}/${n}`)
