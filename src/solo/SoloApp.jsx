import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { CLASSES, CLASS_IDS, TEAM_SIZE, TEAM_SIZES } from '../games/rift/engine.js'
import { ZODIAC, getZodiac } from '../shared/zodiac.js'
import { riftNet } from '../games/rift/netgame.js'
import { createLocalNet } from '../net/localNet.js'
import { loadSoloPick, saveSoloPick } from '../shared/storage.js'
import FullscreenButton from '../shared/FullscreenButton.jsx'

const RiftGame = lazy(() => import('../games/rift/RiftGame.jsx'))

// 솔로(오프라인) 모드 — 서버 없이 캐릭터를 고르고 봇들과 한 판.
//  Electron 데스크톱 빌드의 기본 화면이고, 웹에서도 ?solo로 열 수 있다.
//  전투는 온라인과 완전히 같은 RiftGame — net만 로컬 어댑터(createLocalNet)로 바꿔 낀다.

const shuffle = (arr) => {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// 온라인 드래프트가 만드는 것과 같은 완성 로스터 — 봇은 매판 랜덤 조디악·직업(팀 내 중복 없음)
function buildSoloRoster({ zodiacId, cls, mode }) {
  const size = TEAM_SIZES[mode] || TEAM_SIZE
  const me = getZodiac(zodiacId)
  const freeZ = shuffle(ZODIAC.filter((z) => z.id !== zodiacId))
  const roster = [{ id: 'solo', name: me?.name || '나', zodiacId, color: me?.color, team: 'blue', cls, deviceId: 'solo' }]
  for (const team of ['blue', 'red']) {
    const taken = new Set(team === 'blue' ? [cls] : [])
    for (let i = team === 'blue' ? 1 : 0; i < size; i++) {
      const botCls = shuffle(CLASS_IDS.filter((c) => !taken.has(c)))[0]
      taken.add(botCls)
      const z = freeZ.shift()
      if (!z) break
      roster.push({ id: `bot-${z.id}`, name: `${z.name}봇`, zodiacId: z.id, color: z.color, team, cls: botCls, isBot: true })
    }
  }
  return roster
}

export default function SoloApp() {
  const [net, setNet] = useState(null)
  const netRef = useRef(null)
  useEffect(() => () => netRef.current?.close(), []) // 언마운트 시 로컬 시뮬 정리

  function start(pick) {
    saveSoloPick(pick)
    const n = createLocalNet(riftNet, {
      players: [],
      config: { mode: pick.mode, roster: buildSoloRoster(pick) },
      deviceId: 'solo',
    })
    netRef.current = n
    setNet(n)
  }

  function exit() {
    netRef.current?.close()
    netRef.current = null
    setNet(null)
  }

  if (!net) return <SoloSetup onStart={start} />

  return (
    <Suspense fallback={<div className="net-screen"><div className="net-screen__icon">⏳</div><p>전장을 불러오는 중...</p></div>}>
      <RiftGame net={net} onExit={exit} />
    </Suspense>
  )
}

function SoloSetup({ onStart }) {
  const saved = loadSoloPick()
  const [zodiacId, setZodiacId] = useState(getZodiac(saved?.zodiacId) ? saved.zodiacId : 'tiger')
  const [cls, setCls] = useState(CLASSES[saved?.cls] ? saved.cls : null)
  const [mode, setMode] = useState(TEAM_SIZES[saved?.mode] ? saved.mode : '3v3')

  return (
    <div className="solo">
      <header className="solo__header">
        <div>
          <h1 className="solo__title">⚔️ 조디악 러쉬</h1>
          <p className="solo__sub">캐릭터를 고르고 봇들과 한 판!</p>
        </div>
        <div className="solo__header-right">
          <div className="solo__modes">
            {Object.keys(TEAM_SIZES).map((m) => (
              <button
                key={m}
                className={`btn ${mode === m ? 'btn--primary' : 'btn--ghost'}`}
                onClick={() => setMode(m)}
              >
                {m}
              </button>
            ))}
          </div>
          <FullscreenButton />
        </div>
      </header>

      <div className="solo__zodiacs" role="radiogroup" aria-label="조디악 선택">
        {ZODIAC.map((z) => (
          <button
            key={z.id}
            className={`solo__zodiac ${zodiacId === z.id ? 'is-on' : ''}`}
            style={{ '--z-color': z.color }}
            title={z.name}
            onClick={() => setZodiacId(z.id)}
          >
            {z.emoji}
          </button>
        ))}
      </div>

      <div className="draft__classes solo__classes">
        {CLASS_IDS.map((id) => {
          const c = CLASSES[id]
          return (
            <button
              key={id}
              className={`draft-class ${cls === id ? 'is-on' : ''}`}
              onClick={() => setCls(id)}
            >
              <span className="draft-class__icon">{c.icon}</span>
              <span className="draft-class__name">{c.name}</span>
              <span className="draft-class__desc">{c.desc}</span>
            </button>
          )
        })}
      </div>

      <footer className="solo__footer">
        <button
          className="btn btn--primary solo__start"
          disabled={!cls}
          onClick={() => onStart({ zodiacId, cls, mode })}
        >
          {cls ? `⚔️ ${CLASSES[cls].icon} ${CLASSES[cls].name}(으)로 전투 시작` : '직업을 골라 주세요'}
        </button>
      </footer>
    </div>
  )
}
