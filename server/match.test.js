import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMatch, snakeTeamOrder, PICK_MS, draftPickRemainingMs } from './match.js'
import { CLASS_IDS, CLASS_ROLE } from '../src/games/rift/engine.js'

// 결정적 rng(LCG)
function seeded(seed = 1) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000)
}

test('스네이크 픽 순서: 블루1·레드1·레드2·블루2·블루3·레드3', () => {
  assert.deepEqual(snakeTeamOrder(3), ['blue', 'red', 'red', 'blue', 'blue', 'red'])
  assert.deepEqual(snakeTeamOrder(5), ['blue', 'red', 'red', 'blue', 'blue', 'red', 'red', 'blue', 'blue', 'red'])
  // 각 팀 인원 동일
  const o = snakeTeamOrder(5)
  assert.equal(o.filter((t) => t === 'blue').length, 5)
  assert.equal(o.filter((t) => t === 'red').length, 5)
})

test('매치 생성: 3v3 → 6자리, 팀당 3명, 사람+봇 채움, 지신 고유', () => {
  const m = createMatch(['dev-A', 'dev-B'], '3v3', seeded(7))
  assert.equal(m.participants.length, 6)
  assert.equal(m.participants.filter((p) => p.team === 'blue').length, 3)
  assert.equal(m.participants.filter((p) => p.team === 'red').length, 3)
  assert.equal(m.participants.filter((p) => !p.isBot).length, 2)
  const zodi = m.participants.map((p) => p.zodiacId)
  assert.equal(new Set(zodi).size, 6) // 지신 중복 없음
  assert.equal(m.phase, 'draft')
})

test('드래프트: 순서대로 픽, 전체(아군+적군) 직업 중복 금지, 전원 픽 시 완료', () => {
  const m = createMatch(['dev-A', 'dev-B', 'dev-C', 'dev-D', 'dev-E', 'dev-F'], '3v3', seeded(3))
  // 전원 사람 → 픽 순서대로 진행
  let guard = 0
  while (!m.allPicked() && guard++ < 20) {
    const cur = m.currentPicker()
    m.pick(cur.deviceId, m.availableClasses()[0])
  }
  assert.equal(m.allPicked(), true)
  assert.equal(m.currentPicker(), null)
  // 매치 전체에서 직업 중복 없음(팀 무관)
  const all = m.participants.map((p) => p.cls)
  assert.equal(new Set(all).size, all.length)
  assert.ok(all.every((c) => CLASS_IDS.includes(c)))
})

test('픽 검증: 남의 차례 / 이미 고른 직업(전체)은 거부', () => {
  const m = createMatch(['dev-A', 'dev-B', 'dev-C', 'dev-D', 'dev-E', 'dev-F'], '3v3', seeded(11))
  const cur = m.currentPicker()
  const other = m.participants.find((p) => p.deviceId && p.deviceId !== cur.deviceId)
  assert.throws(() => m.pick(other.deviceId, CLASS_IDS[0]), /차례/)
  // 정상 픽 후, 다음 픽커는 팀과 무관하게 이미 고른 직업을 못 고른다
  m.pick(cur.deviceId, CLASS_IDS[0])
  const next = m.currentPicker()
  assert.throws(() => m.pick(next.deviceId, cur.cls), /이미/)
})

test('봇 자동픽: 자리가 봇이면 autoPickCurrent로 채워진다', () => {
  const m = createMatch(['dev-A'], '3v3', seeded(5)) // 1명 + 봇 5
  let guard = 0
  while (!m.allPicked() && guard++ < 20) {
    const cur = m.currentPicker()
    if (cur.isBot) m.autoPickCurrent()
    else m.pick(cur.deviceId, m.availableClasses()[0])
  }
  assert.equal(m.allPicked(), true)
  assert.ok(m.participants.every((p) => p.cls))
})

test('봇 밸런스 픽: 전원 자동픽이면 각 팀이 역할별로 고르게 채워진다', () => {
  // 여러 시드로 돌려 항상 균형 잡히는지 확인
  for (const seed of [1, 2, 3, 5, 8, 13]) {
    const m = createMatch([], '3v3', seeded(seed)) // 전원 봇
    let guard = 0
    while (!m.allPicked() && guard++ < 20) m.autoPickCurrent()
    for (const team of ['blue', 'red']) {
      const roles = m.participants.filter((p) => p.team === team).map((p) => CLASS_ROLE[p.cls])
      // 3자리 → 역할 3종이 모두 달라야(근접·마법·원거리 코어). 한 역할 몰빵 금지.
      assert.equal(new Set(roles).size, 3, `seed ${seed} ${team} roles=${roles}`)
      assert.ok(roles.includes('fighter') && roles.includes('mage') && roles.includes('marksman'),
        `seed ${seed} ${team} 코어 미충족 roles=${roles}`)
    }
  }
})

