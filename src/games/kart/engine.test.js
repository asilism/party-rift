import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createGame, setInput, fireItem, step, makeView, makeBot, ranking, displayLap, driftLevel,
  STEP, LAPS, COUNTDOWN_TIME, DRIFT_TIERS,
} from './engine.js'
import {
  TRACK, TRACKS, TRACK_LIST, BOX_SPOTS, PADS, PAD_HALF_W,
  nearestSample, wrapDelta, obstaclePose, obstacleTrackPos, obstacleVisible, onIce,
} from './track.js'

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

test('번개: 내 앞의 카트만 스턴되고, 나와 뒤 카트는 멀쩡하다', () => {
  const g = createGame([...P2, { id: 'c', name: 'C', zodiacId: 'tiger', color: '#ccc' }])
  startRacing(g)
  const [a, b, c] = g.karts
  b.prog = a.prog + 100 // b는 내 앞
  c.prog = a.prog - 50 // c는 내 뒤
  a.item = 'lightning'
  fireItem(g, 'a')
  assert.ok(b.stunT > 0, '앞 카트는 번개에 맞아 스턴')
  assert.equal(a.stunT, 0, '쏜 사람은 멀쩡')
  assert.equal(c.stunT, 0, '뒤 카트는 멀쩡')
  assert.equal(makeView(g).lightning, true, '번개 플래시 전파')
  for (let i = 0; i < 60; i++) step(g, STEP) // 1초 후 플래시 종료
  assert.equal(makeView(g).lightning, false)
})

test('번개: 로켓 변신 중인 카트는 면역', () => {
  const g = createGame(P2)
  startRacing(g)
  const [a, b] = g.karts
  b.prog = a.prog + 100
  b.rocketT = 3
  a.item = 'lightning'
  fireItem(g, 'a')
  assert.equal(b.stunT, 0, '로켓 변신 중엔 번개 면역')
})

test('꼴찌는 아이템 박스에서 번개가 나올 수 있다', () => {
  const g = createGame(P2, () => 0.4) // pool[1]
  startRacing(g)
  const a = g.karts[0]
  g.karts[1].prog = a.prog + 30 // a가 꼴찌 (로켓 격차 미만)
  const spot = BOX_SPOTS[0]
  a.x = spot.x
  a.z = spot.z
  a.ci = nearestSample(TRACK, a.x, a.z)
  step(g, STEP)
  assert.equal(a.item, 'lightning')
})

test('슬립스트림: 앞 카트 뒤에 붙어 달리면 부스트가 터진다', () => {
  const g = createGame(P2)
  startRacing(g)
  const [a, b] = g.karts
  // b를 a의 4m 앞 같은 차선에 두고 둘 다 최고속으로 나란히 주행
  const gapSamples = Math.round(4 / TRACK.segLen)
  const bi = (a.ci + gapSamples) % TRACK.n
  const s = TRACK.samples[bi]
  b.x = s.x
  b.z = s.z
  b.ci = bi
  b.prog = a.prog + gapSamples
  b.heading = Math.atan2(s.dz, s.dx)
  a.speed = 26
  b.speed = 26
  const seq0 = a.draftSeq
  for (let i = 0; i < Math.ceil(2 / STEP) && a.draftSeq === seq0; i++) {
    setInput(g, 'a', { steer: autopilot(a), brake: false })
    setInput(g, 'b', { steer: autopilot(b), brake: false })
    step(g, STEP)
  }
  assert.equal(a.draftSeq, seq0 + 1, '슬립스트림 발동')
  assert.ok(a.boostT > 0, '발동 시 부스트')
  assert.ok(makeView(g).karts.every((k) => typeof k.draftSeq === 'number'), 'draftSeq 전파')
})

test('마지막 바퀴에 들어서면 finalLap 플래그가 켜진다', () => {
  const g = createGame(P2)
  startRacing(g)
  assert.equal(makeView(g).finalLap, false)
  g.karts[0].prog = TRACK.n * (LAPS - 1) + 1
  assert.equal(makeView(g).finalLap, true)
})

