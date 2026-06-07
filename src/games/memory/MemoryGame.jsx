import { useEffect, useRef, useState } from 'react'
import MemorySetup from './MemorySetup.jsx'
import Fireworks from '../../shared/Fireworks.jsx'
import FullscreenButton from '../../shared/FullscreenButton.jsx'
import TurnOrderRoll from '../../shared/TurnOrderRoll.jsx'
import { createGame, applyPair, winners } from './engine.js'
import { getZodiac } from '../../shared/zodiac.js'
import { sound } from '../../shared/sound.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export default function MemoryGame({ roster, onExit }) {
  const [phase, setPhase] = useState('setup') // 'setup' | 'order' | 'play'
  const [order, setOrder] = useState(roster) // 차례 정하기로 확정된 순서
  const [game, setGame] = useState(null)
  const [difficulty, setDifficulty] = useState(null) // 다시하기용
  const [flipped, setFlipped] = useState([]) // 현재 뒤집은 카드 id (최대 2)
  const [busy, setBusy] = useState(false) // 짝 판정 중 입력 잠금
  const [banner, setBanner] = useState(null) // { text, key }
  const [soundOn, setSoundOn] = useState(true)
  const prevTurnRef = useRef(-1)

  // 턴이 바뀌면 "○○ 차례!" 배너 (혼자 플레이면 생략)
  useEffect(() => {
    if (!game || game.status !== 'playing' || game.players.length < 2) return
    if (prevTurnRef.current === game.currentIndex) return
    prevTurnRef.current = game.currentIndex
    const p = game.players[game.currentIndex]
    setBanner({ text: `${p.name} 차례!`, key: Date.now() })
    const t = setTimeout(() => setBanner(null), 1200)
    return () => clearTimeout(t)
  }, [game])

  // 난이도 선택 → 차례 정하기 (혼자면 건너뛰고 바로 시작)
  function chooseDifficulty(diff) {
    setDifficulty(diff)
    if (roster.length < 2) beginGame(roster, diff)
    else setPhase('order')
  }

  // 게임 시작: players = 차례 정하기로 확정된 순서
  function beginGame(players, diff = difficulty) {
    sound.setEnabled(soundOn)
    setOrder(players)
    prevTurnRef.current = -1
    setFlipped([])
    setBusy(false)
    setBanner(null)
    // 12지신 색을 붙여 플레이어로 사용 (순서 = 차례)
    const built = players.map((p) => ({
      id: p.id,
      name: p.name,
      zodiacId: p.zodiacId,
      color: getZodiac(p.zodiacId)?.color,
    }))
    setGame(createGame(built, diff))
    setPhase('play')
  }

  function restart() {
    if (difficulty) beginGame(order)
  }

  function toggleSound() {
    const next = !soundOn
    setSoundOn(next)
    sound.setEnabled(next)
    if (next) sound.unlock()
  }

  async function flip(id) {
    if (!game || busy || game.status === 'finished') return
    if (flipped.includes(id) || game.matched.includes(id) || flipped.length >= 2) return

    sound.step()
    const nf = [...flipped, id]
    setFlipped(nf)
    if (nf.length < 2) return

    // 두 장 뒤집힘 → 판정
    setBusy(true)
    const [a, b] = nf
    await sleep(650) // 카드를 눈으로 확인할 시간
    const { next, match, won } = applyPair(game, a, b)

    if (match) {
      sound.ladderUp()
      setGame(next)
      setFlipped([])
      if (game.players.length > 1 && !won) {
        setBanner({ text: '짝 맞췄다! 한 번 더 🎉', key: Date.now() })
        setTimeout(() => setBanner(null), 1100)
      }
      if (won) {
        await sleep(150)
        sound.win()
      }
    } else {
      sound.key()
      await sleep(450) // 틀린 카드 잠깐 보여준 뒤 뒤집기
      setFlipped([])
      setGame(next)
    }
    setBusy(false)
  }

  // 1) 설정 화면 (난이도 선택)
  if (phase === 'setup') {
    return <MemorySetup roster={roster} onStart={chooseDifficulty} onExit={onExit} />
  }
  // 2) 차례 정하기 (2명 이상)
  if (phase === 'order') {
    return (
      <TurnOrderRoll players={roster} onComplete={(p) => beginGame(p)} onBack={() => setPhase('setup')} />
    )
  }

  const { difficulty: diff } = game
  const finished = game.status === 'finished'
  const activePlayer = game.players[game.currentIndex]
  const activeZodiac = getZodiac(activePlayer.zodiacId)
  const matchedSet = new Set(game.matched)
  const flippedSet = new Set(flipped)
  const win = finished ? winners(game) : []
  const solo = game.players.length === 1

  return (
    <div className="memory">
      <div className="ladder__topbar">
        <button className="btn btn--ghost" onClick={onExit}>
          ← 나가기
        </button>
        {!finished ? (
          <div className="turn-indicator" style={{ '--z-color': activePlayer.color }}>
            <span className="turn-indicator__emoji">{activeZodiac?.emoji}</span>
            <span>{solo ? '짝을 찾아요!' : `${activePlayer.name} 차례`}</span>
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
          <div className="mboard" style={{ '--cols': diff.cols, '--rows': diff.rows }}>
            {game.cards.map((card) => {
              const isUp = flippedSet.has(card.id) || matchedSet.has(card.id)
              const isMatched = matchedSet.has(card.id)
              const z = getZodiac(card.animalId)
              return (
                <button
                  key={card.id}
                  type="button"
                  className={`mcard ${isUp ? 'is-up' : ''} ${isMatched ? 'is-matched' : ''}`}
                  onClick={() => flip(card.id)}
                  aria-label={isUp ? z?.name : '뒤집힌 카드'}
                >
                  <span className="mcard__inner">
                    {isUp ? (
                      <span
                        key="front"
                        className="mcard__face mcard__front"
                        style={{ '--z-color': z?.color }}
                      >
                        {z?.emoji}
                      </span>
                    ) : (
                      <span key="back" className="mcard__face mcard__back">
                        <span className="mcard__back-icon">🐾</span>
                      </span>
                    )}
                  </span>
                </button>
              )
            })}
          </div>
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
                  style={{ '--z-color': p.color }}
                >
                  <span className="players-list__emoji">{z?.emoji}</span>
                  <span className="players-list__name">{p.name}</span>
                  <span className="players-list__pos">{p.score}쌍</span>
                </div>
              )
            })}
          </div>
          <div className="dice-area">
            <p className="dice-area__hint">
              {finished ? '' : busy ? '확인 중...' : '카드를 두 장 뒤집어요'}
            </p>
          </div>
        </aside>
      </div>

      {finished && (
        <div className="win-modal">
          <Fireworks />
          <div className="win-modal__card" style={{ '--z-color': win[0]?.color }}>
            <div className="win-modal__emoji">🏆</div>
            {solo ? (
              <>
                <h2>완성! 🎉</h2>
                <p>{diff.pairs}쌍 모두 찾았어요</p>
              </>
            ) : win.length > 1 ? (
              <>
                <h2>공동 우승! 🎉</h2>
                <p>
                  {win.map((p) => p.name).join(', ')} · {win[0].score}쌍
                </p>
              </>
            ) : (
              <>
                <h2>{win[0]?.name} 우승! 🎉</h2>
                <p>{win[0]?.score}쌍으로 1등!</p>
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
