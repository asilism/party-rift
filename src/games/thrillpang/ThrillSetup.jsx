import { getZodiac } from '../../shared/zodiac.js'

// 옵션 없음(매 라운드 랜덤). 규칙 안내 + 시작.
export default function ThrillSetup({ roster, onStart, onExit }) {
  return (
    <div className="setup">
      <div className="setup__topbar">
        <button className="btn btn--ghost" onClick={onExit}>
          ← 뒤로
        </button>
        <h2>스릴팡 💣</h2>
        <span style={{ width: 64 }} />
      </div>

      <div className="setup__panel">
        <p className="setup__label">폭탄이 터지기 직전에! ⏱️</p>
        <ul className="dobble-rules">
          <li>폭탄 구슬이 굴러가 구멍에 빠지면 <b>펑!</b> 💥</li>
          <li>내 버튼을 눌러 <b>내 구슬을 출발</b>시켜요(조금 늦게 도착해요).</li>
          <li>폭탄보다 <b>늦게 들어가면 0점</b>(펑!).</li>
          <li>폭탄보다 빨랐다면, <b>가장 아슬아슬하게(가까이)</b> 넣은 사람이 최고점!</li>
          <li>5라운드 합산, 점수가 제일 높은 사람 우승.</li>
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
          시작! 💣
        </button>
      </div>
    </div>
  )
}
