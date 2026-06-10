import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createGame, setInput, fireItem, step, makeView, ranking, displayLap,
  STEP, LAPS, COUNTDOWN_TIME,
} from './engine.js'
import { TRACK, BOX_SPOTS, nearestSample, wrapDelta } from './track.js'

const P2 = [
  { id: 'a', name: 'A', zodiacId: 'rat', color: '#aaa' },
  { id: 'b', name: 'B', zodiacId: 'ox', color: '#bbb' },
]

// 카운트다운을 건너뛰고 주행 상태로
function startRacing(g) {
  while (g.status === 'countdown') step(g, STEP)
}

// 다음 샘플들을 향해 조향하는 간단한 자동 주행
function autopilot(k) {
  const t = TRACK.samples[(k.ci + 6) % TRACK.n]
  const desired = Math.atan2(t.z - k.z, t.x - k.x)
  let d = desired - k.heading
  while (d > Math.PI) d -= 2 * Math.PI
  while (d < -Math.PI) d += 2 * Math.PI
  return Math.max(-1, Math.min(1, d * 2))
}

test('wrapDelta: 랩 경계를 넘는 인덱스 차이를 감아서 계산', () => {
  assert.equal(wrapDelta(1, 260), 1)
  assert.equal(wrapDelta(-1, 260), -1)
  assert.equal(wrapDelta(259 - 0, 260), -1) // 0 → 259 = 한 칸 후진
  assert.equal(wrapDelta(0 - 259, 260), 1) // 259 → 0 = 출발선 통과
})

test('createGame: 출발선 뒤에 배치, 카운트다운 시작', () => {
  const g = createGame(P2)
  assert.equal(g.status, 'countdown')
  assert.equal(g.karts.length, 2)
  for (const k of g.karts) {
    assert.ok(k.prog < 0) // 출발선 앞(통과 전)
    assert.equal(displayLap(k), 1)
    assert.equal(k.speed, 0)
  }
})

test('카운트다운이 끝나면 racing, 입력 없이도 자동 가속', () => {
  const g = createGame(P2)
  for (let i = 0; i < Math.ceil(COUNTDOWN_TIME / STEP) + 1; i++) step(g, STEP)
  assert.equal(g.status, 'racing')
  for (let i = 0; i < 60; i++) step(g, STEP)
  assert.ok(g.karts[0].speed > 5, `자동 가속 속도: ${g.karts[0].speed}`)
})

test('조향 입력은 heading을, 브레이크는 속도를 바꾼다', () => {
  const g = createGame(P2)
  startRacing(g)
  for (let i = 0; i < 90; i++) step(g, STEP)
  const h0 = g.karts[0].heading
  setInput(g, 'a', { steer: 1, brake: false })
  for (let i = 0; i < 30; i++) step(g, STEP)
  assert.ok(g.karts[0].heading > h0, '조향으로 heading 증가')

  const v0 = g.karts[1].speed
  setInput(g, 'b', { steer: 0, brake: true })
  for (let i = 0; i < 30; i++) step(g, STEP)
  assert.ok(g.karts[1].speed < v0 * 0.6, `브레이크 감속: ${v0} → ${g.karts[1].speed}`)
})

test('자동 주행으로 3랩 완주 → 골인 처리', () => {
  const g = createGame([P2[0]])
  startRacing(g)
  for (let i = 0; i < 60 * 240 && g.status !== 'finished'; i++) {
    setInput(g, 'a', { steer: autopilot(g.karts[0]), brake: false })
    step(g, STEP)
  }
  assert.equal(g.status, 'finished')
  assert.deepEqual(g.finishOrder, ['a'])
  assert.ok(g.karts[0].prog >= TRACK.n * LAPS)
})

test('트랙 가장자리: 밖으로 못 나가고, 감속되며, 트랙 방향으로 되돌려준다', () => {
  const g = createGame([P2[0]])
  startRacing(g)
  const k = g.karts[0]
  const s = TRACK.samples[k.ci]
  // 가장자리 바로 안쪽에서 트랙 바깥(법선 방향)을 향해 전속으로 돌진
  k.x = s.x + s.nx * (TRACK.halfW - 1)
  k.z = s.z + s.nz * (TRACK.halfW - 1)
  k.heading = Math.atan2(s.nz, s.nx)
  k.speed = 26
  for (let i = 0; i < 120; i++) step(g, STEP) // 2초
  const s2 = TRACK.samples[k.ci]
  const lat = (k.x - s2.x) * s2.nx + (k.z - s2.z) * s2.nz
  assert.ok(Math.abs(lat) <= TRACK.halfW, `트랙 안에 머무름 (lat=${lat})`)
  // 진행 방향이 트랙 탄젠트 쪽으로 복귀했는지 (전방 성분이 양수)
  const fwd = Math.cos(k.heading) * s2.dx + Math.sin(k.heading) * s2.dz
  assert.ok(fwd > 0.5, `트랙 방향으로 복귀 (fwd=${fwd})`)
})

