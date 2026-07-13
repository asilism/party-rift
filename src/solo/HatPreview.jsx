import { useEffect, useRef } from 'react'
import { createHeroShowcase } from '../games/rift/scene.js'

// 꾸미기 미리보기 — 쇼케이스 무대를 재사용하되 모션 없이 서 있기만 한다(모자 감상용).
// hat이 바뀔 때마다 무대를 새로 올린다(파츠가 정적 자식이라 리마운트가 가장 확실).
export default function HatPreview({ cls, zodiacId, hat }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const stage = createHeroShowcase(canvas, { cls, zodiacId, hat })
    const holder = canvas.parentElement
    const fit = () => stage.resize(holder.clientWidth, holder.clientHeight)
    const ro = new ResizeObserver(fit)
    ro.observe(holder)
    fit()
    return () => {
      ro.disconnect()
      stage.dispose()
    }
  }, [cls, zodiacId, hat])

  return (
    <div className="hat-preview__holder">
      <canvas ref={canvasRef} />
    </div>
  )
}
