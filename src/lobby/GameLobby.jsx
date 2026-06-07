// 게임 컬렉션 진입점(로비). 게임이 늘어나면 이 목록에 추가한다.
const GAMES = [
  {
    id: 'ladder',
    title: '사다리 게임',
    emoji: '🎲',
    desc: '주사위를 굴려 먼저 골인하면 우승!',
    ready: true,
  },
  // 앞으로 추가될 게임들 (placeholder)
  { id: 'soon1', title: '준비 중', emoji: '✨', desc: '곧 추가됩니다', ready: false },
  { id: 'soon2', title: '준비 중', emoji: '✨', desc: '곧 추가됩니다', ready: false },
]

export default function GameLobby({ onPlay }) {
  return (
    <div className="lobby">
      <header className="lobby__header">
        <h1>🎉 보드게임 파티</h1>
        <p>같이 즐기는 보드/파티게임 모음</p>
      </header>
      <div className="lobby__grid">
        {GAMES.map((g, i) => (
          <button
            key={i}
            className={`game-card ${g.ready ? '' : 'game-card--disabled'}`}
            disabled={!g.ready}
            onClick={() => g.ready && onPlay(g.id)}
          >
            <span className="game-card__emoji">{g.emoji}</span>
            <span className="game-card__title">{g.title}</span>
            <span className="game-card__desc">{g.desc}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
