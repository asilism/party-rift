import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createGame, setInput, fireItem, step, makeView, ranking, displayLap,
  STEP, LAPS, COUNTDOWN_TIME,
} from './engine.js'
import { TRACK, BOX_SPOTS, PAD_ROWS, nearestSample, wrapDelta } from './track.js'

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

test('아이템을 들고 박스를 또 먹으면 리셋 후 재추첨 (itemSeq 증가)', () => {
  const g = createGame(P2, () => 0.9)
  startRacing(g)
  const k = g.karts[0]
  k.item = 'banana'
  const seq0 = k.itemSeq
  const spot = BOX_SPOTS[0]
  k.x = spot.x
  k.z = spot.z
  k.ci = nearestSample(TRACK, k.x, k.z)
  step(g, STEP)
  assert.equal(k.itemSeq, seq0 + 1, '재추첨으로 seq 증가')
  assert.ok(k.item, '아이템 보유')
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

test('폭탄: 센터라인을 따라 날아가 앞 카트를 맞춘다', () => {
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
  a.item = 'bomb'
  fireItem(g, 'a')
  assert.ok(g.objects.some((o) => o.kind === 'bomb'))
  for (let i = 0; i < 120 && !(b.stunT > 0); i++) {
    setInput(g, 'b', { steer: 0, brake: true }) // b는 제자리 근처
    step(g, STEP)
  }
  assert.ok(b.stunT > 0, '폭탄 명중 → 스턴')
})

test('아이템 박스는 먹은 뒤 일정 시간이 지나면 다시 생긴다', () => {
  const g = createGame(P2, () => 0.1)
  startRacing(g)
  const k = g.karts[0]
  const spot = BOX_SPOTS[0]
  k.x = spot.x
  k.z = spot.z
  k.ci = nearestSample(TRACK, k.x, k.z)
  step(g, STEP)
  assert.ok(g.boxes[0].t > 0, '먹은 직후엔 비활성')
  k.x = 0 // 박스에서 치워둔다
  k.z = 0
  for (let i = 0; i < Math.ceil(4.2 / STEP); i++) step(g, STEP)
  assert.equal(g.boxes[0].t, 0, '리스폰 완료')
  assert.equal(makeView(g).boxes[0], true)
})

test('1등과 반 바퀴 이상 차이 나야 추격 로켓이 나온다', () => {
  const g = createGame(P2, () => 0) // rng 0 → pool[0]
  startRacing(g)
  const a = g.karts[0]
  const spot = BOX_SPOTS[0]
  // 반 바퀴 미만 격차 → 로켓 없음
  g.karts[1].prog = a.prog + TRACK.n / 2 - 30
  a.x = spot.x
  a.z = spot.z
  a.ci = nearestSample(TRACK, a.x, a.z)
  step(g, STEP)
  assert.notEqual(a.item, 'rocket', '격차가 작으면 로켓 없음')
  // 반 바퀴 초과 → 로켓
  a.item = null
  g.boxes[0].t = 0
  g.karts[1].prog = a.prog + TRACK.n / 2 + 30
  step(g, STEP)
  assert.equal(a.item, 'rocket')
})

test('추격 로켓: 변신해 질주하되 격차의 절반까지만 따라잡고 풀린다', () => {
  const g = createGame(P2)
  startRacing(g)
  const a = g.karts[0]
  const b = g.karts[1]
  b.prog = a.prog + 300 // 1등이 멀리
  a.item = 'rocket'
  fireItem(g, 'a')
  assert.ok(a.rocketT > 0, '로켓 변신 시작')
  // 변신 중엔 바나나를 밟아도 멀쩡
  g.objects.push({ kind: 'banana', id: 99, x: a.x, z: a.z })
  const prog0 = a.prog
  for (let i = 0; i < 60; i++) step(g, STEP) // 1초
  assert.equal(a.stunT, 0, '공격 면역')
  assert.ok(a.prog - prog0 > 40 / TRACK.segLen, '로켓 속도로 질주')
  for (let i = 0; i < Math.ceil(12 / STEP) && a.rocketT > 0; i++) step(g, STEP)
  assert.equal(a.rocketT, 0, '변신 해제')
  const gained = a.prog - prog0
  assert.ok(Math.abs(gained - 150) < 15, `격차(300)의 절반만 회복 (${gained}샘플)`)
  assert.ok(a.prog < b.prog, '1등을 역전하지 않는다')
  assert.ok(a.speed <= 26.01, `해제 후 카트 속도로 복귀 (${a.speed})`)
})

test('카트끼리 충돌: 뒤에서 박으면 앞 카트가 밀려나고 서로 떨어진다', () => {
  const g = createGame(P2)
  startRacing(g)
  const a = g.karts[0]
  const b = g.karts[1]
  b.x = a.x + Math.cos(a.heading) * 1.5 // a 바로 앞에 정지한 b
  b.z = a.z + Math.sin(a.heading) * 1.5
  b.ci = a.ci
  b.heading = a.heading
  b.speed = 0
  a.speed = 20
  step(g, STEP)
  assert.ok(b.speed > 2, `박치기로 앞 카트 가속 (${b.speed})`)
  assert.ok(a.speed < 20, `박은 카트는 감속 (${a.speed})`)
  const d = Math.hypot(b.x - a.x, b.z - a.z)
  assert.ok(d >= 1.5, `밀어내기로 간격 확보 (${d})`)
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

test('CPU 카트: 입력 없이 스스로 트랙을 달리고 아이템도 쓴다', () => {
  const g = createGame(
    [P2[0], { id: 'cpu', name: '봇', zodiacId: 'ox', color: '#bbb', isBot: true }],
    () => 0.5
  )
  startRacing(g)
  const bot = g.karts[1]
  const prog0 = bot.prog
  for (let i = 0; i < Math.ceil(20 / STEP); i++) step(g, STEP) // 20초 무입력
  assert.ok(bot.prog - prog0 > 100, `봇 스스로 주행 (${bot.prog - prog0}샘플 전진)`)
  assert.ok(bot.speedFactor < 1, 'CPU 최고속은 사람보다 낮다')
  bot.item = 'boost'
  for (let i = 0; i < Math.ceil(4 / STEP) && bot.item; i++) step(g, STEP)
  assert.equal(bot.item, null, '봇이 아이템을 사용')
})

test('가속 발판: 밟으면 버섯처럼 순간 부스트', () => {
  const g = createGame(P2)
  startRacing(g)
  const k = g.karts[0]
  const s = TRACK.samples[PAD_ROWS[0]]
  k.x = s.x
  k.z = s.z
  k.ci = PAD_ROWS[0]
  k.heading = Math.atan2(s.dz, s.dx)
  assert.equal(k.boostT, 0)
  step(g, STEP)
  assert.ok(k.boostT > 1, `발판 부스트 발동 (boostT=${k.boostT})`)
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
