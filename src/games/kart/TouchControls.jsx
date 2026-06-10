import { useEffect, useRef, useState } from 'react'
import { sound } from '../../shared/sound.js'

export const ITEM_EMOJI = { boost: '🍄', banana: '🍌', bomb: '💣', rocket: '🚀' }

const JOY_RADIUS = 60 // px. 이만큼 끌면 풀 조향
const SLOT_MS = 850 // 아이템 슬롯머신 연출 시간
const SLOT_TICK = 75

// 아이템을 새로 뽑을 때마다(seq 증가) 슬롯머신처럼 이모지가 돌아가다 멈춘다.
// 이미 아이템이 있어도 박스를 다시 먹으면 재추첨되므로 seq로 감지한다.
// 돌아가는 동안 표시할 이모지를 반환 (멈추면 null → 실제 아이템 표시).
function useSlotRoll(item, seq) {
  const [rollEmoji, setRollEmoji] = useState(null)
  const lastSeq = useRef(seq) // 마운트 시점의 seq는 연출 없이 그대로 표시
  useEffect(() => {
    if (!item) {
      lastSeq.current = seq
      setRollEmoji(null)
      return
    }
    if (seq === lastSeq.current) return
    lastSeq.current = seq
    const faces = Object.values(ITEM_EMOJI)
    let i = 0
    const t0 = performance.now()
    setRollEmoji(faces[0])
    const iv = setInterval(() => {
      i++
      if (performance.now() - t0 >= SLOT_MS) {
        clearInterval(iv)
        setRollEmoji(null)
        sound.key() // 당첨!
      } else {
        sound.diceTick()
        setRollEmoji(faces[i % faces.length])
      }
    }, SLOT_TICK)
    return () => clearInterval(iv)
  }, [item, seq])
  return rollEmoji
}

// 주행 조작: 화면 아무 데나 드래그하면 그 자리에 조이스틱이 생기고(조향),
// 오른쪽 아래에 브레이크/아이템 버튼. 출력(가속)은 자동이라 버튼이 없다.
const KEY_LEFT = new Set(['ArrowLeft', 'a', 'A'])
const KEY_RIGHT = new Set(['ArrowRight', 'd', 'D'])

export default function TouchControls({ onSteer, onBrake, onItem, item, itemSeq, disabled }) {
  const [joy, setJoy] = useState(null) // {ox, oy, dx, dy}
  const joyPointer = useRef(null)
  const rollEmoji = useSlotRoll(item, itemSeq || 0)
  const rolling = !!rollEmoji
  const onSteerRef = useRef(onSteer)
  onSteerRef.current = onSteer

  // 키보드 조향: ←/→ 또는 A/D. 조이스틱을 잡고 있으면 조이스틱이 우선.
  useEffect(() => {
    const held = new Set()
    const apply = () => {
      if (joyPointer.current != null) return
      const left = [...held].some((k) => KEY_LEFT.has(k))
      const right = [...held].some((k) => KEY_RIGHT.has(k))
      onSteerRef.current((right ? 1 : 0) - (left ? 1 : 0))
    }
    const down = (e) => {
      if (!KEY_LEFT.has(e.key) && !KEY_RIGHT.has(e.key)) return
      e.preventDefault()
      if (held.has(e.key)) return
      held.add(e.key)
      apply()
    }
    const up = (e) => {
      if (held.delete(e.key)) apply()
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

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
        <span className="kart-btn__icon">🛑</span>
        <small>브레이크</small>
      </button>
      <button
        className={`kart-btn kart-btn--item ${
          rolling ? 'kart-btn--item-rolling' : item ? 'kart-btn--item-ready' : ''
        }`}
        disabled={disabled || !item}
        onPointerDown={() => item && !rolling && onItem()}
        onContextMenu={(e) => e.preventDefault()}
      >
        <span className="kart-btn__icon">
          {rolling ? rollEmoji : item ? ITEM_EMOJI[item] : '🎁'}
        </span>
        <small>아이템</small>
      </button>
    </>
  )
}