test('트랙 3종: 자기교차 없음 + 장애물/발판/박스가 모두 정의됨', () => {
  assert.equal(TRACK_LIST.length, 4)
  for (const t of TRACK_LIST) {
    // 자기교차 검사: 인덱스가 멀리 떨어진 샘플끼리는 도로 두 폭보다 멀어야 함
    for (let i = 0; i < t.n; i += 2) {
      for (let j = i + 2; j < t.n; j += 2) {
        if (Math.abs(wrapDelta(j - i, t.n)) < 30) continue
        const d = Math.hypot(t.samples[i].x - t.samples[j].x, t.samples[i].z - t.samples[j].z)
        assert.ok(d > t.halfW * 2 + 1, `${t.id}: 트랙 겹침 없음 (i=${i}, j=${j}, d=${d})`)
      }
    }
    assert.ok(t.obstacles.length >= 3, `${t.id}: 명물 장애물 존재`)
    assert.equal(t.pads.length, 4)
    assert.equal(t.boxSpots.length, 9)
    // 고정 장애물은 트랙 안에 있어야 함
    for (const ob of t.obstacles) {
      if (ob.lat != null) assert.ok(Math.abs(ob.lat) < t.halfW, `${t.id}: ${ob.kind} 트랙 안`)
    }
  }
})

test('트랙 선택: createGame(trackId)로 트랙이 정해지고 뷰에 전파된다', () => {
  const g = createGame(P2, Math.random, 'desert')
  assert.equal(g.track.id, 'desert')
  const v = makeView(g)
  assert.equal(v.trackId, 'desert')
  assert.equal(v.obs.length, TRACKS.desert.obstacles.length)
  // 모르는 trackId는 기본 트랙으로
  assert.equal(createGame(P2, Math.random, 'nope').track.id, 'meadow')
})

test('초원의 소: 부딪히면 튕겨나며 감속하지만 스턴은 없다', () => {
  const g = createGame(P2, Math.random, 'meadow')
  startRacing(g)
  const k = g.karts[0]
  const cow = g.track.obstacles[0]
  const pos = obstaclePose(g.track, cow, g.time + STEP) // 다음 틱의 소 위치에 세워둔다
  k.x = pos.x
  k.z = pos.z
  k.ci = nearestSample(g.track, k.x, k.z)
  k.speed = 20
  step(g, STEP)
  assert.equal(k.bumpSeq, 1, '소와 충돌')
  assert.equal(k.bumpKind, 'cow')
  assert.equal(k.stunT, 0, '스턴 없음 (웃긴 사고)')
  assert.ok(k.speed < 20, `감속 (${k.speed})`)
  const d = Math.hypot(k.x - pos.x, k.z - pos.z)
  assert.ok(d >= cow.r + 1 - 0.01, `밀려남 (d=${d})`)
})

test('소는 한 방향으로만 건너가고, 코스 밖에선 사라진다 (반대편 리스폰)', () => {
  const t = TRACKS.meadow
  const cow = t.obstacles[0]
  // 한 주기 동안 lat이 단조 증가(dir=1): 뒷걸음질 없음
  const t0 = cow.period * (1 - cow.phase) + 0.5 // 주기 시작 직후
  const lats = [0, 0.2, 0.4, 0.6, 0.8].map(
    (f) => obstacleTrackPos(t, cow, t0 + f * cow.period * 0.9).lat
  )
  for (let i = 1; i < lats.length; i++) {
    assert.ok(lats[i] > lats[i - 1], `한 방향 진행 (${lats.join(', ')})`)
  }
  // 주기 시작/끝(코스 밖)에선 안 보이고, 중간(트랙 위)에선 보인다
  assert.equal(obstacleVisible(t, cow, t0), false, '코스 밖에선 숨김')
  assert.equal(obstacleVisible(t, cow, t0 + cow.period / 2), true, '트랙 위에선 표시')
})

test('회오리: 부딪히면 하늘로 붕 날아가고(조향 불가), 착지 후 무적', () => {
  const g = createGame(P2, Math.random, 'desert')
  startRacing(g)
  const k = g.karts[0]
  const tornado = g.track.obstacles.find((o) => o.kind === 'tornado')
  const pos = obstaclePose(g.track, tornado, g.time + STEP)
  k.x = pos.x
  k.z = pos.z
  k.ci = nearestSample(g.track, k.x, k.z)
  k.speed = 20
  step(g, STEP)
  assert.equal(k.bumpKind, 'tornado')
  assert.ok(k.flyT > 0, '하늘로 붕!')
  assert.equal(k.stunT, 0, '스턴이 아니라 비행')
  // 비행 중엔 바나나도 무시
  g.objects.push({ kind: 'banana', id: 99, x: k.x, z: k.z })
  step(g, STEP)
  assert.equal(k.stunT, 0, '비행 중 면역')
  // 착지 후에도 잠시 무적(깜빡임)
  for (let i = 0; i < Math.ceil(1.4 / STEP) && k.flyT > 0; i++) step(g, STEP)
  assert.equal(k.flyT, 0, '착지')
  assert.ok(k.invT > 0, '착지 후 무적 시간')
})

