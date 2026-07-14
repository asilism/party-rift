import { useMemo } from 'react'
import { LANE_IDS, buildMap } from './map.js'
import { isHeroVisible, isUnitVisible, SIGHT_RANGE } from './engine.js'

const TEAM_FILL = { blue: '#4f8cff', red: '#ff6b6b' }
const laneD = (map, lane) => `M ${map.LANES[lane].map((p) => `${p.x} ${p.z}`).join(' L ')}`

// 미니맵 전장의 안개: 어두운 사각형을 깔고, 아군 시야 원만큼 구멍을 뚫는다.
// (SVG 마스크 = 흰색이면 어둠이 보이고, 검정이면 가려진다 → 시야 원을 검정으로)
function FogOverlay({ view, myTeam, pad, map }) {
  const { WORLD, NEXUS_POS } = map
  const W = WORLD.maxX - WORLD.minX
  const H = WORLD.maxZ - WORLD.minZ
  const vis = []
  for (const h of view.heroes || []) {
    if (h.team === myTeam && h.respawnT <= 0) vis.push({ x: h.x, z: h.z, r: SIGHT_RANGE })
  }
  for (const m of view.minions || []) {
    if (m.team === myTeam) vis.push({ x: m.x, z: m.z, r: SIGHT_RANGE * 0.75 })
  }
  for (const t of view.towers || []) {
    if (t.team === myTeam && t.alive) vis.push({ x: t.x, z: t.z, r: SIGHT_RANGE * 0.9 })
  }
  vis.push({ x: NEXUS_POS[myTeam].x, z: NEXUS_POS[myTeam].z, r: SIGHT_RANGE }) // 우물
  return (
    <g>
      <defs>
        <mask
          id="rift-fog"
          maskUnits="userSpaceOnUse"
          x={WORLD.minX - pad} y={WORLD.minZ - pad} width={W + pad * 2} height={H + pad * 2}
        >
          <rect x={WORLD.minX} y={WORLD.minZ} width={W} height={H} fill="#fff" />
          {vis.map((c, i) => (
            <circle key={i} cx={c.x} cy={c.z} r={c.r} fill="#000" />
          ))}
        </mask>
      </defs>
      <rect
        x={WORLD.minX} y={WORLD.minZ} width={W} height={H} rx={10}
        fill="rgba(6, 10, 22, 0.82)" mask="url(#rift-fog)"
      />
    </g>
  )
}

