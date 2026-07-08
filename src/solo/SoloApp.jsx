import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { CLASSES, CLASS_IDS, TEAM_SIZE, TEAM_SIZES } from '../games/rift/engine.js'
import { ZODIAC, getZodiac } from '../shared/zodiac.js'
import { riftNet } from '../games/rift/netgame.js'
import { createLocalNet } from '../net/localNet.js'
import {
  loadSoloPick, saveSoloPick, loadGuideSeen, saveGuideSeen, loadRiftRecords, addRiftRecord,
} from '../shared/storage.js'
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
      // 경기가 끝나면 내 직업 전적에 누적 — 중도 이탈(exit)은 기록하지 않는다
      onFinish(view) {
        const me = view.heroes?.find((h) => h.id === 'solo')
        if (!me) return
        addRiftRecord(me.cls, {
          win: !!view.winner && view.winner === me.team,
          kills: me.kills, deaths: me.deaths, assists: me.assists,
        })
      },
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
  // 직업별 봇전 전적 — 판이 끝날 때(onFinish) 누적된 걸 읽어 카드/헤더에 보여 준다
  const records = loadRiftRecords()
  const total = Object.values(records).reduce(
    (a, r) => ({ games: a.games + r.games, wins: a.wins + r.wins }),
    { games: 0, wins: 0 }
  )
  // 첫 진입이면 조작 가이드를 자동으로 띄운다(닫으면 다시 안 뜸, ❓ 버튼으로 언제든)
  const [helpOpen, setHelpOpen] = useState(() => !loadGuideSeen())
  function closeHelp() {
    saveGuideSeen()
    setHelpOpen(false)
  }

  const z = getZodiac(zodiacId)
  const c = cls ? CLASSES[cls] : null
  const rec = cls ? records[cls] : null

  return (
    <div className="solo">
      {/* 상단: 브랜드 워드마크 + 통산 전적 + 도움말/전체화면 */}
      <header className="solo__top">
        <div className="solo__brand">
          <span className="solo__logo" aria-hidden="true">⚡</span>
          <div>
            <h1 className="solo__wordmark">ZODIAC<span> RUSH</span></h1>
            <p className="solo__wordmark-sub">조디악 러쉬 · 솔로 봇전</p>
          </div>
        </div>
        <div className="solo__top-right">
          {total.games > 0 && (
            <span className="solo__total" title="봇전 통산 전적">
              🏆 {total.wins}승 {total.games - total.wins}패
              <small>{Math.round((total.wins / total.games) * 100)}%</small>
            </span>
          )}
          <button className="btn btn--ghost" onClick={() => setHelpOpen(true)} aria-label="조작법">❓ 조작법</button>
          <FullscreenButton />
        </div>
      </header>

      <div className="solo__main">
        {/* 좌: 선택한 캐릭터 쇼케이스 — 큰 얼굴 + 직업 스킬 미리보기 + 전적 + 시작 */}
        <aside className="solo__showcase" style={{ '--z-color': z?.color || '#ffcf4d' }}>
          <div className="solo__stage">
            <span className="solo__stage-ring" aria-hidden="true" />
            <span className="solo__stage-emoji">{z?.emoji}</span>
            {c && <span className="solo__stage-cls">{c.icon}</span>}
          </div>
          <div className="solo__stage-name">
            {z?.name}
            {c && <span className="solo__stage-clsname">{c.name}</span>}
          </div>

          {c ? (
            <>
              <p className="solo__stage-desc">{c.desc}</p>
              <ul className="solo__skills">
                {[
                  { tag: '스킬', ...c.skill },
                  { tag: '보조 · Lv3', ...c.skill2 },
                  { tag: '궁극 · Lv5', ...c.ult },
                ].map((s) => (
                  <li key={s.tag}>
                    <span className="solo__skill-icon">{s.icon}</span>
                    <span className="solo__skill-main">
                      <b>{s.name} <small>{s.tag}</small></b>
                      <span className="solo__skill-desc">{s.desc}</span>
                    </span>
                  </li>
                ))}
              </ul>
              {rec?.games > 0 && (
                <p className="solo__stage-rec">
                  이 직업 <b>{rec.wins}승 {rec.games - rec.wins}패</b> · 평균 ⚔️{(rec.kills / rec.games).toFixed(1)} 💀{(rec.deaths / rec.games).toFixed(1)} 🤝{(rec.assists / rec.games).toFixed(1)}
                </p>
              )}
            </>
          ) : (
            <p className="solo__stage-desc solo__stage-desc--hint">
              오른쪽에서 직업을 고르면<br />스킬을 미리 볼 수 있어요 👉
            </p>
          )}

          <button
            className="btn btn--primary solo__start"
            disabled={!cls}
            onClick={() => onStart({ zodiacId, cls, mode, botLevel })}
          >
            {cls ? '⚔️ 전투 시작' : '직업을 골라 주세요'}
          </button>
        </aside>

        {/* 우: 선택 — 난이도/모드 세그먼트 + 조디악 스트립 + 직업 그리드 */}
        <section className="solo__pick">
          <div className="solo__filters">
            <div className="solo__seg" role="radiogroup" aria-label="봇 난이도">
              {BOT_LEVEL_OPTS.map((o) => (
                <button
                  key={o.id}
                  className={`solo__seg-btn ${botLevel === o.id ? 'is-on' : ''}`}
                  title={o.desc}
                  onClick={() => setBotLevel(o.id)}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <div className="solo__seg" role="radiogroup" aria-label="모드">
              {Object.keys(TEAM_SIZES).map((m) => (
                <button
                  key={m}
                  className={`solo__seg-btn ${mode === m ? 'is-on' : ''}`}
                  onClick={() => setMode(m)}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          <div className="solo__zodiacs" role="radiogroup" aria-label="조디악 선택">
            {ZODIAC.map((zz) => (
              <button
                key={zz.id}
                className={`solo__zodiac ${zodiacId === zz.id ? 'is-on' : ''}`}
                style={{ '--z-color': zz.color }}
                title={zz.name}
                onClick={() => setZodiacId(zz.id)}
              >
                {zz.emoji}
              </button>
            ))}
          </div>

          <div className="draft__classes solo__classes">
            {CLASS_IDS.map((id) => {
              const cc = CLASSES[id]
              const rr = records[id]
              return (
                <button
                  key={id}
                  className={`draft-class ${cls === id ? 'is-on' : ''}`}
                  onClick={() => setCls(id)}
                >
                  <span className="draft-class__icon">{cc.icon}</span>
                  <span className="draft-class__name">{cc.name}</span>
                  {rr?.games > 0 && (
                    <span className="draft-class__rec">{rr.wins}승 {rr.games - rr.wins}패</span>
                  )}
                </button>
              )
            })}
          </div>
        </section>
      </div>

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
