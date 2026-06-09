import { getZodiac } from '../../shared/zodiac.js'

export default function WhackSetup({ roster, onStart, onExit }) {
  return (
    <div className="setup">
      <div className="setup__topbar">
        <button className="btn btn--ghost" onClick={onExit}>
          ← 뒤로
        </button>
        <h2>두더지 잡기 🔨</h2>
        <span style={{ width: 64 }} />
      </div>
      <div className="setup__panel">
        <p className="setup__label">두더지를 빨리 잡아요! 🐹</p>
        <ul className="dobble-rules">
          <li>내 칸에 <b>두더지가 뿅</b> 나오면 얼른 톡!</li>
          <li>30초 동안 <b>제일 많이 잡은 사람</b>이 우승!</li>
        </ul>
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
        <button className="btn btn--primary" onClick={onStart}>
          시작! 🔨
        </button>
      </div>
    </div>
  )
}
