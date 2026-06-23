import { useState } from 'react'
import FullscreenButton from '../shared/FullscreenButton.jsx'
import { sound } from '../shared/sound.js'

// 첫 화면: 방을 만들거나(이 기기가 호스트) 코드로 다른 방에 합류한다.
//  리프트는 기기마다 조이스틱이 필요해 온라인 방 전용이다.
export default function HomeScreen({ onCreate, onJoin, initialCode = '' }) {
  const [joining, setJoining] = useState(!!initialCode)
  const [code, setCode] = useState(initialCode)

  function submitJoin() {
    const c = code.trim().toUpperCase()
    if (c.length < 4) return
    sound.unlock()
    onJoin(c)
  }

  return (
    <div className="lobby home">
      <header className="lobby__header">
        <div className="lobby__titles">
          <h1>⚔️ 파티 리프트</h1>
          <p>3:3 / 5:5 3D 전장 — 타워를 부수고 넥서스를 터뜨려요</p>
        </div>
        <FullscreenButton />
      </header>

      <div className="home__modes">
        <button
          className="mode-card"
          onClick={() => {
            sound.unlock()
            onCreate()
          }}
        >
          <span className="mode-card__emoji">🌐</span>
          <span className="mode-card__title">방 만들기</span>
          <span className="mode-card__desc">코드를 알려주면 친구 기기로 함께!</span>
        </button>

        {/* 코드 입력 폼이 들어가므로 button이 아닌 div (button 중첩 금지) */}
        <div
          className={`mode-card ${joining ? 'is-open' : ''}`}
          role="button"
          tabIndex={0}
          onClick={() => {
            sound.unlock()
            setJoining(true)
          }}
          onKeyDown={(e) => e.key === 'Enter' && !joining && setJoining(true)}
        >
          <span className="mode-card__emoji">🔑</span>
          <span className="mode-card__title">코드로 참여</span>
          {!joining ? (
            <span className="mode-card__desc">친구가 알려준 방 코드 입력</span>
          ) : (
            <span className="mode-card__join" onClick={(e) => e.stopPropagation()}>
              <input
                className="name-input code-input"
                type="text"
                value={code}
                maxLength={4}
                placeholder="코드 4글자"
                autoFocus
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && submitJoin()}
              />
              <button className="btn btn--primary" disabled={code.trim().length < 4} onClick={submitJoin}>
                참여!
              </button>
            </span>
          )}
        </div>
      </div>

      <p className="home__hint">🌐 같은 서버에 접속한 모든 기기에서 한 방에 모일 수 있어요</p>
    </div>
  )
}
