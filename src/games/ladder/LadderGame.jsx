import { useEffect, useMemo, useRef, useState } from 'react'
import Board from './Board.jsx'
import LadderSetup from './LadderSetup.jsx'
import Dice from '../../shared/Dice.jsx'
import Fireworks from '../../shared/Fireworks.jsx'
import FullscreenButton from '../../shared/FullscreenButton.jsx'
import { DEFAULT_CONFIG, BOARDS } from './board.config.js'
import { createGame, applyMove, computeMove, rollDice } from './engine.js'
import { randomCardId, resolveKeyCard, getCard } from './keycards.js'
import { getZodiac } from '../../shared/zodiac.js'
import { sound } from '../../shared/sound.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export default function LadderGame({ roster, onExit }) {
  const [config, setConfig] = useState(DEFAULT_CONFIG) // 선택된 보드(30칸/50칸)
  const [game, setGame] = useState(null)
  const [displayPos, setDisplayPos] = useState({}) // id -> tile (애니메이션용)
  const [animating, setAnimating] = useState(false)
  const [center, setCenter] = useState(null) // { value, key }
  const [banner, setBanner] = useState(null) // { text, key } — "○○ 차례!"
  const [cardEvent, setCardEvent] = useState(null) // { slots:[id x5], chosen, revealed }
  const [soundOn, setSoundOn] = useState(config.sound)
  const prevTurnRef = useRef(-1)
  const cardBaseRef = useRef(null) // 카드 적용 직전의 게임 상태

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

  function startGame(boardConfig = config) {
    sound.setEnabled(soundOn)
    setConfig(boardConfig)
    prevTurnRef.current = -1
    setCardEvent(null)
    setAnimating(false)
    cardBaseRef.current = null
    const g = createGame(roster, boardConfig)
    setGame(g)
    setDisplayPos(Object.fromEntries(g.players.map((p) => [p.id, p.position])))
  }

  function restart() {
    startGame(config)
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

    // 4) 열쇠카드 칸이면 카드 선택 이벤트로 진입(턴은 카드 적용 후 처리)
    if (move.keyCard) {
      // 멈춘 칸을 게임 상태에 반영(턴은 아직 넘기지 않음)
      const landed = {
        ...game,
        players: game.players.map((p, i) =>
          i === game.currentIndex ? { ...p, position: move.finalPosition } : p
        ),
        lastRoll: roll,
      }
      cardBaseRef.current = landed
      setGame(landed)
      await sleep(250)
      sound.key()
      setCardEvent({ slots: Array.from({ length: 5 }, () => randomCardId()), chosen: null })
      return // setAnimating(false) 하지 않음 — 카드 고를 때까지 대기
    }

    // 5) 상태 확정
    const next = applyMove(game, roll)
    setGame(next)
    if (next.status === 'finished') {
      await sleep(150)
      sound.win()
    }
    setAnimating(false)
  }

  // 카드 1장 선택 → 효과 공개 → 적용 → 턴 처리
  async function handleCardPick(index) {
    const base = cardBaseRef.current
    if (!base || !cardEvent || cardEvent.chosen != null) return
    const cardId = cardEvent.slots[index]
    sound.key()
    setCardEvent((ce) => ({ ...ce, chosen: index, revealed: cardId }))
    await sleep(1200) // 공개된 카드를 보여줌

    const { next, changes, rollAgain } = resolveKeyCard(base, cardId)
    setCardEvent(null)
    cardBaseRef.current = null

    // 자리 이동 애니메이션(부드럽게 미끄러짐 — pawn CSS transition)
    if (changes.length) {
      await sleep(150)
      setDisplayPos((dp) => {
        const nd = { ...dp }
        changes.forEach((c) => (nd[c.id] = c.to))
        return nd
      })
      changes.forEach((c) => (c.to > c.from ? sound.ladderUp() : sound.chuteDown()))
      await sleep(650)
    }

    setGame(next)

    if (next.status === 'finished') {
      await sleep(150)
      sound.win()
      setAnimating(false)
      return
    }

    if (rollAgain) {
      // 같은 사람이 한 번 더 — 턴 그대로, 안내 배너만 표시
      setBanner({ text: '한 번 더! 🎲', key: Date.now() })
      setTimeout(() => setBanner(null), 1300)
    }
    setAnimating(false)
  }

  const activePlayer = game && game.players[game.currentIndex]
  const activeZodiac = activePlayer && getZodiac(activePlayer.zodiacId)
  const winner = game && game.winnerId && game.players.find((p) => p.id === game.winnerId)
  const winnerZodiac = winner && getZodiac(winner.zodiacId)

  const rollFn = useMemo(() => () => rollDice(config), [config])

  // 설정 화면 (보드 선택)
  if (!game) {
    return <LadderSetup boards={BOARDS} roster={roster} onStart={startGame} onExit={onExit} />
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
        <div className="topbar__right">
          <button className="btn btn--ghost" onClick={toggleSound} aria-label="소리">
            {soundOn ? '🔊' : '🔇'}
          </button>
          <FullscreenButton />
        </div>
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
              {cardEvent
                ? '🔑 카드를 골라요'
                : animating
                ? '이동 중...'
                : finished
                ? ''
                : '주사위를 눌러요'}
            </p>
          </div>
        </aside>
      </div>

      {cardEvent && (
        <div className="card-modal">
          <div className="card-modal__title">
            🔑 {cardEvent.chosen == null ? '열쇠카드! 한 장 고르세요' : getCard(cardEvent.revealed)?.title}
          </div>
          <div className="card-row">
            {cardEvent.slots.map((slotId, i) => {
              const chosen = cardEvent.chosen === i
              const dim = cardEvent.chosen != null && !chosen
              const card = getCard(slotId)
              return (
                <button
                  key={i}
                  className={`key-card ${chosen ? 'key-card--face' : 'key-card--back'} ${
                    dim ? 'key-card--dim' : ''
                  }`}
                  disabled={cardEvent.chosen != null}
                  onClick={() => handleCardPick(i)}
                >
                  {chosen ? (
                    <>
                      <span className="key-card__emoji">{card?.emoji}</span>
                      <span className="key-card__title">{card?.title}</span>
                      <span className="key-card__desc">{card?.desc}</span>
                    </>
                  ) : (
                    <span className="key-card__back-icon">🔑</span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {finished && (
        <div className="win-modal">
          <Fireworks />
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
