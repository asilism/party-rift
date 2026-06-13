import { useMemo, useState } from 'react'
import { getZodiac, ZODIAC } from '../../shared/zodiac.js'
import { TEAM_SIZE, CLASSES, CLASS_IDS } from './engine.js'

// 팀/직업 고르기 화면 (호스트 전용):
//  - 참가자 이름을 탭하면 팀이 바뀌고, 직업 배지를 탭하면 직업이 바뀐다.
//  - 한 팀에 같은 직업은 한 명만! 모자란 자리는 봇이 남은 직업으로 채운다.
export default function RiftSetup({ racers, benched, onStart, onExit }) {
  // 기본 배정: 번갈아 가며 파랑/빨강, 직업은 순서대로
  const [teams, setTeams] = useState(() => {
    const t = {}
    racers.forEach((p, i) => {
      t[p.id] = i % 2 === 0 ? 'blue' : 'red'
    })
    return t
  })
  const [classes, setClasses] = useState(() => {
    const c = {}
    const used = { blue: new Set(), red: new Set() }
    racers.forEach((p, i) => {
      const team = i % 2 === 0 ? 'blue' : 'red'
      const cls = CLASS_IDS.find((id) => !used[team].has(id))
      used[team].add(cls)
      c[p.id] = cls
    })
    return c
  })

  const counts = useMemo(() => {
    const c = { blue: 0, red: 0 }
    for (const p of racers) c[teams[p.id]]++
    return c
  }, [racers, teams])

  const usedCls = useMemo(() => {
    const u = { blue: new Set(), red: new Set() }
    for (const p of racers) u[teams[p.id]].add(classes[p.id])
    return u
  }, [racers, teams, classes])

  // 팀 이동: 새 팀에서 직업이 겹치면 빈 직업으로 바꿔준다
  function toggleTeam(p) {
    const cur = teams[p.id]
    const other = cur === 'blue' ? 'red' : 'blue'
    if (counts[other] >= TEAM_SIZE) return // 그쪽 팀이 꽉 찼어요
    const takenThere = new Set(
      racers.filter((o) => o.id !== p.id && teams[o.id] === other).map((o) => classes[o.id])
    )
    setTeams((t) => ({ ...t, [p.id]: other }))
    if (takenThere.has(classes[p.id])) {
      const free = CLASS_IDS.find((id) => !takenThere.has(id))
      setClasses((c) => ({ ...c, [p.id]: free }))
    }
  }

  // 직업 바꾸기: 같은 팀에서 안 쓰는 다음 직업으로 순환
  function cycleClass(p) {
    const team = teams[p.id]
    const taken = new Set(
      racers.filter((o) => o.id !== p.id && teams[o.id] === team).map((o) => classes[o.id])
    )
    const cur = CLASS_IDS.indexOf(classes[p.id])
    for (let k = 1; k <= CLASS_IDS.length; k++) {
      const next = CLASS_IDS[(cur + k) % CLASS_IDS.length]
      if (!taken.has(next)) {
        setClasses((c) => ({ ...c, [p.id]: next }))
        return
      }
    }
  }

  // 미리보기: 남는 자리를 채울 봇 (남은 12지신 + 남은 직업)
  const botPreview = useMemo(() => {
    const usedZ = new Set(racers.map((p) => p.zodiacId))
    const freeZ = ZODIAC.filter((z) => !usedZ.has(z.id))
    let zi = 0
    const make = (team) => {
      const taken = new Set(racers.filter((p) => teams[p.id] === team).map((p) => classes[p.id]))
      const bots = []
      for (let i = counts[team]; i < TEAM_SIZE; i++) {
        const z = freeZ[zi++]
        const cls = CLASS_IDS.find((id) => !taken.has(id))
        taken.add(cls)
        if (z) bots.push({ z, cls })
      }
      return bots
    }
    return { blue: make('blue'), red: make('red') }
  }, [racers, teams, classes, counts])

  const ok = counts.blue <= TEAM_SIZE && counts.red <= TEAM_SIZE

  return (
    <div className="rift-setup">
      <div className="ladder__topbar">
        <button className="btn btn--ghost" onClick={onExit}>← 나가기</button>
        <div className="turn-indicator">⚔️ 파티 리프트 — 팀 & 직업</div>
        <div />
      </div>
      <p className="rift-setup__hint">
        이름을 탭하면 팀 이동, 직업 배지를 탭하면 직업 변경. 한 팀에 같은 직업은 한 명만!
      </p>
      <div className="rift-setup__teams">
        {['blue', 'red'].map((team) => (
          <div key={team} className={`rift-setup__team rift-setup__team--${team}`}>
            <h3>{team === 'blue' ? '🔵 파랑팀' : '🔴 빨강팀'}</h3>
            {racers.filter((p) => teams[p.id] === team).map((p) => {
              const cls = CLASSES[classes[p.id]]
              return (
                <div key={p.id} className="rift-setup__chip">
                  <button className="rift-setup__who" onClick={() => toggleTeam(p)} title="팀 바꾸기">
                    <span>{getZodiac(p.zodiacId)?.emoji}</span> {p.name} <small>↔</small>
                  </button>
                  <button
                    className="rift-setup__cls"
                    onClick={() => cycleClass(p)}
                    title={`${cls.desc} — 스킬: ${cls.skill.name}(${cls.skill.desc}) / 궁극기: ${cls.ult.name}(${cls.ult.desc})`}
                  >
                    {cls.icon} {cls.name}
                  </button>
                </div>
              )
            })}
            {botPreview[team].map(({ z, cls }) => (
              <div key={z.id} className="rift-setup__chip rift-setup__chip--bot">
                <span className="rift-setup__who">
                  <span>{z.emoji}</span> {z.name}봇 🤖
                </span>
                <span className="rift-setup__cls">{CLASSES[cls].icon} {CLASSES[cls].name}</span>
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
        <span>🗺️ 3갈래 길 — 타워를 부수고 넥서스를 터뜨리면 승리!</span>
        <span>🌿 수풀에 숨으면 적에게 안 보여요 (시야 밖 적도 안 보임)</span>
        <span>🐺 정글몹 · 🐉 용 · 👹 바론을 잡으면 강해져요</span>
        <span>⏱️ 10분 안에 못 끝내면 타워/킬 점수로 판정</span>
      </div>
      <button
        className="btn btn--primary rift-setup__start"
        disabled={!ok}
        onClick={() => onStart(teams, classes)}
      >
        🚀 전투 시작!
      </button>
    </div>
  )
}
