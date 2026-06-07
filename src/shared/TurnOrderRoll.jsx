import { useEffect, useState } from 'react'
import Dice from './Dice.jsx'
import { getZodiac } from './zodiac.js'
import { sound } from './sound.js'

// 차례(턴 순서) 정하기 화면. 각자 캐릭터 아래 주사위를 굴려 높은 수가 선순위.
// 동점이면 그 사람들끼리 다시 굴려서 최종 순위를 정한다.
// players: [{ id, zodiacId, name }] → onComplete(orderedPlayers) 로 정렬된 배열 전달.
const roll6 = () => 1 + Math.floor(Math.random() * 6)

// 굴림 기록(내림차순) 비교: 첫 라운드부터 큰 수가 앞.
function compareHistory(a, b) {
  const n = Math.max(a.length, b.length)
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? -1
    const y = b[i] ?? -1
    if (x !== y) return y - x
  }
  return 0
}

export default function TurnOrderRoll({ players, onComplete, onBack }) {
  const [hist, setHist] = useState(() => Object.fromEntries(players.map((p) => [p.id, []])))
  const [roundActive, setRoundActive] = useState(() => players.map((p) => p.id)) // 이번 라운드에 굴릴 사람
  const [results, setResults] = useState({}) // 이번 라운드 결과 id -> number
  const [ordered, setOrdered] = useState(null) // 확정된 최종 순서

  // 이번 라운드의 활성 인원이 모두 굴리면 결과 반영
  useEffect(() => {
    if (ordered) return
    if (roundActive.length === 0) return
    if (!roundActive.every((id) => results[id] != null)) return

    const newHist = { ...hist }
    roundActive.forEach((id) => (newHist[id] = [...newHist[id], results[id]]))

    // 전체를 굴림기록으로 묶어 동점(같은 기록) 그룹을 찾는다
    const groups = {}
    players.forEach((p) => {
      const key = JSON.stringify(newHist[p.id])
      ;(groups[key] = groups[key] || []).push(p.id)
    })
    const nextActive = []
    Object.values(groups).forEach((ids) => {
      if (ids.length > 1) nextActive.push(...ids)
    })

    setHist(newHist)
    setResults({})
    if (nextActive.length === 0) {
      const order = [...players].sort((a, b) => compareHistory(newHist[a.id], newHist[b.id]))
      setOrdered(order)
      setTimeout(() => sound.win(), 150)
    } else {
      setRoundActive(nextActive)
      sound.key() // 동점 → 재대결
    }
  }, [results, roundActive, hist, players, ordered])

  const hasRolled = players.some((p) => hist[p.id].length > 0)
  const tieBreak = !ordered && hasRolled && roundActive.length < players.length
  const rankOf = (id) => (ordered ? ordered.findIndex((p) => p.id === id) + 1 : null)

  return (
    <div className="turnorder">
      <div className="setup__topbar">
        <button className="btn btn--ghost" onClick={onBack}>
          ← 뒤로
        </button>
        <h2>🎲 차례 정하기</h2>
        <span style={{ width: 64 }} />
      </div>

      <p className="turnorder__hint">
        {ordered
          ? '순서가 정해졌어요!'
          : tieBreak
          ? '동점! 같은 수끼리 다시 굴려요'
          : '각자 주사위를 굴려요 · 높은 수가 먼저!'}
      </p>

      <div className="turnorder__grid">
        {players.map((p) => {
          const z = getZodiac(p.zodiacId)
          const canRoll = !ordered && roundActive.includes(p.id) && results[p.id] == null
          const last = results[p.id] != null ? results[p.id] : hist[p.id][hist[p.id].length - 1]
          const rank = rankOf(p.id)
          return (
            <div
              key={p.id}
              className={`turnorder__player ${canRoll ? 'is-active' : ''}`}
              style={{ '--z-color': z?.color }}
            >
              {rank != null && <span className="turnorder__rank">{rank}등</span>}
              <span className="turnorder__emoji">{z?.emoji}</span>
              <span className="turnorder__name">{p.name}</span>
              <Dice
                disabled={!canRoll}
                rollFn={roll6}
                onResult={(n) => setResults((r) => ({ ...r, [p.id]: n }))}
              />
              <span className="turnorder__roll">{last != null ? last : ' '}</span>
            </div>
          )
        })}
      </div>

      {ordered && (
        <button className="btn btn--primary turnorder__go" onClick={() => onComplete(ordered)}>
          이 순서로 시작! 🎮
        </button>
      )}
    </div>
  )
}
