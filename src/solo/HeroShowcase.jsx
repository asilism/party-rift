import { useEffect, useRef, useState } from 'react'
import { createHeroShowcase } from '../games/rift/scene.js'
import { CLASSES } from '../games/rift/engine.js'
import { t } from '../shared/i18n.js'

// 캐릭터 쇼케이스 — 배경 없는 투명 무대 위에서 선택한 직업의 전신 모델이
// 이동 → 평타 → 스킬 → 보조 → 궁극 모션을 강제로 반복 재생한다.
// (엔진을 돌리지 않는 순수 연출이라 대상이 필요한 기술도 항상 보인다)

const SEQ = [
  { kind: 'walk', label: '🏃 달리기', dur: 1.6 },
  { kind: 'atk', label: '⚔️ 평타', dur: 1.0 },
  { kind: 'atk', label: '⚔️ 평타', dur: 1.0 },
  { kind: 'skill', slot: 'skill', dur: 1.6 },
  { kind: 'skill2', slot: 'skill2', dur: 1.6 },
  { kind: 'ult', slot: 'ult', dur: 2.2 },
  { kind: 'rest', dur: 1.0 },
]

export default function HeroShowcase({ cls, zodiacId }) {
  const canvasRef = useRef(null)
  const [caption, setCaption] = useState(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const stage = createHeroShowcase(canvas, { cls, zodiacId })
    const holder = canvas.parentElement
    const fit = () => stage.resize(holder.clientWidth, holder.clientHeight)
    const ro = new ResizeObserver(fit)
    ro.observe(holder)
    fit()

    const c = CLASSES[cls]
    let i = 0
    let timer
    const next = () => {
      const step = SEQ[i % SEQ.length]
      i++
      if (step.kind === 'rest') {
        setCaption(null)
      } else {
        stage.play(step.kind)
        const skill = step.slot ? c[step.slot] : null
        setCaption(skill ? `${skill.icon} ${t(skill.name)}` : t(step.label))
      }
      timer = setTimeout(next, step.dur * 1000)
    }
    timer = setTimeout(next, 500)

    return () => {
      clearTimeout(timer)
      ro.disconnect()
      stage.dispose()
    }
  }, [cls, zodiacId])

  return (
    <div className="hero-showcase">
      <canvas ref={canvasRef} className="hero-showcase__canvas" />
      {caption && (
        <span className="hero-showcase__caption" key={caption}>{caption}</span>
      )}
    </div>
  )
}
