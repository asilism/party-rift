import { useState } from 'react'
import { ZODIAC } from '../../shared/zodiac.js'
import { sound } from '../../shared/sound.js'

// 인원 수 선택 → 각자 12지신 말 선택(선택 순서 = 턴 순서, 중복 불가)
export default function PlayerSetup({ config, onStart, onExit }) {
  const [count, setCount] = useState(config.minPlayers)
  const [picks, setPicks] = useState([]) // [{ id, zodiacId }]
  const [phase, setPhase] = useState('count') // 'count' | 'pick'

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
    const next = [...picks, { id: `p${picks.length + 1}`, zodiacId }]
    setPicks(next)
    if (next.length >= count) onStart(next)
  }

  function undo() {
    setPicks((p) => p.slice(0, -1))
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
            <b>{currentPlayer}번 플레이어</b> 말을 골라요 ({picks.length}/{count})
          </p>
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