test('패널티 후 무적: 스턴이 풀린 직후엔 연달아 당하지 않는다', () => {
  const g = createGame(P2)
  startRacing(g)
  const k = g.karts[0]
  stunKartViaBanana(g, k)
  assert.ok(k.stunT > 0, '첫 바나나 스턴')
  for (let i = 0; i < Math.ceil(2 / STEP) && k.stunT > 0; i++) step(g, STEP)
  assert.equal(k.stunT, 0, '스턴 종료')
  assert.ok(k.invT > 0, '무적 시간 시작')
  stunKartViaBanana(g, k)
  assert.equal(k.stunT, 0, '무적 중엔 다시 안 당함')
  for (let i = 0; i < Math.ceil(2 / STEP) && k.invT > 0; i++) step(g, STEP)
  assert.equal(k.invT, 0, '무적 종료')
  stunKartViaBanana(g, k)
  assert.ok(k.stunT > 0, '무적이 끝나면 다시 당한다')
})

function stunKartViaBanana(g, k) {
  g.objects.push({ kind: 'banana', id: g.nextObjId++, x: k.x, z: k.z })
  step(g, STEP)
  g.objects = g.objects.filter((o) => o.kind !== 'banana')
}

test('사막의 선인장: 박으면 따가워서 스턴', () => {
  const g = createGame(P2, Math.random, 'desert')
  startRacing(g)
  const k = g.karts[0]
  const cactus = g.track.obstacles.find((o) => o.kind === 'cactus')
  const pos = obstaclePose(g.track, cactus, 0) // 고정 장애물 (시간 무관)
  k.x = pos.x
  k.z = pos.z
  k.ci = nearestSample(g.track, k.x, k.z)
  step(g, STEP)
  assert.equal(k.bumpKind, 'cactus')
  assert.ok(k.stunT > 0, '선인장 스턴')
})

test('눈사람: 박으면 와장창 부서지고 일정 시간 뒤 복구된다', () => {
  const g = createGame(P2, Math.random, 'snow')
  startRacing(g)
  const k = g.karts[0]
  const idx = g.track.obstacles.findIndex((o) => o.kind === 'snowman')
  const pos = obstaclePose(g.track, g.track.obstacles[idx], 0)
  k.x = pos.x
  k.z = pos.z
  k.ci = nearestSample(g.track, k.x, k.z)
  k.speed = 20
  step(g, STEP)
  assert.equal(k.bumpKind, 'snowman')
  assert.ok(k.speed < 12, `속도가 뚝 (${k.speed})`)
  assert.equal(makeView(g).obs[idx], false, '부서진 동안엔 숨김')
  k.x = 0 // 카트를 치워두고 리스폰을 기다린다
  k.z = 0
  k.ci = nearestSample(g.track, 0, 0)
  for (let i = 0; i < Math.ceil(7.2 / STEP); i++) step(g, STEP)
  assert.equal(makeView(g).obs[idx], true, '눈사람 복구')
})

