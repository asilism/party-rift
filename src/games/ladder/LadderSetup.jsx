import { useState } from 'react'
import { getZodiac } from '../../shared/zodiac.js'
import { sound } from '../../shared/sound.js'

// 보드(칸 수) 선택 화면. 참가자는 로비에서 정하므로 여기선 보드 크기만 고른다.
// 실제 맵(사다리/미끄럼틀/열쇠칸)은 시작할 때마다 새로 생성된다.
export default function LadderSetup({ sizes, roster, onStart, onExit }) {
  const [sizeId, setSizeId] = useState(sizes[0].id)
  const size = sizes.find((s) => s.id === sizeId) || sizes[0]

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
          {sizes.map((s) => (
            <button
              key={s.id}
              className={`board-choice ${s.id === sizeId ? 'is-selected' : ''}`}
              onClick={() => {
                sound.unlock()
                setSizeId(s.id)
              }}
            >
              <span className="board-choice__label">{s.label}</span>
              <span className="board-choice__desc">1 ~ {s.tileCount}칸</span>
            </button>
          ))}
        </div>
        <p className="setup__hint">🗺️ 맵은 시작할 때마다 새로 만들어져요</p>

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

        <button className="btn btn--primary" onClick={() => onStart(size)}>
          시작! 🎲
        </button>
      </div>
    </div>
  )
}
