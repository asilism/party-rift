import { useMemo } from 'react'
import { TRACKS, DEFAULT_TRACK_ID } from './track.js'

// 우측 상단 미니맵: 트랙 모양(SVG path) 위에 카트 위치를 점으로 표시.
// 월드 좌표(x, z)를 그대로 viewBox에 쓰므로 변환 계산이 없다.
export default function MiniMap({ karts, myId, trackId }) {
  const track = TRACKS[trackId] || TRACKS[DEFAULT_TRACK_ID]
  const { d, viewBox, startX, startZ } = useMemo(() => {
    const pts = track.samples.filter((_, i) => i % 4 === 0)
    const xs = pts.map((p) => p.x)
    const zs = pts.map((p) => p.z)
    const pad = track.halfW + 6
    const minX = Math.min(...xs) - pad
    const minZ = Math.min(...zs) - pad
    const w = Math.max(...xs) + pad - minX
    const h = Math.max(...zs) + pad - minZ
    return {
      d: `M ${pts.map((p) => `${p.x.toFixed(1)} ${p.z.toFixed(1)}`).join(' L ')} Z`,
      viewBox: `${minX.toFixed(1)} ${minZ.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}`,
      startX: track.samples[0].x,
      startZ: track.samples[0].z,
    }
  }, [track])

  return (
    <svg className="kart-minimap" viewBox={viewBox}>
      <path
        d={d}
        fill="none"
        stroke="rgba(15, 20, 35, 0.75)"
        strokeWidth={track.halfW * 2 + 7}
        strokeLinejoin="round"
      />
      <path
        d={d}
        fill="none"
        stroke="rgba(220, 226, 240, 0.85)"
        strokeWidth={track.halfW * 2}
        strokeLinejoin="round"
      />
      <circle cx={startX} cy={startZ} r={4.5} fill="#ffcf4d" stroke="#1a1a1a" strokeWidth={1.5} />
      {karts.map((k) => {
        const mine = k.id === myId
        return (
          <circle
            key={k.id}
            cx={k.x}
            cy={k.z}
            r={mine ? 9 : 6.5}
            fill={k.color || '#fff'}
            stroke={mine ? '#ffffff' : 'rgba(0, 0, 0, 0.45)'}
            strokeWidth={mine ? 3 : 1.5}
          />
        )
      })}
    </svg>
  )
}
