import { useEffect, useRef, useState } from 'react'
import ThrillSetup from './ThrillSetup.jsx'
import Fireworks from '../../shared/Fireworks.jsx'
import FullscreenButton from '../../shared/FullscreenButton.jsx'
import {
  createGame,
  scoreRound,
  applyRoundScores,
  winners,
  randomDuration,
  TRAVEL_MS,
} from './engine.js'
import { getZodiac } from '../../shared/zodiac.js'
import { sound } from '../../shared/sound.js'

const READY_MS = 1000
const clamp01 = (v) => Math.max(0, Math.min(1, v))
const lerp = (a, b, t) => a + (b - a) * t

// 좌표(% of arena)
const HOLE = { x: 50, y: 22 } // 블랙홀(폭탄 회전) 중심
const DISC = { rx: 19, ry: 14 } // 블랙홀 디스크 반지름(가로%/세로%) → 타원
const ORX = DISC.rx - 4 // 폭탄 궤도 가로 반지름(디스크 안쪽)
const ORY = DISC.ry - 4 // 폭탄 궤도 세로 반지름
const ENTRY = { x: 50, y: 44 } // 튜브 입구(블랙홀 아래)
const STACK_BOTTOM = 86 // 맨 아래 공 중심 y%
// 공 간격 = 공 지름(var(--ballh))의 0.92배 → 살짝 겹쳐 실제로 쌓인 것처럼 딱 붙음
const slotY = (k) => `calc(${STACK_BOTTOM}% - ${(k * 0.92).toFixed(3)} * var(--ballh))`
const CORNERS = {
  tl: { x: 13, y: 32 },
  tr: { x: 87, y: 32 },
  bl: { x: 13, y: 84 },
  br: { x: 87, y: 84 },
}
const SEATS = { 1: ['bl'], 2: ['bl', 'br'], 3: ['bl', 'br', 'tl'], 4: ['bl', 'br', 'tl', 'tr'] }

// 폭탄: 완만하게 ~10바퀴 돌며 내려오다, 막판에 오일러 디스크처럼 급가속 + 여러 번 튀기며 중앙 구멍으로 쏙.
const EULER_TURNS = 10
const BOUNCES = 6
function bombOrbit(p) {
  const c = clamp01(p)
  const env = 1 - c // 반지름 외곽선: 선형(완만) 강하 → 천천히 안으로
  // 막판으로 갈수록 강해지는 감쇠 튀김(오일러 disk rattle)
  const bounce = 1 - 0.35 * c * Math.abs(Math.sin(Math.pow(c, 1.6) * BOUNCES * Math.PI))
  const k = env * bounce
  const turns = 0.45 * c + 0.55 * Math.pow(c, 3) // 각속도: 막판 급가속
  const ang = -Math.PI / 2 + turns * EULER_TURNS * Math.PI * 2
  const scale = 1 - 0.2 * Math.pow(c, 3) // 살짝만 작아짐(원근감) → 최종 ≈ 0.8
  return { x: HOLE.x + ORX * k * Math.cos(ang), y: HOLE.y + ORY * k * Math.sin(ang), scale }
}

