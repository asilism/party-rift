import { useEffect, useState } from 'react'
import GameLobby from './lobby/GameLobby.jsx'
import LadderGame from './games/ladder/LadderGame.jsx'
import MemoryGame from './games/memory/MemoryGame.jsx'
import { loadRoster, saveRoster } from './shared/storage.js'

// 화면 흐름: 로비 → (게임 선택) → 게임
// 참가자(roster)는 로비에서 관리하고 모든 게임이 공유한다. [{ id, zodiacId, name }]
// 오프라인 모드: 참가자는 localStorage에 저장돼 새로고침/재방문 시 유지된다.
export default function App() {
  const [screen, setScreen] = useState('lobby') // 'lobby' | 'ladder' | 'memory'
  const [roster, setRoster] = useState(loadRoster) // 저장된 참가자로 초기화

  // 참가자가 바뀔 때마다 로컬에 저장
  useEffect(() => {
    saveRoster(roster)
  }, [roster])

  return (
    <div className="app">
      <div className="rotate-hint">
        <div className="rotate-hint__inner">
          <div className="rotate-hint__icon">📱↻</div>
          <p>가로로 돌려서 즐겨주세요</p>
        </div>
      </div>

      {screen === 'lobby' && (
        <GameLobby roster={roster} setRoster={setRoster} onPlay={(id) => setScreen(id)} />
      )}
      {screen === 'ladder' && <LadderGame roster={roster} onExit={() => setScreen('lobby')} />}
      {screen === 'memory' && <MemoryGame roster={roster} onExit={() => setScreen('lobby')} />}
    </div>
  )
}
