import { test } from 'node:test'
import assert from 'node:assert/strict'
import { riftNet } from './netgame.js'

// 두 스냅샷 버퍼를 만들어 t 시점에서 보간한다.
const buf = (a, b) => [
  { at: 0, v: a },
  { at: 100, v: b },
]
const hero = (o) => ({ id: 'h', x: 0, z: 0, dir: 0, respawnT: 0, ...o })
const snap = (h) => ({ phase: 'play', time: 0, heroes: [h], minions: [], monsters: [], projectiles: [] })

test('보간: 살아있는 영웅은 두 위치 사이를 부드럽게 지난다', () => {
  const a = snap(hero({ x: 0, z: 0 }))
  const b = snap(hero({ x: 10, z: 0 }))
  const v = riftNet.interpolate(buf(a, b), 50) // 중간 시점
  assert.ok(Math.abs(v.heroes[0].x - 5) < 1e-6, `x=${v.heroes[0].x}`)
})

test('리스폰(사망→부활): 시체 위치에서 분수대로 미끄러지지 않고 스냅한다', () => {
  // a: 전장에서 사망(respawnT>0), b: 분수대에서 부활(respawnT=0)
  const a = snap(hero({ x: 40, z: 40, respawnT: 0.05 }))
  const b = snap(hero({ x: -80, z: -80, respawnT: 0 }))
  const v = riftNet.interpolate(buf(a, b), 50) // 보간 중간 시점
  const h = v.heroes[0]
  // 최신(부활) 위치로 스냅 — 중간 지점(전장~분수대 사이)을 지나면 "누가 살아났는지" 새어 나간다
  assert.equal(h.respawnT, 0)
  assert.ok(h.x === -80 && h.z === -80, `pos=${h.x},${h.z}`)
})

test('큰 도약(점멸·순간이동)도 보간 없이 스냅한다', () => {
  const a = snap(hero({ x: 0, z: 0 }))
  const b = snap(hero({ x: 30, z: 0 })) // 한 스냅샷에 30유닛 = 순간이동
  const v = riftNet.interpolate(buf(a, b), 50)
  assert.equal(v.heroes[0].x, 30)
})
