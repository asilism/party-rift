import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRealtimeSession } from './realtime.js'
import { decodeSnapshot } from '../src/net/realtime/codec.js'

function makeRoom() {
  const devices = new Map()
  devices.set('devH', { players: [{ id: 'rat', name: '쥐', zodiacId: 'rat', deviceId: 'devH' }] })
  devices.set('devG', { players: [{ id: 'ox', name: '소', zodiacId: 'ox', deviceId: 'devG' }] })
  return { code: 'ABCD', hostId: 'devH', devices }
}

// 한 기기 입장에서 받은 프레임들을 누적 디코드해 최종 view를 만든다.
function rebuild(frames) {
  let view = null
  for (const bytes of frames) view = decodeSnapshot(view, bytes)
  return view
}

test('카트 세션: 시작 → 바이너리 방송 → 클라 누적 디코드(④+②)', async () => {
  const room = makeRoom()
  const frames = new Map()
  const session = createRealtimeSession('kart', room, (devId, bytes) => {
    if (!frames.has(devId)) frames.set(devId, [])
    frames.get(devId).push(bytes)
  })
  session.begin()
  session.start({})
  await new Promise((r) => setTimeout(r, 220)) // 몇 틱 방송
  session.end()

  for (const devId of ['devH', 'devG']) {
    const view = rebuild(frames.get(devId))
    assert.equal(view.phase, 'play')
    assert.ok(view.karts.length >= 2, '봇 포함 정원까지 채워진다')
    assert.ok(view.karts.some((k) => k.id === 'rat'))
    assert.ok(view.karts.some((k) => k.id === 'ox'))
  }
  // 첫 프레임은 full, 이후는 델타라 더 작아야 한다
  const g = frames.get('devG')
  assert.ok(g.length >= 2)
  assert.ok(g[g.length - 1].length < g[0].length, '델타 프레임이 full보다 작다')
})

test('카트 세션: 이탈한 사람의 카트는 봇이 인계', async () => {
  const room = makeRoom()
  const frames = new Map()
  const session = createRealtimeSession('kart', room, (devId, bytes) => {
    if (!frames.has(devId)) frames.set(devId, [])
    frames.get(devId).push(bytes)
  })
  session.begin()
  session.start({})
  await new Promise((r) => setTimeout(r, 80))
  // 게스트 이탈: 방 명단에서 제거 + 세션에 인계 통지
  room.devices.delete('devG')
  session.takeOver(['ox'])
  await new Promise((r) => setTimeout(r, 80))
  session.end()

  const view = rebuild(frames.get('devH'))
  const ox = view.karts.find((k) => k.id === 'ox')
  assert.ok(ox && ox.isBot === true, '이탈한 ox는 봇이 되어 계속 달린다')
})

test('리프트 세션: 엔진 헤드리스 구동 + 영웅/넥서스 스냅샷', async () => {
  const devices = new Map()
  devices.set('devH', { players: [{ id: 'rat', name: '쥐', zodiacId: 'rat', deviceId: 'devH' }] })
  const room = { code: 'WXYZ', hostId: 'devH', devices }
  const frames = []
  const session = createRealtimeSession('rift', room, (_devId, bytes) => frames.push(bytes))
  session.begin()
  session.start({ teams: { rat: 'blue' }, classes: { rat: 'mage' }, mode: '3v3' })
  await new Promise((r) => setTimeout(r, 200))
  session.end()

  const view = rebuild(frames)
  assert.equal(view.phase, 'play')
  assert.ok(view.heroes.length >= 2, '봇 포함 양 팀이 채워진다')
  assert.ok(view.heroes.some((h) => h.id === 'rat'))
  assert.ok(view.nexus && view.nexus.blue && view.nexus.red)
})
