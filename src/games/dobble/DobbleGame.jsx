import { useMemo, useState } from 'react'
import DobbleSetup from './DobbleSetup.jsx'
import Fireworks from '../../shared/Fireworks.jsx'
import FullscreenButton from '../../shared/FullscreenButton.jsx'
import { createGame, tapSymbol, winners } from './engine.js'
import { getZodiac } from '../../shared/zodiac.js'
import { sound } from '../../shared/sound.js'

const N = 5 // 보통 난이도: 카드당 6문양
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 플레이어 수에 따른 좌석 배치 — 와이드 화면에 맞게 2인은 좌우, 3·4인은 꼭지점.
const SEATS = {
  1: ['bc'],
  2: ['left', 'right'],
  3: ['bl', 'br', 'tl'], // 4인처럼 꼭지점에, 한 자리(우상단)만 비움
  4: ['bl', 'br', 'tl', 'tr'],
}

// 문양 배치를 카드 내용으로 결정(같은 카드는 항상 같은 배치).
// 링(+중앙)에 균등 배치 후, 각 문양의 최대 반지름을 "이웃까지 거리/2"와 "테두리까지"로
// 제한 → 절대 겹치지 않게. 크기는 그 한도 내에서 랜덤(74~100%)이라 크고 작고 섞이고
// 카드를 꽉 채운다. (size = 폰트 크기 %)
function makeLayout(symbols) {
  let seed = symbols.reduce((s, v) => (s * 31 + v + 7) >>> 0, 9)
  const rng = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 4294967296
  }
  const count = symbols.length
  const hasCenter = count >= 5
  const ringCount = hasCenter ? count - 1 : count
  const R = 30 // 링 반지름(%)
  const EDGE = 47 // 카드 안쪽 반지름(%)
  const rot0 = rng() * Math.PI * 2
  const pts = []
  for (let i = 0; i < ringCount; i++) {
    const ang = rot0 + (i / ringCount) * Math.PI * 2
    pts.push({ x: 50 + Math.cos(ang) * R, y: 50 + Math.sin(ang) * R })
  }
  if (hasCenter) pts.push({ x: 50, y: 50 })

  return pts.map((p, i) => {
    let maxR = EDGE - Math.hypot(p.x - 50, p.y - 50) // 테두리까지
    for (let j = 0; j < pts.length; j++) {
      if (j === i) continue
      const half = Math.hypot(p.x - pts[j].x, p.y - pts[j].y) / 2
      if (half < maxR) maxR = half
    }
    const r = maxR * (0.74 + rng() * 0.26) // 한도 내 랜덤 크기
    return { x: p.x, y: p.y, size: r * 1.85, rot: rng() * 70 - 35 } // 폰트 크기 ≈ 지름
  })
}

function DobbleCard({ symbols, emojiOf, onTap, disabled }) {
  const layout = useMemo(() => makeLayout(symbols), [symbols.join(',')])
  return (
    <div className="dobble-card">
      {symbols.map((s, i) => {
        const L = layout[i] || { x: 50, y: 50, rot: 0, size: 22 }
        const style = {
          left: `${L.x}%`,
          top: `${L.y}%`,
          fontSize: `${L.size}cqmin`,
          transform: `translate(-50%, -50%) rotate(${L.rot}deg)`,
        }
        if (!onTap) return <span key={s} className="dobble-sym" style={style}>{emojiOf(s)}</span>
        return (
          <button
            key={s}
            type="button"
            className="dobble-sym"
            style={style}
            disabled={disabled}
            onClick={() => onTap(s)}
          >
            {emojiOf(s)}
          </button>
        )
      })}
    </div>
  )
}

