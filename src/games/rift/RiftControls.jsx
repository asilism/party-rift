import { useEffect, useRef, useState } from 'react'
import { CLASSES, RECALL_TIME, ABILITY_SCALING, powerLabel } from './engine.js'
import { getItem } from './items.js'
import { t } from '../../shared/i18n.js'

// 스킬 한 줄 데미지/회복/보호막 공식 + 현재 수치를 만든다(툴팁용).
//  me.power(주력 스탯)·me.dmgMult(버프 배율)·me.lvl로 실제 값을 계산한다.
function abilityLines(clsId, slot, me) {
  const info = ABILITY_SCALING[clsId]?.[slot]
  if (!info || !me) return []
  const label = t(powerLabel(clsId))
  const power = me.power ?? 0
  const mult = me.dmgMult ?? 1
  const lines = []
  const scale = (base, coef, m) => Math.round((base + coef * power) * m)
  const formula = (base, coef) => (base ? `${base} + ${coef}×${label}` : `${coef}×${label}`)
  if (info.dmg) lines.push(`💥 ${t('피해')} ${formula(info.dmg[0], info.dmg[1])} = ${scale(info.dmg[0], info.dmg[1], mult)}`)
  if (info.dot) {
    const dps = scale(info.dot[0], info.dot[1], mult)
    lines.push(`☠️ ${t('지속피해')} ${formula(info.dot[0], info.dot[1])} = ${dps}/${t('초')} · ${info.dotDur}${t('초')}(${t('총')} ${Math.round(dps * info.dotDur)})`)
  }
  if (info.heal) lines.push(`💚 ${t('회복')} ${formula(info.heal[0], info.heal[1])} = ${scale(info.heal[0], info.heal[1], 1)}`)
  if (info.shield) lines.push(`🛡️ ${t('보호막')} ${formula(info.shield[0], info.shield[1])} = ${scale(info.shield[0], info.shield[1], 1)}`)
  if (info.summon) lines.push(`🐾 ${t('소환수 공격력')} ${formula(info.summon[0], info.summon[1])} = ${scale(info.summon[0], info.summon[1], 1)}${info.count ? ` (×${info.count}${t('마리')})` : ''}`)
  if (info.note) lines.push(`· ${t(info.note)}`)
  return lines
}

const JOY_RADIUS = 60 // px. 이만큼 끌면 풀 스피드
const ATK_REPEAT_MS = 220 // 공격 버튼을 누르고 있으면 연타해 준다

// 이동 조작: 화면 아무 데나 드래그하면 그 자리에 조이스틱이 생기고(8방향 이동).
// 오른쪽 아래: 평타(발바닥 패드) 버튼을 중심으로 스킬들이 호를 그리며 둘러싼다 — 강아지 발바닥 🐾.
// 왼쪽(약함) → 오른쪽/위(강함) 순서: 직업 스킬 → 보조 스킬 → 궁극기 (스킬 이름 표시).
const KEYS = {
  left: new Set(['ArrowLeft', 'a', 'A']),
  right: new Set(['ArrowRight', 'd', 'D']),
  up: new Set(['ArrowUp', 'w', 'W']),
  down: new Set(['ArrowDown', 's', 'S']),
}

// pulse 값이 바뀔 때마다 잠깐(240ms) 눌림 상태를 켜 주는 훅.
// 키보드·게임패드 입력처럼 포인터 이벤트가 없는 조작에서도 버튼 누름 피드백을 보여 준다.
function usePressPulse(pulse, setPressed) {
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; return undefined } // 마운트 시엔 깜빡이지 않음
    setPressed(true)
    const t = setTimeout(() => setPressed(false), 240)
    return () => clearTimeout(t)
  }, [pulse])
}

