import { useState } from 'react'
import FullscreenButton from '../shared/FullscreenButton.jsx'
import { sound } from '../shared/sound.js'
import logoUrl from '../resources/logo.png'

// 첫 화면: 플레이 방식 선택.
//  - 한 기기로: 기존 핫시트(오프라인) 모드
//  - 방 만들기: 온라인 방 생성(이 기기가 호스트)
//  - 코드로 참여: 다른 기기가 만든 방에 합류
export default function HomeScreen({ onLocal, onCreate, onJoin, initialCode = '' }) {
  const [joining, setJoining] = useState(!!initialCode)
  const [code, setCode] = useState(initialCode)
  const [logoOk, setLogoOk] = useState(true)

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
          {logoOk ? (
            <img className="lobby__logo" src={logoUrl} alt="보드게임 파티" onError={() => setLogoOk(false)} />
          ) : (
            <>
              <h1>🎉 보드게임 파티</h1>
              <p>같이 즐기는 보드/파티게임 모음</p>
            </>
          )}
        </div>
        <FullscreenButton />
      </header>

      <div className="home__modes">
        <button
          className="mode-card"
          onClick={() => {
            sound.unlock()
            onLocal()
          }}
        >
          <span className="mode-card__emoji">📱</span>
          <span className="mode-card__title">한 기기로 놀기</span>
          <span className="mode-card__desc">모두 모여서 번갈아 플레이</span>
        </button>

        <button
          className="mode-card"
          onClick={() => {
            sound.unlock()
            onCreate()
          }}
        >
          <span className="mode-card__emoji">🌐</span>
          <span className="mode-card__title">온라인 방 만들기</span>
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

      <p className="home__hint">🌐 온라인 방은 같은 서버에 접속한 모든 기기에서 참여할 수 있어요</p>
    </div>
  )
}
