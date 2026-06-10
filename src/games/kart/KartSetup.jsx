import { getZodiac } from '../../shared/zodiac.js'
import { LAPS } from './engine.js'

// 호스트 전용 시작 화면. 카트는 기기당 1대 — 각 기기의 첫 참가자가 달린다.
// 4명이 안 되면 CPU가 빈자리를 채워서 혼자서도 즐길 수 있다.
export default function KartSetup({ racers, benched, onStart, onExit }) {
  const canStart = racers.length >= 1
  const cpuCount = Math.max(0, 4 - racers.length)

  return (
    <div className="setup">
      <div className="setup__topbar">
        <button className="btn btn--ghost" onClick={onExit}>
          ← 뒤로
        </button>
        <h2>파티 카트 🏎️</h2>
        <span style={{ width: 64 }} />
      </div>

      <div className="setup__panel">
        <p className="setup__label">3D 서킷 {LAPS}랩 아이템 레이싱! 🏁</p>
        <ul className="dobble-rules">
          <li>가속은 <b>자동!</b> 화면을 드래그하면 <b>조이스틱</b>으로 핸들을 꺾어요. (키보드 ←/→ 또는 A/D도 OK)</li>
          <li>🛑 <b>브레이크</b>로 코너를 돌고, 🎁 박스에서 아이템을 얻어요.</li>
          <li>🍄 부스트 · 🍌 바나나 · 💣 폭탄 — 버튼 한 번으로 사용!</li>
          <li>많이 뒤처지면 🚀 <b>추격 로켓</b>이 나와요 — 로켓으로 변신해 슝!</li>
          <li>무지개 <b>가속 발판</b>을 밟으면 순간 가속!</li>
          <li>카트는 <b>기기당 1대</b>: 각 기기의 첫 참가자가 달려요.</li>
          <li>4명이 안 되면 🤖 <b>CPU</b>가 빈자리를 채워요 — 혼자서도 OK!</li>
        </ul>
        <div className="setup__roster">
          {racers.map((p) => {
            const z = getZodiac(p.zodiacId)
            return (
              <span key={p.id} className="player-chip player-chip--mini" style={{ '--z-color': z.color }}>
                <span className="player-chip__emoji">{z.emoji}</span>
                <span className="player-chip__name">{p.name}</span>
              </span>
            )
          })}
          {Array.from({ length: cpuCount }, (_, i) => (
            <span key={`cpu-${i}`} className="player-chip player-chip--mini" style={{ '--z-color': '#8a93ad' }}>
              <span className="player-chip__emoji">🤖</span>
              <span className="player-chip__name">CPU</span>
            </span>
          ))}
          {benched.map((p) => {
            const z = getZodiac(p.zodiacId)
            return (
              <span key={p.id} className="player-chip player-chip--mini" style={{ '--z-color': z.color, opacity: 0.55 }}>
                <span className="player-chip__emoji">{z.emoji}</span>
                <span className="player-chip__name">{p.name} (관전)</span>
              </span>
            )
          })}
        </div>
        {!canStart && (
          <p className="setup__hint">⚠️ 참가자가 1명 이상 있어야 출발할 수 있어요</p>
        )}
        <button className="btn btn--primary" disabled={!canStart} onClick={onStart}>
          출발! 🏎️
        </button>
      </div>
    </div>
  )
}
