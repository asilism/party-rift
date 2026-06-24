import { useEffect, useRef, useState } from 'react'
import { CLASSES, CLASS_IDS } from '../games/rift/engine.js'
import { getZodiac } from '../shared/zodiac.js'
import { sound } from '../shared/sound.js'
import FullscreenButton from '../shared/FullscreenButton.jsx'

const PICK_MS = 10_000 // 사람 픽 제한(서버와 동일)

// 드래프트 화면 — 랜덤 배정된 두 팀, 스네이크 픽 순서로 직업을 고른다.
//  내 차례면 직업 그리드(같은 팀이 고른 직업은 비활성) + 10초 타이머.
export default function DraftScreen({ match, you, onPick, onLeave, notice }) {
  const players = match?.players || []
  const blue = players.filter((p) => p.team === 'blue').sort((a, b) => a.seat - b.seat)
  const red = players.filter((p) => p.team === 'red').sort((a, b) => a.seat - b.seat)

  const me = players.find((p) => p.seat === you) || null
  const current = match?.current // 현재 픽 차례 seat (없으면 전원 완료)
  const isMyTurn = current != null && current === you
  const allPicked = current == null

  const takenByMyTeam = new Set(players.filter((p) => p.team === me?.team && p.cls).map((p) => p.cls))

  // 내 차례 10초 타이머는 로컬에서 부드럽게 줄인다(서버는 차례마다만 스냅샷을 보냄).
  const [remain, setRemain] = useState(PICK_MS)
  const serverRemain = match?.pickRemainingMs
  useEffect(() => {
    if (!isMyTurn) return undefined
    // 차례 시작 시점 기준 데드라인(재접속 시 서버 잔여시간 반영)
    const deadline = performance.now() + (serverRemain != null ? serverRemain : PICK_MS)
    const tick = () => setRemain(Math.max(0, deadline - performance.now()))
    tick()
    const id = setInterval(tick, 100)
    return () => clearInterval(id)
    // 차례(current)가 바뀔 때만 재시작 — serverRemain 변화로는 재시작하지 않는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMyTurn, current])
  const timerPct = Math.max(0, Math.min(100, (remain / PICK_MS) * 100))

  // 내 차례가 열리는 순간 알림음
  const wasMyTurn = useRef(false)
  useEffect(() => {
    if (isMyTurn && !wasMyTurn.current) sound.key?.()
    wasMyTurn.current = isMyTurn
  }, [isMyTurn])

  function pick(classId) {
    if (!isMyTurn || takenByMyTeam.has(classId)) return
    sound.step()
    onPick(classId)
  }

  return (
    <div className="draft">
      <header className="draft__header">
        <div>
          <h1 className="draft__title">⚔️ 캐릭터 드래프트</h1>
          <p className="draft__sub">
            {allPicked ? '전원 픽 완료! 곧 전장이 열려요…' : isMyTurn ? '당신 차례 — 직업을 고르세요!' : '다른 선수가 고르는 중…'}
          </p>
        </div>
        <div className="draft__top-right">
          <button className="btn btn--ghost" onClick={onLeave}>← 나가기</button>
          <FullscreenButton />
        </div>
      </header>

      {notice && <div className="net-toast">{notice}</div>}

      <div className="draft__teams">
        <TeamColumn team="blue" label="블루팀" players={blue} current={current} you={you} />
        <div className="draft__vs">VS</div>
        <TeamColumn team="red" label="레드팀" players={red} current={current} you={you} mirror />
      </div>

      {isMyTurn && (
        <section className="draft__pick">
          <div className="draft__timer">
            <div className="draft__timer-fill" style={{ width: `${timerPct}%` }} />
            <span className="draft__timer-num">{Math.ceil(remain / 1000)}초</span>
          </div>
          <div className="draft__classes">
            {CLASS_IDS.map((id) => {
              const c = CLASSES[id]
              const taken = takenByMyTeam.has(id)
              return (
                <button
                  key={id}
                  className={`draft-class ${taken ? 'is-taken' : ''}`}
                  disabled={taken}
                  onClick={() => pick(id)}
                >
                  <span className="draft-class__icon">{c.icon}</span>
                  <span className="draft-class__name">{c.name}</span>
                  <span className="draft-class__desc">{c.desc}</span>
                  {taken && <span className="draft-class__tag">팀 내 선택됨</span>}
                </button>
              )
            })}
          </div>
        </section>
      )}

      {!isMyTurn && !allPicked && (
        <p className="draft__wait">⏳ {current != null ? '픽을 기다리는 중…' : ''}</p>
      )}
    </div>
  )
}

function TeamColumn({ team, label, players, current, you, mirror }) {
  return (
    <div className={`draft-team draft-team--${team} ${mirror ? 'draft-team--mirror' : ''}`}>
      <div className="draft-team__label">{label}</div>
      <div className="draft-team__slots">
        {players.map((p) => {
          const z = getZodiac(p.zodiacId)
          const c = p.cls ? CLASSES[p.cls] : null
          const isCurrent = p.seat === current
          const mine = p.seat === you
          return (
            <div
              key={p.seat}
              className={`draft-slot ${isCurrent ? 'is-current' : ''} ${mine ? 'is-mine' : ''} ${p.cls ? 'is-done' : ''}`}
              style={{ '--z-color': p.color || z?.color }}
            >
              <span className="draft-slot__avatar">{z?.emoji}</span>
              <span className="draft-slot__info">
                <span className="draft-slot__name">
                  {p.name}
                  {mine && <span className="draft-slot__you">나</span>}
                  {p.isBot && <span className="draft-slot__bot">BOT</span>}
                </span>
                <span className="draft-slot__class">
                  {c ? <>{c.icon} {c.name}</> : isCurrent ? '고르는 중…' : '대기'}
                </span>
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
