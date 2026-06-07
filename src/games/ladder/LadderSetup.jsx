import { useState } from 'react'
import { getZodiac } from '../../shared/zodiac.js'
import { sound } from '../../shared/sound.js'

// 보드(칸 수) 선택 화면. 참가자는 로비에서 정하므로 여기선 보드만 고른다.
export default function LadderSetup({ boards, roster, onStart, onExit }) {
  const [boardId, setBoardId] = useState(boards[0].id)
  const board = boards.find((b) => b.id === boardId) || boards[0]

  return (
    <div className="setup">
      <div className="setup__topbar">
        <button className="btn btn--ghost" onClick={onExit}>
          ← 뒤로
        </button>
        <h2>사다리 게임</h2>
        <span style={{ width: 64 }} />
      </div>

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
              <span className="board-choice__desc">1 ~ {b.config.tileCount}칸</span>
            </button>
          ))}
        </div>

        <div className="setup__roster">
          {roster.map((p) => {
            const z = getZodiac(p.zodiacId)
            return (
              <span key={p.id} className="player-chip player-chip--mini" style={{ '--z-color': z.color }}>
                <span className="player-chip__emoji">{z.emoji}</span>
                <span className="player-chip__name">{p.name}</span>
              </span>
            )
          })}
        </div>

        <button className="btn btn--primary" onClick={() => onStart(board.config)}>
          시작! 🎲
        </button>
      </div>
    </div>
  )
}
