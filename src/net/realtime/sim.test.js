import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RealtimeSim } from './sim.js'

// 가짜 어댑터: x를 vx만큼 매 틱 움직이는 1차원 세계
const fake = {
  STEP: 1 / 60,
  createGame: (players) => ({ ents: players.map((p) => ({ id: p.id, x: 0, vx: 0 })) }),
  setInput: (s, id, { vx = 0 }) => { const e = s.ents.find((e) => e.id === id); if (e) e.vx = vx },
  step: (s, dt) => { for (const e of s.ents) e.x += e.vx * dt },
  makeView: (s) => ({ ents: s.ents.map((e) => ({ id: e.id, x: e.x })) }),
}

test('advance가 고정 STEP으로 누적 진행한다(나머지 시간 이월)', () => {
  const sim = new RealtimeSim(fake, fake.createGame([{ id: 'a' }]))
  sim.setInput('a', { vx: 60 }) // 60유닛/초
  // 1초를 50ms씩 20번 쪼개도 나머지가 이월되어 총 60틱·x≈60에 수렴
  let total = 0
  for (let i = 0; i < 20; i++) total += sim.advance(50)
  // 부동소수 경계라 59~60틱(나머지는 다음 호출로 이월). x는 진행한 틱만큼 정확.
  assert.ok(total === 59 || total === 60, `ticks=${total}`)
  assert.ok(Math.abs(sim.view().ents[0].x - total * fake.STEP * 60) < 1e-6)
})

test('큰 dt는 잘라서 폭주를 막는다', () => {
  const sim = new RealtimeSim(fake, fake.createGame([{ id: 'a' }]))
  const ticks = sim.advance(100000)
  assert.ok(ticks <= 21)
})

// ④ 핵심 전제: 실제 카트 엔진이 브라우저 없이 Node에서 그대로 돈다.
test('실제 카트 엔진을 헤드리스로 구동(서버 권위 검증)', async () => {
  const kart = await import('../../games/kart/engine.js')
  const players = [
    { id: 'rat', name: '쥐', zodiacId: 'rat', color: '#f00' },
    { id: 'ox', name: '소', zodiacId: 'ox', color: '#0f0', isBot: true },
  ]
  const adapter = {
    STEP: kart.STEP,
    createGame: (ps) => kart.createGame(ps, () => 0.5),
    setInput: kart.setInput,
    step: kart.step,
    makeView: kart.makeView,
  }
  const sim = new RealtimeSim(adapter, adapter.createGame(players))
  sim.setInput('rat', { steer: 0.3, brake: false, drift: false })
  // 5초 진행 — 카운트다운(3초) 지나 주행 시작
  for (let i = 0; i < 100; i++) sim.advance(50)
  const view = sim.view()
  assert.equal(view.phase, 'play')
  assert.equal(view.karts.length, 2)
  const me = view.karts.find((k) => k.id === 'rat')
  assert.ok(Number.isFinite(me.x) && Number.isFinite(me.z))
  // 주행 중이라면 출발선에서 어느 정도는 움직였다
  assert.equal(view.status, 'racing')
})
