import { tileToCoord } from './engine.js'
import { classifyPlatforms } from './board.config.js'
import { getZodiac } from '../../shared/zodiac.js'

// 칸 중심의 화면상 좌표(%) 계산. row 0(맨 아래)이 화면 하단에 오도록 반전.
function tileCenterPct(tile, config) {
  const { row, col } = tileToCoord(tile, config.cols)
  const left = ((col + 0.5) / config.cols) * 100
  const top = ((config.rows - 1 - row + 0.5) / config.rows) * 100
  return { left, top }
}

export default function Board({ config, positions, players, activeId }) {
  const goal = config.tileCount
  const { ups, downs } = classifyPlatforms(config)
  const platformByTile = {}
  ups.forEach((p) => (platformByTile[p.from] = 'up'))
  downs.forEach((p) => (platformByTile[p.from] = 'down'))

  // 같은 칸에 있는 말들 간 오프셋 계산
  const tileOccupants = {}
  players.forEach((p) => {
    const t = positions[p.id]
    ;(tileOccupants[t] = tileOccupants[t] || []).push(p.id)
  })

  return (
    <div className="board" style={{ '--cols': config.cols, '--rows': config.rows }}>
      {/* 칸 */}
      {Array.from({ length: config.tileCount }).map((_, idx) => {
        const tile = idx + 1
        const { row, col } = tileToCoord(tile, config.cols)
        const gridRow = config.rows - row // 1-based, 맨 위가 1
        const gridCol = col + 1
        const kind = platformByTile[tile]
        const isStart = tile === 1
        const isGoal = tile === goal
        return (
          <div
            key={tile}
            className={`tile ${kind ? `tile--${kind}` : ''} ${
              isStart ? 'tile--start' : ''
            } ${isGoal ? 'tile--goal' : ''}`}
            style={{ gridRow, gridColumn: gridCol }}
          >
            <span className="tile__num">{tile}</span>
            {isStart && <span className="tile__tag">출발</span>}
            {isGoal && <span className="tile__tag">🏁 골</span>}
            {kind === 'up' && <span className="tile__arrow">⬆️</span>}
            {kind === 'down' && <span className="tile__arrow">⬇️</span>}
          </div>
        )
      })}

      {/* 발판 연결선 */}
      <svg className="board__links" viewBox="0 0 100 100" preserveAspectRatio="none">
        {[...ups, ...downs].map((p, i) => {
          const a = tileCenterPct(p.from, config)
          const b = tileCenterPct(p.to, config)
          return (
            <line
              key={i}
              x1={a.left}
              y1={a.top}
              x2={b.left}
              y2={b.top}
              className={`link link--${p.to > p.from ? 'up' : 'down'}`}
            />
          )
        })}
      </svg>

      {/* 말(오버레이) */}
      {players.map((p) => {
        const tile = positions[p.id]
        const { left, top } = tileCenterPct(tile, config)
        const occ = tileOccupants[tile] || []
        const order = occ.indexOf(p.id)
        const count = occ.length
        // 같은 칸 내 가로 분산
        const spread = count > 1 ? (order - (count - 1) / 2) * 7 : 0
        const z = getZodiac(p.zodiacId)
        return (
          <div
            key={p.id}
            className={`pawn ${activeId === p.id ? 'pawn--active' : ''}`}
            style={{
              left: `calc(${left}% + ${spread}px)`,
              top: `${top}%`,
              '--pawn-color': z?.color || '#fff',
            }}
            title={z?.name}
          >
            <span className="pawn__emoji">{z?.emoji}</span>
          </div>
        )
      })}
    </div>
  )
}
