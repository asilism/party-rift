import { useRef, useState } from 'react'

export const ITEM_EMOJI = { boost: '🍄', banana: '🍌', rocket: '🚀' }

const JOY_RADIUS = 60 // px. 이만큼 끌면 풀 조향

// 주행 조작: 화면 아무 데나 드래그하면 그 자리에 조이스틱이 생기고(조향),
// 오른쪽 아래에 브레이크/아이템 버튼. 출력(가속)은 자동이라 버튼이 없다.
export default function TouchControls({ onSteer, onBrake, onItem, item, disabled }) {
  const [joy, setJoy] = useState(null) // {ox, oy, dx, dy}
  const joyPointer = useRef(null)

  function steerFrom(e, origin) {
    let dx = e.clientX - origin.ox
    let dy = e.clientY - origin.oy
    const len = Math.hypot(dx, dy)
    if (len > JOY_RADIUS) {
      dx = (dx / len) * JOY_RADIUS
      dy = (dy / len) * JOY_RADIUS
    }
    onSteer(Math.max(-1, Math.min(1, dx / JOY_RADIUS)))
    return { ...origin, dx, dy }
  }

  function down(e) {
    if (disabled || joyPointer.current != null) return
    joyPointer.current = e.pointerId
    e.currentTarget.setPointerCapture(e.pointerId)
    setJoy({ ox: e.clientX, oy: e.clientY, dx: 0, dy: 0 })
  }
  function move(e) {
    if (e.pointerId !== joyPointer.current) return
    setJoy((j) => (j ? steerFrom(e, j) : j))
  }
  function up(e) {
    if (e.pointerId !== joyPointer.current) return
    joyPointer.current = null
    setJoy(null)
    onSteer(0)
  }

  return (
    <>
      <div
        className="kart-touch"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      />
      {joy && (
        <div className="kart-joy" style={{ left: joy.ox, top: joy.oy }}>
          <div
            className="kart-joy__stick"
            style={{ transform: `translate(${joy.dx}px, ${joy.dy}px)` }}
          />
        </div>
      )}
      {/* disabled 속성을 쓰면 누른 채 비활성화될 때 release가 막혀
          브레이크가 고착될 수 있다 → 누르기만 막고 떼기는 항상 처리 */}
      <button
        className="kart-btn kart-btn--brake"
        onPointerDown={() => !disabled && onBrake(true)}
        onPointerUp={() => onBrake(false)}
        onPointerLeave={() => onBrake(false)}
        onPointerCancel={() => onBrake(false)}
        onContextMenu={(e) => e.preventDefault()}
      >
        🛑
        <small>브레이크</small>
      </button>
      <button
        className={`kart-btn kart-btn--item ${item ? 'kart-btn--item-ready' : ''}`}
        disabled={disabled || !item}
        onPointerDown={() => item && onItem()}
        onContextMenu={(e) => e.preventDefault()}
      >
        {item ? ITEM_EMOJI[item] : '🎁'}
        <small>아이템</small>
      </button>
    </>
  )
}