test('봇 밸런스 픽 5v5: 다섯 분야가 한 명씩(근접·마법·원거리·서폿·정글) — 양 팀 모두', () => {
  // 정글이 2종(암살자·사슬잡이)이라 양 팀 모두 정글러를 가질 수 있다.
  for (const seed of [1, 4, 7, 11]) {
    const m = createMatch([], '5v5', seeded(seed)) // 전원 봇, 팀당 5명
    let guard = 0
    while (!m.allPicked() && guard++ < 30) m.autoPickCurrent()
    for (const team of ['blue', 'red']) {
      const roles = m.participants.filter((p) => p.team === team).map((p) => CLASS_ROLE[p.cls])
      assert.equal(new Set(roles).size, 5, `seed ${seed} ${team} roles=${roles}`)
    }
  }
})

test('이탈: 사람 자리를 봇으로 전환', () => {
  const m = createMatch(['dev-A', 'dev-B'], '3v3', seeded(9))
  const seat = m.seatOf('dev-A')
  assert.equal(seat.isBot, false)
  assert.ok(m.makeBotSeat('dev-A'))
  assert.equal(m.seatOf('dev-A'), null)
  assert.equal(m.participants[seat.seat].isBot, true)
  assert.equal(m.hasHuman(), true) // dev-B 남음
})

test('roster: 플레이 단계용 풀 로스터(엔진 형태)', () => {
  const m = createMatch(['dev-A', 'dev-B', 'dev-C', 'dev-D', 'dev-E', 'dev-F'], '3v3', seeded(2))
  let guard = 0
  while (!m.allPicked() && guard++ < 20) {
    const cur = m.currentPicker()
    m.pick(cur.deviceId, m.availableClasses()[0])
  }
  m.toPlay()
  const roster = m.roster()
  assert.equal(roster.length, 6)
  assert.ok(roster.every((p) => p.id && p.team && p.cls))
  // 사람은 deviceId 보유(입력 소유권), 봇은 없음
  assert.ok(roster.filter((p) => p.deviceId).length === 6 || roster.some((p) => p.deviceId))
})

test('room.devices: 사람 기기만, 엔티티 1개씩', () => {
  const m = createMatch(['dev-A', 'dev-B'], '3v3', seeded(4))
  assert.equal(m.room.devices.size, 2)
  for (const [devId, dev] of m.room.devices) {
    assert.equal(dev.players.length, 1)
    assert.equal(dev.players[0].deviceId, devId)
  }
})

test('PICK_MS 상수 노출', () => {
  assert.equal(typeof PICK_MS, 'number')
})

test('드래프트 픽 잔여시간: 갓 시작한 차례는 항상 풀타임(나중 픽 시간 새던 버그 회귀)', () => {
  const m = createMatch(['dev-A', 'dev-B', 'dev-C', 'dev-D', 'dev-E', 'dev-F'], '3v3', seeded(3))
  const now = 1_000_000

  // 픽 직후 브로드캐스트 재현: index.js가 turnSeat=null로 두고 보낸다(아직 차례 리셋 전).
  // 이때 turnAt이 이전 차례 기준(여기선 18초 경과)이어도 잔여가 새면 안 되고 풀타임이어야 한다.
  const first = m.currentPicker()
  assert.equal(first.isBot, false)
  assert.equal(draftPickRemainingMs(m, null, now - 18_000, now), PICK_MS)

  // 한 명 픽 → 다음(나중) 차례. 여전히 픽 직후엔 풀타임 (← 이게 안 되면 "나중 픽일수록 몇 초")
  m.pick(first.deviceId, m.availableClasses()[0])
  const second = m.currentPicker()
  assert.equal(draftPickRemainingMs(m, null, now - 18_000, now), PICK_MS)

  // 루프가 차례를 리셋한 뒤(turnSeat=현재 픽커, turnAt=지금)에는 정상적으로 줄어든다.
  assert.equal(draftPickRemainingMs(m, second.seat, now, now), PICK_MS)
  assert.equal(draftPickRemainingMs(m, second.seat, now - 5_000, now), PICK_MS - 5_000)
})

test('드래프트 픽 잔여시간: 봇 차례는 null(타이머 바 숨김)', () => {
  const m = createMatch(['dev-A'], '3v3', seeded(5)) // 1 사람 + 5 봇
  let guard = 0
  while (!m.currentPicker()?.isBot && guard++ < 12) {
    const cur = m.currentPicker()
    if (!cur) break
    m.pick(cur.deviceId, m.availableClasses()[0])
  }
  const cur = m.currentPicker()
  assert.ok(cur && cur.isBot)
  assert.equal(draftPickRemainingMs(m, null, 1_000_000, 1_000_000), null)
})
