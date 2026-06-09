import { getZodiac } from '../../shared/zodiac.js'

export default function TrafficSetup({ roster, onStart, onExit }) {
  return (
    <div className="setup">
      <div className="setup__topbar">
        <button className="btn btn--ghost" onClick={onExit}>
          ← 뒤로
        </button>
        <h2>신호등 반응 🚦</h2>
        <span style={{ width: 64 }} />
      </div>
      <div className="setup__panel">
        <p className="setup__label">초록불에 제일 빨리! 🟢</p>
        <ul className="dobble-rules">
          <li>불이 <b>빨강 🔴</b>일 땐 기다려요(누르면 부정출발!).</li>
          <li><b>초록 🟢</b>으로 바뀌면 내 버튼을 제일 빨리!</li>
          <li>5판 중 많이 이긴 사람이 우승!</li>
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
          시작! 🚦
        </button>
      </div>
    </div>
  )
}
