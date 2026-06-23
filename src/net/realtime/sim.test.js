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

// ④ 핵심 전제(실제 리프트 엔진을 브라우저 없이 Node에서 그대로 구동)는
//    server/realtime.test.js 가 전체 세션으로 검증한다.