export default function DobbleGame({ roster, onExit }) {
  const [phase, setPhase] = useState('setup') // 'setup' | 'play'
  const [game, setGame] = useState(null)
  const [flash, setFlash] = useState(null) // { id, ok, key }
  const [soundOn, setSoundOn] = useState(true)

  function startGame() {
    sound.setEnabled(soundOn)
    const players = roster.slice(0, 4).map((p) => ({
      id: p.id,
      name: p.name,
      zodiacId: p.zodiacId,
      color: getZodiac(p.zodiacId)?.color,
    }))
    setGame(createGame(players, N))
    setFlash(null)
    setPhase('play')
  }

  function restart() {
    startGame()
  }

  function toggleSound() {
    const next = !soundOn
    setSoundOn(next)
    sound.setEnabled(next)
    if (next) sound.unlock()
  }

  async function handleTap(playerId, symbol) {
    if (!game || game.status === 'finished') return
    const r = tapSymbol(game, playerId, symbol)
    if (r.result === 'ignored' || r.result === 'locked') return
    setGame(r.state)
    setFlash({ id: playerId, ok: r.result === 'correct', key: Date.now() })
    if (r.result === 'correct') {
      sound.ladderUp()
      if (r.finished) {
        await sleep(200)
        sound.win()
      }
    } else {
      sound.chuteDown()
    }
  }

  if (phase === 'setup') {
    return <DobbleSetup roster={roster} onStart={startGame} onExit={onExit} />
  }

  const emojiOf = (idx) => game.symbols[idx]
  const finished = game.status === 'finished'
  const seats = SEATS[game.players.length] || SEATS[4]
  const remaining = game.centerQueue.length - game.centerPos
  const win = finished ? winners(game) : []

  return (
    <div className="dobble">
      <div className="ladder__topbar">
        <button className="btn btn--ghost" onClick={onExit}>
          ← 나가기
        </button>
        <div className="turn-indicator">{finished ? '🏁 게임 끝!' : `🔍 남은 카드 ${remaining}`}</div>
        <div className="topbar__right">
          <button className="btn btn--ghost" onClick={toggleSound} aria-label="소리">
            {soundOn ? '🔊' : '🔇'}
          </button>
          <FullscreenButton />
        </div>
      </div>

      <div className={`dobble__table dobble__table--p${game.players.length}`}>
        {game.players.map((p, i) => {
          const z = getZodiac(p.zodiacId)
          const locked = game.locked.includes(p.id)
          const flashing = flash && flash.id === p.id
          return (
            <div key={p.id} className={`dobble-seat seat--${seats[i] || 'bottom'}`}>
              <div className="dobble-seat__label" style={{ '--z-color': p.color }}>
                <span className="dobble-seat__emoji">{z?.emoji}</span>
                <span className="dobble-seat__name">{p.name}</span>
                <span className="dobble-seat__score">{p.score}점</span>
                {locked && <span className="dobble-seat__lock">🚫</span>}
              </div>
              <div
                key={flashing ? flash.key : p.id}
                className={`dobble-card-wrap ${locked ? 'is-locked' : ''} ${
                  flashing ? (flash.ok ? 'flash-ok' : 'flash-bad') : ''
                }`}
                style={{ '--z-color': p.color }}
              >
                <DobbleCard
                  symbols={p.card}
                  emojiOf={emojiOf}
                  onTap={(s) => handleTap(p.id, s)}
                  disabled={finished || locked}
                />
              </div>
            </div>
          )
        })}

        <div className="dobble-seat seat--center">
          <div className="dobble-card-wrap dobble-card-wrap--center">
            {game.center && <DobbleCard symbols={game.center} emojiOf={emojiOf} />}
          </div>
        </div>
      </div>

      {finished && (
        <div className="win-modal">
          <Fireworks />
          <div className="win-modal__card" style={{ '--z-color': win[0]?.color }}>
            <div className="win-modal__emoji">🏆</div>
            {win.length > 1 ? (
              <>
                <h2>공동 우승! 🎉</h2>
                <p>{win.map((p) => p.name).join(', ')} · {win[0].score}점</p>
              </>
            ) : (
              <>
                <h2>{win[0]?.name} 우승! 🎉</h2>
                <p>{win[0]?.score}점으로 1등!</p>
              </>
            )}
            <div className="win-modal__btns">
              <button className="btn btn--primary" onClick={restart}>
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
