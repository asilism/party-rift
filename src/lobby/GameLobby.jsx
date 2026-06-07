import { useState } from 'react'
import { ZODIAC, getZodiac } from '../shared/zodiac.js'
import { sound } from '../shared/sound.js'
import FullscreenButton from '../shared/FullscreenButton.jsx'

// 게임 컬렉션 진입점(로비). 게임이 늘어나면 이 목록에 추가한다.
// minPlayers/maxPlayers 로 참가 인원에 따라 선택 가능 여부를 결정한다.
const GAMES = [
  {
    id: 'ladder',
    title: '사다리 게임',
    emoji: '🎲',
    desc: '주사위를 굴려 먼저 골인!',
    minPlayers: 2,
    maxPlayers: 5,
    ready: true,
  },
  {
    id: 'memory',
    title: '12지신 메모리',
    emoji: '🃏',
    desc: '같은 동물 짝을 많이 찾아요',
    minPlayers: 1,
    maxPlayers: 5,
    ready: true,
  },
  { id: 'soon1', title: '준비 중', emoji: '✨', desc: '곧 추가됩니다', ready: false },
]

const MAX_PLAYERS = 5 // 로비 전체 참가 가능 최대 인원

export default function GameLobby({ roster, setRoster, onPlay }) {
  const [adding, setAdding] = useState(false)
  const [nameInput, setNameInput] = useState('')

  const taken = new Set(roster.map((p) => p.zodiacId))
  const full = roster.length >= MAX_PLAYERS

  function addPlayer(zodiacId) {
    if (taken.has(zodiacId) || full) return
    sound.step()
    const z = getZodiac(zodiacId)
    const name = nameInput.trim() || z.name
    setRoster([...roster, { id: zodiacId, zodiacId, name }])
    setNameInput('')
  }

  function removePlayer(id) {
    sound.unlock()
    setRoster(roster.filter((p) => p.id !== id))
  }

  function reason(g) {
    if (!g.ready) return '준비 중'
    if (roster.length < g.minPlayers) return `${g.minPlayers}명 이상 필요`
    return null
  }

  return (
    <div className="lobby">
      <header className="lobby__header">
        <div className="lobby__titles">
          <h1>🎉 보드게임 파티</h1>
          <p>같이 즐기는 보드/파티게임 모음</p>
        </div>
        <FullscreenButton />
      </header>

      {/* 참가자 관리 */}
      <section className="roster">
        <div className="roster__bar">
          <span className="roster__title">참가자 {roster.length}/{MAX_PLAYERS}</span>
          <button
            className="btn btn--ghost roster__add-btn"
            disabled={full}
            onClick={() => {
              sound.unlock()
              setAdding((v) => !v)
            }}
          >
            {adding ? '닫기' : '+ 참가자 추가'}
          </button>
        </div>

        {roster.length === 0 && !adding && (
          <p className="roster__empty">참가자를 추가해 주세요 (말은 12지신 중에서 골라요)</p>
        )}

        {roster.length > 0 && (
          <div className="roster__list">
            {roster.map((p) => {
              const z = getZodiac(p.zodiacId)
              return (
                <div key={p.id} className="player-chip" style={{ '--z-color': z.color }}>
                  <span className="player-chip__emoji">{z.emoji}</span>
                  <span className="player-chip__name">{p.name}</span>
                  <button
                    className="player-chip__x"
                    aria-label={`${p.name} 빼기`}
                    onClick={() => removePlayer(p.id)}
                  >
                    ✕
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {adding && (
          <div className="roster__add">
            <input
              className="name-input"
              type="text"
              value={nameInput}
              maxLength={6}
              placeholder="이름 (선택)"
              onChange={(e) => setNameInput(e.target.value)}
            />
            <p className="setup__hint">이름을 적고 말을 고르면 추가돼요 (이름 생략 가능)</p>
            <div className="zodiac-grid">
              {ZODIAC.map((z) => {
                const used = taken.has(z.id)
                return (
                  <button
                    key={z.id}
                    className={`zodiac-cell ${used ? 'zodiac-cell--used' : ''}`}
                    style={{ '--z-color': z.color }}
                    disabled={used || full}
                    onClick={() => addPlayer(z.id)}
                  >
                    <span className="zodiac-cell__emoji">{z.emoji}</span>
                    <span className="zodiac-cell__name">{z.name}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </section>

      {/* 게임 목록 */}
      <div className="lobby__grid">
        {GAMES.map((g, i) => {
          const blocked = reason(g)
          return (
            <button
              key={i}
              className={`game-card ${blocked ? 'game-card--disabled' : ''}`}
              disabled={!!blocked}
              onClick={() => !blocked && onPlay(g.id)}
            >
              <span className="game-card__emoji">{g.emoji}</span>
              <span className="game-card__title">{g.title}</span>
              <span className="game-card__desc">{g.desc}</span>
              {g.ready && g.minPlayers != null && (
                <span className="game-card__players">
                  👥 {g.minPlayers}~{g.maxPlayers}명
                </span>
              )}
              {blocked && <span className="game-card__lock">{blocked}</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
