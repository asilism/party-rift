import { useMemo, useState } from 'react'
import { getZodiac, ZODIAC } from '../../shared/zodiac.js'
import { TEAM_SIZE } from './engine.js'

// 팀 나누기 화면 (호스트 전용): 참가자를 탭해서 파랑/빨강 팀을 오가고,
// 모자란 자리는 봇이 채운다. 3:3 고정.
export default function RiftSetup({ racers, benched, onStart, onExit }) {
  // 기본 배정: 번갈아 가며 파랑/빨강
  const [teams, setTeams] = useState(() => {
    const t = {}
    racers.forEach((p, i) => {
      t[p.id] = i % 2 === 0 ? 'blue' : 'red'
    })
    return t
  })

  const counts = useMemo(() => {
    const c = { blue: 0, red: 0 }
    for (const p of racers) c[teams[p.id]]++
    return c
  }, [racers, teams])

  function toggle(p) {
    const cur = teams[p.id]
    const other = cur === 'blue' ? 'red' : 'blue'
    if (counts[other] >= TEAM_SIZE) return // 그쪽 팀이 꽉 찼어요
    setTeams((t) => ({ ...t, [p.id]: other }))
  }

  // 미리보기: 남는 자리를 채울 봇 (시작 시에도 같은 규칙으로 뽑는다)
  const botPreview = useMemo(() => {
    const used = new Set(racers.map((p) => p.zodiacId))
    const free = ZODIAC.filter((z) => !used.has(z.id))
    return {
      blue: free.slice(0, Math.max(0, TEAM_SIZE - counts.blue)),
      red: free.slice(
        Math.max(0, TEAM_SIZE - counts.blue),
        Math.max(0, TEAM_SIZE - counts.blue) + Math.max(0, TEAM_SIZE - counts.red)
      ),
    }
  }, [racers, counts])

  const ok = counts.blue <= TEAM_SIZE && counts.red <= TEAM_SIZE

  return (
    <div className="rift-setup">
      <div className="ladder__topbar">
        <button className="btn btn--ghost" onClick={onExit}>← 나가기</button>
        <div className="turn-indicator">⚔️ 파티 리프트 — 팀 나누기</div>
        <div />
      </div>
      <p className="rift-setup__hint">
        참가자를 탭하면 팀이 바뀌어요. 빈자리는 봇이 채워서 3:3으로 싸워요!
      </p>
      <div className="rift-setup__teams">
        {['blue', 'red'].map((team) => (
          <div key={team} className={`rift-setup__team rift-setup__team--${team}`}>
            <h3>{team === 'blue' ? '🔵 파랑팀' : '🔴 빨강팀'}</h3>
            {racers.filter((p) => teams[p.id] === team).map((p) => (
              <button key={p.id} className="rift-setup__chip" onClick={() => toggle(p)}>
                <span>{getZodiac(p.zodiacId)?.emoji}</span> {p.name}
                <small>↔</small>
              </button>
            ))}
            {botPreview[team].map((z) => (
              <div key={z.id} className="rift-setup__chip rift-setup__chip--bot">
                <span>{z.emoji}</span> {z.name}봇 🤖
              </div>
            ))}
          </div>
        ))}
      </div>
      {benched.length > 0 && (
        <p className="rift-setup__bench">
          👀 관전: 같은 기기 두 번째 참가자부터는 구경해요 —{' '}
          {benched.map((p) => `${getZodiac(p.zodiacId)?.emoji}${p.name}`).join(' · ')}
        </p>
      )}
      <div className="rift-setup__rules">
        <span>🗺️ 타워를 부수고 넥서스를 터뜨리면 승리!</span>
        <span>🐺 정글몹 · 🐉 용 · 👹 바론을 잡으면 강해져요</span>
        <span>⏱️ 10분 안에 못 끝내면 타워/킬 점수로 판정</span>
      </div>
      <button
        className="btn btn--primary rift-setup__start"
        disabled={!ok}
        onClick={() => onStart(teams)}
      >
        🚀 전투 시작!
      </button>
    </div>
  )
}
