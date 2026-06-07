import { getZodiac } from '../../shared/zodiac.js'

// 도블은 실시간 경쟁 + 옵션이 없으므로, 규칙 안내 + 시작 버튼만.
export default function DobbleSetup({ roster, onStart, onExit }) {
  return (
    <div className="setup">
      <div className="setup__topbar">
        <button className="btn btn--ghost" onClick={onExit}>
          ← 뒤로
        </button>
        <h2>도블</h2>
        <span style={{ width: 64 }} />
      </div>

      <div className="setup__panel">
        <p className="setup__label">같은 문양을 먼저 찾아요! 🔍</p>
        <ul className="dobble-rules">
          <li>가운데 카드와 <b>내 카드</b>에는 똑같은 문양이 딱 하나 있어요.</li>
          <li>내 카드에서 그 문양을 <b>먼저 누르면</b> 그 카드를 가져와요(1점)!</li>
          <li>가져온 카드가 <b>내 새 카드</b>가 돼서 문제가 계속 바뀌어요.</li>
          <li><b>틀리면</b> 이번 카드 동안 못 눌러요(패널티).</li>
          <li>가운데 카드를 다 쓰면 <b>가장 많이 모은 사람</b>이 우승!</li>
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
          시작! 🔍
        </button>
      </div>
    </div>
  )
}
