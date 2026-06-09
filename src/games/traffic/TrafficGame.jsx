import { useEffect, useRef, useState } from 'react'
import TrafficSetup from './TrafficSetup.jsx'
import Fireworks from '../../shared/Fireworks.jsx'
import FullscreenButton from '../../shared/FullscreenButton.jsx'
import { createGame, roundWinner, applyRound, winners } from './engine.js'
import { getZodiac } from '../../shared/zodiac.js'
import { sound } from '../../shared/sound.js'

const GO_WINDOW = 2500 // 초록불 후 응답 대기

export default function TrafficGame({ roster, onExit }) {
  const [phase, setPhase] = useState('setup') // 'setup' | 'play'
  const [roundPhase, setRoundPhase] = useState('wait') // 'wait'(빨강) | 'go'(초록) | 'result'
  const [game, setGame] = useState(null)
  const [presses, setPresses] = useState({}) // id -> { ms } | { falseStart:true }
  const [roundWin, setRoundWin] = useState(undefined) // 라운드 승자 id | null
  const [soundOn, setSoundOn] = useState(true)

  const greenRef = useRef(0)
  const pressRef = useRef({})
  const timers = useRef([])
  const gameRef = useRef(null)

  const clearTimers = () => {
    timers.current.forEach(clearTimeout)
    timers.current = []
  }
  useEffect(() => clearTimers, [])

  function startGame() {
    sound.setEnabled(soundOn)
    const players = roster.map((p) => ({
      id: p.id,
      name: p.name,
      zodiacId: p.zodiacId,
      color: getZodiac(p.zodiacId)?.color,
    }))
    const g = createGame(players)
    gameRef.current = g
    setGame(g)
    setPhase('play')
    startRound()
  }

  function startRound() {
    clearTimers()
    pressRef.current = {}
    setPresses({})
    setRoundWin(undefined)
    setRoundPhase('wait')
    const delay = 1400 + Math.random() * 2600 // 빨강 유지 시간
    timers.current.push(
      setTimeout(() => {
        greenRef.current = Date.now()
        setRoundPhase('go')
        sound.ladderUp()
        timers.current.push(setTimeout(() => evaluate(), GO_WINDOW))
      }, delay)
    )
  }

  function press(id) {
    if (roundPhase === 'result') return
    if (pressRef.current[id]) return // 이미 응답
    if (roundPhase === 'wait') {
      pressRef.current = { ...pressRef.current, [id]: { falseStart: true } }
      sound.chuteDown()
    } else {
      pressRef.current = { ...pressRef.current, [id]: { ms: Date.now() - greenRef.current } }
      sound.step()
    }
    setPresses({ ...pressRef.current })
    // 전원 응답하면 즉시 채점
    if (gameRef.current.players.every((p) => pressRef.current[p.id])) evaluate()
  }

  function evaluate() {
    if (roundPhase === 'result') return
    clearTimers()
    const g = gameRef.current
    const entries = g.players.map((p) => {
      const e = pressRef.current[p.id]
      return { id: p.id, ms: e?.ms ?? null, falseStart: !!e?.falseStart }
    })
    const wid = roundWinner(entries)
    setRoundWin(wid)
    const next = applyRound(g, wid)
    gameRef.current = next
    setGame(next)
    setRoundPhase('result')
    if (wid) setTimeout(() => sound.win(), 100)
  }

  function nextRound() {
    if (gameRef.current.status === 'finished') return
    startRound()
  }

  function toggleSound() {
    const n = !soundOn
    setSoundOn(n)
    sound.setEnabled(n)
    if (n) sound.unlock()
  }

  if (phase === 'setup') {
    return <TrafficSetup roster={roster} onStart={startGame} onExit={onExit} />
  }

  const finished = game.status === 'finished'
  const win = finished ? winners(game) : []
  const lightText =
    roundPhase === 'wait' ? '준비…' : roundPhase === 'go' ? '지금 눌러!' : roundWin ? '🏆' : '아무도!'

  return (
    <div className="traffic">
      <div className="ladder__topbar">
        <button className="btn btn--ghost" onClick={onExit}>
          ← 나가기
        </button>
        <div className="turn-indicator">{finished ? '🏁 게임 끝!' : `🚦 ${game.round}/${game.rounds} 판`}</div>
        <div className="topbar__right">
          <button className="btn btn--ghost" onClick={toggleSound} aria-label="소리">
            {soundOn ? '🔊' : '🔇'}
          </button>
          <FullscreenButton />
        </div>
      </div>

      <div className="traffic__main">
        <div className={`traffic-light is-${roundPhase}`}>
          <span className="traffic-light__text">{lightText}</span>
        </div>
      </div>

      <div className="traffic__btns">
        {game.players.map((p) => {
          const z = getZodiac(p.zodiacId)
          const e = presses[p.id]
          const isWin = roundPhase === 'result' && roundWin === p.id
          let label = `${z?.emoji} ${p.name}`
          if (e?.falseStart) label = '❌ 부정출발'
          else if (e?.ms != null) label = `${e.ms}ms`
          if (isWin) label = `🏆 ${p.name}`
          return (
            <button
              key={p.id}
              className={`traffic-btn ${e?.falseStart ? 'is-bad' : ''} ${isWin ? 'is-win' : ''}`}
              style={{ '--z-color': p.color }}
              disabled={roundPhase === 'result' || !!presses[p.id]}
              onPointerDown={() => press(p.id)}
            >
              {label}
            </button>
          )
        })}
      </div>

      {roundPhase === 'result' && !finished && (
        <div className="thrill__next">
          <button className="btn btn--primary" onClick={nextRound}>
            다음 판 →
          </button>
        </div>
      )}

      {finished && (
        <div className="win-modal">
          <Fireworks />
          <div className="win-modal__card" style={{ '--z-color': win[0]?.color }}>
            <div className="win-modal__emoji">🏆</div>
            {win.length > 1 ? (
              <>
                <h2>공동 우승! 🎉</h2>
                <p>{win.map((p) => p.name).join(', ')} · {win[0].score}판</p>
              </>
            ) : (
              <>
                <h2>{win[0]?.name} 우승! 🎉</h2>
                <p>{win[0]?.score}판 이겼어요!</p>
              </>
            )}
            <div className="win-modal__btns">
              <button className="btn btn--primary" onClick={startGame}>
                다시하기
              </button>
              <button className="btn btn--ghost" onClick={onExit}>
                로비로
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
