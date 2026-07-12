import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { CLASSES, CLASS_IDS, TEAM_SIZES } from '../games/rift/engine.js'
import { ZODIAC, getZodiac } from '../shared/zodiac.js'
import { riftNet } from '../games/rift/netgame.js'
import { createLocalNet } from '../net/localNet.js'
import { sound } from '../shared/sound.js'
import {
  loadSoloPick, saveSoloPick, loadGuideSeen, saveGuideSeen, loadRiftRecords, addRiftRecord,
  loadUnlockSeen, saveUnlockSeen, loadProfile, saveProfile, loadSoundOn, saveSoundOn,
} from '../shared/storage.js'
import { t, getLang, switchLang } from '../shared/i18n.js'
import { unlockedClassIds, unlockedCount, nextUnlock, STARTER_COUNT } from './unlocks.js'
import { buildSoloRoster } from './roster.js'
import MenuStage from './MenuStage.jsx'
import HeroShowcase from './HeroShowcase.jsx'
import FullscreenButton from '../shared/FullscreenButton.jsx'
// 오픈소스 고지 전문 — 빌드에 원문 그대로 번들되어 웹/데스크톱/안드로이드 배포물 모두에 포함된다
import NOTICES from '../../THIRD_PARTY_NOTICES.md?raw'

const RiftGame = lazy(() => import('../games/rift/RiftGame.jsx'))

// 솔로(오프라인) 모드 — 고전 콘솔식 4뎁스 셸.
//   타이틀(눌러서 시작) → 메인 메뉴 → 모드·난이도 → 캐릭터 선택 → 전투
// 모든 메뉴 화면 뒤에는 봇들이 실제로 싸우는 라이브 전장(MenuStage)이 흐른다.
// 조디악(수호 지신)은 프로필 — 첫 실행에 한 번 정하고 메뉴에서 변경한다.

const BOT_LEVEL_OPTS = [
  { id: 'easy', label: '😌 쉬움', desc: '봇이 뜸을 들이고 덜 아파요 — 처음이라면 여기부터' },
  { id: 'normal', label: '⚔️ 보통', desc: '온라인과 같은 봇' },
  { id: 'hard', label: '🔥 어려움', desc: '칼같이 반응하고 더 아프게' },
]

const MODE_OPTS = [
  { id: '3v3', emoji: '⚔️', name: '3 대 3', desc: '작은 맵 · 빠른 한판', tag: '기본' },
  { id: '5v5', emoji: '🐉', name: '5 대 5', desc: '넓은 맵 · 정글 대격전', tag: '큰판' },
]

