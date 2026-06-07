import { useEffect, useMemo, useRef, useState } from 'react'
import Board from './Board.jsx'
import PlayerSetup from './PlayerSetup.jsx'
import Dice from '../../shared/Dice.jsx'
import { DEFAULT_CONFIG, BOARDS } from './board.config.js'
import { createGame, applyMove, computeMove, rollDice } from './engine.js'
import { getZodiac } from '../../shared/zodiac.js'
import { sound } from '../../shared/sound.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export default function LadderGame({ onExit }) {
  const [config, setConfig] = useState(DEFAULT_CONFIG) // 선택된 보드(30칸/50칸)
  const [roster, setRoster] = useState(null) // [{ id, zodiacId }]
  const [game, setGame] = useState(null)
  const [displayPos, setDisplayPos] = useState({}) // id -> tile (애니메이션용)
  const [animating, setAnimating] = useState(false)
  const [center, setCenter] = useState(null) // { value, key }
  const [banner, setBanner] = useState(null) // { text, key } — "○○ 차례!"
  const [soundOn, setSoundOn] = useState(config.sound)
  const prevTurnRef = useRef(-1)

  // 턴이 바뀔 때마다 "○○ 차례!" 배너 표시 (첫 턴 포함)
  useEffect(() => {
    if (!game || game.status !== 'playing') return
    if (prevTurnRef.current === game.currentIndex) return
    prevTurnRef.current = game.currentIndex
    const p = game.players[game.currentIndex]
    setBanner({ text: `${p.name} 차례!`, key: Date.now() })
    const t = setTimeout(() => setBanner(null), 1300)
    return () => clearTimeout(t)
  }, [game])

  function startGame(picks, boardConfig = config) {
    sound.setEnabled(soundOn)
    setConfig(boardConfig)
    setRoster(picks)
    prevTurnRef.current = -1
    const g = createGame(picks, boardConfig)
    setGame(g)
    setDisplayPos(Object.fromEntries(g.players.map((p) => [p.id, p.position])))
  }

  function restart() {
    if (roster) startGame(roster, config)
  }

  function toggleSound() {
    const next = !soundOn
    setSoundOn(next)
    sound.setEnabled(next)
    if (next) sound.unlock()
  }

  async function handleResult(roll) {
    if (!game || animating || game.status === 'finished') return
    setAnimating(true)
    const player = game.players[game.currentIndex]
    const move = computeMove(player.position, roll, config)

    // 1) 중앙에 큰 숫자 연출
    setCenter({ value: roll, key: Date.now() })
    await sleep(750)
    setCenter(null)

    // 2) 한 칸씩 걸어가기
    for (const tile of move.walkPath) {
      setDisplayPos((dp) => ({ ...dp, [player.id]: tile }))
      sound.step()
      await sleep(280)
    }

    // 3) 발판 발동
    if (move.platform) {
      await sleep(250)
      setDisplayPos((dp) => ({ ...dp, [player.id]: move.platform.to }))
      move.platform.dir === 'up' ? sound.ladderUp() : sound.chuteDown()
      await sleep(500)
    }

    // 4) 상태 확정
    const next = applyMove(game, roll)
    setGame(next)
    if (next.status === 'finished') {
      await sleep(150)
      sound.win()
    }
    setAnimating(false)
  }

  const activePlayer = game && game.players[game.currentIndex]
  const activeZodiac = activePlayer && getZodiac(activePlayer.zodiacId)
  const winner = game && game.winnerId && game.players.find((p) => p.id === game.winnerId)
  const winnerZodiac = winner && getZodiac(winner.zodiacId)

  const rollFn = useMemo(() => () => rollDice(config), [config])

  // 설정 화면
  if (!game) {
    return (
      <PlayerSetup boards={BOARDS} onStart={startGame} onExit={onExit} />
    )
  }

  const finished = game.status === 'finished'

  return (
    <div className="ladder">
      <div className="ladder__topbar">
        <button className="btn btn--ghost" onClick={onExit}>
          ← 나가기
        </button>
        {!finished ? (
          <div className="turn-indicator" style={{ '--z-color': activeZodiac?.color }}>
            <span className="turn-indicator__emoji">{activeZodiac?.emoji}</span>
            <span>{activePlayer.name} 차례</span>
          </div>
        ) : (
          <div className="turn-indicator">🏁 게임 끝!</div>
        )}
        <button className="btn btn--ghost" onClick={toggleSound} aria-label="소리">
          {soundOn ? '🔊' : '🔇'}
        </button>
      </div>

      <div className="ladder__main">
        <div className="ladder__board-wrap">
          <Board
            config={config}
            positions={displayPos}
            players={game.players}
            activeId={!finished ? activePlayer.id : null}
          />
          {center && (
            <div key={center.key} className="center-number">
              {center.value}
            </div>
          )}
          {banner && (
            <div key={banner.key} className="turn-banner">
              {banner.text}
            </div>
          )}
        </div>

        <aside className="ladder__side">
          <div className="players-list">
            {game.players.map((p, i) => {
              const z = getZodiac(p.zodiacId)
              return (
                <div
                  key={p.id}
                  className={`players-list__item ${
                    !finished && i === game.currentIndex ? 'is-active' : ''
                  }`}
                  style={{ '--z-color': z.color }}
                >
                  <span className="players-list__emoji">{z.emoji}</span>
                  <span className="players-list__name">{p.name}</span>
                  <span className="players-list__pos">{displayPos[p.id]}칸</span>
                </div>
              )
            })}
          </div>

          <div className="dice-area">
            <Dice disabled={finished || animating} rollFn={rollFn} onResult={handleResult} />
            <p className="dice-area__hint">
              {animating ? '이동 중...' : finished ? '' : '주사위를 눌러요'}
            </p>
          </div>
        </aside>
      </div>

      {finished && (
        <div className="win-modal">
          <div className="win-modal__card" style={{ '--z-color': winnerZodiac?.color }}>
            <div className="win-modal__emoji">{winnerZodiac?.emoji}</div>
            <h2>{winner?.name} 우승! 🎉</h2>
            <p>{winnerZodiac?.name} 골인!</p>
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