// 우측 상단 미니맵: 3갈래 레인/타워/수호석/수풀 위에 영웅·용·이무기 위치 표시.
// 내 팀 시야 규칙 그대로 — 안 보이는 적은 미니맵에도 안 찍힌다.
export default function RiftMiniMap({ view, myId }) {
  const map = useMemo(() => buildMap(view.mode), [view.mode])
  const { WORLD, NEXUS_POS, BUSHES, WALL_LINES, DRAGON_PIT, BARON_PIT } = map
  const pad = 8
  const vb = `${WORLD.minX - pad} ${WORLD.minZ - pad} ${WORLD.maxX - WORLD.minX + pad * 2} ${WORLD.maxZ - WORLD.minZ + pad * 2}`
  const myTeam = view.heroes?.find((h) => h.id === myId)?.team || null
  const abyss = view.mode === 'boss' // 심연 테마 — 3D 씬과 같은 검보라 톤
  return (
    <svg className="rift-minimap" viewBox={vb}>
      <rect
        x={WORLD.minX} y={WORLD.minZ}
        width={WORLD.maxX - WORLD.minX} height={WORLD.maxZ - WORLD.minZ}
        rx={10} fill={abyss ? 'rgba(34, 26, 54, 0.82)' : 'rgba(20, 50, 24, 0.78)'}
      />
      {/* 중앙 강줄기 — 보스전 맵(협곡)엔 강이 없다 */}
      {!abyss && (
        <rect x={-7} y={WORLD.minZ} width={14} height={WORLD.maxZ - WORLD.minZ} fill="rgba(108, 196, 232, 0.4)" />
      )}
      {LANE_IDS.map((l) => (
        <path
          key={l} d={laneD(map, l)} fill="none"
          stroke={abyss ? 'rgba(150, 132, 196, 0.5)' : 'rgba(217, 199, 154, 0.55)'}
          strokeWidth={9} strokeLinejoin="round"
        />
      ))}
      {/* 성벽 */}
      {WALL_LINES.map((w, i) => (
        <line
          key={i}
          x1={w.x1} y1={w.z1} x2={w.x2} y2={w.z2}
          stroke={abyss ? 'rgba(88, 74, 122, 0.95)' : 'rgba(125, 132, 148, 0.95)'}
          strokeWidth={6} strokeLinecap="round"
        />
      ))}
      {/* 수풀 */}
      {BUSHES.map((b, i) => (
        <circle key={i} cx={b.x} cy={b.z} r={b.r} fill={abyss ? 'rgba(88, 56, 140, 0.9)' : 'rgba(47, 125, 61, 0.9)'} />
      ))}
      {/* 전장의 안개: 아군 시야(영웅/병사/타워/우물) 밖 지형은 어둡게 — 3D 화면과 동일 규칙.
          관전(myTeam 없음)이면 안개 없음. 지형 위에만 덮고 랜드마크/유닛은 위에 그려 또렷이 보인다. */}
      {myTeam && <FogOverlay view={view} myTeam={myTeam} pad={pad} map={map} />}
      {/* 정글몹/용/이무기 */}
      {view.monsters?.map((m) =>
        m.kind !== 'dragon' && m.kind !== 'baron'
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
      {/* 타워/수호석 */}
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
          cx={NEXUS_POS[team].x} cy={NEXUS_POS[team].z} r={6}
          fill={view.nexus?.[team]?.hp > 0 ? TEAM_FILL[team] : 'rgba(120,126,140,0.5)'}
          stroke="#fff" strokeWidth={1.5}
        />
      ))}
      {/* 적 병사 무리 (시야 안만) */}
      {view.minions?.map((m) =>
        isUnitVisible(view, m, myTeam) ? (
          <circle key={m.id} cx={m.x} cy={m.z} r={1.8} fill={TEAM_FILL[m.team]} opacity={0.8} />
        ) : null
      )}
      {/* 영웅 (시야/수풀 규칙 적용). 보스전의 보스는 아래 비컨이 따로 그린다 */}
      {view.heroes?.map((h) => {
        if (h.respawnT > 0) return null
        if (view.mode === 'boss' && h.cls?.startsWith('boss_')) return null
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
      {/* 보스전: 보스 위치는 안개를 무시하고 상시 표시 — 소나 핑처럼 퍼지는 맥동 링(삐용삐용).
          링 색은 국면을 따른다(빨강→주황→보라). view.time 기반이라 프레임마다 매끄럽게 돈다 */}
      {view.mode === 'boss' && view.heroes?.filter((h) => h.cls?.startsWith('boss_') && h.respawnT <= 0).map((b) => {
        const ph = b.bossPhase || 1
        const col = ph === 3 ? '#b266ff' : ph === 2 ? '#ff7d2a' : '#ff4d4d'
        const t = view.time || 0
        return (
          <g key={b.id}>
            {[0, 0.7].map((off) => {
              const p = ((t + off) % 1.4) / 1.4 // 0→1 반복 — 퍼지며 사라지는 핑
              return (
                <circle
                  key={off}
                  cx={b.x} cy={b.z} r={5 + 12 * p}
                  fill="none" stroke={col} strokeWidth={2.2}
                  opacity={0.9 * (1 - p)}
                />
              )
            })}
            <circle cx={b.x} cy={b.z} r={6.5} fill={col} stroke="#fff" strokeWidth={1.5} />
            <text x={b.x} y={b.z + 4.5} fontSize={11} textAnchor="middle">
              {{ boss_colossus: '👹', boss_archmage: '🧙', boss_shadow: '👺' }[b.cls] || '👹'}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
