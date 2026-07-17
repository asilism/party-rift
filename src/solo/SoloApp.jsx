import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { CLASSES, CLASS_IDS, TEAM_SIZES, BOSS_IDS } from '../games/rift/engine.js'
import { ZODIAC, getZodiac } from '../shared/zodiac.js'
import { riftNet } from '../games/rift/netgame.js'
import { createLocalNet } from '../net/localNet.js'
import { sound } from '../shared/sound.js'
import {
  loadSoloPick, saveSoloPick, loadGuideSeen, saveGuideSeen, loadRiftRecords, loadRiftRecordsByMode, addRiftRecord,
  loadUnlockSeen, saveUnlockSeen, loadProfile, saveProfile, loadSoundOn, saveSoundOn,
  loadCoins, addCoins, claimFirstWinToday, addCoinUnlock, loadCoinUnlocks,
  loadEquippedHat, saveEquippedHat, loadOwnedHats, addOwnedHat,
  loadEquippedCostume, saveEquippedCostume, loadOwnedCostumes, addOwnedCostume,
  loadEquippedWeapon, saveEquippedWeapon, loadOwnedWeapons, addOwnedWeapon,
  loadBossRecords, recordBossClear, bossTierUnlocked, loadRiftGfx, saveRiftGfx,
  loadEquippedTitle, saveEquippedTitle, loadDefenseRecords, recordDefenseRun, loadArenaRecords, recordArenaRun,
} from '../shared/storage.js'
import { t, getLang, switchLang } from '../shared/i18n.js'
import { unlockedClassIds, unlockedCount, nextUnlock, STARTER_COUNT, UNLOCK_PRICE } from './unlocks.js'
import { buildSoloRoster } from './roster.js'
import { missionRows, recordMissionProgress, claimMission, allClearState, claimAllClear, ALL_CLEAR_REWARD } from './missions.js'
import { recordMatchForAchievements, achievementRows, evaluateAchievements } from './achievements.js'
import { createTournament, nextRound, resolveRound, userPlacement, arenaLevelFor, ARENA_PLACE_COIN } from './colosseum.js'
import Fireworks from '../shared/Fireworks.jsx'
import { adsAvailable, showRewarded } from '../shared/ads.js'
import MenuStage from './MenuStage.jsx'
import HeroShowcase from './HeroShowcase.jsx'
import HatPreview from './HatPreview.jsx'
import FullscreenButton from '../shared/FullscreenButton.jsx'
// 오픈소스 고지 전문 — 빌드에 원문 그대로 번들되어 웹/데스크톱/안드로이드 배포물 모두에 포함된다
import NOTICES from '../../THIRD_PARTY_NOTICES.md?raw'

const RiftGame = lazy(() => import('../games/rift/RiftGame.jsx'))

// 솔로(오프라인) 모드 — 고전 콘솔식 4뎁스 셸.
//   타이틀(눌러서 시작) → 메인 메뉴 → 모드·난이도 → 캐릭터 선택 → 전투
// 모든 메뉴 화면 뒤에는 봇들이 실제로 싸우는 라이브 전장(MenuStage)이 흐른다.
// 조디악(수호 지신)은 프로필 — 첫 실행에 한 번 정하고 메뉴에서 변경한다.

// 통합 난이도 — 모든 모드 공용, 모드 선택 화면에서 1회 고른다.
//  3v3/5v5/방어전은 봇 난이도로, 보스전은 티어로 매핑. 보스전 악몽/지옥은 실력 게이트(전 단계 클리어).
const DIFF_OPTS = [
  { id: 'easy', icon: '😌', label: '쉬움', botLevel: 'easy', bossTier: 'normal', desc: '편안한 한 판 — 처음이라면 여기부터' },
  { id: 'nightmare', icon: '💀', label: '악몽', botLevel: 'normal', bossTier: 'hard', desc: '제대로 된 도전 — 온라인 수준 봇' },
  { id: 'hell', icon: '🔥', label: '지옥', botLevel: 'hard', bossTier: 'nightmare', desc: '최강 — 칼같이 반응하고 더 아프게' },
]

// 보스전 난이도 티어 — 해금은 실력 게이트(전 단계 클리어). 코인 보상도 티어를 따라 오른다.
// 보스전 티어별 보상·표기(승리 배너용) — 선택은 위 DIFF_OPTS(통합 난이도)가 담당한다
const BOSS_TIER_OPTS = [
  { id: 'normal', icon: '😌', label: '쉬움', coin: 30 },
  { id: 'hard', icon: '💀', label: '악몽', coin: 45 },
  { id: 'nightmare', icon: '🔥', label: '지옥', coin: 60 },
]
const BOSS_TIER_ICON = { hard: '💀', nightmare: '🔥' } // 보통은 배지 없음

