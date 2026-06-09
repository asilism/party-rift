import { getZodiac } from '../../shared/zodiac.js'

export default function RaceSetup({ roster, onStart, onExit }) {
  return (
    <div className="setup">
      <div className="setup__topbar">
        <button className="btn btn--ghost" onClick={onExit}>
          ← 뒤로
        </button>
        <h2>달리기 경주 🏁</h2>
        <span style={{ width: 64 }} />
      </div>

      <div className="setup__panel">
        <p className="setup__label">버튼을 마구 눌러 달려요! 🏃</p>
        <ul className="dobble-rules">
          <li>"출발!" 하면 <b>내 칸을 계속 두드려요.</b></li>
          <li>제일 먼저 <b>결승선 🏁</b>에 닿으면 우승!</li>
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
          시작! 🏁
        </button>
      </div>
    </div>
  )
}
