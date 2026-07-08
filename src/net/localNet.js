// 조디악 러쉬 — 로컬(오프라인) 실시간 어댑터.
// 서버(server/realtime.js)가 하던 일 — 고정틱 시뮬레이션 + 30Hz 바이너리 스냅샷 방송 —
// 을 같은 어댑터·코덱으로 브라우저 안에서 돌린다. useRealtimeGame/RiftGame 입장에선
// 온라인 net과 모양이 같아서 전투 화면 코드는 한 줄도 바뀌지 않는다.
// (Electron 데스크톱 싱글플레이·봇전 연습 모드의 기반. 멀티는 기존 서버 경로 그대로.)
import { RealtimeSim } from './realtime/sim.js'
import { encodeSnapshot } from './realtime/codec.js'
import { racerIdFor } from './realtime/roster.js'

const BCAST_MS = 33 // 30Hz 방송 — 서버 TICK_MS와 같은 리듬(시뮬 substep은 RealtimeSim이 처리)

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

// players: 사람 참가자(로컬은 보통 1명). 부족 인원은 adapter.buildParticipants가 봇으로 채우거나,
// config.roster로 완성된 로스터를 직접 넘길 수 있다(온라인 드래프트와 같은 계약).
export function createLocalNet(adapter, { players, config, deviceId = 'solo' } = {}) {
  const { players: roster, opts } = adapter.buildParticipants(players, config)
  const sim = new RealtimeSim(adapter, adapter.createGame(roster, opts))
  const myId = racerIdFor(roster, deviceId)

  const subs = new Set()
  let lastView = null // 델타 기준 — null이면 다음 방송은 full
  let paused = false
  let last = now()

  const timer = setInterval(() => {
    const t = now()
    if (!paused) sim.advance(t - last)
    last = t
    if (!subs.size) return
    const view = { ...sim.view(), paused }
    const bytes = encodeSnapshot(lastView, view)
    lastView = view
    for (const fn of subs) fn(bytes)
  }, BCAST_MS)

  return {
    online: true, // 전투 화면 게이트("온라인 방 전용") 통과 — 로컬 권위 시뮬도 "방"이다
    local: true,
    isHost: true,
    deviceId,
    players: roster,
    subscribeSnapshot(fn) {
      subs.add(fn)
      return () => subs.delete(fn)
    },
    rtResync() {
      lastView = null // 다음 방송을 full로 — 늦게 구독해도 안전하게 동기화
    },
    rtInput(input) {
      if (myId) sim.setInput(myId, input)
    },
    rtAction(action) {
      if (myId) sim.applyAction(action, myId)
    },
    rtPause(p) {
      paused = !!p
    },
    getRtt: () => 0, // 로컬은 왕복 지연 없음 — HUD 핑 표시는 0이면 숨겨진다
    close() {
      clearInterval(timer)
      subs.clear()
    },
  }
}
