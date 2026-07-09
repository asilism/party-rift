import { useEffect, useRef } from 'react'
import { createFaceGallery } from '../games/rift/scene.js'

// 개발용 검수 페이지 — 주소에 ?faces 를 붙여 접속.
// 12지신의 인게임 실물(전신 모델 + 얼굴 텍스처)을 한 화면에 진열해
// 얼굴 크기·크롭을 비교한다. 조정은 src/games/rift/zodiacFaces.js 스펙에서.
export default function FaceGallery() {
  const canvasRef = useRef(null)
  useEffect(() => {
    const stage = createFaceGallery(canvasRef.current)
    const holder = canvasRef.current.parentElement
    const fit = () => stage.resize(holder.clientWidth, holder.clientHeight)
    const ro = new ResizeObserver(fit)
    ro.observe(holder)
    fit()
    return () => {
      ro.disconnect()
      stage.dispose()
    }
  }, [])
  return (
    <div className="face-gallery">
      <canvas ref={canvasRef} />
      <p className="face-gallery__hint">🔍 12지신 인게임 실물 비교(?faces) — 얼굴 크기·크롭 검수용 개발 페이지</p>
    </div>
  )
}
