import { LANES, LANE_IDS, WORLD, BUSHES, DRAGON_PIT, BARON_PIT } from './map.js'
import { isHeroVisible, isUnitVisible } from './engine.js'

const TEAM_FILL = { blue: '#4f8cff', red: '#ff6b6b' }
const laneD = (lane) => `M ${LANES[lane].map((p) => `${p.x} ${p.z}`).join(' L ')}`

// 우측 상단 미니맵: 3갈래 레인/타워/넥서스/수풀 위에 영웅·용·바론 위치 표시.
// 내 팀 시야 규칙 그대로 — 안 보이는 적은 미니맵에도 안 찍힌다.
export default function RiftMiniMap({ view, myId }) {
  const pad = 8
  const vb = `${WORLD.minX - pad} ${WORLD.minZ - pad} ${WORLD.maxX - WORLD.minX + pad * 2} ${WORLD.maxZ - WORLD.minZ + pad * 2}`
  const myTeam = view.heroes?.find((h) => h.id === myId)?.team || null
  return (
    <svg className="rift-minimap" viewBox={vb}>
      <rect
        x={WORLD.minX} y={WORLD.minZ}
        width={WORLD.maxX - WORLD.minX} height={WORLD.maxZ - WORLD.minZ}
        rx={10} fill="rgba(20, 50, 24, 0.78)"
      />
      <rect x={-7} y={WORLD.minZ} width={14} height={WORLD.maxZ - WORLD.minZ} fill="rgba(108, 196, 232, 0.4)" />
      {LANE_IDS.map((l) => (
        <path key={l} d={laneD(l)} fill="none" stroke="rgba(217, 199, 154, 0.55)" strokeWidth={9} strokeLinejoin="round" />
      ))}
      {/* 수풀 */}
      {BUSHES.map((b, i) => (
        <circle key={i} cx={b.x} cy={b.z} r={b.r} fill="rgba(47, 125, 61, 0.9)" />
      ))}
      {/* 정글몹/용/바론 */}
      {view.monsters?.map((m) =>
        m.kind === 'wolf'
          ? m.alive && <circle key={m.id} cx={m.x} cy={m.z} r={3} fill="#cfd6e4" />
          : (
            <text
              key={m.id}
              x={m.kind === 'dragon' ? DRAGON_PIT.x : BARON_PIT.x}
              y={(m.kind === 'dragon' ? DRAGON_PIT.z : BARON_PIT.z) + 4}
              fontSize={13} textAnchor="middle"
              opacity={m.alive ? 1 : 0.3}
            >
              {m.kind === 'dragon' ? '🐉' : '👹'}
            </text>
          )
      )}
      {/* 타워/넥서스 */}
      {view.towers?.map((t) => (
        <rect
          key={t.id}
          x={t.x - 3.5} y={t.z - 3.5} width={7} height={7} rx={1.5}
          fill={t.alive ? TEAM_FILL[t.team] : 'rgba(120, 126, 140, 0.5)'}
          stroke="rgba(0,0,0,0.4)" strokeWidth={1}
        />
      ))}
      {['blue', 'red'].map((team) => (
        <circle
          key={team}
          cx={team === 'blue' ? -96 : 96} cy={0} r={6}
          fill={view.nexus?.[team]?.hp > 0 ? TEAM_FILL[team] : 'rgba(120,126,140,0.5)'}
          stroke="#fff" strokeWidth={1.5}
        />
      ))}
      {/* 적 미니언 무리 (시야 안만) */}
      {view.minions?.map((m) =>
        isUnitVisible(view, m, myTeam) ? (
          <circle key={m.id} cx={m.x} cy={m.z} r={1.8} fill={TEAM_FILL[m.team]} opacity={0.8} />
        ) : null
      )}
      {/* 영웅 (시야/수풀 규칙 적용) */}
      {view.heroes?.map((h) => {
        if (h.respawnT > 0) return null
        if (!isHeroVisible(view, h, myTeam)) return null
        const mine = h.id === myId
        return (
          <circle
            key={h.id}
            cx={h.x} cy={h.z} r={mine ? 6 : 4.5}
            fill={TEAM_FILL[h.team]}
            stroke={mine ? '#ffe066' : 'rgba(255,255,255,0.8)'}
            strokeWidth={mine ? 2.5 : 1}
          />
        )
      })}
    </svg>
  )
}
