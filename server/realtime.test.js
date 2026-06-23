import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRealtimeSession } from './realtime.js'
import { decodeSnapshot } from '../src/net/realtime/codec.js'

// 한 기기 입장에서 받은 프레임들을 누적 디코드해 최종 view를 만든다.
function rebuild(frames) {
  let view = null
  for (const bytes of frames) view = decodeSnapshot(view, bytes)
  return view
}

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
