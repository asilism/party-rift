import { useEffect, useRef, useState } from 'react'
import WhackSetup from './WhackSetup.jsx'
import Fireworks from '../../shared/Fireworks.jsx'
import FullscreenButton from '../../shared/FullscreenButton.jsx'
import { createGame, whack, winners, DURATION_MS, HOLES } from './engine.js'
import { getZodiac } from '../../shared/zodiac.js'
import { sound } from '../../shared/sound.js'

const POP_MIN = 700
const POP_MAX = 1150

export default function WhackGame({ roster, onExit }) {
  const [phase, setPhase] = useState('setup') // 'setup' | 'play'
  const [game, setGame] = useState(null)
  const [holes, setHoles] = useState({}) // `${pid}-${i}` -> upUntil(ms)
  const [now, setNow] = useState(0)
  const [timeLeft, setTimeLeft] = useState(Math.round(DURATION_MS / 1000))
  const [done, setDone] = useState(false)
  const [soundOn, setSoundOn] = useState(true)

  const endRef = useRef(0)
  const holesRef = useRef({})
  const tickRef = useRef(null)
  const spawnRef = useRef(null)

  function clearLoops() {
    clearInterval(tickRef.current)
    clearInterval(spawnRef.current)
  }
  useEffect(() => clearLoops, [])

  function startGame() {
    sound.setEnabled(soundOn)
    const players = roster.map((p) => ({
      id: p.id,
      name: p.name,
      zodiacId: p.zodiacId,
      color: getZodiac(p.zodiacId)?.color,
    }))
    setGame(createGame(players))
    holesRef.current = {}
    setHoles({})
    setDone(false)
    setTimeLeft(Math.round(DURATION_MS / 1000))
    setPhase('play')
    const start = Date.now()
    endRef.current = start + DURATION_MS
    setNow(start)
    clearLoops()
    tickRef.current = setInterval(() => {
      const t = Date.now()
      setNow(t)
      setTimeLeft(Math.max(0, Math.ceil((endRef.current - t) / 1000)))
      if (t >= endRef.current) {
        clearLoops()
        setDone(true)
        setTimeout(() => sound.win(), 150)
      }
    }, 90)
    spawnRef.current = setInterval(() => {
      const t = Date.now()
      if (t >= endRef.current) return
      const h = { ...holesRef.current }
      players.forEach((p) => {
        if (Math.random() < 0.85) {
          const down = []
          for (let i = 0; i < HOLES; i++) if (!(h[`${p.id}-${i}`] > t)) down.push(i)
          if (down.length) {
            const i = down[Math.floor(Math.random() * down.length)]
            h[`${p.id}-${i}`] = t + POP_MIN + Math.random() * (POP_MAX - POP_MIN)
          }
        }
      })
      holesRef.current = h
      setHoles(h)
    }, 620)
  }

  function hit(pid, i) {
    if (done) return
    const key = `${pid}-${i}`
    if (!(holesRef.current[key] > Date.now())) return // 두더지 없음 → 헛스윙
    holesRef.current = { ...holesRef.current, [key]: 0 }
    setHoles(holesRef.current)
    setGame((g) => whack(g, pid))
    sound.step()
  }

  function toggleSound() {
    const n = !soundOn
    setSoundOn(n)
    sound.setEnabled(n)
    if (n) sound.unlock()
  }

  if (phase === 'setup') {
    return <WhackSetup roster={roster} onStart={startGame} onExit={onExit} />
  }

  const win = done ? winners(game) : []

  return (
    <div className="whack">
      <div className="ladder__topbar">
        <button className="btn btn--ghost" onClick={onExit}>
          ← 나가기
        </button>
        <div className="turn-indicator">{done ? '🏁 끝!' : `⏱️ ${timeLeft}초`}</div>
        <div className="topbar__right">
          <button className="btn btn--ghost" onClick={toggleSound} aria-label="소리">
            {soundOn ? '🔊' : '🔇'}
          </button>
          <FullscreenButton />
        </div>
      </div>

      <div className="whack__zones">
        {game.players.map((p) => {
          const z = getZodiac(p.zodiacId)
          return (
            <div className="whack-zone" key={p.id} style={{ '--z-color': p.color }}>
              <div className="whack-zone__head">
                <span>{z?.emoji} {p.name}</span>
                <span className="whack-zone__score">{p.score}</span>
              </div>
              <div className="whack-grid">
                {Array.from({ length: HOLES }).map((_, i) => {
                  const up = holes[`${p.id}-${i}`] > now
                  return (
                    <button
                      key={i}
                      className={`whack-hole ${up ? 'is-up' : ''}`}
                      disabled={done}
                      onPointerDown={() => hit(p.id, i)}
                    >
                      <span className="whack-mole">🐹</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {done && (
        <div className="win-modal">
          <Fireworks />
          <div className="win-modal__card" style={{ '--z-color': win[0]?.color }}>
            <div className="win-modal__emoji">🏆</div>
            {win.length > 1 ? (
              <>
                <h2>공동 우승! 🎉</h2>
                <p>{win.map((p) => p.name).join(', ')} · {win[0].score}마리</p>
              </>
            ) : (
              <>
                <h2>{win[0]?.name} 우승! 🎉</h2>
                <p>{win[0]?.score}마리 잡았어요!</p>
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
