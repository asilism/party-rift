import { useEffect, useRef } from 'react'
import { createRiftScene } from './scene.js'
import { buildMap } from './map.js'

// 3D 캔버스. 매 프레임 sample()로 최신 뷰(호스트: 실시간 상태,
// 게스트: 스냅샷 보간)를 받아 그린다. React 리렌더와 무관하게 60fps 상한
// (120Hz 기기에서도 60 — 발열·배터리 절약, 아래 FRAME_MS 참조).
// mode(3v3/5v5)가 바뀌면 맞는 크기의 맵으로 장면을 다시 만든다.
export default function Rift3D({ sample, myId, mode = '3v3', hitFx = true, gfx = 'med' }) {
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
    const scene = createRiftScene(canvas, buildMap(mode), gfx)
    sceneRef.current = scene
    scene.setHitFx?.(hitFxRef.current) // 생성 직후 현재 설정 반영
    const holder = canvas.parentElement
    const fit = () => scene.resize(holder.clientWidth, holder.clientHeight)
    const ro = new ResizeObserver(fit)
    ro.observe(holder)
    fit()

    let raf
    // FPS 상한 — 120Hz 폰에서 rAF를 그대로 따라가면 GPU 일이 2배가 되어
    // 화질 이득 없이 발열·배터리만 는다. 그래픽 티어 연동: 상/중 60, 하 30(발열 최소).
    // 1.5ms 여유는 vsync 지터로 프레임을 건너뛰어 캡 아래로 떨어지는 것을 막는 표준 보정.
    const FRAME_MS = 1000 / (gfx === 'low' ? 30 : 60) - 1.5
    let lastT = 0
    const loop = (t) => {
      raf = requestAnimationFrame(loop)
      if (t - lastT < FRAME_MS) return
      lastT = t
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
    // gfx가 바뀌면 렌더러(픽셀레이트·AA)를 새로 만들어야 해서 장면을 재생성한다
  }, [mode, gfx])

  // 설정에서 타격 효과를 켜고 끄면 장면을 새로 만들지 않고 즉시 반영(비교하기 쉽게)
  useEffect(() => {
    sceneRef.current?.setHitFx?.(hitFx)
  }, [hitFx])

  return <canvas ref={canvasRef} className="rift__canvas" />
}
