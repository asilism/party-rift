import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createRoomClient } from './RoomClient.js'

// 온라인 매치 상태를 앱 전체에 제공하는 컨텍스트(서버 권위, 매치메이킹 큐 기반).
//  - 서버가 큐 → 드래프트 → 플레이의 전 생애주기를 주도한다.
//  - ws 연결은 앱 수명 내내 단 하나 유지 → 화면 전환에도 끊기지 않고, 재접속 시 진행 복구.
//  - 상태(status): 'connecting' | 'gate' | 'queue' | 'match'
const MatchCtx = createContext(null)

export function useMatch() {
  return useContext(MatchCtx)
}

export function MatchProvider({ children }) {
  const clientRef = useRef(null)
  if (!clientRef.current) clientRef.current = createRoomClient()
  const client = clientRef.current

  const [status, setStatus] = useState('connecting') // 'connecting' | 'gate' | 'queue' | 'match'
  const [queue, setQueue] = useState(null) // { mode, count, target, remainingMs }
  const [match, setMatch] = useState(null) // 드래프트/플레이 스냅샷
  const [you, setYou] = useState(null) // 내 자리(seat)
  const [notice, setNotice] = useState(null)
  const reconnectRef = useRef(null)

  useEffect(() => {
    const offs = [
      client.on('open', () => setNotice(null)),
      client.on('queue', ({ queue }) => {
        setQueue(queue)
        setMatch(null)
        setStatus('queue')
      }),
      client.on('match', ({ match, you }) => {
        setMatch(match)
        if (you != null) setYou(you)
        setQueue(null)
        setStatus('match')
      }),
      client.on('gate', () => {
        setMatch(null)
        setQueue(null)
        setYou(null)
        setStatus('gate')
      }),
      client.on('error', ({ message }) => setNotice(message)),
      client.on('disconnect', () => {
        setNotice('서버와 연결이 끊어졌어요. 다시 연결하는 중...')
        // 자동 재접속 → hello로 진행 중이던 큐/매치를 이어받는다
        clearTimeout(reconnectRef.current)
        reconnectRef.current = setTimeout(() => client.connect(), 1500)
      }),
    ]
    client.connect()
    return () => {
      clearTimeout(reconnectRef.current)
      offs.forEach((off) => off())
      client.close()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client])

  // 안내 토스트 자동 닫기(연결 중 메시지는 유지)
  useEffect(() => {
    if (!notice || status === 'connecting') return
    const t = setTimeout(() => setNotice(null), 2600)
    return () => clearTimeout(t)
  }, [notice, status])

  const value = useMemo(() => {
    // 내 엔티티 id 매핑용 최소 players(racerIdFor가 deviceId로 찾는다)
    const players = (match?.players || []).map((p) => ({
      id: p.zodiacId,
      zodiacId: p.zodiacId,
      deviceId: p.seat === you ? client.deviceId : undefined,
    }))
    return {
      status,
      queue,
      match,
      you,
      notice,
      deviceId: client.deviceId,
      joinQueue: client.joinQueue,
      leaveQueue: client.leaveQueue,
      startNow: client.startNow,
      pick: client.pick,
      leaveMatch: client.leaveMatch,
      // 전투 화면(RiftGame)에 내려줄 실시간 네트워크 핸들
      net:
        match?.phase === 'play'
          ? {
              online: true,
              isHost: false,
              deviceId: client.deviceId,
              players,
              subscribeSnapshot: (fn) => client.on('rt', (bytes) => fn(bytes)),
              rtInput: client.rtInput,
              rtAction: client.rtAction,
              rtResync: client.rtResync,
            }
          : null,
    }
  }, [status, queue, match, you, notice, client])

  return <MatchCtx.Provider value={value}>{children}</MatchCtx.Provider>
}