export default function SoloApp() {
  const [profile, setProfileState] = useState(() => {
    const p = loadProfile()
    return getZodiac(p) ? p : null
  })
  const [screen, setScreen] = useState(() => {
    // 언어 전환 등 새로고침 뒤 복귀할 화면(1회성 힌트)
    try {
      const r = sessionStorage.getItem('bgp.rift.resume.v1')
      if (r) {
        sessionStorage.removeItem('bgp.rift.resume.v1')
        return r
      }
    } catch { /* 무시 */ }
    return 'title'
  }) // title | profile | menu | mode | char | records | settings | play
  const saved = loadSoloPick()
  const [mode, setMode] = useState(TEAM_SIZES[saved?.mode] ? saved.mode : '3v3')
  const [botLevel, setBotLevel] = useState(
    BOT_LEVEL_OPTS.some((o) => o.id === saved?.botLevel) ? saved.botLevel : 'easy'
  )
  const [net, setNet] = useState(null)
  const netRef = useRef(null)
  const [helpOpen, setHelpOpen] = useState(false)
  const [exitAsk, setExitAsk] = useState(false) // 전투 중 뒤로가기 → "나갈까요?" 확인
  useEffect(() => () => netRef.current?.close(), [])

  function go(next) {
    sound.step()
    setScreen(next)
  }

  useEffect(() => {
    sound.setEnabled(loadSoundOn()) // 저장된 전역 사운드 설정 적용
  }, [])

  function enterFromTitle() {
    sound.unlock()
    sound.go()
    setScreen(profile ? 'menu' : 'profile')
  }

  function pickProfile(zodiacId) {
    saveProfile(zodiacId)
    setProfileState(zodiacId)
    go('menu')
  }

  function startBattle(cls) {
    const pick = { zodiacId: profile, cls, mode, botLevel }
    saveSoloPick(pick)
    const n = createLocalNet(riftNet, {
      players: [],
      config: { mode, roster: buildSoloRoster(pick), botLevel },
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
    if (typeof window !== 'undefined') window.__soloNet = n // E2E 캡처/디버그용 핸들 — 게임 코드는 참조 금지
    setNet(n)
    setScreen('play')
  }

  function exitBattle() {
    netRef.current?.close()
    netRef.current = null
    setNet(null)
    setScreen('char') // 모드·난이도 유지한 채 "한 판 더" 흐름
  }

  // 뒤로가기(ESC/안드로이드 하드웨어 버튼) 공통 처리:
  //  가이드 열림 → 닫기 / 전투 중 → 일시정지 + "나갈까요?" 확인 / 메뉴 → 이전 화면 / 타이틀 → 앱 종료(안드로이드만)
  useEffect(() => {
    const back = { profile: profile ? 'menu' : 'title', menu: 'title', mode: 'menu', char: 'mode', records: 'menu', licenses: 'settings', settings: 'menu' }
    const handleBack = () => {
      if (helpOpen) { saveGuideSeen(); setHelpOpen(false); return }
      if (screen === 'play') {
        if (exitAsk) { setExitAsk(false); netRef.current?.rtPause(false) } // 확인창에서 뒤로 = 계속 싸우기
        else { setExitAsk(true); netRef.current?.rtPause(true) }
        return
      }
      if (back[screen]) { setScreen(back[screen]); return }
      // 타이틀에서 뒤로 = 안드로이드 관례상 앱 종료 (웹/데스크톱은 무시)
      if (screen === 'title' && window.Capacitor?.isNativePlatform?.()) {
        import('@capacitor/app').then(({ App }) => App.exitApp()).catch(() => {})
      }
    }
    const onKey = (e) => { if (e.key === 'Escape') handleBack() }
    const onBack = () => handleBack()
    window.addEventListener('keydown', onKey)
    window.addEventListener('zodiac-back', onBack)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('zodiac-back', onBack)
    }
  }, [screen, profile, helpOpen, exitAsk])

  // 안드로이드 하드웨어 뒤로가기 → zodiac-back 이벤트로 위 핸들러에 합류
  useEffect(() => {
    if (!window.Capacitor?.isNativePlatform?.()) return undefined
    let handle = null
    let dead = false
    import('@capacitor/app').then(({ App }) => {
      const p = App.addListener('backButton', () => window.dispatchEvent(new CustomEvent('zodiac-back')))
      Promise.resolve(p).then((h) => { if (dead) h.remove?.(); else handle = h })
    }).catch(() => {})
    return () => {
      dead = true
      handle?.remove?.()
    }
  }, [])

  // 백그라운드로 가면(전화·홈 화면) 전투를 자동 일시정지 — 복귀하면 기존 일시정지
  // 화면("재개하기" 버튼)이 떠 있어 유저 타이밍에 재개한다.
  useEffect(() => {
    if (screen !== 'play') return undefined
    const onVis = () => {
      if (document.hidden) netRef.current?.rtPause(true)
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [screen])

  if (screen === 'play') {
    return (
      <Suspense fallback={<div className="net-screen"><div className="net-screen__icon">⏳</div><p>{t('전장을 불러오는 중...')}</p></div>}>
        <RiftGame net={net} onExit={exitBattle} />
        {exitAsk && (
          <div className="solo-help" onClick={() => { setExitAsk(false); netRef.current?.rtPause(false) }}>
            <div className="toy-card solo-help__card" onClick={(e) => e.stopPropagation()}>
              <h2 className="toy-heading">{t('전투에서 나갈까요?')}</h2>
              <p className="toy-sub">{t('지금 나가면 이 판은 전적에 기록되지 않아요')}</p>
              <div className="solo-exit__btns">
                <button
                  className="toy-btn toy-btn--green"
                  onClick={() => { setExitAsk(false); netRef.current?.rtPause(false) }}
                >
                  {t('⚔️ 계속 싸우기')}
                </button>
                <button
                  className="toy-btn toy-btn--orange"
                  onClick={() => { setExitAsk(false); exitBattle() }}
                >
                  {t('🚪 나가기')}
                </button>
              </div>
            </div>
          </div>
        )}
      </Suspense>
    )
  }

  return (
    <div className="shell">
      <MenuStage />
      {screen === 'title' && <TitleScreen onEnter={enterFromTitle} />}
      {screen === 'profile' && (
        <ProfileScreen current={profile} onPick={pickProfile} onBack={profile ? () => go('menu') : null} />
      )}
      {screen === 'menu' && (
        <MainMenu
          profile={profile}
          onPlay={() => go('mode')}
          onRecords={() => go('records')}
          onHelp={() => setHelpOpen(true)}
          onProfile={() => go('profile')}
          onSettings={() => go('settings')}
        />
      )}
      {screen === 'settings' && <SettingsScreen onBack={() => go('menu')} onLicenses={() => go('licenses')} />}
      {screen === 'mode' && (
        <ModeScreen
          botLevel={botLevel}
          onBotLevel={setBotLevel}
          onPick={(m) => { setMode(m); go('char') }}
          onBack={() => go('menu')}
        />
      )}
      {screen === 'char' && (
        <CharScreen
          profile={profile}
          mode={mode}
          botLevel={botLevel}
          onStart={startBattle}
          onBack={() => go('mode')}
          onHelp={() => setHelpOpen(true)}
        />
      )}
      {screen === 'records' && <RecordsScreen onBack={() => go('menu')} />}
      {screen === 'licenses' && <LicensesScreen onBack={() => go('settings')} />}
      {helpOpen && <SoloHelp onClose={() => { saveGuideSeen(); setHelpOpen(false) }} />}
    </div>
  )
}

// ── 1. 타이틀 — 로고 + "눌러서 시작" ──
function TitleScreen({ onEnter }) {
  useEffect(() => {
    const onKey = () => onEnter()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <div className="screen title-screen" onPointerDown={onEnter}>
      <div className="title-screen__top">
        <FullscreenButton />
      </div>
      <div className="toy-logo">
        <h1 className="toy-logo__en">ZODIAC<span className="toy-logo__bolt">⚡</span>BLITZ</h1>
        {getLang() !== 'en' && <p className="toy-logo__ko">조디악 블리츠</p>}
      </div>
      <p className="title-screen__press">TOUCH TO START</p>
      <p className="title-screen__ver">v0.1</p>
    </div>
  )
}

// ── 1.5. 프로필 — 수호 지신 선택 (첫 실행 1회, 메뉴에서 변경 가능) ──
function ProfileScreen({ current, onPick, onBack }) {
  return (
    <div className="screen profile-screen">
      {onBack && <BackButton onBack={onBack} />}
      <div className="toy-card profile-card">
        <h2 className="toy-heading">{t('너의 수호 지신은?')}</h2>
        <p className="toy-sub">{t('전장에서 네 얼굴이 될 동물이야 — 언제든 메뉴에서 바꿀 수 있어')}</p>
        <div className="profile-card__grid">
          {ZODIAC.map((z) => (
            <button
              key={z.id}
              className={`toy-zodiac ${current === z.id ? 'is-on' : ''}`}
              style={{ '--z-color': z.color }}
              onClick={() => onPick(z.id)}
            >
              <span className="toy-zodiac__emoji">{z.emoji}</span>
              <span className="toy-zodiac__name">{t(z.name)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── 2. 메인 메뉴 ──
function MainMenu({ profile, onPlay, onRecords, onHelp, onProfile, onSettings }) {
  const z = getZodiac(profile)
  const records = loadRiftRecords()
  const total = Object.values(records).reduce(
    (a, r) => ({ games: a.games + r.games, wins: a.wins + r.wins }),
    { games: 0, wins: 0 }
  )
  return (
    <div className="screen menu-screen">
      <div className="menu-screen__logo">
        <h1 className="toy-logo__en toy-logo__en--small">ZODIAC<span className="toy-logo__bolt">⚡</span>BLITZ</h1>
      </div>
      <button className="profile-chip" onClick={onProfile} title={t('수호 지신 바꾸기')}>
        <span className="profile-chip__emoji">{z?.emoji}</span>
        <span className="profile-chip__info">
          <b>{z?.name}</b>
          <small>{total.games > 0 ? `${total.wins}${t('승')} ${total.games - total.wins}${t('패')}` : t('첫 출전 대기')}</small>
        </span>
      </button>
      <nav className="menu-screen__list">
        <button className="toy-btn toy-btn--yellow toy-btn--big" onClick={onPlay}>{t('⚔️ 게임 시작')}</button>
        {/* 온라인은 멀티 재개방 때까지 비활성 (웹 온라인 플로우는 ?solo 없는 주소로 여전히 접근 가능) */}
        <button className="toy-btn toy-btn--blue is-soon" disabled>
          {t('🌐 온라인')} <span className="toy-btn__badge">{t('준비 중')}</span>
        </button>
        <button className="toy-btn toy-btn--green" onClick={onRecords}>{t('📊 전적')}</button>
      </nav>
      {/* 보조 기능은 우하단 원형 아이콘으로 — 메뉴 리스트를 핵심 3개로 유지 */}
      <div className="menu-screen__corner">
        <FullscreenButton />
        <button className="menu-fab" onClick={onHelp} title={t('❓ 조작법')} aria-label={t('❓ 조작법')}>❓</button>
        <button className="menu-fab" onClick={onSettings} title={t('⚙️ 설정')} aria-label={t('⚙️ 설정')}>⚙️</button>
      </div>
    </div>
  )
}

// ── 3. 모드·난이도 ──
function ModeScreen({ botLevel, onBotLevel, onPick, onBack }) {
  return (
    <div className="screen mode-screen">
      <BackButton onBack={onBack} />
      <h2 className="toy-heading toy-heading--screen">{t('어디서 싸울까?')}</h2>
      <div className="mode-screen__levels">
        {BOT_LEVEL_OPTS.map((o) => (
          <button
            key={o.id}
            className={`toy-pill ${botLevel === o.id ? 'is-on' : ''}`}
            title={t(o.desc)}
            onClick={() => { sound.step(); onBotLevel(o.id) }}
          >
            {t(o.label)}
          </button>
        ))}
      </div>
      <div className="mode-screen__cards">
        {MODE_OPTS.map((m, i) => (
          <button key={m.id} className={`toy-card mode-card mode-card--${i}`} onClick={() => onPick(m.id)}>
            <span className="mode-card__tag">{t(m.tag)}</span>
            <span className="mode-card__emoji">{m.emoji}</span>
            <span className="mode-card__name">{t(m.name)}</span>
            <span className="mode-card__desc">{t(m.desc)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ── 4. 캐릭터 선택 ──
function CharScreen({ profile, mode, botLevel, onStart, onBack, onHelp }) {
  const saved = loadSoloPick()
  const records = loadRiftRecords()
  const total = Object.values(records).reduce(
    (a, r) => ({ games: a.games + r.games, wins: a.wins + r.wins }),
    { games: 0, wins: 0 }
  )
  const unlocked = new Set(unlockedClassIds(total.wins))
  const next = nextUnlock(total.wins)
  const [seenCount] = useState(loadUnlockSeen)
  const seenBase = Math.max(seenCount, STARTER_COUNT)
  useEffect(() => {
    saveUnlockSeen(unlockedCount(total.wins))
    // 첫 캐릭터 선택 진입이면 조작 가이드를 한 번 띄운다
    if (!loadGuideSeen()) onHelp()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [cls, setCls] = useState(CLASSES[saved?.cls] && unlocked.has(saved.cls) ? saved.cls : null)
  // 낮은 화면에선 스킬 설명이 접혀 있다 — 누른 스킬만 펼친다(넉넉한 화면은 CSS가 전부 펼침)
  const [openSkill, setOpenSkill] = useState(null)

  const z = getZodiac(profile)
  const c = cls ? CLASSES[cls] : null
  const rec = cls ? records[cls] : null
  const levelLabel = BOT_LEVEL_OPTS.find((o) => o.id === botLevel)?.label

  return (
    <div className="screen char-screen">
      {/* 상단 한 줄: 뒤로 · 제목 · 모드요약 — 세로 공간 절약(모바일 가로 화면) */}
      <div className="char-screen__top">
        <BackButton onBack={onBack} />
        <h2 className="toy-heading toy-heading--screen char-screen__heading">{t('누구로 싸울까?')}</h2>
        <button className="char-screen__setup" onClick={onBack} title={t('모드·난이도 바꾸기')}>
          {MODE_OPTS.find((m) => m.id === mode)?.emoji} {mode} · {t(levelLabel)} ✏️
        </button>
      </div>

      <div className="char-screen__body">
        <aside className="toy-card char-show" style={{ '--z-color': z?.color || '#ffc93c' }}>
          {/* 머리: 무대 + 이름·설명을 가로로 — 세로 예산 절약 */}
          <div className="char-show__head">
            <div className="char-show__stage">
              <span className="char-show__ring" aria-hidden="true" />
              <span className="char-show__emoji">{z?.emoji}</span>
              {c && <span className="char-show__cls">{c.icon}</span>}
            </div>
            <div className="char-show__id">
              <div className="char-show__name">
                {t(z?.name)}{c && <span className="char-show__clsname"> · {t(c.name)}</span>}
              </div>
              {c
                ? <p className="char-show__desc">{t(c.desc)}</p>
                : <p className="char-show__desc">{t('직업을 고르면 스킬을 미리 볼 수 있어 👉')}</p>}
            </div>
          </div>
          {/* 훈련장: 선택한 직업의 전신 모델이 평타·스킬을 실제로 시전한다 */}
          {c && <HeroShowcase cls={cls} zodiacId={profile} />}
          {/* 가운데(스킬·전적)만 스크롤 — 출전 버튼은 항상 보인다 */}
          <div className="char-show__mid">
            {c && (
              <>
                <ul className="char-show__skills">
                  {[
                    { tag: t('스킬'), ...c.skill },
                    { tag: t('보조 Lv3'), ...c.skill2 },
                    { tag: t('궁극 Lv5'), ...c.ult },
                  ].map((s) => (
                    <li
                      key={s.tag}
                      className={openSkill === s.tag ? 'is-open' : ''}
                      onClick={() => setOpenSkill((o) => (o === s.tag ? null : s.tag))}
                    >
                      <span className="char-show__skill-icon">{s.icon}</span>
                      <span className="char-show__skill-main">
                        <b>
                          {t(s.name)} <small>{s.tag}</small>
                          <span className="char-show__skill-caret" aria-hidden="true">▾</span>
                        </b>
                        <span className="char-show__skill-desc">{t(s.desc)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
                {rec?.games > 0 && (
                  <p className="char-show__rec">
                    <b>{rec.wins}{t('승')} {rec.games - rec.wins}{t('패')}</b> · {t('평균')} ⚔️{(rec.kills / rec.games).toFixed(1)} 💀{(rec.deaths / rec.games).toFixed(1)} 🤝{(rec.assists / rec.games).toFixed(1)}
                  </p>
                )}
              </>
            )}
          </div>
          <button className="toy-btn toy-btn--yellow char-show__start" disabled={!cls} onClick={() => cls && onStart(cls)}>
            {cls ? t('⚔️ 출전!') : t('직업을 골라줘')}
          </button>
        </aside>

        <section className="char-screen__pick">
          {next && (
            <p className="char-screen__unlock">
              {t('🔓 승리하면')} <b>{CLASSES[next].icon} {t(CLASSES[next].name)}</b> {t('해금!')}
            </p>
          )}
          <div className="char-grid">
            {CLASS_IDS.map((id, idx) => {
              const cc = CLASSES[id]
              const rr = records[id]
              const locked = !unlocked.has(id)
              const isNew = !locked && idx >= seenBase
              return (
                <button
                  key={id}
                  className={`char-card ${cls === id ? 'is-on' : ''} ${locked ? 'is-locked' : ''}`}
                  disabled={locked}
                  title={locked ? t('승리할 때마다 새 캐릭터가 하나씩 열려요') : t(cc.desc)}
                  onClick={() => { sound.step(); setCls(id); setOpenSkill(null) }}
                >
                  <span className="char-card__icon">{cc.icon}</span>
                  <span className="char-card__name">{t(cc.name)}</span>
                  {locked && <span className="char-card__lock">🔒</span>}
                  {isNew && <span className="char-card__new">NEW</span>}
                  {!locked && rr?.games > 0 && (
                    <span className="char-card__rec">{rr.wins}{t('승')} {rr.games - rr.wins}{t('패')}</span>
                  )}
                </button>
              )
            })}
          </div>
        </section>
      </div>
    </div>
  )
}

// ── 전적 ──
function RecordsScreen({ onBack }) {
  const records = loadRiftRecords()
  const rows = CLASS_IDS.filter((id) => records[id]?.games > 0)
  const total = rows.reduce(
    (a, id) => ({ games: a.games + records[id].games, wins: a.wins + records[id].wins }),
    { games: 0, wins: 0 }
  )
  return (
    <div className="screen records-screen">
      <BackButton onBack={onBack} />
      <h2 className="toy-heading toy-heading--screen">{t('전적')}</h2>
      <div className="toy-card records-card">
        {rows.length === 0 ? (
          <p className="records-card__empty">{t('아직 기록이 없어 — 첫 판을 치르고 오자! ⚔️')}</p>
        ) : (
          <>
            <p className="records-card__total">
              {t('🏆 통산')} <b>{total.wins}{t('승')} {total.games - total.wins}{t('패')}</b> · {t('승률')} {Math.round((total.wins / total.games) * 100)}%
            </p>
            <div className="records-card__rows">
              {rows.map((id) => {
                const r = records[id]
                const rate = Math.round((r.wins / r.games) * 100)
                return (
                  <div key={id} className="records-row">
                    <span className="records-row__cls">{CLASSES[id].icon} {t(CLASSES[id].name)}</span>
                    <span className="records-row__wl">{r.wins}{t('승')} {r.games - r.wins}{t('패')}</span>
                    <span className="records-row__bar"><span style={{ width: `${rate}%` }} /></span>
                    <span className="records-row__rate">{rate}%</span>
                    <span className="records-row__kda">
                      ⚔️{(r.kills / r.games).toFixed(1)} 💀{(r.deaths / r.games).toFixed(1)} 🤝{(r.assists / r.games).toFixed(1)}
                    </span>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── 4.4. 설정 — 언어·사운드 (게임 전역, 인게임 설정과 같은 저장소) ──
function SettingsScreen({ onBack, onLicenses }) {
  const [soundOn, setSoundOn] = useState(loadSoundOn)
  const lang = getLang()
  function toggleSound() {
    const n = !soundOn
    setSoundOn(n)
    saveSoundOn(n)
    sound.setEnabled(n)
    if (n) { sound.unlock(); sound.step() }
  }
  return (
    <div className="screen settings-screen">
      <BackButton onBack={onBack} />
      <h2 className="toy-heading toy-heading--screen">{t('설정')}</h2>
      <div className="toy-card settings-card">
        <div className="settings-row">
          <span className="settings-row__label">🌐 {t('언어')}</span>
          <div className="settings-row__seg">
            <button
              className={`toy-pill ${lang === 'ko' ? 'is-on' : ''}`}
              onClick={() => { if (lang !== 'ko') switchLang('ko') }}
            >
              한국어
            </button>
            <button
              className={`toy-pill ${lang === 'en' ? 'is-on' : ''}`}
              onClick={() => { if (lang !== 'en') switchLang('en') }}
            >
              English
            </button>
          </div>
        </div>
        <div className="settings-row">
          <span className="settings-row__label">{soundOn ? '🔊' : '🔇'} {t('사운드')}</span>
          <div className="settings-row__seg">
            <button className={`toy-pill ${soundOn ? 'is-on' : ''}`} onClick={() => { if (!soundOn) toggleSound() }}>{t('켜짐')}</button>
            <button className={`toy-pill ${!soundOn ? 'is-on' : ''}`} onClick={() => { if (soundOn) toggleSound() }}>{t('꺼짐')}</button>
          </div>
        </div>
        <button className="settings-link" onClick={onLicenses}>{t('ⓘ 오픈소스 라이선스')} ›</button>
        <p className="settings-note">{t('언어를 바꾸면 화면이 새로고침돼요')}</p>
      </div>
    </div>
  )
}

// ── 4.5. 오픈소스 라이선스 — 배포물에 포함된 고지 전문(THIRD_PARTY_NOTICES.md)을 보여준다 ──
// 원문은 마크다운이라 화면용으로 기호만 걷어낸다(내용 무수정 — 고지 문구는 그대로).
const NOTICES_TEXT = NOTICES
  .replace(/^```$/gm, '')
  .replace(/^#{1,3} /gm, '')
  .replace(/\*\*(.+?)\*\*/g, '$1')
  .replace(/^---$/gm, '━━━━━━━━━━━━')

function LicensesScreen({ onBack }) {
  return (
    <div className="screen licenses-screen">
      <BackButton onBack={onBack} />
      <h2 className="toy-heading toy-heading--screen">{t('오픈소스 라이선스')}</h2>
      <div className="toy-card licenses-card">
        <pre>{NOTICES_TEXT}</pre>
      </div>
    </div>
  )
}

function BackButton({ onBack }) {
  return (
    <button className="toy-back" onClick={onBack} aria-label={t('뒤로')}>
      {t('← 뒤로')}
    </button>
  )
}

// 조작 가이드 — 첫 캐릭터 선택 진입 때 자동 1회 + 메뉴의 ❓ 버튼.
// 본문에 강조 마크업이 섞여 있어 문장 단위 t() 대신 언어별 블록으로 분기한다.
function SoloHelp({ onClose }) {
  const en = getLang() === 'en'
  return (
    <div className="solo-help" onClick={onClose}>
      <div className="toy-card solo-help__card" onClick={(e) => e.stopPropagation()}>
        <h2 className="toy-heading">{t('🎮 처음 오셨나요?')}</h2>

        <div className="solo-help__sec">
          <h3>{t('🏆 목표')}</h3>
          {en
            ? <p>Push down the <b>towers</b> along three lanes and destroy the enemy <b>Guardian Stone</b> to win!</p>
            : <p>3갈래 레인의 <b>타워</b>를 부수며 전진해 적 <b>수호석</b>를 터뜨리면 승리!</p>}
        </div>

        <div className="solo-help__sec">
          <h3>{t('🕹️ 조작')} <small>{t('(게임 중 ⚙️ 설정에서 바꿀 수 있어요)')}</small></h3>
          {en ? (
            <ul>
              <li>⌨️ <b>Keyboard</b> — WASD/arrows to move · <b>L</b> attack · <b>H/J/K</b> skills · <b>1·2</b> items</li>
              <li>📱 <b>Mobile/Touch</b> — drag left side to move · right buttons to attack/cast</li>
              <li>🎮 <b>Xbox Pad</b> — stick to move · A attack · X/Y/B skills · LB·RB items</li>
            </ul>
          ) : (
            <ul>
              <li>⌨️ <b>키보드</b> — WASD·화살표 이동 · <b>L</b> 평타 · <b>H/J/K</b> 스킬 · <b>1·2</b> 아이템</li>
              <li>📱 <b>모바일/터치</b> — 왼쪽 드래그로 이동 · 오른쪽 버튼으로 공격/스킬</li>
              <li>🎮 <b>Xbox 패드</b> — 스틱 이동 · A 평타 · X/Y/B 스킬 · LB·RB 아이템</li>
            </ul>
          )}
        </div>

        <div className="solo-help__sec">
          <h3>{t('📈 성장')}</h3>
          {en ? (
            <p>
              Kill soldiers and jungle monsters for <b>XP & gold</b>, then gear up at the 🛒 <b>shop</b> in your fountain.
              Your 2nd skill unlocks at Lv3, your ultimate at Lv5.
            </p>
          ) : (
            <p>
              병사·정글몹을 잡아 <b>경험치·골드</b>를 모으고, 우물(시작 지점)에서 🛒 <b>상점</b>으로 장비를 맞춰요.
              Lv3에 보조 스킬, Lv5에 궁극기가 열려요.
            </p>
          )}
        </div>

        <div className="solo-help__sec">
          <h3>{t('💡 꿀팁')}</h3>
          {en
            ? <p>🌿 Bushes hide you · 🐉 Dragon / 👹 Imugi grant team buffs · in danger, 🏠 recall!</p>
            : <p>🌿 수풀에 숨으면 안 보여요 · 🐉 용/👹 이무기는 팀 버프 · 위험하면 🏠 귀환!</p>}
        </div>

        <button className="toy-btn toy-btn--yellow solo-help__ok" onClick={onClose}>{t('알겠어, 가보자!')}</button>
      </div>
    </div>
  )
}