test('아이템 박스를 지나가면 아이템 획득 + 박스 리스폰 대기', () => {
  const g = createGame(P2, () => 0.1)
  startRacing(g)
  const k = g.karts[0]
  const spot = BOX_SPOTS[0]
  k.x = spot.x
  k.z = spot.z
  k.ci = nearestSample(TRACK, k.x, k.z)
  step(g, STEP)
  assert.ok(k.item, '아이템 획득')
  assert.ok(g.boxes[0].t > 0, '박스 리스폰 대기')
})

test('부스트: 사용하면 boostT가 걸리고 최고속이 올라간다', () => {
  const g = createGame(P2)
  startRacing(g)
  const drive = () => {
    g.karts.forEach((k) => setInput(g, k.id, { steer: autopilot(k), brake: false }))
    step(g, STEP)
  }
  for (let i = 0; i < 180; i++) drive() // 트랙을 따라 최고속 도달
  const base = g.karts[0].speed
  g.karts[0].item = 'boost'
  fireItem(g, 'a')
  assert.equal(g.karts[0].item, null)
  for (let i = 0; i < 40; i++) drive()
  assert.ok(g.karts[0].speed > base * 1.2, `부스트 가속: ${base} → ${g.karts[0].speed}`)
})

test('바나나: 뒤에 떨어지고, 밟은 카트는 스턴', () => {
  const g = createGame(P2)
  startRacing(g)
  g.karts[0].item = 'banana'
  fireItem(g, 'a')
  const banana = g.objects.find((o) => o.kind === 'banana')
  assert.ok(banana, '바나나 생성')
  const b = g.karts[1]
  b.x = banana.x
  b.z = banana.z
  b.ci = nearestSample(TRACK, b.x, b.z)
  step(g, STEP)
  assert.ok(b.stunT > 0, '바나나 밟고 스턴')
  assert.equal(g.objects.length, 0, '밟힌 바나나는 제거')
})

test('로켓: 센터라인을 따라 날아가 앞 카트를 맞춘다', () => {
  const g = createGame(P2)
  startRacing(g)
  const a = g.karts[0]
  const b = g.karts[1]
  // b를 a보다 20샘플 앞 트랙 위에 세워둔다
  const bi = (a.ci + 20) % TRACK.n
  const s = TRACK.samples[bi]
  b.x = s.x
  b.z = s.z
  b.ci = bi
  b.prog = a.prog + 20
  a.item = 'rocket'
  fireItem(g, 'a')
  assert.ok(g.objects.some((o) => o.kind === 'rocket'))
  for (let i = 0; i < 120 && !(b.stunT > 0); i++) {
    setInput(g, 'b', { steer: 0, brake: true }) // b는 제자리 근처
    step(g, STEP)
  }
  assert.ok(b.stunT > 0, '로켓 명중 → 스턴')
})

test('1등 골인 후 제한시간이 지나면 레이스 종료, 순위는 진행도순', () => {
  const g = createGame(P2)
  startRacing(g)
  g.karts[0].prog = TRACK.n * LAPS + 1 // a 골인
  step(g, STEP)
  assert.equal(g.karts[0].finished, true)
  assert.deepEqual(g.finishOrder, ['a'])
  assert.equal(g.status, 'racing')
  for (let i = 0; i < Math.ceil(31 / STEP) && g.status !== 'finished'; i++) step(g, STEP)
  assert.equal(g.status, 'finished')
  assert.deepEqual(ranking(g).map((k) => k.id), ['a', 'b'])
})

test('makeView: JSON 직렬화 가능한 스냅샷', () => {
  const g = createGame(P2)
  startRacing(g)
  g.karts[0].item = 'banana'
  fireItem(g, 'a')
  const v = makeView(g)
  const round = JSON.parse(JSON.stringify(v))
  assert.equal(round.phase, 'play')
  assert.equal(round.karts.length, 2)
  assert.equal(round.boxes.length, BOX_SPOTS.length)
  assert.equal(round.objects.length, 1)
  assert.ok(round.karts.every((k) => typeof k.rank === 'number'))
})