// 쿨다운 버튼: 남은 시간 비율만큼 어두운 부채꼴 오버레이 + 스킬 이름
// interactive=false면 터치 입력은 막고 쿨다운/상태 표시만 한다(키보드·패드 모드).
// stock != null이면 재고제 스킬(엔지니어 포탑): 갯수 배지를 띄우고, 재고가 있으면
// 쿨다운(다음 재고 충전 시간)이 돌고 있어도 사용 가능한 상태로 표시한다.
function CdButton({ className, icon, label, name, desc, lines, cd, cdMax, locked, lockText, onPress, onRelease, interactive = true, pulse = 0, stock = null }) {
  const frac = cdMax > 0 ? Math.max(0, Math.min(1, cd / cdMax)) : 0
  const ready = !locked && (frac <= 0 || (stock ?? 0) > 0)
  const [pressed, setPressed] = useState(false)
  // 터치 툴팁: 길게(450ms) 누르고 있는 동안만. 탭에는 안 뜬다 — 터치 기기의
  // 눌어붙는 :hover(다른 곳을 누를 때까지 유지)가 툴팁으로 화면을 가리던 문제.
  const [tipOn, setTipOn] = useState(false)
  const tipTimer = useRef(null)
  useEffect(() => () => clearTimeout(tipTimer.current), []) // 언마운트 시 타이머 정리
  usePressPulse(pulse, setPressed)
  const release = () => {
    clearTimeout(tipTimer.current)
    setTipOn(false)
    if (!interactive) return
    if (pressed) setPressed(false)
    onRelease?.()
  }
  return (
    <button
      // 키보드/게임패드 모드에서도 마우스 오버 툴팁은 보이게 한다(클릭 발동만 막음).
      className={`rift-btn ${className} ${ready ? 'rift-btn--ready' : ''} ${pressed ? 'rift-btn--press' : ''} ${tipOn ? 'rift-btn--tip-on' : ''}`}
      style={interactive ? undefined : { opacity: 0.82 }}
      onPointerDown={(e) => {
        if (e.pointerType !== 'mouse') {
          // 잠긴 스킬도 길게 누르면 설명은 읽을 수 있게 — 가드보다 먼저 건다
          clearTimeout(tipTimer.current)
          tipTimer.current = setTimeout(() => setTipOn(true), 450)
        }
        if (!interactive || locked) return
        setPressed(true)
        onPress?.()
      }}
      onPointerUp={release}
      onPointerLeave={release}
      onPointerCancel={release}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span className="rift-btn__icon">{locked ? '🔒' : icon}</span>
      <small>{locked ? lockText : label}</small>
      {!locked && frac > 0 && (
        <span
          className="rift-btn__cd"
          // 재고가 남아 있으면 어둡게 덮지 않고 충전 진행선만 보여 준다 (사용 가능하니까)
          style={{
            background: `conic-gradient(${(stock ?? 0) > 0 ? 'rgba(8, 12, 26, 0.28)' : 'rgba(8, 12, 26, 0.78)'} ${frac * 360}deg, transparent 0deg)`,
          }}
        >
          {(stock ?? 0) > 0 ? '' : Math.ceil(cd)}
        </span>
      )}
      {stock != null && <span className="rift-btn__stock">{stock}</span>}
      {desc && (
        <span className="rift-btn__tip" role="tooltip">
          <b>{icon} {name}{cdMax > 0 ? ` · ${t('쿨')} ${cdMax}${t('초')}` : ''}{locked ? ` (${lockText})` : ''}</b>
          {desc}
          {lines && lines.length > 0 && (
            <span className="rift-btn__tip-stats">
              {lines.map((l, i) => (
                <span key={i}>{l}</span>
              ))}
            </span>
          )}
        </span>
      )}
    </button>
  )
}

