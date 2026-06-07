import { useState } from 'react'
import GameLobby from './lobby/GameLobby.jsx'
import LadderGame from './games/ladder/LadderGame.jsx'

// 화면 흐름: 로비 → (게임 선택) → 게임
export default function App() {
  const [screen, setScreen] = useState('lobby') // 'lobby' | 'ladder'

  return (
    <div className="app">
      <div className="rotate-hint">
        <div className="rotate-hint__inner">
          <div className="rotate-hint__icon">📱↻</div>
          <p>가로로 돌려서 즐겨주세요</p>
        </div>
      </div>

      {screen === 'lobby' && <GameLobby onPlay={(id) => setScreen(id)} />}
      {screen === 'ladder' && <LadderGame onExit={() => setScreen('lobby')} />}
    </div>
  )
}