export default function ThrillGame({ roster, onExit }) {
  const [game, setGame] = useState(null)
  const [phase, setPhase] = useState('setup')
  const [roundPhase, setRoundPhase] = useState('ready')
  const [elapsed, setElapsed] = useState(0)
  const [pressed, setPressed] = useState({})
  const [soundOn, setSoundOn] = useState(true)

  const durRef = useRef(0)
  const startRef = useRef(0)
  const pressRef = useRef({})
  const rafRef = useRef(0)
  const droppedRef = useRef(false)
  const readyTimerRef = useRef(null)

  useEffect(
    () => () => {
      cancelAnimationFrame(rafRef.current)
      clearTimeout(readyTimerRef.current)
    },
    []
  )

  function startGame() {
    sound.setEnabled(soundOn)
    const players = roster.slice(0, 4).map((p) => ({
      id: p.id,
      name: p.name,
      zodiacId: p.zodiacId,
      color: getZodiac(p.zodiacId)?.color,
    }))
    setGame(createGame(players))
    setPhase('play')
    beginRound()
  }

  function beginRound() {
    durRef.current = randomDuration()
    pressRef.current = {}
    droppedRef.current = false
    setPressed({})
    setElapsed(0)
    setRoundPhase('ready')
    clearTimeout(readyTimerRef.current)
    readyTimerRef.current = setTimeout(() => {
      startRef.current = Date.now()
      setRoundPhase('running')
    }, READY_MS)
  }

  useEffect(() => {
    if (roundPhase !== 'running') return
    let active = true
    const tick = () => {
      if (!active) return
      const e = Date.now() - startRef.current
      setElapsed(e)
      if (!droppedRef.current && e >= durRef.current) {
        droppedRef.current = true
        sound.chuteDown() // 폭탄이 쏙(쌓임)
      }
      if (e >= durRef.current + TRAVEL_MS + 250) {
        finalizeRound()
        return
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      active = false
      cancelAnimationFrame(rafRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundPhase])

  function press(id) {
    if (roundPhase !== 'running') return
    if (pressRef.current[id] != null) return
    const t = Date.now() - startRef.current
    if (t >= durRef.current) return
    pressRef.current[id] = t
    setPressed({ ...pressRef.current })
    sound.step()
  }

  function finalizeRound() {
    const entries = game.players.map((p) => ({ id: p.id, pressAt: pressRef.current[p.id] ?? null }))
    const s = scoreRound(entries, durRef.current, TRAVEL_MS)
    setRoundPhase('result')
    const next = applyRoundScores(game, s.points)
    setGame(next)
    if (next.status === 'finished') setTimeout(() => sound.win(), 200)
  }

  function toggleSound() {
    const nx = !soundOn
    setSoundOn(nx)
    sound.setEnabled(nx)
    if (nx) sound.unlock()
  }

  if (phase === 'setup') {
    return <ThrillSetup roster={roster} onStart={startGame} onExit={onExit} />
  }

  const T = durRef.current || 3000
  const finished = game.status === 'finished'
  const win = finished ? winners(game) : []
  const seats = SEATS[game.players.length] || SEATS[4]

  // 도착(파이프 진입) 정보
  const bombDropped = elapsed >= T
  // 폭탄이 떨어진 순간부터는 누름 시각이 확정 → 라운드 점수를 바로 계산해 표시
  const scored = bombDropped
    ? scoreRound(
        game.players.map((p) => ({ id: p.id, pressAt: pressed[p.id] ?? null })),
        T,
        TRAVEL_MS
      )
    : null
  const items = game.players
    .filter((p) => pressed[p.id] != null)
    .map((p) => ({ kind: 'player', id: p.id, color: p.color, arrival: pressed[p.id] + TRAVEL_MS }))
  items.push({ kind: 'bomb', id: '__bomb', arrival: T })
  const inPipe = items.filter((it) => elapsed >= it.arrival).sort((a, b) => a.arrival - b.arrival)
  const bombIdx = inPipe.findIndex((it) => it.kind === 'bomb')

  return (
    <div className="thrill">
      <div className="ladder__topbar">
        <button className="btn btn--ghost" onClick={onExit}>
          ← 나가기
        </button>
        <div className="turn-indicator">
          {finished ? '🏁 게임 끝!' : `💣 ${game.round}/${game.rounds} 라운드`}
        </div>
        <div className="topbar__right">
          <button className="btn btn--ghost" onClick={toggleSound} aria-label="소리">
            {soundOn ? '🔊' : '🔇'}
          </button>
          <FullscreenButton />
        </div>
      </div>

      <div className="thrill__arena">
        {/* 각자 파이프(코너 → 튜브 입구) */}
        <svg className="thrill__pipes" viewBox="0 0 100 100" preserveAspectRatio="none">
          {game.players.map((p, i) => {
            const c = CORNERS[seats[i] || 'bl']
            return (
              <line
                key={p.id}
                x1={c.x}
                y1={c.y}
                x2={ENTRY.x}
                y2={ENTRY.y}
                stroke={p.color}
                strokeWidth="3.2"
                strokeLinecap="round"
                opacity="0.5"
              />
            )
          })}
        </svg>

        {/* 중앙 세로 튜브 */}
        <div
          className="thrill__tube"
          style={{ left: `${ENTRY.x}%`, top: `${ENTRY.y}%`, height: `${STACK_BOTTOM + 5 - ENTRY.y}%` }}
        />

        {/* 블랙홀(아래가 살짝 뾰족한 깔때기, 폭탄 전용) */}
        <div
          className="thrill__blackhole"
          style={{
            left: `${HOLE.x}%`,
            top: `${HOLE.y}%`,
            width: `${DISC.rx * 2}%`,
            height: `${DISC.ry * 2}%`,
          }}
        />
        {/* 가운데 실제 구멍(공 크기 + 약간 여유로 고정) */}
        <div className="thrill__hole" style={{ left: `${HOLE.x}%`, top: `${HOLE.y}%` }} />

        {/* 폭탄: 도착 전 블랙홀에서 회전 */}
        {!bombDropped &&
          (() => {
            const o = bombOrbit(elapsed / T)
            return (
              <div
                className="thrill-bomb"
                style={{ left: `${o.x}%`, top: `${o.y}%`, transform: `translate(-50%, -50%) scale(${o.scale})` }}
              >
                💣
              </div>
            )
          })()}

        {/* 파이프로 이동 중인 플레이어 공 */}
        {game.players.map((p, i) => {
          const pa = pressed[p.id]
          if (pa == null) return null
          const tp = (elapsed - pa) / TRAVEL_MS
          if (tp >= 1) return null // 도착 → 스택에서 렌더
          const c = CORNERS[seats[i] || 'bl']
          const x = lerp(c.x, ENTRY.x, tp)
          const y = lerp(c.y, ENTRY.y, tp)
          return (
            <span
              key={p.id}
              className="thrill-ball thrill-ball--rolling"
              style={{ left: `${x}%`, top: `${y}%`, '--z-color': p.color }}
            />
          )
        })}

        {/* 튜브에 쌓인 공들(도착 순서대로) */}
        {inPipe.map((it, k) => {
          const y = slotY(k)
          if (it.kind === 'bomb') {
            return (
              <div key="__bomb" className="thrill-bomb thrill-bomb--stacked" style={{ left: `${ENTRY.x}%`, top: y }}>
                💣
              </div>
            )
          }
          const disq = bombIdx >= 0 && k > bombIdx // 폭탄보다 위(늦음) → 실격
          return (
            <span
              key={it.id}
              className={`thrill-ball thrill-ball--stacked ${disq ? 'is-disq' : ''}`}
              style={{ left: `${ENTRY.x}%`, top: y, '--z-color': it.color }}
            />
          )
        })}

        {/* 폭탄 낙하 순간, 파이프 옆에 각 공의 라운드 점수 표시 */}
        {scored &&
          inPipe.map((it, k) => {
            if (it.kind === 'bomb') return null
            const row = scored.rows.find((r) => r.id === it.id)
            const ok = row && !row.busted
            const pl = game.players.find((p) => p.id === it.id)
            const z = pl && getZodiac(pl.zodiacId)
            return (
              <div
                key={`s-${it.id}`}
                className={`thrill-pipescore ${ok ? 'ok' : 'bust'}`}
                style={{ left: `${ENTRY.x + 9}%`, top: slotY(k), '--z-color': it.color }}
              >
                <span className="thrill-pipescore__who">
                  {z?.emoji} {pl?.name}
                </span>
                <span className="thrill-pipescore__pt">{ok ? `+${scored.points[it.id]}` : '실격'}</span>
              </div>
            )
          })}

        {/* 코너 버튼(스테이션) — 아레나 좌표계 안에서 파이프 시작점과 정렬 */}
        {game.players.map((p, i) => {
          const z = getZodiac(p.zodiacId)
          const c = CORNERS[seats[i] || 'bl']
          const done = pressed[p.id] != null
          return (
            <button
              key={p.id}
              className={`thrill-station ${done ? 'is-done' : ''}`}
              style={{ left: `${c.x}%`, top: `${c.y}%`, '--z-color': p.color }}
              disabled={roundPhase !== 'running' || done}
              onPointerDown={() => press(p.id)}
            >
              <span className="thrill-station__emoji">{z?.emoji}</span>
              <span className="thrill-station__name">{p.name}</span>
              <span className="thrill-station__score">{p.score}점</span>
            </button>
          )
        })}

        {roundPhase === 'ready' && <div className="thrill__banner">준비… 💣</div>}
      </div>

      {roundPhase === 'running' && !bombDropped && (
        <div className="thrill__hint">폭탄보다 늦지 않게! 폭탄 바로 아래에 쌓일수록 고득점 ⏱️</div>
      )}
      {roundPhase === 'result' && !finished && (
        <div className="thrill__next">
          <button className="btn btn--primary" onClick={beginRound}>
            다음 라운드 →
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
                <p>{win.map((p) => p.name).join(', ')} · {win[0].score}점</p>
              </>
            ) : (
              <>
                <h2>{win[0]?.name} 우승! 🎉</h2>
                <p>{win[0]?.score}점으로 1등!</p>
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
