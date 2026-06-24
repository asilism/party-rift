// 온라인 방 WebSocket 클라이언트.
// 서버 메시지(room/state/action/error/closed)를 구독자에게 전달하는 얇은 래퍼.
// React 쪽은 RoomContext가 이걸 감싸서 상태로 노출한다.

const DEVICE_KEY = 'bgp.deviceId.v1'

// 기기 식별자: 한 번 만들어 localStorage에 보관 → 새로고침해도 같은 기기로 인식
export function getDeviceId() {
  try {
    let id = localStorage.getItem(DEVICE_KEY)
    if (!id) {
      id = `dev-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`
      localStorage.setItem(DEVICE_KEY, id)
    }
    return id
  } catch {
    return `dev-${Math.random().toString(36).slice(2, 10)}`
  }
}

// 서버 주소: 같은 호스트의 /ws (개발 중엔 vite가 8787로 프록시)
export function wsUrl() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${location.host}/ws`
}

export function createRoomClient({ url = wsUrl(), deviceId = getDeviceId() } = {}) {
  let ws = null
  let closedByUser = false
  const listeners = new Map() // type -> Set<fn>

  const emit = (type, payload) => {
    const set = listeners.get(type)
    if (set) [...set].forEach((fn) => fn(payload))
  }

  function connect() {
    closedByUser = false
    // 소켓을 지역 변수로 캡처 → 재연결로 교체된 "옛 소켓"의 이벤트는 무시(가짜 disconnect 방지).
    const sock = new WebSocket(url)
    ws = sock
    sock.binaryType = 'arraybuffer' // 실시간 스냅샷은 바이너리 프레임으로 온다
    sock.onopen = () => {
      if (sock !== ws) return
      send({ t: 'hello', deviceId })
      emit('open')
    }
    sock.onmessage = (ev) => {
      if (sock !== ws) return
      // 바이너리 프레임 = 실시간 게임 스냅샷(델타/full). JSON 파싱하지 않고 그대로 넘긴다.
      if (typeof ev.data !== 'string') {
        emit('rt', new Uint8Array(ev.data))
        return
      }
      let msg
      try {
        msg = JSON.parse(ev.data)
      } catch {
        return
      }
      emit(msg.t, msg)
    }
    sock.onclose = () => {
      if (sock !== ws) return // 재연결로 교체된 옛 소켓 → 무시
      if (!closedByUser) emit('disconnect')
    }
    sock.onerror = () => {}
  }

  function send(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
  }

  function close() {
    closedByUser = true
    try {
      ws?.close()
    } catch {
      /* 무시 */
    }
  }

  function on(type, fn) {
    if (!listeners.has(type)) listeners.set(type, new Set())
    listeners.get(type).add(fn)
    return () => listeners.get(type)?.delete(fn)
  }

  return {
    deviceId,
    connect,
    close,
    on,
    // 매치메이킹 큐 / 드래프트
    joinQueue: (mode) => send({ t: 'queue', mode }),
    leaveQueue: () => send({ t: 'leaveQueue' }),
    startNow: () => send({ t: 'startNow' }),
    pick: (classId) => send({ t: 'pick', classId }),
    leaveMatch: () => send({ t: 'leaveMatch' }),
    // 실시간 게임(④ 서버 권위) — 서버가 시뮬을 주도하므로 입력/액션만 보낸다
    rtInput: (input) => send({ t: 'rtInput', input }),
    rtAction: (action) => send({ t: 'rtAction', action }),
    rtResync: () => send({ t: 'rtResync' }),
  }
}
