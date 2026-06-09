import { useEffect, useRef, useState } from 'react'
import RaceSetup from './RaceSetup.jsx'
import Fireworks from '../../shared/Fireworks.jsx'
import FullscreenButton from '../../shared/FullscreenButton.jsx'
import { createGame, tapRun, progress, ranking, winner } from './engine.js'
import { getZodiac } from '../../shared/zodiac.js'
import { sound } from '../../shared/sound.js'

export default function RaceGame({ roster, onExit }) {
  const [phase, setPhase] = useState('setup') // 'setup' | 'play'
  const [roundPhase, setRoundPhase] = useState('ready') // 'ready'(카운트다운) | 'run' | 'done'
  const [count, setCount] = useState(3) // 3,2,1,0(출발)
  const [game, setGame] = useState(null)
  const [soundOn, setSoundOn] = useState(true)
  const timers = useRef([])

  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  function startGame() {
    sound.setEnabled(soundOn)
    const players = roster.map((p) => ({
      id: p.id,
      name: p.name,
      zodiacId: p.zodiacId,
      color: getZodiac(p.zodiacId)?.color,
    }))
    setGame(createGame(players))
    setPhase('play')
    beginCountdown()
  }

  function beginCountdown() {
    timers.current.forEach(clearTimeout)
    timers.current = []
    setRoundPhase('ready')
    setCount(3)
    ;[1, 2].forEach((n) => {
      timers.current.push(setTimeout(() => { setCount(3 - n); sound.step() }, n * 800))
    })
    timers.current.push(
      setTimeout(() => {
        setCount(0) // 출발!
        sound.ladderUp()
        setRoundPhase('run')
      }, 3 * 800)
    )
  }

  function tap(id) {
    if (roundPhase !== 'run') return
    setGame((g) => {
      const next = tapRun(g, id)
      if (next.status === 'finished' && g.status !== 'finished') {
        setRoundPhase('done')
        setTimeout(() => sound.win(), 120)
      }
      return next
    })
  }

  function toggleSound() {
    const n = !soundOn
    setSoundOn(n)
    sound.setEnabled(n)
    if (n) sound.unlock()
  }

  if (phase === 'setup') {
    return <RaceSetup roster={roster} onStart={startGame} onExit={onExit} />
  }

  const finished = game.status === 'finished'
  const win = finished ? winner(game) : null
  const order = finished ? ranking(game) : []

  return (
    <div className="race">
      <div className="ladder__topbar">
        <button className="btn btn--ghost" onClick={onExit}>
          ← 나가기
        </button>
        <div className="turn-indicator">{finished ? '🏁 도착!' : '🏃 달리기 경주'}</div>
        <div className="topbar__right">
          <button className="btn btn--ghost" onClick={toggleSound} aria-label="소리">
            {soundOn ? '🔊' : '🔇'}
          </button>
          <FullscreenButton />
        </div>
      </div>

      <div className="race__track">
        {game.players.map((p) => {
          const z = getZodiac(p.zodiacId)
          const pr = progress(p)
          return (
            <button
              key={p.id}
              className="race-lane"
              style={{ '--z-color': p.color }}
              disabled={roundPhase !== 'run'}
              onPointerDown={() => tap(p.id)}
            >
              <span className="race-lane__name">
                {z?.emoji} {p.name}
              </span>
              <span className="race-lane__rail">
                <span className="race-lane__goal">🏁</span>
                <span className="race-lane__runner" style={{ left: `calc(4% + ${pr * 88}%)` }}>
                  {z?.emoji}
                </span>
              </span>
            </button>
          )
        })}
      </div>

      {roundPhase === 'ready' && (
        <div className="race__count" key={count}>
          {count === 0 ? '출발!' : count}
        </div>
      )}
      {roundPhase === 'run' && <div className="race__hint">내 칸을 마구 두드려요! 👆👆</div>}

      {finished && (
        <div className="win-modal">
          <Fireworks />
          <div className="win-modal__card" style={{ '--z-color': win?.color }}>
            <div className="win-modal__emoji">🏆</div>
            <h2>{win?.name} 우승! 🎉</h2>
            <p>
              {order.map((p, i) => `${i + 1}등 ${getZodiac(p.zodiacId)?.emoji}${p.name}`).join('  ·  ')}
            </p>
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
