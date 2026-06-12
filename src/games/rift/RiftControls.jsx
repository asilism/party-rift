import { useEffect, useRef, useState } from 'react'
import { CLASSES } from './engine.js'

const JOY_RADIUS = 60 // px. 이만큼 끌면 풀 스피드
const ATK_REPEAT_MS = 220 // 공격 버튼을 누르고 있으면 연타해 준다

// 이동 조작: 화면 아무 데나 드래그하면 그 자리에 조이스틱이 생기고(8방향 이동),
// 오른쪽 아래에 기본공격 + 직업 스킬 + 궁극기 버튼 (스킬 이름 표시).
const KEYS = {
  left: new Set(['ArrowLeft', 'a', 'A']),
  right: new Set(['ArrowRight', 'd', 'D']),
  up: new Set(['ArrowUp', 'w', 'W']),
  down: new Set(['ArrowDown', 's', 'S']),
}

// 쿨다운 버튼: 남은 시간 비율만큼 어두운 부채꼴 오버레이 + 스킬 이름
function CdButton({ className, icon, label, cd, cdMax, locked, lockText, onPress, onRelease }) {
  const frac = cdMax > 0 ? Math.max(0, Math.min(1, cd / cdMax)) : 0
  const ready = !locked && frac <= 0
  return (
    <button
      className={`rift-btn ${className} ${ready ? 'rift-btn--ready' : ''}`}
      onPointerDown={() => !locked && onPress?.()}
      onPointerUp={() => onRelease?.()}
      onPointerLeave={() => onRelease?.()}
      onPointerCancel={() => onRelease?.()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span className="rift-btn__icon">{locked ? '🔒' : icon}</span>
      <small>{locked ? lockText : label}</small>
      {!locked && frac > 0 && (
        <span
          className="rift-btn__cd"
          style={{ background: `conic-gradient(rgba(8, 12, 26, 0.78) ${frac * 360}deg, transparent 0deg)` }}
        >
          {Math.ceil(cd)}
        </span>
      )}
    </button>
  )
}

export default function RiftControls({ onMove, onAttack, onSkill, onUlt, me, disabled }) {
  const [joy, setJoy] = useState(null) // {ox, oy, dx, dy}
  const joyPointer = useRef(null)
  const onMoveRef = useRef(onMove)
  onMoveRef.current = onMove
  const onAttackRef = useRef(onAttack)
  onAttackRef.current = onAttack
  const atkTimer = useRef(null)
  const cls = CLASSES[me?.cls] || CLASSES.warrior

  // 키보드: WASD/화살표 이동, Space/J 공격, K 스킬, L 궁극기
  useEffect(() => {
    const held = new Set()
    const apply = () => {
      if (joyPointer.current != null) return
      const v = (set) => ([...held].some((k) => set.has(k)) ? 1 : 0)
      const mx = v(KEYS.right) - v(KEYS.left)
      const mz = v(KEYS.down) - v(KEYS.up)
      const len = Math.hypot(mx, mz) || 1
      onMoveRef.current(mx / len, mz / len)
    }
    const down = (e) => {
      if (e.repeat) return
      if (e.key === ' ' || e.key === 'j' || e.key === 'J') {
        e.preventDefault()
        onAttackRef.current?.()
        return
      }
      if (e.key === 'k' || e.key === 'K') return onSkill?.()
      if (e.key === 'l' || e.key === 'L') return onUlt?.()
      for (const set of Object.values(KEYS)) {
        if (set.has(e.key)) {
          e.preventDefault()
          held.add(e.key)
          apply()
          return
        }
      }
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
  }, [onSkill, onUlt])

  useEffect(() => () => clearInterval(atkTimer.current), [])

  function moveFrom(e, origin) {
    let dx = e.clientX - origin.ox
    let dy = e.clientY - origin.oy
    const len = Math.hypot(dx, dy)
    if (len > JOY_RADIUS) {
      dx = (dx / len) * JOY_RADIUS
      dy = (dy / len) * JOY_RADIUS
    }
    onMove(dx / JOY_RADIUS, dy / JOY_RADIUS)
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
    setJoy((j) => (j ? moveFrom(e, j) : j))
  }
  function up(e) {
    if (e.pointerId !== joyPointer.current) return
    joyPointer.current = null
    setJoy(null)
    onMove(0, 0)
  }

  // 공격 버튼: 누르고 있으면 자동 연타 (아이들 손가락 보호!)
  function atkPress() {
    onAttack()
    clearInterval(atkTimer.current)
    atkTimer.current = setInterval(() => onAttackRef.current?.(), ATK_REPEAT_MS)
  }
  function atkRelease() {
    clearInterval(atkTimer.current)
    atkTimer.current = null
  }

  return (
    <>
      <div
        className="rift-touch"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      />
      {joy && (
        <div className="rift-joy" style={{ left: joy.ox, top: joy.oy }}>
          <div
            className="rift-joy__stick"
            style={{ transform: `translate(${joy.dx}px, ${joy.dy}px)` }}
          />
        </div>
      )}
      <CdButton
        className="rift-btn--ult"
        icon={cls.ult.icon}
        label={cls.ult.name}
        cd={me?.ultCd ?? 0}
        cdMax={cls.ult.cd}
        locked={me?.ultLocked}
        lockText="Lv3 해금"
        onPress={onUlt}
      />
      <CdButton
        className="rift-btn--skill"
        icon={cls.skill.icon}
        label={cls.skill.name}
        cd={me?.skillCd ?? 0}
        cdMax={cls.skill.cd}
        onPress={onSkill}
      />
      <CdButton
        className="rift-btn--atk"
        icon="⚔️"
        label="공격"
        cd={0}
        cdMax={0}
        onPress={atkPress}
        onRelease={atkRelease}
      />
    </>
  )
}
