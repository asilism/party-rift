import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMatch, snakeTeamOrder, PICK_MS } from './match.js'
import { CLASS_IDS } from '../src/games/rift/engine.js'

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

test('드래프트: 순서대로 픽, 같은 팀 직업 중복 금지, 전원 픽 시 완료', () => {
  const m = createMatch(['dev-A', 'dev-B', 'dev-C', 'dev-D', 'dev-E', 'dev-F'], '3v3', seeded(3))
  // 전원 사람 → 픽 순서대로 진행
  let guard = 0
  while (!m.allPicked() && guard++ < 20) {
    const cur = m.currentPicker()
    const avail = m.availableClasses(cur.team)
    m.pick(cur.deviceId, avail[0])
  }
  assert.equal(m.allPicked(), true)
  assert.equal(m.currentPicker(), null)
  // 각 팀 직업 중복 없음
  for (const team of ['blue', 'red']) {
    const cls = m.participants.filter((p) => p.team === team).map((p) => p.cls)
    assert.equal(new Set(cls).size, cls.length)
    assert.ok(cls.every((c) => CLASS_IDS.includes(c)))
  }
})

test('픽 검증: 남의 차례/중복 직업은 거부', () => {
  const m = createMatch(['dev-A', 'dev-B', 'dev-C', 'dev-D', 'dev-E', 'dev-F'], '3v3', seeded(11))
  const cur = m.currentPicker()
  const other = m.participants.find((p) => p.deviceId && p.deviceId !== cur.deviceId)
  assert.throws(() => m.pick(other.deviceId, CLASS_IDS[0]), /차례/)
  // 정상 픽 후, 같은 팀원이 같은 직업 고르려 하면 거부
  m.pick(cur.deviceId, CLASS_IDS[0])
  // cur.team의 다음 픽 차례를 찾아 같은 직업 시도
  let next = m.currentPicker()
  while (next && next.team !== cur.team) {
    m.pick(next.deviceId, m.availableClasses(next.team)[0])
    next = m.currentPicker()
  }
  if (next) assert.throws(() => m.pick(next.deviceId, cur.cls), /이미 고른/)
})

test('봇 자동픽: 자리가 봇이면 autoPickCurrent로 채워진다', () => {
  const m = createMatch(['dev-A'], '3v3', seeded(5)) // 1명 + 봇 5
  let guard = 0
  while (!m.allPicked() && guard++ < 20) {
    const cur = m.currentPicker()
    if (cur.isBot) m.autoPickCurrent()
    else m.pick(cur.deviceId, m.availableClasses(cur.team)[0])
  }
  assert.equal(m.allPicked(), true)
  assert.ok(m.participants.every((p) => p.cls))
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
    m.pick(cur.deviceId, m.availableClasses(cur.team)[0])
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