test('빙판: 같은 조향이라도 빙판 위에선 핸들이 덜 듣는다', () => {
  const t = TRACKS.snow
  const iceI = t.ice[0].from + 5
  const dryI = Math.round(t.n * 0.3)
  assert.ok(onIce(t, iceI) && !onIce(t, dryI), '빙판/일반 구간 구분')
  const turnAt = (si) => {
    const g = createGame([P2[0]], Math.random, 'snow')
    startRacing(g)
    const k = g.karts[0]
    const s = t.samples[si]
    k.x = s.x
    k.z = s.z
    k.ci = si
    k.heading = Math.atan2(s.dz, s.dx)
    k.speed = 20
    const h0 = k.heading
    setInput(g, 'a', { steer: 1, brake: false })
    step(g, STEP)
    return Math.abs(k.heading - h0)
  }
  const dry = turnAt(dryI)
  const ice = turnAt(iceI)
  assert.ok(ice < dry * 0.6, `빙판 조향 감소 (dry=${dry}, ice=${ice})`)
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

test('가속 발판: 발판 위치는 트랙 안, 밟으면 버섯처럼 순간 부스트', () => {
  for (const pad of PADS) {
    assert.ok(Math.abs(pad.lat) + PAD_HALF_W < TRACK.halfW, `발판이 트랙 안 (lat=${pad.lat})`)
  }
  const g = createGame(P2)
  startRacing(g)
  const k = g.karts[0]
  const pad = PADS[0]
  const s = TRACK.samples[pad.i]
  k.x = s.x + s.nx * pad.lat // 발판의 좌우 위치를 정확히 밟는다
  k.z = s.z + s.nz * pad.lat
  k.ci = pad.i
  k.heading = Math.atan2(s.dz, s.dx)
  assert.equal(k.boostT, 0)
  step(g, STEP)
  assert.ok(k.boostT > 1, `발판 부스트 발동 (boostT=${k.boostT})`)

  // 발판에서 옆으로 비켜 가면 발동하지 않는다
  const g2 = createGame(P2)
  startRacing(g2)
  const k2 = g2.karts[0]
  const offLat = pad.lat > 0 ? pad.lat - PAD_HALF_W * 3 : pad.lat + PAD_HALF_W * 3
  k2.x = s.x + s.nx * offLat
  k2.z = s.z + s.nz * offLat
  k2.ci = pad.i
  k2.heading = Math.atan2(s.dz, s.dx)
  step(g2, STEP)
  assert.equal(k2.boostT, 0, '비켜 가면 부스트 없음')
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

// ── 드리프트 & 미니터보 ──

// 전속으로 가속시키고 트랙 중앙에 세워두는 헬퍼
function speedUp(g, id, secs = 2) {
  const k = g.karts.find((p) => p.id === id)
  for (let i = 0; i < Math.round(secs / STEP); i++) {
    step(g, STEP)
    recenter(k)
  }
  return k
}

// 코너가 짧은 트랙에서 드리프트 충전만 검증할 수 있게,
// 매 틱 카트를 트랙 중앙선 위(진행 방향 정렬)로 되돌린다
function recenter(k) {
  const s = TRACK.samples[k.ci]
  k.x = s.x
  k.z = s.z
  k.heading = Math.atan2(s.dz, s.dx)
}

// 드리프트를 유지하며 secs초 충전
function chargeDrift(g, id, secs) {
  const k = g.karts.find((p) => p.id === id)
  setInput(g, id, { steer: 1, drift: true })
  for (let i = 0; i < Math.round(secs / STEP); i++) {
    step(g, STEP)
    recenter(k)
  }
  return k
}

test('드리프트: 버튼+조향으로 시작되고 차체가 바깥쪽으로 미끄러진다', () => {
  const g = createGame([P2[0]])
  startRacing(g)
  const k = speedUp(g, 'a')
  setInput(g, 'a', { steer: 1, drift: true })
  step(g, STEP)
  assert.equal(k.driftDir, 1, '오른쪽 드리프트 시작')
  const x0 = k.x
  const z0 = k.z
  step(g, STEP)
  // 이동 방향이 차체가 향한 방향(heading)보다 바깥쪽(왼쪽)
  const mv = Math.atan2(k.z - z0, k.x - x0)
  let d = mv - k.heading
  while (d > Math.PI) d -= 2 * Math.PI
  while (d < -Math.PI) d += 2 * Math.PI
  assert.ok(d < -0.1, `미끄러짐 각도 d=${d}`)
})

test('드리프트 없이는 시작되지 않는다 (저속/조향 없음/버튼 없음)', () => {
  const g = createGame([P2[0]])
  startRacing(g)
  const k = speedUp(g, 'a')
  setInput(g, 'a', { steer: 1, drift: false }) // 버튼 없음
  step(g, STEP)
  assert.equal(k.driftDir, 0)
  setInput(g, 'a', { steer: 0.1, drift: true }) // 조향 부족
  step(g, STEP)
  assert.equal(k.driftDir, 0)
  k.speed = 5 // 저속
  setInput(g, 'a', { steer: 1, drift: true })
  step(g, STEP)
  assert.equal(k.driftDir, 0)
})

test('미니터보: 오래 유지할수록 더 긴 부스트 (1단계 < 3단계)', () => {
  const g = createGame([P2[0]])
  startRacing(g)
  speedUp(g, 'a')
  const k = chargeDrift(g, 'a', DRIFT_TIERS[0] + 0.2)
  assert.equal(driftLevel(k.driftT), 1)
  setInput(g, 'a', { steer: 0, drift: false })
  step(g, STEP)
  assert.equal(k.driftDir, 0)
  assert.equal(k.turboSeq, 1)
  const boost1 = k.boostT
  assert.ok(boost1 > 0.4, `1단계 터보 boostT=${boost1}`)

  const g2 = createGame([P2[0]])
  startRacing(g2)
  speedUp(g2, 'a')
  const k2 = chargeDrift(g2, 'a', DRIFT_TIERS[2] + 0.2)
  assert.equal(driftLevel(k2.driftT), 3)
  setInput(g2, 'a', { steer: 0, drift: false })
  step(g2, STEP)
  assert.ok(k2.boostT > boost1, `3단계가 더 길다 (${k2.boostT} > ${boost1})`)
})

test('충전이 부족하면 터보 없이 드리프트만 풀린다', () => {
  const g = createGame([P2[0]])
  startRacing(g)
  speedUp(g, 'a')
  const k = chargeDrift(g, 'a', DRIFT_TIERS[0] * 0.5)
  setInput(g, 'a', { steer: 0, drift: false })
  step(g, STEP)
  assert.equal(k.driftDir, 0)
  assert.equal(k.boostT, 0)
  assert.equal(k.turboSeq, 0)
})

test('스턴되면 충전 중이던 미니터보를 잃는다', () => {
  const g = createGame([P2[0]])
  startRacing(g)
  speedUp(g, 'a')
  const k = chargeDrift(g, 'a', DRIFT_TIERS[1] + 0.2)
  k.stunT = 1 // 폭탄에 맞은 상황
  step(g, STEP)
  assert.equal(k.driftDir, 0)
  assert.equal(k.driftT, 0)
  assert.equal(k.boostT, 0, '터보 보상 없음')
  assert.equal(k.turboSeq, 0)
})

test('makeView에 드리프트 상태가 들어간다', () => {
  const g = createGame([P2[0]])
  startRacing(g)
  speedUp(g, 'a')
  chargeDrift(g, 'a', DRIFT_TIERS[0] + 0.2)
  const v = makeView(g)
  assert.equal(v.karts[0].drift, 1)
  assert.equal(v.karts[0].driftLvl, 1)
  assert.equal(typeof v.karts[0].turboSeq, 'number')
})

// ── 중도 이탈 → 봇 전환 ──

test('makeBot: 연결이 끊긴 카트를 봇이 이어받아 스스로 달린다', () => {
  const g = createGame(P2)
  startRacing(g)
  assert.ok(makeBot(g, 'b'), '사람 카트는 봇으로 전환')
  const k = g.karts[1]
  assert.equal(k.isBot, true)
  assert.equal(makeBot(g, 'b'), null, '이미 봇이면 무시')
  assert.equal(makeBot(g, 'no-such'), null, '없는 카트는 무시')
  const p0 = k.prog
  for (let i = 0; i < 60 * 5; i++) step(g, STEP)
  assert.ok(k.prog > p0 + 30, `봇이 스스로 전진 (${p0} → ${k.prog})`)
  assert.ok(k.speedFactor <= 0.97, 'CPU 속도 상한 적용')
})

test('스타트 대시: 출발 직전 드리프트를 누르고 있으면 출발 부스트', () => {
  const g = createGame(P2)
  setInput(g, 'a', { steer: 0, drift: true }) // 미리 눌러둬도 OK
  startRacing(g)
  assert.ok(g.karts[0].boostT > 0, '눌렀던 카트는 부스트')
  assert.equal(g.karts[1].boostT, 0, '안 누른 카트는 그대로')
  assert.equal(makeView(g).karts[0].startDash, true)
})

// ── 화산 협곡: 고도 / 점프대 / 용암 추락 ──

// 트랙을 지정해 다음 샘플을 향해 조향하는 자동 주행 (autopilot의 일반화)
function autopilotOn(track, k) {
  const t = track.samples[(k.ci + 6) % track.n]
  const desired = Math.atan2(t.z - k.z, t.x - k.x)
  let d = desired - k.heading
  while (d > Math.PI) d -= 2 * Math.PI
  while (d < -Math.PI) d += 2 * Math.PI
  return Math.max(-1, Math.min(1, d * 2))
}

// 카트를 특정 샘플 위에 진행 방향으로 정렬해 세워두는 헬퍼
function placeAt(track, k, si, speed) {
  const s = track.samples[si]
  k.x = s.x
  k.z = s.z
  k.ci = si
  k.prog = si
  k.heading = Math.atan2(s.dz, s.dx)
  k.speed = speed
  k.ky = s.y || 0
}

test('화산: 고도 프로필 — 언덕/협곡이 있고 기존 트랙은 평지 그대로', () => {
  const v = TRACKS.volcano
  assert.ok(Math.max(...v.samples.map((s) => s.y)) > 5, '오르막 존재')
  assert.ok(Math.min(...v.samples.map((s) => s.y)) >= 0)
  assert.ok(v.gaps.length >= 1, '용암 협곡 존재')
  assert.ok(v.jumps.length >= 2, '점프대 존재')
  for (const id of ['meadow', 'desert', 'snow']) {
    assert.ok(TRACKS[id].samples.every((s) => s.y === 0), `${id}는 평지`)
  }
  const g = createGame(P2, Math.random, 'volcano')
  const view = makeView(g)
  assert.equal(typeof view.karts[0].y, 'number')
  assert.equal(view.karts[0].air, false)
})

test('화산: 점프대를 빠르게 밟으면 날아서 협곡을 건넌다', () => {
  const g = createGame([P2[0]], Math.random, 'volcano')
  startRacing(g)
  const t = g.track
  const k = g.karts[0]
  placeAt(t, k, (t.jumps[0].i - 4 + t.n) % t.n, 26)
  let flew = false
  for (let i = 0; i < 60 * 4 && !(flew && !k.air); i++) {
    if (k.air) flew = true
    setInput(g, 'a', { steer: autopilotOn(t, k) })
    step(g, STEP)
  }
  assert.equal(k.jumpSeq, 1, '점프대 발사')
  assert.ok(flew, '공중에 떴다')
  assert.equal(k.fallSeq, 0, '추락 없이')
  assert.ok(wrapDelta(k.ci - t.gaps[0].to, t.n) > 0, `협곡 너머 착지 (ci=${k.ci})`)
})

test('화산: 느린 카트는 협곡에 풍덩 — 연출 후 낭떠러지 앞 리스폰', () => {
  const g = createGame([P2[0]], Math.random, 'volcano')
  startRacing(g)
  const t = g.track
  const k = g.karts[0]
  const gap = t.gaps[0]
  placeAt(t, k, gap.from + 2, 4) // 도로가 없는 곳에서 저속
  for (let i = 0; i < 60 * 3 && k.fallSeq === 0; i++) step(g, STEP)
  assert.equal(k.fallSeq, 1, '추락 발생')
  assert.ok(k.fallT > 0)
  for (let i = 0; i < 60 * 3 && k.fallT > 0; i++) step(g, STEP)
  assert.equal(k.ci, (gap.from - 8 + t.n) % t.n, '낭떠러지 앞 리스폰')
  assert.ok(k.invT > 0, '리스폰 직후 무적')
  assert.ok(!k.air)
  assert.ok(k.speed < 10)
})

test('화산: 공중에선 아이템 박스/장애물/충돌을 그냥 지나친다', () => {
  const g = createGame(P2, Math.random, 'volcano')
  startRacing(g)
  const k = g.karts[0]
  k.air = true
  k.vy = 5
  k.ky = (g.track.samples[k.ci].y || 0) + 3
  const spot = g.track.boxSpots[0]
  k.x = spot.x
  k.z = spot.z
  k.ci = nearestSample(g.track, k.x, k.z)
  step(g, STEP)
  assert.equal(k.item, null, '공중에선 박스를 못 먹는다')
})

test('화산: 용암 불덩이에 닿으면 앗 뜨거 스턴', () => {
  const g = createGame(P2, Math.random, 'volcano')
  startRacing(g)
  const t = g.track
  const k = g.karts[0]
  const ob = t.obstacles[0]
  const pos = obstaclePose(t, ob, g.time + STEP)
  k.x = pos.x
  k.z = pos.z
  k.ci = nearestSample(t, k.x, k.z)
  k.ky = pos.y || 0
  step(g, STEP)
  assert.ok(k.stunT > 0, '용암 스턴')
  assert.equal(k.bumpKind, 'magma')
})
