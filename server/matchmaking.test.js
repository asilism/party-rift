import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMatchmaker, WAIT_MS, targetFor } from './matchmaking.js'

test('큐 입장: 첫 입장에 startAt 설정, 스냅샷 카운트/남은시간', () => {
  const mm = createMatchmaker()
  const snap = mm.join('dev-A', '3v3', 1000)
  assert.equal(snap.mode, '3v3')
  assert.equal(snap.count, 1)
  assert.equal(snap.target, 6)
  assert.equal(snap.remainingMs, WAIT_MS)
  // 30초 경과 후 남은시간 줄어듦
  assert.equal(mm.snapshot('3v3', 31000).remainingMs, WAIT_MS - 30000)
})

test('모드 이동: 다른 큐로 옮기면 이전 큐에서 빠진다', () => {
  const mm = createMatchmaker()
  mm.join('dev-A', '3v3', 0)
  mm.join('dev-A', '5v5', 100)
  assert.equal(mm.snapshot('3v3', 100).count, 0)
  assert.equal(mm.snapshot('5v5', 100).count, 1)
  assert.equal(mm.modeOf('dev-A'), '5v5')
})

test('ready: 목표 인원 차면 즉시, 아니면 1분 후', () => {
  const mm = createMatchmaker()
  mm.join('dev-A', '3v3', 0)
  assert.equal(mm.ready('3v3', 0), false)
  assert.equal(mm.ready('3v3', WAIT_MS - 1), false)
  assert.equal(mm.ready('3v3', WAIT_MS), true) // 1분 경과 → 1명만 있어도 ready

  const mm2 = createMatchmaker()
  for (let i = 0; i < targetFor('3v3'); i++) mm2.join(`d${i}`, '3v3', 0)
  assert.equal(mm2.ready('3v3', 0), true) // 목표 인원 즉시 ready
})

test('빈 큐는 ready 아님', () => {
  const mm = createMatchmaker()
  assert.equal(mm.ready('3v3', WAIT_MS * 10), false)
})

test('takeMatch: 목표 인원까지 빼오고 초과분은 큐에 남아 다시 대기', () => {
  const mm = createMatchmaker()
  for (let i = 0; i < 8; i++) mm.join(`d${i}`, '3v3', 0) // 목표 6 초과로 8명
  const ids = mm.takeMatch('3v3', WAIT_MS)
  assert.equal(ids.length, 6)
  assert.deepEqual(ids, ['d0', 'd1', 'd2', 'd3', 'd4', 'd5'])
  const snap = mm.snapshot('3v3', WAIT_MS)
  assert.equal(snap.count, 2) // d6, d7 남음
  assert.equal(snap.remainingMs, WAIT_MS) // 새 창 시작
  assert.equal(mm.modeOf('d6'), '3v3')
  assert.equal(mm.modeOf('d0'), null) // 매치로 빠짐
})

test('leave: 큐에서 제거, 첫 입장자 나가면 startAt 재계산', () => {
  const mm = createMatchmaker()
  mm.join('dev-A', '3v3', 0)
  mm.join('dev-B', '3v3', 5000)
  mm.leave('dev-A')
  assert.equal(mm.snapshot('3v3', 5000).count, 1)
  // 남은 dev-B의 joinAt(5000) 기준 → 남은시간 = WAIT_MS
  assert.equal(mm.snapshot('3v3', 5000).remainingMs, WAIT_MS)
})

test('알 수 없는 모드는 에러', () => {
  const mm = createMatchmaker()
  assert.throws(() => mm.join('dev-A', '9v9', 0), /모드/)
})