// 귀환 버튼: 쿨다운 없이 7초 채널링. 시전 중엔 남은 시간만큼 차오르는 게이지를 보여준다.
// (이동/피격/기절/다른 스킬에 방해받으면 엔진이 취소한다. 다시 누르면 시전 취소)
function RecallButton({ recallT, onPress, interactive = true, pulse = 0 }) {
  const channeling = recallT > 0
  const frac = channeling ? 1 - recallT / RECALL_TIME : 0 // 진행도(0→1)
  const [pressed, setPressed] = useState(false)
  usePressPulse(pulse, setPressed)
  return (
    <button
      className={`rift-btn rift-btn--recall ${channeling ? 'rift-btn--channel-on' : 'rift-btn--ready'} ${pressed ? 'rift-btn--press' : ''}`}
      style={interactive ? undefined : { pointerEvents: 'none', opacity: 0.82 }}
      onPointerDown={() => {
        setPressed(true)
        onPress?.()
      }}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      onPointerCancel={() => setPressed(false)}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span className="rift-btn__icon">🏠</span>
      <small>{channeling ? t('시전중') : t('귀환')}</small>
      {channeling && (
        <span
          className="rift-btn__cd"
          style={{ background: `conic-gradient(rgba(40, 190, 200, 0.85) ${frac * 360}deg, rgba(8, 12, 26, 0.6) 0deg)` }}
        >
          {Math.ceil(recallT)}
        </span>
      )}
    </button>
  )
}