const MODE_OPTS = [
  { id: '3v3', emoji: '⚔️', name: '3 대 3', desc: '작은 맵 · 빠른 한판', tag: '기본' },
  { id: '5v5', emoji: '🐉', name: '5 대 5', desc: '넓은 맵 · 정글 대격전', tag: '큰판' },
  { id: 'boss', emoji: '👹', name: '보스전', desc: '5명이 거대 보스에 도전 — 잡으면 승리', tag: '도전', price: 300 },
  { id: 'defense', emoji: '🌊', name: '무한 방어', desc: '끝없는 파도에서 수호석을 지켜라 — 기록에 도전!', tag: '생존', price: 300 },
  { id: 'arena', emoji: '🏟️', name: '콜로세움', desc: '12지신 2대2 토너먼트 — 최후의 팀이 되어라!', tag: '결투', price: 300 },
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
  const [diff, setDiff] = useState(
    DIFF_OPTS.some((o) => o.id === saved?.diff) ? saved.diff : 'easy'
  )
  const [net, setNet] = useState(null)
  const netRef = useRef(null)
  const [helpOpen, setHelpOpen] = useState(false)
  const [exitAsk, setExitAsk] = useState(false) // 전투 중 뒤로가기 → "나갈까요?" 확인
  const [coinMsg, setCoinMsg] = useState(null) // 경기 종료 코인 보상 라인(승리 화면에 표시)
  const [tour, setTour] = useState(null) // 콜로세움 토너먼트 상태
  const [tourStage, setTourStage] = useState('bracket') // bracket(대진) | result(라운드 결과) | final(최종 순위)
  const arenaCarryRef = useRef({}) // 라운드 간 유저 팀 이월(레벨·골드·아이템)
  const arenaViewRef = useRef(null) // 라운드 종료 뷰(결과 보기 버튼 대기)
  const [adState, setAdState] = useState('idle') // 보상형 광고 버튼 상태: idle | loading | fail
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

  // ── 콜로세움 흐름 — 토너먼트 생성 → (라운드: 브래킷 → 경기 → 결과) 반복 → 최종 순위 ──
  function startColosseum(cls) {
    const tn = createTournament(profile, cls)
    arenaCarryRef.current = {}
    arenaViewRef.current = null
    nextRound(tn)
    setTour(tn)
    setTourStage('bracket')
    setScreen('colosseum')
  }

  function startArenaRound() {
    const cur = tour.current
    if (!cur?.myPair) return
    const myTeam = cur.myPair[0].isUser ? cur.myPair[0] : cur.myPair[1]
    const opp = cur.myPair[0] === myTeam ? cur.myPair[1] : cur.myPair[0]
    const toRoster = (m, team) => ({
      id: m.id, name: m.name, zodiacId: m.zodiacId, color: getZodiac(m.zodiacId)?.color,
      team, cls: m.cls, isBot: m.isBot, deviceId: m.isBot ? undefined : 'solo',
      title: m.isBot ? null : t(loadEquippedTitle()) || null,
    })
    const roster = [...myTeam.members.map((m) => toRoster(m, 'blue')), ...opp.members.map((m) => toRoster(m, 'red'))]
    const lvl = arenaLevelFor(tour.round)
    const carry = {}
    for (const m of myTeam.members) carry[m.id] = arenaCarryRef.current[m.id] || { lvl, gold: 0 }
    // 상대 봇: 레벨 동기 + 지난 라운드 몫의 골드(이번 준비 페이즈에 몰아서 산다)
    for (const m of opp.members) carry[m.id] = { lvl, gold: (tour.round - 1) * 1000 }
    setCoinMsg(null)
    setAdState('idle')
    arenaViewRef.current = null
    const dOpt = DIFF_OPTS.find((o) => o.id === diff) || DIFF_OPTS[0]
    const n = createLocalNet(riftNet, {
      players: [],
      config: { mode: 'arena', roster, carry, botLevel: dOpt.botLevel },
      deviceId: 'solo',
      onFinish(view) {
        arenaViewRef.current = view // 결과 반영은 '결과 보기' 버튼에서 — 경기 결과 모달을 먼저 보게 한다
        const me = view.heroes?.find((h) => h.id === 'solo')
        if (me) {
          const win = !!view.winner && view.winner === 'blue'
          recordMissionProgress({ win, kills: me.kills, assists: me.assists, jungle: me.jungleKills })
          recordMatchForAchievements({ view, me, win })
        }
      },
    })
    netRef.current = n
    if (typeof window !== 'undefined') window.__soloNet = n
    setNet(n)
    setScreen('play')
  }

  // 라운드 결과 반영(정상 종료·중도 이탈 공통) — 이월 추출 후 판정, 콜로세움 화면으로
  function finishArenaRound(forfeit = false) {
    const view = arenaViewRef.current
    const win = !forfeit && !!view && view.winner === 'blue'
    const nextLvl = arenaLevelFor(tour.round + 1)
    if (view) {
      for (const id of ['solo', 'ally']) {
        const h = view.heroes?.find((x) => x.id === id)
        if (h) arenaCarryRef.current[id] = { lvl: Math.max(nextLvl, h.lvl || 0), gold: h.gold || 0, items: h.items || [] }
      }
    } else {
      // 뷰가 없으면(즉시 이탈) 레벨만 승급
      for (const id of ['solo', 'ally']) {
        const c = arenaCarryRef.current[id] || { gold: 0, items: [] }
        arenaCarryRef.current[id] = { ...c, lvl: nextLvl }
      }
    }
    resolveRound(tour, win)
    setTour({ ...tour })
    setTourStage('result')
    arenaViewRef.current = null
    netRef.current?.close()
    netRef.current = null
    setNet(null)
    setScreen('colosseum')
  }

  function arenaNextRound() {
    const me = tour.teams.find((tm) => tm.isUser)
    if (tour.over || !me.alive) {
      setTourStage('final')
      return
    }
    nextRound(tour)
    setTour({ ...tour })
    setTourStage('bracket')
  }

  function finishColosseum() {
    const place = userPlacement(tour) || 6
    addCoins(ARENA_PLACE_COIN[place] || 10)
    recordArenaRun(place)
    evaluateAchievements() // 완주/우승 업적 즉시 지급(라이브 게터)
    setTour(null)
    go('menu')
  }

  function startBattle(cls) {
    if (mode === 'arena') return startColosseum(cls)
    setCoinMsg(null) // 새 경기 — 지난 보상 라인 지움
    setAdState('idle')
    const dOpt = DIFF_OPTS.find((o) => o.id === diff) || DIFF_OPTS[0]
    const pick = { zodiacId: profile, cls, mode, diff, botLevel: dOpt.botLevel, bossTier: dOpt.bossTier }
    saveSoloPick(pick)
    const n = createLocalNet(riftNet, {
      players: [],
      config: { mode, roster: buildSoloRoster(pick), botLevel: dOpt.botLevel, bossTier: dOpt.bossTier },
      deviceId: 'solo',
      // 경기가 끝나면 내 직업 전적에 누적 — 중도 이탈(exit)은 기록하지 않는다
      onFinish(view) {
        const me = view.heroes?.find((h) => h.id === 'solo')
        if (!me) return
        const win = !!view.winner && view.winner === me.team
        // 직업 전적은 3v3/5v5만 쌓는다 — 보스전·방어전 결과는 전용 기록으로 따로 남긴다
        if (view.mode !== 'boss' && view.mode !== 'defense') {
          addRiftRecord(me.cls, {
            win, mode: view.mode,
            kills: me.kills, deaths: me.deaths, assists: me.assists,
          })
        }
        // 조디악 코인: 승 30 / 패 10 + 하루 첫 승 보너스 50.
        //  보스전은 티어별 승리 코인(보통 30/어려움 45/악몽 60) + 보스·티어 첫 토벌 +100.
        //  방어전은 승패가 없다 — 버틴 파도만큼 번다(5 + 파도×2).
        const tier = view.mode === 'boss' ? (view.bossTier || 'normal') : null
        const tierOpt = tier && BOSS_TIER_OPTS.find((o) => o.id === tier)
        let earn = view.mode === 'defense' ? 5 + (view.wave || 0) * 2 : win ? (tierOpt?.coin || 30) : 10
        let firstWin = false
        if (win && claimFirstWinToday()) {
          earn += 50
          firstWin = true
        }
        // 보스전 토벌 기록 — 클리어 타임·최단 기록·토벌 횟수 (승리 시에만, 티어별)
        let bossRec = null
        if (view.mode === 'boss' && win) {
          const bossHero = view.heroes?.find((h) => h.cls?.startsWith('boss_'))
          if (bossHero) {
            const time = view.timePlayed || 0
            bossRec = { ...recordBossClear(bossHero.cls, time, tier), time, tier }
            if (bossRec.isFirst) earn += 100 // 이 보스·이 티어 첫 토벌 보너스
          }
        }
        // 방어전 기록 — 도달 파도·최고 기록
        let defRec = null
        if (view.mode === 'defense') {
          defRec = { ...recordDefenseRun(view.wave || 0), wave: view.wave || 0 }
        }
        addCoins(earn)
        // 일일 미션 진행도 누적 (판수/승리/킬/어시/정글몹)
        recordMissionProgress({ win, kills: me.kills, assists: me.assists, jungle: me.jungleKills })
        // 업적 누적·판정 — 새로 달성한 업적은 결과 화면 배너로(보상 코인은 즉시 지급됨)
        const achNew = recordMatchForAchievements({ view, me, win })
        setCoinMsg({ earn, firstWin, bossRec, defRec, achNew })
      },
    })
    netRef.current = n
    if (typeof window !== 'undefined') window.__soloNet = n // E2E 캡처/디버그용 핸들 — 게임 코드는 참조 금지
    setNet(n)
    setScreen('play')
  }

  function exitBattle() {
    if (mode === 'arena' && tour) {
      // 콜로세움: 정상 종료면 결과 반영, 경기 중 이탈이면 그 라운드 몰수패
      finishArenaRound(!arenaViewRef.current)
      return
    }
    netRef.current?.close()
    netRef.current = null
    setNet(null)
    setScreen('char') // 모드·난이도 유지한 채 "한 판 더" 흐름
  }

  // 뒤로가기(ESC/안드로이드 하드웨어 버튼) 공통 처리:
  //  가이드 열림 → 닫기 / 전투 중 → 일시정지 + "나갈까요?" 확인 / 메뉴 → 이전 화면 / 타이틀 → 앱 종료(안드로이드만)
  useEffect(() => {
    const back = { profile: profile ? 'menu' : 'title', menu: 'title', mode: 'menu', char: 'mode', records: 'menu', licenses: 'settings', settings: 'menu', hats: 'menu' }
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
        <RiftGame
          net={net}
          onExit={exitBattle}
          bonus={coinMsg ? (
            <>
              🪙 +{coinMsg.earn}{coinMsg.firstWin ? ` (${t('오늘 첫 승리!')})` : ''}
              {coinMsg.doubled && <span className="win-banner__doubled"> ×2!</span>}
              {coinMsg.bossRec && (
                <span className="win-banner__bossrec">
                  {' · '}
                  {BOSS_TIER_ICON[coinMsg.bossRec.tier] && `${BOSS_TIER_ICON[coinMsg.bossRec.tier]} ${t(BOSS_TIER_OPTS.find((o) => o.id === coinMsg.bossRec.tier)?.label || '')} `}
                  ⏱ {fmtClearTime(coinMsg.bossRec.time)}
                  {coinMsg.bossRec.isFirst ? ` 🏅 ${t('첫 토벌!')} +100` : coinMsg.bossRec.isBest ? ` 🏆 ${t('최단 기록!')}` : ''}
                </span>
              )}
              {coinMsg.defRec && (
                <span className="win-banner__bossrec">
                  {' · '}🌊 {coinMsg.defRec.wave}{t('번째 파도')}
                  {coinMsg.defRec.isBest && coinMsg.defRec.wave > 0 ? ` 🏆 ${t('최고 기록!')}` : ''}
                </span>
              )}
              {coinMsg.achNew?.length > 0 && (
                <span className="win-banner__ach">
                  {coinMsg.achNew.map((a) => (
                    <span key={a.id} className="win-banner__ach-item">
                      🏆 {t('업적 달성')}: {a.icon} <b>{t(a.name)}</b> +{a.reward}🪙
                    </span>
                  ))}
                </span>
              )}
            </>
          ) : null}
          adButton={coinMsg && !coinMsg.doubled && adsAvailable() ? (
            <button
              className="btn win-modal__ad"
              disabled={adState === 'loading'}
              onClick={async () => {
                setAdState('loading')
                const ok = await showRewarded(() => {
                  addCoins(coinMsg.earn)
                  setCoinMsg((m) => ({ ...m, earn: m.earn * 2, doubled: true }))
                })
                // 실패(미로드·중도 이탈)를 조용히 삼키면 버튼이 "죽은" 것처럼 보인다 — 라벨로 알린다
                setAdState(ok ? 'idle' : 'fail')
              }}
            >
              {adState === 'loading' ? `⏳ ${t('광고 불러오는 중…')}`
                : adState === 'fail' ? `📺 ${t('광고 준비 중 — 잠시 후 다시')}`
                  : `📺 ${t('광고 보고 2배 보상')}`}
            </button>
          ) : null}
        />
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
          onHats={() => go('hats')}
        />
      )}
      {screen === 'colosseum' && tour && (
        <ColosseumScreen
          tour={tour}
          stage={tourStage}
          onEnter={startArenaRound}
          onSkipRound={() => { resolveRound(tour, false); setTour({ ...tour }); setTourStage('result') }}
          onNextRound={arenaNextRound}
          onFinish={finishColosseum}
        />
      )}
      {screen === 'settings' && <SettingsScreen onBack={() => go('menu')} onLicenses={() => go('licenses')} />}
      {screen === 'hats' && <HatScreen profile={profile} onBack={() => go('menu')} />}
      {screen === 'mode' && (
        <ModeScreen
          diff={diff}
          onDiff={setDiff}
          onPick={(m) => { setMode(m); go('char') }}
          onBack={() => go('menu')}
        />
      )}
      {screen === 'char' && (
        <CharScreen
          profile={profile}
          mode={mode}
          diff={diff}
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

// ── 2a. 오늘의 미션 위젯 — 메뉴 좌하단. 완료하면 코인을 수령한다 ──
// 각 미션 보상과 올클리어 보너스(+100)를 미리 보여줘 "다 깨면 얼마"가 한눈에 보인다.
function MissionWidget() {
  const [, refresh] = useState(0)
  const rows = missionRows()
  const bonus = allClearState() // locked | ready | claimed
  function claim(id, mult = 1) {
    const reward = claimMission(id)
    if (reward > 0) {
      addCoins(reward * mult)
      sound.go()
      refresh((n) => n + 1)
    }
  }
  function claimBonus(mult = 1) {
    const reward = claimAllClear()
    if (reward > 0) {
      addCoins(reward * mult)
      sound.go()
      refresh((n) => n + 1)
    }
  }
  return (
    <div className="missions">
      <div className="missions__head">📅 {t('오늘의 미션')}</div>
      {rows.map((m) => (
        <div key={m.id} className={`missions__row ${m.claimed ? 'is-claimed' : ''}`}>
          <span className="missions__name">{t(m.name)}</span>
          <span className="missions__bar">
            <span style={{ width: `${Math.round((m.cur / m.goal) * 100)}%` }} />
          </span>
          {m.claimed
            ? <span className="missions__done">✅</span>
            : m.done
              ? (
                <>
                  <button className="missions__claim" onClick={() => claim(m.id)}>🪙 {m.reward}</button>
                  {adsAvailable() && (
                    <button
                      className="missions__claim missions__claim--ad"
                      title={t('광고 보고 2배')}
                      onClick={() => showRewarded(() => claim(m.id, 2))}
                    >
                      📺x2
                    </button>
                  )}
                </>
              )
              : (
                <span className="missions__count">
                  <b className="missions__hint">🪙{m.reward}</b> {m.cur}/{m.goal}
                </span>
              )}
        </div>
      ))}
      {/* 올클리어 보너스 — 잠김 상태에서도 금액을 보여줘 마지막 판까지 끌고 간다 */}
      <div className={`missions__row missions__row--bonus ${bonus === 'claimed' ? 'is-claimed' : ''}`}>
        <span className="missions__name">🎁 {t('모두 완료 보너스')}</span>
        {bonus === 'claimed'
          ? <span className="missions__done">✅</span>
          : bonus === 'ready'
            ? (
              <>
                <button className="missions__claim" onClick={() => claimBonus()}>🪙 {ALL_CLEAR_REWARD}</button>
                {adsAvailable() && (
                  <button
                    className="missions__claim missions__claim--ad"
                    title={t('광고 보고 2배')}
                    onClick={() => showRewarded(() => claimBonus(2))}
                  >
                    📺x2
                  </button>
                )}
              </>
            )
            : <span className="missions__count"><b className="missions__hint">🪙{ALL_CLEAR_REWARD}</b></span>}
      </div>
    </div>
  )
}

// ── 2. 메인 메뉴 ──
function MainMenu({ profile, onPlay, onRecords, onHelp, onProfile, onSettings, onHats }) {
  const z = getZodiac(profile)
  const coins = loadCoins() // 메뉴 진입 때마다 최신 잔액을 읽는다(경기·꾸미기 후 갱신)
  const title = loadEquippedTitle() // 장착 칭호 — 업적 탭에서 달았다면 프로필 칩에 표시
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
      <div className="menu-topright">
        <button className="profile-chip" onClick={onProfile} title={t('수호 지신 바꾸기')}>
          <span className="profile-chip__emoji">{z?.emoji}</span>
          <span className="profile-chip__info">
            <b>{z?.name}{title && <span className="profile-chip__title"> 🎖{t(title)}</span>}</b>
            <small>{total.games > 0 ? `${total.wins}${t('승')} ${total.games - total.wins}${t('패')}` : t('첫 출전 대기')}</small>
          </span>
        </button>
        {/* 소유 코인 — 꾸미기 외 메인 메뉴에서도 상시 노출 */}
        <div className="menu-coins" title={t('조디악 코인')}>
          <span className="menu-coins__icon">🪙</span>
          <b className="menu-coins__amt">{coins}</b>
        </div>
      </div>
      <nav className="menu-screen__list">
        <button className="toy-btn toy-btn--yellow toy-btn--big" onClick={onPlay}>{t('⚔️ 혼자 플레이')}</button>
        {/* 온라인(같이 플레이)은 멀티 재개방 때까지 비활성 (웹 온라인 플로우는 ?solo 없는 주소로 여전히 접근 가능) */}
        <button className="toy-btn toy-btn--blue is-soon" disabled>
          {t('🌐 같이 플레이')} <span className="toy-btn__badge">{t('준비 중')}</span>
        </button>
        <button className="toy-btn toy-btn--green" onClick={onRecords}>{t('📊 전적')}</button>
        <button className="toy-btn toy-btn--pink" onClick={onHats}>{t('🎩 꾸미기')}</button>
      </nav>
      <MissionWidget />
      {/* 보조 기능은 우하단 원형 아이콘으로 — 메뉴 리스트를 핵심 3개로 유지 */}
      <div className="menu-screen__corner">
        <FullscreenButton />
        <button className="menu-fab" onClick={onHelp} title={t('❓ 조작법')} aria-label={t('❓ 조작법')}>❓</button>
        <button className="menu-fab" onClick={onSettings} title={t('⚙️ 설정')} aria-label={t('⚙️ 설정')}>⚙️</button>
      </div>
    </div>
  )
}

// ── 코인 사용 확인 모달 — 실수 방지: 캐릭터·꾸미기·모드 해금 공용 ──
function BuyConfirm({ title, desc, price, okLabel, onOk, onCancel }) {
  return (
    <div className="solo-help" onClick={onCancel}>
      <div className="toy-card solo-help__card" onClick={(e) => e.stopPropagation()}>
        <h2 className="toy-heading">{title}</h2>
        <p className="toy-sub">{desc}</p>
        <div className="solo-exit__btns">
          <button className="toy-btn toy-btn--yellow" onClick={onOk}>🪙 {price} {okLabel}</button>
          <button className="toy-btn toy-btn--blue" onClick={onCancel}>{t('취소')}</button>
        </div>
      </div>
    </div>
  )
}

// ── 3. 모드·난이도 ──
function ModeScreen({ diff, onDiff, onPick, onBack }) {
  const [modeUnlocks, setModeUnlocks] = useState(loadCoinUnlocks) // 'mode:boss' 형태로 저장
  const [buyAsk, setBuyAsk] = useState(null) // 해금 확인 대기 중인 모드 — 실수 차감 방지
  const [tierNotice, setTierNotice] = useState(null) // 보스전 티어 실력 게이트 안내
  // 횡스크롤 어포던스 — 양 끝 도달 여부에 따라 페이드·화살표를 켜고 끈다
  const cardsRef = useRef(null)
  const [scrollHint, setScrollHint] = useState({ left: false, right: false })
  function refreshScrollHint() {
    const el = cardsRef.current
    if (!el) return
    setScrollHint({
      left: el.scrollLeft > 8,
      right: el.scrollLeft < el.scrollWidth - el.clientWidth - 8,
    })
  }
  useEffect(() => {
    refreshScrollHint() // 첫 진입: 오른쪽에 더 있음을 알린다
    const onResize = () => refreshScrollHint()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  function askBuyMode(m) {
    if (loadCoins() < m.price) {
      sound.step() // 코인 부족 — 카드의 가격 표시가 안내 역할
      return
    }
    sound.step()
    setBuyAsk(m)
  }
  function buyMode(m) {
    sound.go()
    addCoins(-m.price)
    addCoinUnlock(`mode:${m.id}`)
    setModeUnlocks(loadCoinUnlocks())
  }
  return (
    <div className="screen mode-screen">
      <BackButton onBack={onBack} />
      <h2 className="toy-heading toy-heading--screen">{t('어디서 싸울까?')}</h2>
      <div className="mode-screen__levels">
        {DIFF_OPTS.map((o) => (
          <button
            key={o.id}
            className={`toy-pill ${diff === o.id ? 'is-on' : ''}`}
            title={t(o.desc)}
            onClick={() => { sound.step(); onDiff(o.id) }}
          >
            {o.icon} {t(o.label)}
          </button>
        ))}
      </div>
      <div className="mode-screen__scrollwrap">
        {scrollHint.left && <><div className="mode-scroll-fade mode-scroll-fade--left" /><span className="mode-scroll-hint mode-scroll-hint--left">›</span></>}
        {scrollHint.right && <><div className="mode-scroll-fade mode-scroll-fade--right" /><span className="mode-scroll-hint mode-scroll-hint--right">›</span></>}
        <div className="mode-screen__cards" ref={cardsRef} onScroll={refreshScrollHint}>
        {MODE_OPTS.map((m, i) => {
          // 유료 모드(보스전): 코인으로 1회 해금 — 해금 전엔 자물쇠와 가격을 보여준다.
          // 개발자 모드(HAT_DEV: dev 서버/?devhat)에서는 꾸미기처럼 바로 열린다.
          // (보스별 토벌 타임은 여기가 아니라 📊 전적 화면에서 본다)
          const locked = m.price && !HAT_DEV && !modeUnlocks.includes(`mode:${m.id}`)
          return (
            <button
              key={m.id}
              className={`toy-card mode-card mode-card--${i} ${locked ? 'mode-card--locked' : ''}`}
              onClick={() => {
                if (locked) { askBuyMode(m); return }
                // 보스전 실력 게이트: 악몽/지옥은 전 단계 클리어가 필요하다
                if (m.id === 'boss') {
                  const dOpt = DIFF_OPTS.find((o) => o.id === diff)
                  if (dOpt && !bossTierUnlocked(dOpt.bossTier)) {
                    sound.step()
                    setTierNotice(dOpt.bossTier === 'nightmare'
                      ? t('보스전 지옥은 악몽 난이도를 클리어하면 열려요')
                      : t('보스전 악몽은 쉬움 난이도를 클리어하면 열려요'))
                    return
                  }
                }
                onPick(m.id)
              }}
            >
              <span className="mode-card__tag">{locked ? '🔒' : t(m.tag)}</span>
              <span className="mode-card__emoji">{m.emoji}</span>
              <span className="mode-card__name">{t(m.name)}</span>
              <span className="mode-card__desc">
                {locked ? `🪙 ${m.price} — ${t('코인으로 열기')}` : t(m.desc)}
              </span>
            </button>
          )
        })}
        </div>
      </div>
      {tierNotice && (
        <div className="solo-help" onClick={() => setTierNotice(null)}>
          <div className="toy-card solo-help__card" onClick={(e) => e.stopPropagation()}>
            <h2 className="toy-heading">🔒 {t('아직 잠겨 있어요')}</h2>
            <p className="toy-sub">{tierNotice}</p>
            <div className="solo-exit__btns">
              <button className="toy-btn toy-btn--yellow" onClick={() => setTierNotice(null)}>{t('알겠어')}</button>
            </div>
          </div>
        </div>
      )}
      {buyAsk && (
        <BuyConfirm
          title={`${buyAsk.emoji} ${t(buyAsk.name)} ${t('열기')}`}
          desc={`🪙 ${buyAsk.price} ${t('코인을 사용해서 열어줄까요?')}`}
          price={buyAsk.price}
          okLabel={t('열기')}
          onOk={() => { buyMode(buyAsk); setBuyAsk(null) }}
          onCancel={() => { sound.step(); setBuyAsk(null) }}
        />
      )}
    </div>
  )
}

// ── 4. 캐릭터 선택 ──
function CharScreen({ profile, mode, diff, onStart, onBack, onHelp }) {
  const [coins, setCoins] = useState(loadCoins)
  const [, forceUnlockRefresh] = useState(0)
  const [buyAsk, setBuyAsk] = useState(null) // 해금 확인 대기 중인 직업 id — 실수 차감 방지
  function buyUnlock(id) {
    if (loadCoins() < UNLOCK_PRICE) return
    sound.go()
    addCoins(-UNLOCK_PRICE)
    addCoinUnlock(id)
    setCoins(loadCoins())
    forceUnlockRefresh((n) => n + 1)
  }
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
  const dOpt = DIFF_OPTS.find((o) => o.id === diff)

  return (
    <div className="screen char-screen">
      {/* 상단 한 줄: 뒤로 · 제목 · 모드요약 — 세로 공간 절약(모바일 가로 화면) */}
      <div className="char-screen__top">
        <BackButton onBack={onBack} />
        <h2 className="toy-heading toy-heading--screen char-screen__heading">{t('누구로 싸울까?')}</h2>
        <span className="char-screen__coins" title={t('조디악 코인')}>🪙 {coins}</span>
        <button className="char-screen__setup" onClick={onBack} title={t('모드·난이도 바꾸기')}>
          {MODE_OPTS.find((m) => m.id === mode)?.emoji} {mode} · {dOpt ? `${dOpt.icon} ${t(dOpt.label)}` : ''} ✏️
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
          {c && <HeroShowcase cls={cls} zodiacId={profile} hat={loadEquippedHat()} costume={loadEquippedCostume()} weapon={loadEquippedWeapon()} />}
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
              {t('🔓 승리하면')} <b>{CLASSES[next].icon} {t(CLASSES[next].name)}</b> {t('열려요!')}
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
                  disabled={locked && coins < UNLOCK_PRICE}
                  title={locked
                    ? `${t('승리할 때마다 새 캐릭터가 하나씩 열려요')}${coins >= UNLOCK_PRICE ? ` · ${t('눌러서 코인으로 바로 열기')}` : ''}`
                    : t(cc.desc)}
                  onClick={() => {
                    if (locked) { sound.step(); setBuyAsk(id); return } // 코인 선행 해금 — 확인 후 차감
                    sound.step(); setCls(id); setOpenSkill(null)
                  }}
                >
                  <span className="char-card__icon">{cc.icon}</span>
                  <span className="char-card__name">{t(cc.name)}</span>
                  {locked && (
                    <span className={`char-card__lock ${coins >= UNLOCK_PRICE ? 'char-card__lock--buyable' : ''}`}>
                      {coins >= UNLOCK_PRICE ? `🪙${UNLOCK_PRICE}` : '🔒'}
                    </span>
                  )}
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
      {buyAsk && CLASSES[buyAsk] && (
        <BuyConfirm
          title={`${CLASSES[buyAsk].icon} ${t(CLASSES[buyAsk].name)} ${t('열기')}`}
          desc={`🪙 ${UNLOCK_PRICE} ${t('코인을 사용해서 열어줄까요?')}`}
          price={UNLOCK_PRICE}
          okLabel={t('열기')}
          onOk={() => { buyUnlock(buyAsk); setBuyAsk(null) }}
          onCancel={() => { sound.step(); setBuyAsk(null) }}
        />
      )}
    </div>
  )
}

// ── 전적 — 3대3 / 5대5 / 보스전 탭 ──
const RECORD_TABS = [
  { id: '3v3', label: '3 대 3' },
  { id: '5v5', label: '5 대 5' },
  { id: 'boss', label: '보스전' },
  { id: 'defense', label: '방어전' },
  { id: 'arena', label: '콜로세움' },
  { id: 'ach', label: '업적' },
]

// 직업 전적 카드(3v3/5v5 공용) — 한 모드의 직업별 승패·KDA
function ClassRecordCard({ records }) {
  const rows = CLASS_IDS.filter((id) => records[id]?.games > 0)
  const total = rows.reduce(
    (a, id) => ({ games: a.games + records[id].games, wins: a.wins + records[id].wins }),
    { games: 0, wins: 0 }
  )
  if (rows.length === 0) {
    return (
      <div className="toy-card records-card">
        <p className="records-card__empty">{t('아직 기록이 없어 — 첫 판을 치르고 오자! ⚔️')}</p>
      </div>
    )
  }
  return (
    <div className="toy-card records-card">
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
    </div>
  )
}

// 보스 토벌 카드 — 보스별 최단 클리어 타임과 토벌 횟수
function BossRecordCard({ bossRecs }) {
  // v2: 보스별 × 티어별 기록 — 한 보스 행 안에 티어 칩 3개(보통/어려움/악몽)
  const cleared = BOSS_IDS.some((id) => BOSS_TIER_OPTS.some((o) => bossRecs[id]?.[o.id]?.clears > 0))
  return (
    <div className="toy-card records-card records-card--boss">
      {!cleared ? (
        <p className="records-card__empty">{t('아직 토벌한 보스가 없어 — 보스전에 도전해 봐! 👹')}</p>
      ) : (
        <div className="records-card__rows">
          {BOSS_IDS.map((id) => {
            const byTier = bossRecs[id] || {}
            const done = BOSS_TIER_OPTS.some((o) => byTier[o.id]?.clears > 0)
            return (
              <div key={id} className={`boss-rec-row ${done ? '' : 'boss-rec-row--locked'}`}>
                <span className="boss-rec-row__name">{CLASSES[id].icon} {t(CLASSES[id].name)}</span>
                {done ? (
                  BOSS_TIER_OPTS.map((o) => {
                    const r = byTier[o.id]
                    return (
                      <span key={o.id} className={`boss-rec-row__tier ${r?.clears > 0 ? '' : 'is-empty'}`} title={t(o.label)}>
                        {o.icon} {r?.clears > 0 ? `${fmtClearTime(r.best)} ×${r.clears}` : '—'}
                      </span>
                    )
                  })
                ) : (
                  <span className="boss-rec-row__none">— {t('미토벌')}</span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function RecordsScreen({ onBack }) {
  const [tab, setTab] = useState('3v3')
  const byMode = loadRiftRecordsByMode()
  const bossRecs = loadBossRecords()
  return (
    <div className="screen records-screen">
      <BackButton onBack={onBack} />
      <h2 className="toy-heading toy-heading--screen">{t('전적')}</h2>
      <div className="records-tabs">
        {RECORD_TABS.map((tb) => (
          <button
            key={tb.id}
            className={`records-tab ${tab === tb.id ? 'records-tab--on' : ''}`}
            onClick={() => setTab(tb.id)}
          >
            {t(tb.label)}
          </button>
        ))}
      </div>
      {tab === 'ach'
        ? <AchievementCard />
        : tab === 'arena'
          ? <ArenaRecordCard />
          : tab === 'defense'
            ? <DefenseRecordCard />
          : tab === 'boss'
            ? <BossRecordCard bossRecs={bossRecs} />
            : <ClassRecordCard records={byMode[tab] || {}} />}
    </div>
  )
}

// ── 콜로세움 화면 — 대진(bracket) / 라운드 결과(result) / 최종 순위(final) ──
//  라운드 결과는 이 모드의 얼굴: 내 경기 배너 → 다른 경기 → 6팀 포인트 보드 → 다음 예고 순서로 읽힌다.
function TeamFaces({ team, big }) {
  return (
    <span className={`colo-faces ${big ? 'colo-faces--big' : ''}`}>
      {team.members.map((m) => <span key={m.id} className="colo-face">{m.emoji}</span>)}
    </span>
  )
}

function TeamPts({ team, deducted }) {
  return (
    <div className={`colo-pts ${team.alive ? '' : 'colo-pts--dead'}`}>
      <div className="colo-pts__bar">
        <div className="colo-pts__fill" style={{ width: `${(team.pts / 10) * 100}%` }} />
      </div>
      <b className="colo-pts__num">{team.alive ? team.pts : '💀'}</b>
      {deducted > 0 && <span className="colo-pts__delta">-{deducted}</span>}
    </div>
  )
}

function ColosseumScreen({ tour, stage, onEnter, onSkipRound, onNextRound, onFinish }) {
  const cur = tour.current
  const last = tour.lastResults
  const meTeam = tour.teams.find((tm) => tm.isUser)
  // 보드 정렬: 생존(포인트순) → 탈락(늦게 탈락한 순)
  const board = [...tour.teams].sort((a, b) =>
    (b.alive ? 1 : 0) - (a.alive ? 1 : 0) || b.pts - a.pts || (b.elimRound || 0) - (a.elimRound || 0))
  const deductedOf = (tm) => (stage === 'result' && last?.results.some((r) => r.loser === tm) ? last.deduction : 0)
  const place = userPlacement(tour)

  return (
    <div className="screen colo-screen">
      <h2 className="toy-heading toy-heading--screen">🏟️ {t('콜로세움')}</h2>

      {stage === 'bracket' && cur && (
        <div className="toy-card colo-card">
          <div className="colo-card__head">
            <b>{cur.isFinal ? `👑 ${t('결승 데스매치')}` : `${cur.round}${t('라운드')}`}</b>
            <span className="colo-deduct">{t('패배 시')} -{cur.deduction}</span>
          </div>
          <div className="colo-pairs">
            {cur.pairs.map((p, i) => {
              const mine = p[0].isUser || p[1].isUser
              return (
                <div key={i} className={`colo-pair ${mine ? 'colo-pair--mine' : ''}`}>
                  <TeamFaces team={p[0]} /><span className="colo-vs">VS</span><TeamFaces team={p[1]} />
                  {mine && <span className="colo-pair__tag">{t('내 경기')}</span>}
                </div>
              )
            })}
            {cur.bye && (
              <div className="colo-pair colo-pair--bye">
                <TeamFaces team={cur.bye} /><span className="colo-bye">🛋️ {t('휴식')}</span>
              </div>
            )}
          </div>
          {cur.myPair
            ? <button className="toy-btn toy-btn--yellow toy-btn--big colo-cta" onClick={onEnter}>⚔️ {t('입장')}</button>
            : <button className="toy-btn toy-btn--blue colo-cta" onClick={onSkipRound}>🛋️ {t('이번 라운드 휴식 — 결과 보기')}</button>}
        </div>
      )}

      {stage === 'result' && last && (
        <div className="toy-card colo-card">
          <div className="colo-card__head">
            <b>{last.round}{t('라운드 결과')}</b>
            <span className="colo-deduct">-{last.deduction}</span>
          </div>
          {/* 내 경기 배너 */}
          {last.results.filter((r) => r.isMine).map((r, i) => {
            const iWon = r.winner.isUser
            return (
              <div key={i} className={`colo-myresult ${iWon ? 'colo-myresult--win' : 'colo-myresult--lose'}`}>
                <TeamFaces team={r.a} big /><span className="colo-vs colo-vs--big">VS</span><TeamFaces team={r.b} big />
                <div className="colo-myresult__text">{iWon ? `🏆 ${t('승리!')}` : `💥 ${t('패배')} (-${last.deduction})`}</div>
              </div>
            )
          })}
          {/* 다른 경기 — 승자에 ✓ */}
          <div className="colo-others">
            {last.results.filter((r) => !r.isMine).map((r, i) => (
              <div key={i} className="colo-other">
                <span className={r.winner === r.a ? 'colo-w' : 'colo-l'}><TeamFaces team={r.a} /></span>
                <span className="colo-vs">vs</span>
                <span className={r.winner === r.b ? 'colo-w' : 'colo-l'}><TeamFaces team={r.b} /></span>
                <span className="colo-other__win">{r.winner === r.a ? '◀' : '▶'}</span>
              </div>
            ))}
            {last.bye && <div className="colo-other colo-other--bye"><TeamFaces team={last.bye} /> 🛋️</div>}
          </div>
          {/* 포인트 보드 */}
          <div className="colo-board">
            {board.map((tm) => (
              <div key={tm.idx} className={`colo-row ${tm.isUser ? 'colo-row--me' : ''} ${tm.alive ? '' : 'colo-row--dead'}`}>
                <TeamFaces team={tm} />
                <span className="colo-row__name">{tm.isUser ? t('우리 팀') : tm.members[0].name}</span>
                <TeamPts team={tm} deducted={deductedOf(tm)} />
              </div>
            ))}
          </div>
          {last.eliminated.length > 0 && (
            <div className="colo-elim">💀 {last.eliminated.map((tm) => tm.members.map((m) => m.emoji).join('')).join(' · ')} {t('탈락!')}</div>
          )}
          <button className="toy-btn toy-btn--yellow toy-btn--big colo-cta" onClick={onNextRound}>
            {tour.over || !meTeam.alive ? `📋 ${t('최종 결과')}` : `▶ ${t('다음 라운드')} (${t('패배 시')} -${3 + tour.round * 2})`}
          </button>
        </div>
      )}

      {stage === 'final' && (
        <div className="toy-card colo-card colo-card--final">
          {place === 1 && <Fireworks />}
          <div className="colo-final__trophy">{place === 1 ? '🏆' : place === 2 ? '🥈' : place === 3 ? '🥉' : '🏟️'}</div>
          <h3 className="colo-final__place">{place === 1 ? t('우승!') : `${place}${t('위')}`}</h3>
          <p className="colo-final__sub">
            {place === 1 ? t('콜로세움의 정상 — 최후의 팀이 되었다!') : t('다음엔 더 높은 곳으로!')}
          </p>
          <div className="colo-final__coin">🪙 +{ARENA_PLACE_COIN[place] || 10}</div>
          <button className="toy-btn toy-btn--yellow toy-btn--big colo-cta" onClick={onFinish}>{t('보상 받기')}</button>
        </div>
      )}
    </div>
  )
}

// ── 콜로세움 탭 — 우승·최고 순위·완주 ──
function ArenaRecordCard() {
  const rec = loadArenaRecords()
  return (
    <div className="toy-card records-card records-card--defense">
      {rec.runs === 0 ? (
        <p className="records-card__empty">{t('아직 콜로세움에 서 본 적이 없어 — 토너먼트에 도전해 봐! 🏟️')}</p>
      ) : (
        <div className="defense-rec">
          <div className="defense-rec__best">🏆 {t('우승')} <b>{rec.wins}</b>{t('회')}</div>
          <div className="defense-rec__sub">🥇 {t('최고 순위')} {rec.best}{t('위')} · 🎮 {rec.runs}{t('판')}</div>
        </div>
      )}
    </div>
  )
}

// ── 방어전 탭 — 최고 기록·출전·누적 파도 ──
function DefenseRecordCard() {
  const rec = loadDefenseRecords()
  return (
    <div className="toy-card records-card records-card--defense">
      {rec.runs === 0 ? (
        <p className="records-card__empty">{t('아직 파도를 막아본 적이 없어 — 무한 방어에 도전해 봐! 🌊')}</p>
      ) : (
        <div className="defense-rec">
          <div className="defense-rec__best">🏆 {t('최고 기록')} <b>{rec.bestWave}</b>{t('번째 파도')}</div>
          <div className="defense-rec__sub">🌊 {t('누적')} {rec.totalWaves} · 🎮 {rec.runs}{t('판')}</div>
        </div>
      )}
    </div>
  )
}

// ── 업적 탭 — 진행바·달성 여부·보상. 달성한 것이 위로 오지 않게 정의 순서 유지(시리즈가 이어져 보이게).
//  달성한 칭호 배지는 탭해서 바로 장착/해제 — 얻은 자리에서 바로 다는 게 제일 직관적이다 ──
function AchievementCard() {
  const rows = achievementRows()
  const doneCount = rows.filter((r) => r.done).length
  const [equipped, setEquipped] = useState(loadEquippedTitle)
  function toggleTitle(title) {
    const next = equipped === title ? null : title
    saveEquippedTitle(next)
    setEquipped(next)
    sound.step()
  }
  return (
    <div className="toy-card records-card records-card--ach">
      <div className="ach-summary">
        🏆 {doneCount} / {rows.length} {t('달성')}
        {equipped && <span className="ach-summary__title">🎖 {t(equipped)}</span>}
      </div>
      <div className="ach-list">
        {rows.map((r) => (
          <div key={r.id} className={`ach-row ${r.done ? 'ach-row--done' : ''}`}>
            <span className="ach-row__icon">{r.icon}</span>
            <div className="ach-row__body">
              <div className="ach-row__head">
                <b className="ach-row__name">{t(r.name)}</b>
                {r.title && (r.done ? (
                  <button
                    className={`ach-row__title-badge ach-row__title-badge--btn ${equipped === r.title ? 'is-on' : ''}`}
                    title={equipped === r.title ? t('칭호 해제') : t('칭호 장착')}
                    onClick={() => toggleTitle(r.title)}
                  >
                    🎖 {t(r.title)}{equipped === r.title ? ' ✓' : ''}
                  </button>
                ) : (
                  <span className="ach-row__title-badge" title={t('칭호')}>🎖 {t(r.title)}</span>
                ))}
                <span className="ach-row__reward">{r.done ? '✅' : `🪙 ${r.reward}`}</span>
              </div>
              <div className="ach-row__desc">{t(r.desc)}</div>
              {!r.done && (
                <div className="ach-row__track">
                  <div className="ach-row__fill" style={{ width: `${Math.min(100, (r.cur / r.target) * 100)}%` }} />
                  <span className="ach-row__num">{r.cur} / {r.target}</span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── 4.4a. 꾸미기(모자) — 코인으로 사고 장착한다. 미리보기는 수호 지신 + 대표 직업 ──
const HATS = [
  { id: null, name: '맨머리', price: 0 },
  { id: 'straw', name: '밀짚모자', price: 200 },
  { id: 'ribbon', name: '리본', price: 200 },
  { id: 'leaf', name: '새싹', price: 250 },
  { id: 'beanie', name: '털모자', price: 250 },
  { id: 'cap', name: '야구모자', price: 300 },
  { id: 'party', name: '파티 고깔', price: 300 },
  { id: 'flower', name: '꽃 한 송이', price: 350 },
  { id: 'horns', name: '도깨비 뿔', price: 400, fx: true }, // fx: 전용 반짝이 연출(scene.js HAT_FX)
  { id: 'headphones', name: '헤드폰', price: 450 },
  { id: 'halo', name: '천사 고리', price: 600, fx: true },
  { id: 'wizard', name: '마법사 고깔', price: 600, fx: true },
  { id: 'tophat', name: '신사 모자', price: 800, fx: true },
  { id: 'viking', name: '바이킹 투구', price: 900, fx: true },
  { id: 'sakura', name: '벚꽃 화관', price: 1000, fx: true },
  { id: 'crown', name: '왕관', price: 1500, fx: true },
]

// 옷 코스튬 목록 — 모자와 같은 구조(scene.js COSTUME_BUILDERS와 id 일치)
const COSTUMES = [
  { id: null, name: '기본', price: 0 },
  { id: 'bowtie', name: '나비넥타이', price: 200 },
  { id: 'scarf', name: '목도리', price: 250 },
  { id: 'lei', name: '꽃목걸이', price: 300 },
  { id: 'backpack', name: '배낭', price: 300 },
  { id: 'quiver', name: '화살통', price: 350 },
  { id: 'shield', name: '등 방패', price: 400 },
  { id: 'tube', name: '오리 튜브', price: 450 },
  { id: 'lantern', name: '초롱불', price: 500, fx: true },
  { id: 'goldcape', name: '황금 망토', price: 600 },
  { id: 'armor', name: '기사 갑옷', price: 700 },
  { id: 'redcloak', name: '진홍 망토', price: 800 },
  { id: 'jetpack', name: '로켓 배낭', price: 900, fx: true },
  { id: 'wings', name: '천사 날개', price: 1200, fx: true },
  { id: 'devilwings', name: '악마 날개', price: 1200, fx: true },
  { id: 'starcape', name: '별의 망토', price: 1500, fx: true },
]

// 무기 스킨 목록 — 장착하면 직업 기본 무기를 대체한다(scene.js WEAPON_SKINS와 id 일치)
const WEAPONS = [
  { id: null, name: '기본 무기', price: 0 },
  { id: 'woodsword', name: '목검', price: 200 },
  { id: 'candycane', name: '사탕 지팡이', price: 250 },
  { id: 'pan', name: '프라이팬', price: 300 },
  { id: 'mallet', name: '뿅망치', price: 350 },
  { id: 'fish', name: '생선', price: 400 },
  { id: 'umbrella', name: '우산', price: 450 },
  { id: 'trident', name: '삼지창', price: 550 },
  { id: 'doubleaxe', name: '양날도끼', price: 650 },
  { id: 'guitar', name: '일렉 기타', price: 700 },
  { id: 'scythe', name: '낫', price: 750 },
  { id: 'gemstaff', name: '보석 지팡이', price: 900, fx: true },
  { id: 'lightspear', name: '번개 창', price: 1000, fx: true },
  { id: 'flamesword', name: '화염검', price: 1200, fx: true },
  { id: 'frostblade', name: '서리검', price: 1200, fx: true },
  { id: 'excalibur', name: '성검', price: 1500, fx: true },
]

// 보스전 클리어 타임 표기 (m:ss)
const fmtClearTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

// 개발자 모드 — 웹 테스트(vite dev 서버 또는 주소에 ?devhat)에서는 모든 꾸미기를 코인 없이
// 바로 장착해 본다. 앱(Capacitor)과 일반 빌드에서는 꺼져 있어 코인 경제에 영향 없음.
const HAT_DEV = import.meta.env.DEV
  || (typeof location !== 'undefined' && new URLSearchParams(location.search).has('devhat'))

// 탭별 데이터·저장소 바인딩 — 모자/옷이 같은 화면 로직을 공유한다
const WARDROBE_TABS = {
  hat: {
    label: '🎩 모자', items: HATS,
    loadOwned: loadOwnedHats, addOwned: addOwnedHat,
    loadEquipped: loadEquippedHat, saveEquipped: saveEquippedHat,
  },
  costume: {
    label: '🧣 옷', items: COSTUMES,
    loadOwned: loadOwnedCostumes, addOwned: addOwnedCostume,
    loadEquipped: loadEquippedCostume, saveEquipped: saveEquippedCostume,
  },
  weapon: {
    label: '🗡️ 무기', items: WEAPONS,
    loadOwned: loadOwnedWeapons, addOwned: addOwnedWeapon,
    loadEquipped: loadEquippedWeapon, saveEquipped: saveEquippedWeapon,
  },
}

function HatScreen({ profile, onBack }) {
  const [tab, setTab] = useState('hat')
  const [coins, setCoins] = useState(loadCoins)
  const [buyAsk, setBuyAsk] = useState(null) // 구매 확인 대기 중인 아이템 — 실수 차감 방지
  const [owned, setOwned] = useState(() => ({ hat: loadOwnedHats(), costume: loadOwnedCostumes(), weapon: loadOwnedWeapons() }))
  const [equipped, setEquipped] = useState(() => ({ hat: loadEquippedHat(), costume: loadEquippedCostume(), weapon: loadEquippedWeapon() }))
  // 미리 입어보기 — 아무거나 눌러 공짜로 걸쳐 본다(저장 안 함). 보유품을 누르면 장착.
  // 미리보기는 탭별로 따로 들고, 무대에는 모자+옷을 함께 입혀 조합을 보여준다.
  const [preview, setPreview] = useState(() => ({ hat: loadEquippedHat(), costume: loadEquippedCostume(), weapon: loadEquippedWeapon() }))
  const saved = loadSoloPick()
  const previewCls = CLASSES[saved?.cls] ? saved.cls : 'warrior'
  const T = WARDROBE_TABS[tab]
  const previewDef = T.items.find((it) => (it.id || null) === (preview[tab] || null))
  const previewOwned = preview[tab] === null || HAT_DEV || owned[tab].includes(preview[tab])

  function pick(item) {
    setPreview((p) => ({ ...p, [tab]: item.id })) // 누르면 일단 걸쳐 본다
    if (item.id === null || HAT_DEV || owned[tab].includes(item.id)) {
      T.saveEquipped(item.id) // 보유품 → 장착 (기본/맨머리 = 해제)
      setEquipped((e) => ({ ...e, [tab]: item.id }))
    }
    sound.step()
  }

  function buyPreview() {
    if (previewOwned || !previewDef || coins < previewDef.price) return
    sound.go()
    addCoins(-previewDef.price)
    T.addOwned(preview[tab])
    T.saveEquipped(preview[tab]) // 사면 바로 장착
    setCoins(loadCoins())
    setOwned((o) => ({ ...o, [tab]: T.loadOwned() }))
    setEquipped((e) => ({ ...e, [tab]: preview[tab] }))
  }

  return (
    <div className="screen hats-screen">
      <BackButton onBack={onBack} />
      <h2 className="toy-heading toy-heading--screen">{t('꾸미기')}</h2>
      <div className="hats-screen__body">
        <aside className="toy-card hats-preview">
          <HatPreview cls={previewCls} zodiacId={profile} hat={preview.hat} costume={preview.costume} weapon={preview.weapon} />
          <span className="char-screen__coins">🪙 {coins}</span>
          {!previewOwned && previewDef && (
            coins >= previewDef.price
              ? (
                <button className="toy-btn toy-btn--yellow hats-buy" onClick={() => { sound.step(); setBuyAsk(previewDef) }}>
                  🪙 {previewDef.price} {t('구매·장착')}
                </button>
              )
              : <span className="hats-buy hats-buy--poor">🪙 {previewDef.price} — {t('코인이 부족해요')}</span>
          )}
        </aside>
        <div className="toy-card hats-grid-card">
          <div className="hats-tabs">
            {Object.entries(WARDROBE_TABS).map(([id, def]) => (
              <button
                key={id}
                className={`hats-tab ${tab === id ? 'is-on' : ''}`}
                onClick={() => { setTab(id); sound.step() }}
              >
                {t(def.label)}
              </button>
            ))}
          </div>
          <div className="hats-grid">
            {T.items.map((item) => {
              const isOwned = item.id === null || owned[tab].includes(item.id)
              const isOn = (equipped[tab] || null) === item.id
              const isPreview = (preview[tab] || null) === item.id
              return (
                <button
                  key={item.id || 'none'}
                  className={`hat-card ${isOn ? 'is-on' : ''} ${!isOn && isPreview ? 'is-preview' : ''}`}
                  onClick={() => pick(item)}
                >
                  <span className="hat-card__name">{t(item.name)}{item.fx ? ' ✨' : ''}</span>
                  <span className="hat-card__tag">
                    {isOn ? t('장착 중') : isOwned ? t('보유') : `🪙 ${item.price}`}
                  </span>
                </button>
              )
            })}
          </div>
          <p className="hats-note">
            {HAT_DEV
              ? <>🛠 {t('개발자 모드: 모든 꾸미기를 바로 장착해 볼 수 있어요')}</>
              : t('아무거나 눌러서 공짜로 걸쳐 보세요 — 장착은 보유한 것만 돼요')}
          </p>
        </div>
      </div>
      {buyAsk && (
        <BuyConfirm
          title={`${t(buyAsk.name)}${buyAsk.fx ? ' ✨' : ''}`}
          desc={`🪙 ${buyAsk.price} ${t('코인을 사용해서 사고 바로 입어볼까요?')}`}
          price={buyAsk.price}
          okLabel={t('구매·장착')}
          onOk={() => { buyPreview(); setBuyAsk(null) }}
          onCancel={() => { sound.step(); setBuyAsk(null) }}
        />
      )}
    </div>
  )
}

// ── 4.4. 설정 — 언어·사운드 (게임 전역, 인게임 설정과 같은 저장소) ──
// 그래픽 품질 3단(인게임 설정과 동일 값) — 메뉴 설정에서도 미리 바꿀 수 있다
const GFX_OPTS = [
  { id: 'high', label: '상' },
  { id: 'med', label: '중' },
  { id: 'low', label: '하' },
]

function SettingsScreen({ onBack, onLicenses }) {
  const [soundOn, setSoundOn] = useState(loadSoundOn)
  const [gfx, setGfx] = useState(loadRiftGfx)
  const lang = getLang()
  function toggleSound() {
    const n = !soundOn
    setSoundOn(n)
    saveSoundOn(n)
    sound.setEnabled(n)
    if (n) { sound.unlock(); sound.step() }
  }
  function pickGfx(id) {
    setGfx(id)
    saveRiftGfx(id)
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
        <div className="settings-row">
          <span className="settings-row__label">🎨 {t('그래픽')}</span>
          <div className="settings-row__seg">
            {GFX_OPTS.map((o) => (
              <button
                key={o.id}
                className={`toy-pill ${gfx === o.id ? 'is-on' : ''}`}
                onClick={() => pickGfx(o.id)}
              >
                {t(o.label)}
              </button>
            ))}
          </div>
        </div>
        <button className="settings-link" onClick={onLicenses}>{t('ⓘ 오픈소스 라이선스')} ›</button>
        <p className="settings-note">{t('언어를 바꾸면 화면이 새로고침돼요')} · {t('그래픽은 다음 전투부터 적용돼요')}</p>
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
