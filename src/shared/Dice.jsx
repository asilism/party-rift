import { useRef, useState } from 'react'
import { sound } from './sound.js'

// 주사위 한 개. 클릭하면 구르는 연출 후 결과를 onResult로 전달한다.
// 실제 숫자는 부모가 넘긴 rollFn()으로 결정(랜덤 로직은 engine에 위치).
const PIPS = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
}

function DieFace({ value }) {
  const active = new Set(PIPS[value] || [])
  return (
    <div className="die__face">
      {Array.from({ length: 9 }).map((_, i) => (
        <span key={i} className={`die__pip ${active.has(i) ? 'on' : ''}`} />
      ))}
    </div>
  )
}

export default function Dice({ disabled, rollFn, onResult }) {
  const [face, setFace] = useState(1)
  const [rolling, setRolling] = useState(false)
  const timer = useRef(null)

  function handleRoll() {
    if (rolling || disabled) return
    sound.unlock()
    const result = rollFn()
    setRolling(true)

    const start = Date.now()
    const duration = 850
    const tick = () => {
      const elapsed = Date.now() - start
      if (elapsed >= duration) {
        clearInterval(timer.current)
        setFace(result)
        setRolling(false)
        onResult(result)
        return
      }
      setFace(1 + Math.floor(Math.random() * 6))
      sound.diceTick()
    }
    timer.current = setInterval(tick, 90)
  }

  return (
    <button
      className={`die ${rolling ? 'die--rolling' : ''}`}
      onClick={handleRoll}
      disabled={disabled || rolling}
      aria-label="주사위 굴리기"
    >
      <DieFace value={face} />
    </button>
  )
}