export default function RiftControls({ onMove, onAttack, onSkill, onSkill2, onUlt, onRecall, onUseItem, me, disabled, scheme = 'mobile' }) {
  const [joy, setJoy] = useState(null) // {ox, oy, dx, dy}
  const joyPointer = useRef(null)
  const onMoveRef = useRef(onMove)
  onMoveRef.current = onMove
  const onAttackRef = useRef(onAttack)
  onAttackRef.current = onAttack
  // 키보드 핸들러는 마운트 시 한 번만 등록한다(아래 useEffect [] 의존). 콜백은 ref로 최신화 —
  // 매 렌더마다 새로 만들어지는 onSkill/onUlt를 의존성에 넣으면 effect가 재실행되며
  // 눌린 키 집합(held)이 초기화돼 대각(동시키) 입력이 사라진다.
  const onSkillRef = useRef(onSkill)
  onSkillRef.current = onSkill
  const onSkill2Ref = useRef(onSkill2)
  onSkill2Ref.current = onSkill2
  const onUltRef = useRef(onUlt)
  onUltRef.current = onUlt
  const onRecallRef = useRef(onRecall)
  onRecallRef.current = onRecall
  const disabledRef = useRef(disabled)
  disabledRef.current = disabled
  const atkTimer = useRef(null)
  const cls = CLASSES[me?.cls] || CLASSES.warrior
  // 보유 중인 액티브 아이템(물병/종, 최대 2개) — 슬롯 번호를 들고 있어야 서버 useItem 액션에 넣는다.
  //  키보드/패드 이펙트는 마운트 시 한 번만 등록되므로 ref로 최신 목록을 넘긴다.
  const onUseItemRef = useRef(onUseItem)
  onUseItemRef.current = onUseItem
  const actives = (me?.items || [])
    .map((id, slot) => ({ item: getItem(id), slot }))
    .filter((x) => x.item?.active)
    .slice(0, 2)
  const activesRef = useRef(actives)
  activesRef.current = actives

  const mobile = scheme === 'mobile' // 터치(조이스틱+버튼)로만 조작
  const keyboard = scheme === 'wasd' // WASD/화살표 + 스킬 키
  const gamepad = scheme === 'xbox' // Xbox 컨트롤러(게임패드 API)

  // 키보드·게임패드로 발동할 때도 해당 버튼이 눌리는 피드백을 보여 주기 위한 펄스 카운터.
  // 슬롯별 값이 늘 때마다 그 버튼이 잠깐 깜빡인다.
  const [pulses, setPulses] = useState({})
  const firePulse = (slot) => setPulses((p) => ({ ...p, [slot]: (p[slot] || 0) + 1 }))

  // 키보드: WASD/화살표 이동(대각 포함), L(또는 Space) 평타, H 직업스킬, J 보조스킬, K 궁극기, B 귀환
  // 선택한 조작 방식이 'wasd'일 때만 동작한다.
  useEffect(() => {
    if (!keyboard) return undefined
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
      if (disabledRef.current) return
      if (e.key === ' ' || e.key === 'l' || e.key === 'L') {
        e.preventDefault()
        firePulse('atk')
        onAttackRef.current?.()
        return
      }
      if (e.key === 'h' || e.key === 'H') { firePulse('skill'); return onSkillRef.current?.() }
      if (e.key === 'j' || e.key === 'J') { firePulse('skill2'); return onSkill2Ref.current?.() }
      if (e.key === 'k' || e.key === 'K') { firePulse('ult'); return onUltRef.current?.() }
      if (e.key === 'b' || e.key === 'B') { firePulse('recall'); return onRecallRef.current?.() }
      // 1/2: 액티브 아이템(물병/종) 사용
      if (e.key === '1' || e.key === '2') {
        const a = activesRef.current[Number(e.key) - 1]
        if (a) { firePulse(`item${Number(e.key) - 1}`); onUseItemRef.current?.(a.slot) }
        return
      }
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
      onMoveRef.current(0, 0) // 모드 전환 시 이동 입력 해제
    }
  }, [keyboard])

  // 게임패드(Xbox): 좌 아날로그 스틱 이동(가변 속도), A 평타, X 직업스킬, Y 보조스킬, B 궁극기, ≡(메뉴) 귀환.
  // 표준 매핑 기준 버튼 인덱스 — A:0, B:1, X:2, Y:3, ≡(Start/Menu):9. 평타는 누르고 있으면 연타, 나머지는 누르는 순간(엣지)만.
  // 선택한 조작 방식이 'xbox'일 때만 폴링한다.
  useEffect(() => {
    if (!gamepad) return undefined
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return undefined
    const DEADZONE = 0.18 // 스틱 표류 무시
    const BTN = { atk: 0, skill: 2, skill2: 3, ult: 1, recall: 9, item0: 4, item1: 5 } // A, X, Y, B, ≡, LB, RB
    const prev = {} // 버튼 직전 눌림 상태(라이징 엣지 판정)
    let padMoving = false // 스틱으로 이동 중인가 — idle일 땐 멈춤 신호를 한 번만 보낸다
    let lastAtk = 0
    let raf = 0
    const edge = (gp, idx, fn) => {
      const now = !!gp.buttons[idx]?.pressed
      if (now && !prev[idx]) fn?.()
      prev[idx] = now
    }
    const poll = () => {
      raf = requestAnimationFrame(poll)
      const gp = [...(navigator.getGamepads() || [])].find(Boolean)
      if (!gp) return
      // 좌 스틱 이동: 데드존을 제외하고 0~1로 다시 스케일 → 미세 조작이 부드럽다
      const x = gp.axes[0] || 0
      const y = gp.axes[1] || 0
      const mag = Math.hypot(x, y)
      if (!disabledRef.current && mag > DEADZONE) {
        const s = Math.min(1, (mag - DEADZONE) / (1 - DEADZONE)) / mag
        onMoveRef.current(x * s, y * s)
        padMoving = true
      } else if (padMoving) {
        onMoveRef.current(0, 0) // 중앙 복귀(또는 비활성) 시 한 번만 멈춤 신호
        padMoving = false
      }
      if (disabledRef.current) return // 사망/일시정지 중엔 스킬 입력 무시
      // 평타: 누르고 있으면 연타(엔진 쿨다운이 실제 발동을 제어)
      if (gp.buttons[BTN.atk]?.pressed) {
        const t = performance.now()
        if (t - lastAtk >= ATK_REPEAT_MS) {
          firePulse('atk')
          onAttackRef.current?.()
          lastAtk = t
        }
      }
      edge(gp, BTN.skill, () => { firePulse('skill'); onSkillRef.current?.() })
      edge(gp, BTN.skill2, () => { firePulse('skill2'); onSkill2Ref.current?.() })
      edge(gp, BTN.ult, () => { firePulse('ult'); onUltRef.current?.() })
      edge(gp, BTN.recall, () => { firePulse('recall'); onRecallRef.current?.() })
      // LB/RB: 액티브 아이템(물병/종) 사용
      edge(gp, BTN.item0, () => {
        const a = activesRef.current[0]
        if (a) { firePulse('item0'); onUseItemRef.current?.(a.slot) }
      })
      edge(gp, BTN.item1, () => {
        const a = activesRef.current[1]
        if (a) { firePulse('item1'); onUseItemRef.current?.(a.slot) }
      })
    }
    raf = requestAnimationFrame(poll)
    return () => {
      cancelAnimationFrame(raf)
      onMoveRef.current(0, 0) // 모드 전환 시 이동 입력 해제
    }
  }, [gamepad])

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
    if (e.button != null && e.button > 0) return // 우/중클릭은 무시(컨텍스트 메뉴·오작동 방지)
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
      {/* 드래그 이동 레이어 — 모바일(터치) 모드에서만 활성화 */}
      {mobile && (
        <div
          className="rift-touch"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
        />
      )}
      {mobile && joy && (
        <div className="rift-joy" style={{ left: joy.ox, top: joy.oy }}>
          <div
            className="rift-joy__stick"
            style={{ transform: `translate(${joy.dx}px, ${joy.dy}px)` }}
          />
        </div>
      )}
      {/* 스킬/평타/귀환 버튼은 항상 보여 쿨다운을 알려주되, 터치 입력은 모바일 모드에서만 받는다. */}
      <CdButton
        className="rift-btn--ult"
        icon={cls.ult.icon}
        label={t(cls.ult.name)}
        name={t(cls.ult.name)}
        desc={t(cls.ult.desc)}
        lines={abilityLines(me?.cls, 'ult', me)}
        cd={me?.ultCd ?? 0}
        cdMax={cls.ult.cd}
        locked={me?.ultLocked}
        lockText={t('Lv5 해금')}
        onPress={onUlt}
        interactive={mobile}
        pulse={pulses.ult || 0}
      />
      {cls.skill2 && (
        <CdButton
          className="rift-btn--skill2"
          icon={cls.skill2.icon}
          label={t(cls.skill2.name)}
          name={t(cls.skill2.name)}
          desc={t(cls.skill2.desc)}
          lines={abilityLines(me?.cls, 'skill2', me)}
          cd={me?.skill2Cd ?? 0}
          cdMax={cls.skill2.cd}
          locked={me?.skill2Locked}
          lockText={t('Lv3 해금')}
          onPress={onSkill2}
          interactive={mobile}
          pulse={pulses.skill2 || 0}
        />
      )}
      <CdButton
        className="rift-btn--skill"
        icon={cls.skill.icon}
        label={t(cls.skill.name)}
        name={t(cls.skill.name)}
        desc={t(cls.skill.desc)}
        lines={abilityLines(me?.cls, 'skill', me)}
        cd={me?.skillCd ?? 0}
        cdMax={cls.skill.cd}
        stock={me?.cls === 'engineer' ? me?.turretStock ?? 0 : null}
        onPress={onSkill}
        interactive={mobile}
        pulse={pulses.skill || 0}
      />
      <CdButton
        className="rift-btn--atk"
        icon="⚔️"
        label={t('공격')}
        name={t('기본 공격')}
        desc={t('사거리 안 가장 가까운 적을 자동으로 친다(누르고 있으면 연타)')}
        cd={0}
        cdMax={0}
        onPress={atkPress}
        onRelease={atkRelease}
        interactive={mobile}
        pulse={pulses.atk || 0}
      />
      {/* 액티브 아이템 버튼 (물병/종) — 사면 나타난다. 키보드 1·2, 패드 LB·RB, 모바일 터치. */}
      {actives.map((a, i) => (
        <CdButton
          key={a.item.id}
          className={`rift-btn--item${i}`}
          icon={a.item.icon}
          label={a.item.active.label}
          name={a.item.name}
          desc={`${a.item.desc}${keyboard ? ` (단축키 ${i + 1})` : gamepad ? ` (${i === 0 ? 'LB' : 'RB'})` : ''}`}
          cd={me?.itemCds?.[a.slot] ?? 0}
          cdMax={a.item.active.cd}
          onPress={() => onUseItem?.(a.slot)}
          interactive={mobile}
          pulse={pulses[`item${i}`] || 0}
        />
      ))}
      <RecallButton recallT={me?.recallT ?? 0} onPress={onRecall} interactive={mobile} pulse={pulses.recall || 0} />
    </>
  )
}
