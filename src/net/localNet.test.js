import test from 'node:test'
import assert from 'node:assert/strict'
import { createLocalNet } from './localNet.js'
import { decodeSnapshot } from './realtime/codec.js'
import { riftNet } from '../games/rift/netgame.js'

// 로컬(오프라인) net: 서버 없이 시뮬+스냅샷 방송이 온라인과 같은 계약으로 도는지.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function soloNet() {
  return createLocalNet(riftNet, {
    players: [{ id: 'solo', name: '나', zodiacId: 'tiger', deviceId: 'solo' }],
    config: { mode: '3v3', teams: { solo: 'blue' }, classes: { solo: 'warrior' } },
    deviceId: 'solo',
  })
}

test('로컬 net: 봇이 채워진 3v3 스냅샷이 델타 누적 디코드로 흐른다', async () => {
  const net = soloNet()
  try {
    // 내 자리 + 봇 5명 = 6인 로스터
    assert.equal(net.players.length, 6)
    assert.equal(net.players.filter((p) => p.isBot).length, 5)

    const views = []
    let acc = null
    net.subscribeSnapshot((bytes) => {
      acc = decodeSnapshot(acc, bytes) // 클라(useRealtimeGame)와 같은 누적 디코드
      views.push(acc)
    })
    net.rtResync() // 구독 직후 full 요청 — 훅이 하는 것과 동일
    await sleep(250)

    assert.ok(views.length >= 4, `30Hz 방송이 흘러야 한다 (받은 수: ${views.length})`)
    const v = views[views.length - 1]
    assert.equal(v.phase, 'play')
    assert.equal(v.heroes.length, 6)
    assert.ok(v.heroes.some((h) => h.id === 'solo'), '내 영웅이 스냅샷에 있어야 한다')
    // 입력/액션이 소유권(myId)으로 매핑되어 예외 없이 처리된다
    net.rtInput({ mx: 1, mz: 0 })
    net.rtAction({ type: 'cast', slot: 'atk' })
    await sleep(70)
  } finally {
    net.close()
  }
})

test('로컬 net: 일시정지하면 시뮬 시간이 멈추고 paused가 방송된다', async () => {
  const net = soloNet()
  try {
    let acc = null
    net.subscribeSnapshot((bytes) => { acc = decodeSnapshot(acc, bytes) })
    net.rtResync()
    await sleep(150)
    net.rtPause(true)
    await sleep(70)
    const frozen = acc.time
    assert.equal(acc.paused, true)
    await sleep(150)
    assert.equal(acc.time, frozen, '일시정지 중엔 게임 시간이 흐르면 안 된다')
    net.rtPause(false)
    await sleep(150)
    assert.ok(acc.time > frozen, '재개하면 다시 흐른다')
  } finally {
    net.close()
  }
})

test('로컬 net: close 후엔 방송이 멈춘다', async () => {
  const net = soloNet()
  let count = 0
  net.subscribeSnapshot(() => { count++ })
  net.rtResync()
  await sleep(120)
  net.close()
  const at = count
  await sleep(120)
  assert.equal(count, at)
})
