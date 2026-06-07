import { useState } from 'react'
import { DIFFICULTIES } from './board.config.js'
import { getZodiac } from '../../shared/zodiac.js'
import { sound } from '../../shared/sound.js'

// 난이도 선택 화면. 참가자는 로비에서 정하므로 여기선 난이도만 고른다.
export default function MemorySetup({ roster, onStart, onExit }) {
  const [diffId, setDiffId] = useState(DIFFICULTIES[0].id)
  const difficulty = DIFFICULTIES.find((d) => d.id === diffId) || DIFFICULTIES[0]

  return (
    <div className="setup">
      <div className="setup__topbar">
        <button className="btn btn--ghost" onClick={onExit}>
          ← 뒤로
        </button>
        <h2>12지신 메모리</h2>
        <span style={{ width: 64 }} />
      </div>

      <div className="setup__panel">
        <p className="setup__label">난이도를 골라요</p>
        <div className="board-choices">
          {DIFFICULTIES.map((d) => (
            <button
              key={d.id}
              className={`board-choice ${d.id === diffId ? 'is-selected' : ''}`}
              onClick={() => {
                sound.unlock()
                setDiffId(d.id)
              }}
            >
              <span className="board-choice__label">
                {d.emoji} {d.label}
              </span>
              <span className="board-choice__desc">
                {d.pairs}쌍 · {d.pairs * 2}장
              </span>
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

        <button className="btn btn--primary" onClick={() => onStart(difficulty)}>
          시작! 🃏
        </button>
      </div>
    </div>
  )
}
