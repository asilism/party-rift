import { useState } from 'react'
import { ZODIAC } from '../../shared/zodiac.js'
import { sound } from '../../shared/sound.js'

// 보드 선택 → 인원 수 선택 → 각자 12지신 말 선택(선택 순서 = 턴 순서, 중복 불가)
export default function PlayerSetup({ boards, onStart, onExit }) {
  const [boardId, setBoardId] = useState(boards[0].id)
  const board = boards.find((b) => b.id === boardId) || boards[0]
  const config = board.config
  const [count, setCount] = useState(config.minPlayers)
  const [picks, setPicks] = useState([]) // [{ id, zodiacId, name }]
  const [phase, setPhase] = useState('board') // 'board' | 'count' | 'pick'
  const [nameInput, setNameInput] = useState('')

  const taken = new Set(picks.map((p) => p.zodiacId))
  const currentPlayer = picks.length + 1

  function changeCount(delta) {
    sound.unlock()
    setCount((c) =>
      Math.min(config.maxPlayers, Math.max(config.minPlayers, c + delta))
    )
  }

  function pickZodiac(zodiacId) {
    if (taken.has(zodiacId)) return
    sound.step()
    const name = nameInput.trim() || `${currentPlayer}번`
    const next = [...picks, { id: `p${picks.length + 1}`, zodiacId, name }]
    setPicks(next)
    setNameInput('')
    if (next.length >= count) onStart(next, config)
  }

  function undo() {
    setPicks((p) => p.slice(0, -1))
    setNameInput('')
  }

  return (
    <div className="setup">
      <div className="setup__topbar">
        <button className="btn btn--ghost" onClick={onExit}>
          ← 뒤로
        </button>
        <h2>사다리 게임</h2>
        <span style={{ width: 64 }} />
      </div>

      {phase === 'board' && (
        <div className="setup__panel">
          <p className="setup__label">어떤 보드로 할까요?</p>
          <div className="board-choices">
            {boards.map((b) => (
              <button
                key={b.id}
                className={`board-choice ${b.id === boardId ? 'is-selected' : ''}`}
                onClick={() => {
                  sound.unlock()
                  setBoardId(b.id)
                }}
              >
                <span className="board-choice__label">{b.label}</span>
                <span className="board-choice__desc">
                  1 ~ {b.config.tileCount}칸
                </span>
              </button>
            ))}
          </div>
          <button className="btn btn--primary" onClick={() => setPhase('count')}>
            다음 →
          </button>
        </div>
      )}

      {phase === 'count' && (
        <div className="setup__panel">
          <p className="setup__label">몇 명이서 할까요?</p>
          <div className="counter">
            <button className="counter__btn" onClick={() => changeCount(-1)}>
              −
            </button>
            <span className="counter__value">{count}</span>
            <button className="counter__btn" onClick={() => changeCount(1)}>
              ＋
            </button>
          </div>
          <p className="setup__hint">
            {config.minPlayers}~{config.maxPlayers}명
          </p>
          <button className="btn btn--primary" onClick={() => setPhase('pick')}>
            말 고르기 →
          </button>
        </div>
      )}

      {phase === 'pick' && (
        <div className="setup__panel">
          <p className="setup__label">
            <b>{currentPlayer}번 플레이어</b> ({picks.length}/{count})
          </p>
          <input
            className="name-input"
            type="text"
            value={nameInput}
            maxLength={6}
            placeholder={`이름 (선택) · 예: ${currentPlayer}번`}
            onChange={(e) => setNameInput(e.target.value)}
          />
          <p className="setup__hint">이름을 적고 말을 고르세요 (이름은 생략 가능)</p>
          <div className="zodiac-grid">
            {ZODIAC.map((z) => {
              const used = taken.has(z.id)
              const owner = picks.findIndex((p) => p.zodiacId === z.id)
              return (
                <button
                  key={z.id}
                  className={`zodiac-cell ${used ? 'zodiac-cell--used' : ''}`}
                  style={{ '--z-color': z.color }}
                  disabled={used}
                  onClick={() => pickZodiac(z.id)}
                >
                  <span className="zodiac-cell__emoji">{z.emoji}</span>
                  <span className="zodiac-cell__name">{z.name}</span>
                  {used && <span className="zodiac-cell__badge">{owner + 1}P</span>}
                </button>
              )
            })}
          </div>
          {picks.length > 0 && (
            <button className="btn btn--ghost" onClick={undo}>
              ↶ 한 명 취소
            </button>
          )}
        </div>
      )}
    </div>
  )
}
