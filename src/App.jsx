import { lazy, Suspense, useState } from 'react'
import HomeScreen from './lobby/HomeScreen.jsx'
import OnlineLobby from './lobby/OnlineLobby.jsx'
import ErrorBoundary from './shared/ErrorBoundary.jsx'
import { RoomProvider, useRoom } from './net/RoomContext.jsx'

// 파티 리프트 — 단독 게임. three.js(3D)를 쓰므로 게임에 들어갈 때만 내려받는다(번들 분리).
const RiftGame = lazy(() => import('./games/rift/RiftGame.jsx'))

// 리프트는 기기마다 조이스틱이 필요해 온라인 방 전용이다.
//  화면 흐름:  홈(방 만들기/코드 참여) → 온라인 로비(참가자 모으기) → 전투
export default function App() {
  // URL에 ?room=CODE 가 있으면 바로 참여 시도 (초대 링크)
  const [mode, setMode] = useState(() => {
    const code = new URLSearchParams(location.search).get('room')
    return code ? { kind: 'online', intent: { kind: 'join', code: code.toUpperCase() } } : { kind: 'home' }
  })

  // 홈으로 나올 때 초대 코드 쿼리를 지운다 (새로고침 시 재참여 방지)
  function goHome() {
    if (location.search) history.replaceState(null, '', location.pathname)
    setMode({ kind: 'home' })
  }

  return (
    <div className="app">
      <div className="rotate-hint">
        <div className="rotate-hint__inner">
          <div className="rotate-hint__icon">📱↻</div>
          <p>가로로 돌려서 즐겨주세요</p>
        </div>
      </div>

      {mode.kind === 'home' && (
        <HomeScreen
          onCreate={() => setMode({ kind: 'online', intent: { kind: 'create' } })}
          onJoin={(code) => setMode({ kind: 'online', intent: { kind: 'join', code } })}
        />
      )}

      {mode.kind === 'online' && (
        <RoomProvider intent={mode.intent} onLeft={goHome}>
          <OnlineFlow onHome={goHome} />
        </RoomProvider>
      )}
    </div>
  )
}

// 온라인 모드 — 화면(screen)은 방 상태로 서버가 관리하고 호스트가 전환한다.
function OnlineFlow({ onHome }) {
  const { status, room, notice, deviceId, isHost, addPlayer, removePlayer, setScreen, leaveRoom, net } = useRoom()

  if (status === 'connecting') {
    return (
      <div className="net-screen">
        <div className="net-screen__icon">🌐</div>
        <p>서버에 연결하는 중...</p>
        <button className="btn btn--ghost" onClick={onHome}>← 취소</button>
      </div>
    )
  }

  if (status === 'error' || status === 'closed' || !room) {
    return (
      <div className="net-screen">
        <div className="net-screen__icon">😢</div>
        <p>{notice || '방에 연결할 수 없어요.'}</p>
        <button className="btn btn--primary" onClick={onHome}>처음으로</button>
      </div>
    )
  }

  if (room.screen === 'lobby') {
    return (
      <OnlineLobby
        room={room}
        isHost={isHost}
        deviceId={deviceId}
        addPlayer={addPlayer}
        removePlayer={removePlayer}
        setScreen={setScreen}
        onLeave={leaveRoom}
        notice={notice}
      />
    )
  }

  // 전투 중: 호스트의 나가기 → 방 전체가 로비로, 게스트의 나가기 → 방을 떠남
  const onExit = isHost ? () => setScreen('lobby') : leaveRoom
  return (
    <ErrorBoundary key={room.screen} onExit={onExit}>
      {notice && <div className="net-toast net-toast--ingame">{notice}</div>}
      <Suspense
        fallback={
          <div className="net-screen">
            <div className="net-screen__icon">⏳</div>
            <p>전장을 불러오는 중...</p>
          </div>
        }
      >
        <RiftGame roster={room.players} onExit={onExit} net={net} />
      </Suspense>
    </ErrorBoundary>
  )
}
