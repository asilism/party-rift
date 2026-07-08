import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { CLASSES, CLASS_IDS, TEAM_SIZE, TEAM_SIZES } from '../games/rift/engine.js'
import { ZODIAC, getZodiac } from '../shared/zodiac.js'
import { riftNet } from '../games/rift/netgame.js'
import { createLocalNet } from '../net/localNet.js'
import { loadSoloPick, saveSoloPick, loadGuideSeen, saveGuideSeen } from '../shared/storage.js'
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
      config: { mode: pick.mode, roster: buildSoloRoster(pick), botLevel: pick.botLevel },
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

// 봇 난이도 — engine BOT_LEVELS(easy/normal/hard)와 짝
const BOT_LEVEL_OPTS = [
  { id: 'easy', label: '😌 쉬움', desc: '봇이 뜸을 들이고 덜 아파요 — 처음이라면 여기부터' },
  { id: 'normal', label: '⚔️ 보통', desc: '온라인과 같은 봇' },
  { id: 'hard', label: '🔥 어려움', desc: '칼같이 반응하고 더 아프게' },
]

function SoloSetup({ onStart }) {
  const saved = loadSoloPick()
  const [zodiacId, setZodiacId] = useState(getZodiac(saved?.zodiacId) ? saved.zodiacId : 'tiger')
  const [cls, setCls] = useState(CLASSES[saved?.cls] ? saved.cls : null)
  const [mode, setMode] = useState(TEAM_SIZES[saved?.mode] ? saved.mode : '3v3')
  // 처음 온 사람 기본값은 쉬움 — 저장된 선택이 있으면 그걸 따른다
  const [botLevel, setBotLevel] = useState(
    BOT_LEVEL_OPTS.some((o) => o.id === saved?.botLevel) ? saved.botLevel : 'easy'
  )
  // 첫 진입이면 조작 가이드를 자동으로 띄운다(닫으면 다시 안 뜸, ❓ 버튼으로 언제든)
  const [helpOpen, setHelpOpen] = useState(() => !loadGuideSeen())
  function closeHelp() {
    saveGuideSeen()
    setHelpOpen(false)
  }

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
          <button className="btn btn--ghost" onClick={() => setHelpOpen(true)} aria-label="조작법">❓ 조작법</button>
          <FullscreenButton />
        </div>
      </header>

      <div className="solo__levels" role="radiogroup" aria-label="봇 난이도">
        {BOT_LEVEL_OPTS.map((o) => (
          <button
            key={o.id}
            className={`solo__level ${botLevel === o.id ? 'is-on' : ''}`}
            title={o.desc}
            onClick={() => setBotLevel(o.id)}
          >
            {o.label}
          </button>
        ))}
      </div>

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
          onClick={() => onStart({ zodiacId, cls, mode, botLevel })}
        >
          {cls ? `⚔️ ${CLASSES[cls].icon} ${CLASSES[cls].name}(으)로 전투 시작` : '직업을 골라 주세요'}
        </button>
      </footer>

      {helpOpen && <SoloHelp onClose={closeHelp} />}
    </div>
  )
}

// 조작 가이드 — 첫 실행 온보딩 겸 언제든 여는 도움말. 게임 목표 → 조작 → 성장 순서.
function SoloHelp({ onClose }) {
  return (
    <div className="solo-help" onClick={onClose}>
      <div className="solo-help__card" onClick={(e) => e.stopPropagation()}>
        <h2 className="solo-help__title">🎮 처음 오셨나요?</h2>

        <div className="solo-help__sec">
          <h3>🏆 목표</h3>
          <p>3갈래 레인의 <b>타워</b>를 부수며 전진해 적 <b>넥서스</b>를 터뜨리면 승리!</p>
        </div>

        <div className="solo-help__sec">
          <h3>🕹️ 조작 <small>(게임 중 ⚙️ 설정에서 바꿀 수 있어요)</small></h3>
          <ul>
            <li>⌨️ <b>키보드</b> — WASD·화살표 이동 · <b>L</b> 평타 · <b>H/J/K</b> 스킬 · <b>1·2</b> 아이템</li>
            <li>📱 <b>모바일/터치</b> — 왼쪽 드래그로 이동 · 오른쪽 버튼으로 공격/스킬</li>
            <li>🎮 <b>Xbox 패드</b> — 스틱 이동 · A 평타 · X/Y/B 스킬 · LB·RB 아이템</li>
          </ul>
        </div>

        <div className="solo-help__sec">
          <h3>📈 성장</h3>
          <p>
            미니언·정글몹을 잡아 <b>경험치·골드</b>를 모으고, 우물(시작 지점)에서 🛒 <b>상점</b>으로 장비를 맞춰요.
            Lv3에 보조 스킬, Lv5에 궁극기가 열려요.
          </p>
        </div>

        <div className="solo-help__sec">
          <h3>💡 꿀팁</h3>
          <p>🌿 수풀에 숨으면 안 보여요 · 🐉 용/👹 바론은 팀 버프 · 위험하면 🏠 귀환!</p>
        </div>

        <button className="btn btn--primary solo-help__ok" onClick={onClose}>알겠어요, 시작할게요!</button>
      </div>
    </div>
  )
}
