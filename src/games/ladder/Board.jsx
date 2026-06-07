import { tileToCoord } from './engine.js'
import { classifyPlatforms } from './board.config.js'
import { getZodiac } from '../../shared/zodiac.js'

// 칸 중심의 화면상 좌표(%) — HTML 노드/말 배치용. row 0(맨 아래)이 화면 하단에 오도록 반전.
function centerPct(tile, config) {
  const { row, col } = tileToCoord(tile, config.cols)
  return {
    left: ((col + 0.5) / config.cols) * 100,
    top: ((config.rows - 1 - row + 0.5) / config.rows) * 100,
  }
}

// SVG 좌표(viewBox = cols x rows). 컨테이너와 종횡비가 같아 왜곡 없음.
function centerSvg(tile, config) {
  const { row, col } = tileToCoord(tile, config.cols)
  return { x: col + 0.5, y: config.rows - 1 - row + 0.5 }
}

export default function Board({ config, positions, players, activeId }) {
  const goal = config.tileCount
  const { ups, downs } = classifyPlatforms(config)
  const platformByTile = {}
  ups.forEach((p) => (platformByTile[p.from] = 'up'))
  downs.forEach((p) => (platformByTile[p.from] = 'down'))

  // 구불구불 트랙: 1번 → 마지막 칸까지 중심을 잇는 경로
  const trackPath = Array.from({ length: config.tileCount })
    .map((_, i) => {
      const c = centerSvg(i + 1, config)
      return `${i === 0 ? 'M' : 'L'} ${c.x} ${c.y}`
    })
    .join(' ')

  // 같은 칸에 있는 말들 간 오프셋
  const tileOccupants = {}
  players.forEach((p) => {
    const t = positions[p.id]
    ;(tileOccupants[t] = tileOccupants[t] || []).push(p.id)
  })

  return (
    <div className="board" style={{ '--cols': config.cols, '--rows': config.rows }}>
      <svg
        className="board__svg"
        viewBox={`0 0 ${config.cols} ${config.rows}`}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <marker
            id="arrow-up"
            viewBox="0 0 10 10"
            refX="6"
            refY="5"
            markerWidth="4"
            markerHeight="4"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" fill="var(--accent2)" />
          </marker>
          <marker
            id="arrow-down"
            viewBox="0 0 10 10"
            refX="6"
            refY="5"
            markerWidth="4"
            markerHeight="4"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" fill="#ff7b7b" />
          </marker>
        </defs>

        {/* 트랙(길) — 외곽 + 안쪽 두 겹으로 도로 느낌 */}
        <path className="track track--outer" d={trackPath} />
        <path className="track track--inner" d={trackPath} />

        {/* 발판(사다리/미끄럼틀) */}
        {[...ups, ...downs].map((p, i) => {
          const a = centerSvg(p.from, config)
          const b = centerSvg(p.to, config)
          const up = p.to > p.from
          return (
            <line
              key={i}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              className={`plink plink--${up ? 'up' : 'down'}`}
              markerEnd={`url(#arrow-${up ? 'up' : 'down'})`}
            />
          )
        })}
      </svg>

      {/* 칸 노드 */}
      {Array.from({ length: config.tileCount }).map((_, idx) => {
        const tile = idx + 1
        const { left, top } = centerPct(tile, config)
        const kind = platformByTile[tile]
        const isStart = tile === 1
        const isGoal = tile === goal
        return (
          <div
            key={tile}
            className={`node ${kind ? `node--${kind}` : ''} ${
              isStart ? 'node--start' : ''
            } ${isGoal ? 'node--goal' : ''}`}
            style={{ left: `${left}%`, top: `${top}%`, '--cols': config.cols }}
          >
            {isGoal ? (
              <span className="node__goal">🏁</span>
            ) : isStart ? (
              <span className="node__goal">출발</span>
            ) : (
              <span className="node__num">{tile}</span>
            )}
            {kind === 'up' && <span className="node__badge node__badge--up">⬆</span>}
            {kind === 'down' && <span className="node__badge node__badge--down">⬇</span>}
          </div>
        )
      })}

      {/* 말 */}
      {players.map((p) => {
        const tile = positions[p.id]
        const { left, top } = centerPct(tile, config)
        const occ = tileOccupants[tile] || []
        const order = occ.indexOf(p.id)
        const count = occ.length
        const spread = count > 1 ? (order - (count - 1) / 2) * 9 : 0
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
            title={p.name || z?.name}
          >
            <span className="pawn__emoji">{z?.emoji}</span>
          </div>
        )
      })}
    </div>
  )
}
