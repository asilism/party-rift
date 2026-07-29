// 보스전 시뮬(보스 지정) — 신규 기믹(발구르기/STACK) 후 봇 5인 클리어율 확인
// 사용: node boss-sim2.mjs <판수> <보스cls> [엔진URL]
const engineUrl = process.argv[4] || '../src/games/rift/engine.js'
const { createGame, step, CLASS_IDS } = await import(engineUrl)
const lcg = (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)

function runOne(seed, bossCls, tier) {
  const rng = lcg(seed)
  const clses = [...CLASS_IDS].sort(() => rng() - 0.5).slice(0, 5)
  const players = clses.map((c, i) => ({ id: `b${i}`, name: `봇${i}`, zodiacId: 'rat', color: '#abc', team: 'blue', cls: c, isBot: true }))
  players.push({ id: 'boss', name: '보스', zodiacId: bossCls, color: '#f55', team: 'red', cls: bossCls, isBot: true })
  const st = createGame(players, { mode: 'boss', rng, bossTier: tier })
  const dt = 1 / 30
  let stacks = 0
  let prevStack = false
  const seenFeed = new Set()
  let solo = 0
  let beamKills = 0
  const beamSeen = new Set()
  const shares = []
  // 녹스 계측: 추격 처형 / 떨쳐냄(그로기 보상) / 돌진 시전 / 연쇄(돌진 사망)
  let huntExec = 0
  let huntShake = 0
  let dashes = 0
  let dashChain = 0
  while (st.status !== 'finished' && st.time < 22 * 60) {
    step(st, dt)
    const anyStack = st.heroes.some((h) => h.stackT > 0)
    if (anyStack && !prevStack) stacks++
    prevStack = anyStack
    for (const f of st.feed || []) {
      if (seenFeed.has(f.seq)) continue
      seenFeed.add(f.seq)
      const msg = f.msg || ''
      const m = /🌠 (\d+)명이 성좌/.exec(msg)
      if (m) shares.push(Number(m[1]))
      else if (msg.includes('홀로 받아냈다')) { solo++; shares.push(1) }
      else if (msg.includes('소환석 전파괴')) shares.push(0) // 의식 저지 성공
      else if (msg.includes('명이 마력에 소멸')) solo += Number(/(\d+)명이 마력에/.exec(msg)?.[1] || 0) // 처형 수
      else if (msg.includes('그림자에 잡혔다')) huntExec++
      else if (msg.includes('그림자를 떨쳐냈다')) huntShake++
      else if (msg.includes('어둠이 요동친다')) dashes++
      else if (msg.includes('다시 덮친다')) dashChain++
      else if (msg.includes('발밑에서 싹텄다')) huntExec++ // 브램블: 씨앗 발아(자리 잡은 심장 수)
      else if (msg.includes('심장이 부서졌다')) huntShake++ // 브램블: 심장 철거
      else if (msg.includes('만개 — 가시밭이 일제히')) dashChain++ // 브램블: 만개 명중
      else if (msg.includes('꽃봉오리를 연다')) dashes++ // 브램블: 만개 시전
    }
    for (const hh of st.heroes) {
      if (hh.team === 'blue' && hh.beamDeathAt != null && !beamSeen.has(hh.id + ':' + hh.beamDeathAt)) {
        beamSeen.add(hh.id + ':' + hh.beamDeathAt)
        beamKills++
      }
    }
    if (!st.heroes.some((h) => h.isBoss)) break
  }
  const deaths = st.heroes.filter((h) => h.team === 'blue').reduce((a, h) => a + h.deaths, 0)
  return { win: st.winner === 'blue', time: Math.round(st.time), stacks, solo, deaths, beamKills, huntExec, huntShake, dashes, dashChain, avgShare: shares.length ? (shares.reduce((a, b) => a + b, 0) / shares.length).toFixed(1) : '-' }
}

const n = Number(process.argv[2] || 16)
const bossCls = process.argv[3] || 'boss_archmage'
const tier = process.argv[5] || 'normal'
let wins = 0
let stacksTotal = 0
let soloTotal = 0
let deathsTotal = 0
let hx = 0, hs = 0, dc = 0, dch = 0
for (let i = 0; i < n; i++) {
  const r = runOne(4200 + i * 97, bossCls, tier)
  wins += r.win ? 1 : 0
  stacksTotal += r.stacks
  soloTotal += r.solo
  deathsTotal += r.deaths
  hx += r.huntExec; hs += r.huntShake; dc += r.dashes; dch += r.dashChain
  console.log(`#${i}: ${r.win ? '승' : '패'} ${Math.floor(r.time / 60)}:${String(r.time % 60).padStart(2, '0')} | 처형 ${r.solo} · 광선사 ${r.beamKills} | 그림자처형 ${r.huntExec} · 떨쳐냄 ${r.huntShake} · 돌진 ${r.dashes}(연쇄 ${r.dashChain}) | 팀데스 ${r.deaths}`)
}
console.log(`>> [${bossCls}/${tier}] 클리어율 ${wins}/${n} (${Math.round((wins / n) * 100)}%) | 판당 낙인 ${(stacksTotal / n).toFixed(1)} · 홀로 ${(soloTotal / n).toFixed(1)} · 팀데스 ${(deathsTotal / n).toFixed(1)}`)
console.log(`>> 녹스 판당: 그림자처형 ${(hx / n).toFixed(1)} · 떨쳐냄 ${(hs / n).toFixed(1)} · 돌진 ${(dc / n).toFixed(1)} · 연쇄 ${(dch / n).toFixed(1)}`)
