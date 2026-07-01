import { useEffect, useRef } from 'react'
import { createRiftScene } from './scene.js'
import { buildMap } from './map.js'

// 3D 캔버스. 매 프레임 sample()로 최신 뷰(호스트: 실시간 상태,
// 게스트: 스냅샷 보간)를 받아 그린다. React 리렌더와 무관하게 60fps.
// mode(3v3/5v5)가 바뀌면 맞는 크기의 맵으로 장면을 다시 만든다.
export default function Rift3D({ sample, myId, mode = '3v3', hitFx = true }) {
  const canvasRef = useRef(null)
  const sampleRef = useRef(sample)
  sampleRef.current = sample
  const myIdRef = useRef(myId)
  myIdRef.current = myId
  const hitFxRef = useRef(hitFx)
  hitFxRef.current = hitFx
  const sceneRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const scene = createRiftScene(canvas, buildMap(mode))
    sceneRef.current = scene
    scene.setHitFx?.(hitFxRef.current) // 생성 직후 현재 설정 반영
    const holder = canvas.parentElement
    const fit = () => scene.resize(holder.clientWidth, holder.clientHeight)
    const ro = new ResizeObserver(fit)
    ro.observe(holder)
    fit()

    let raf
    const loop = () => {
      raf = requestAnimationFrame(loop)
      const v = sampleRef.current?.()
      if (v?.heroes?.length) scene.render(v, myIdRef.current)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      sceneRef.current = null
      scene.dispose()
    }
  }, [mode])

  // 설정에서 타격 효과를 켜고 끄면 장면을 새로 만들지 않고 즉시 반영(비교하기 쉽게)
  useEffect(() => {
    sceneRef.current?.setHitFx?.(hitFx)
  }, [hitFx])

  return <canvas ref={canvasRef} className="rift__canvas" />
}
