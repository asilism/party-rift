import { useEffect, useRef } from 'react'
import { createKartScene } from './scene.js'
import { TRACKS, DEFAULT_TRACK_ID } from './track.js'

// 3D 캔버스. 매 프레임 sample()로 최신 뷰(호스트: 실시간 상태,
// 게스트: 스냅샷 보간)를 받아 그린다. React 리렌더와 무관하게 60fps.
// 트랙이 바뀌면(다시하기에서 다른 맵 선택 등) 씬을 새로 만든다.
export default function Kart3D({ sample, myId, trackId }) {
  const canvasRef = useRef(null)
  const sampleRef = useRef(sample)
  sampleRef.current = sample
  const myIdRef = useRef(myId)
  myIdRef.current = myId

  useEffect(() => {
    const canvas = canvasRef.current
    const track = TRACKS[trackId] || TRACKS[DEFAULT_TRACK_ID]
    const scene = createKartScene(canvas, track)
    const holder = canvas.parentElement
    const fit = () => scene.resize(holder.clientWidth, holder.clientHeight)
    const ro = new ResizeObserver(fit)
    ro.observe(holder)
    fit()

    let raf
    const loop = () => {
      raf = requestAnimationFrame(loop)
      const v = sampleRef.current?.()
      if (v?.karts?.length) scene.render(v, myIdRef.current)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      scene.dispose()
    }
  }, [trackId])

  return <canvas ref={canvasRef} className="kart__canvas" />
}
