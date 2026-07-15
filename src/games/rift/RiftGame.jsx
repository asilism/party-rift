import { useEffect, useRef, useState } from 'react'
import Rift3D from './Rift3D.jsx'
import RiftMiniMap from './RiftMiniMap.jsx'
import RiftControls from './RiftControls.jsx'
import RiftShop from './RiftShop.jsx'
import Fireworks from '../../shared/Fireworks.jsx'
import FullscreenButton from '../../shared/FullscreenButton.jsx'
import { IS_APP_SHELL } from '../../shared/appShell.js'
import { canShop, CLASSES, bountyGold } from './engine.js'
import { getZodiac } from '../../shared/zodiac.js'
import { getItem, ITEM_SLOTS } from './items.js'
import { sound } from '../../shared/sound.js'
import { loadRiftControl, saveRiftControl, loadRiftHitFx, saveRiftHitFx, loadRiftGfx, saveRiftGfx, loadRiftBtnScale, saveRiftBtnScale } from '../../shared/storage.js'
import { useRealtimeGame } from '../../net/useRealtimeGame.js'
import { riftNet } from './netgame.js'
import { NetWaiting } from '../../net/NetParts.jsx'
import { t, tFeed } from '../../shared/i18n.js'

// 조디악 블리츠 — 3:3 AOS. 온라인 방 전용(기기마다 조이스틱이 필요해서).
//  - 서버 권위(④): 서버가 60Hz로 시뮬레이션을 돌리고 30Hz로 바이너리 델타 스냅샷을 방송.
//  - 클라(①③): 내 영웅은 입력 즉시 반영(예측)·권위 보정, 남의 유닛은 보간으로 부드럽게.
//      모든 동기화 배관은 useRealtimeGame이 담당.
//  - 영웅은 기기당 1명: 그 기기가 드래프트에서 고른 영웅을 조종한다.
//  - 매치(팀/직업)는 서버가 드래프트로 확정·시작하므로, 이 컴포넌트는 전장을 그리기만 한다.
export default function RiftGame({ onExit, net, bonus = null, adButton = null }) {
  const online = !!net?.online
  const ctrlRef = useRef({ mx: 0, mz: 0 })
  const { view, sample, myId, sendAction } = useRealtimeGame(net, riftNet, ctrlRef)
  const [soundOn, setSoundOn] = useState(true)
  // 핑(왕복 지연) — RoomClient가 2초마다 계측한 값을 1초 주기로 읽어 HUD에 보여 준다
  const [rtt, setRtt] = useState(0)
  useEffect(() => {
    if (!net?.getRtt) return undefined
    const t = setInterval(() => setRtt(net.getRtt() || 0), 1000)
    return () => clearInterval(t)
  }, [net])

  // 전장 진입 시 사운드 준비(첫 입력에서 unlock)
  useEffect(() => {
    sound.setEnabled(soundOn)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 버튼/상점 — 소유권은 서버가 판정(내 영웅에만 적용)
  function cast(slot) {
    sendAction({ type: 'cast', slot })
  }
  function buy(itemId) {
    sendAction({ type: 'buy', itemId })
  }
  function sell(slot) {
    sendAction({ type: 'sell', slot })
  }

  function resetShopBuys() {
    sendAction({ type: 'resetShop' }) // 소유권은 서버가 판정(내 영웅에만 적용)
  }
  function useItemSlot(slot) {
    sendAction({ type: 'useItem', slot }) // 액티브 아이템(물병/종) 사용
  }

  function toggleSound() {
    const n = !soundOn
    setSoundOn(n)
    sound.setEnabled(n)
    if (n) sound.unlock()
  }

  // 조이스틱이 필요한 게임이라 온라인 방 전용 (로비에서도 막지만 한 번 더 가드)
  if (!online) {
    return (
      <div className="net-screen">
        <div className="net-screen__icon">⚔️</div>
        <p>{t('조디악 블리츠는 온라인 방 전용이에요. 각자 기기로 접속해 주세요!')}</p>
        <button className="btn btn--primary" onClick={onExit}>{t('← 돌아가기')}</button>
      </div>
    )
  }

  // 아직 서버 스냅샷을 못 받았을 때(전장 생성 직후) — 곧 엔진 카운트다운이 이어진다
  if (!view || view.phase !== 'play') {
    return <NetWaiting text={t('이제 곧 경기가 시작합니다… ⚔️')} onExit={onExit} />
  }

  // ── 전투 단계 ──
  return (
    <RiftPlay
      hud={view}
      sample={sample}
      myId={myId}
      ctrlRef={ctrlRef}
      onCast={cast}
      onBuy={buy}
      onSell={sell}
      onResetShop={resetShopBuys}
      onUseItem={useItemSlot}
      rtt={rtt}
      onTogglePause={net.rtPause ? () => net.rtPause(!view.paused) : null}
      exitLabel={net.local ? t('🔁 다시 하기') : t('🔁 새 매치 찾기')}
      bonus={bonus}
      adButton={adButton}
      onExit={onExit}
      soundOn={soundOn}
      onToggleSound={toggleSound}
    />
  )
}

// 전투 FX(종류) → 효과음 카테고리. 근접/원거리/마법/건물파괴 + 보조.
const FX_SOUND = {
  dash: 'melee', blink: 'melee', execute: 'melee', whirl: 'melee', // 근접 타격
  volley: 'ranged', lightarrow: 'ranged', // 원거리 타격
  boom: 'magic', meteorhit: 'magic', fissure: 'magic', chain: 'magic', frost: 'magic', // 마법 타격
  curse: 'magic', frostnova: 'magic', abszero: 'magic', plague: 'magic', doom: 'magic', // 직업 전용 마법
  venom: 'magic', // 이무기 독 뿜기
  dread: 'magic', shriek: 'magic', // 공포술사
  quake: 'tower', cage: 'magic', rocksplash: 'magic', // 대지술사 (융기는 돌 구르는 묵직함 → 타워 계열음)
  poof: 'shield', // 환영무희 연막 펑
  heal: 'heal', holylight: 'heal', shield: 'shield', // 보조
  berserk: 'melee', taunt: 'shield', haste: 'heal', stealth: 'shield', hawk: 'ranged', // 보조 스킬
  summon: 'magic', deploy: 'shield', // 소환/설치
  towerfall: 'tower', nexusfall: 'nexus', // 건물 파괴
}
// 위치 기반 가청 범위(월드 유닛): 전투/스킬 소리는 내 화면 근처(약 1화면)만, 건물 붕괴는 더 멀리까지.
const AUDIO_RANGE = 52
const AUDIO_RANGE_BIG = 105
const FX_PLAY = {
  melee: () => sound.meleeHit(),
  ranged: () => sound.rangedHit(),
  magic: () => sound.magicHit(),
  heal: () => sound.healChime(),
  shield: () => sound.shield(),
  tower: () => sound.towerFall(),
  nexus: () => sound.nexusFall(),
}
const FX_THROTTLE_MS = 110 // 같은 카테고리는 이 간격 안에선 한 번만 (동시 타격/연속 틱 스팸 방지)

// HUD 효과음: 스냅샷 변화를 보고 호스트/게스트 동일하게 재생
function useRiftSounds(hud, myId) {
  const prev = useRef({})
  const fxSeen = useRef(0) // 마지막으로 사운드를 낸 fx의 최대 id
  const fxLast = useRef({}) // 카테고리별 마지막 재생 시각(ms)
  useEffect(() => {
    if (!hud) return
    const p = prev.current
    const me = hud.heroes?.find((h) => h.id === myId)
    if (hud.status === 'countdown' && hud.countdown > 0 && hud.countdown !== p.countdown) sound.count()
    if (hud.status === 'playing' && p.status === 'countdown') sound.go()
    const feedSeq = hud.feed?.length ? hud.feed[hud.feed.length - 1].seq : 0
    // 새 판(한판 더!)에선 feedSeq가 1부터 다시 시작하므로 이전 값보다 작아진다 → 0으로 보고 비교
    const prevFeedSeq = feedSeq >= (p.feedSeq || 0) ? (p.feedSeq || 0) : 0
    if (p.feedSeq != null && feedSeq > prevFeedSeq) sound.key()
    if (me && p.respawnT === 0 && me.respawnT > 0) sound.chuteDown() // 내 영웅 사망
    if (me && p.respawnT > 0 && me.respawnT === 0) sound.ladderUp() // 부활!
    if (me && p.lvl != null && me.lvl > p.lvl) sound.ladderUp() // 레벨 업
    // 전투 FX → 카테고리별 효과음. 새로 등장한 fx만, 카테고리별 throttle.
    const fxs = hud.fx || []
    const curMax = fxs.reduce((m, f) => (f.id > m ? f.id : m), 0)
    if (curMax < fxSeen.current) fxSeen.current = 0 // 새 판: fx id가 작아지면 추적 리셋
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
    for (const f of fxs) {
      if (f.id <= fxSeen.current) continue
      const cat = FX_SOUND[f.kind]
      if (!cat) continue
      // 위치 기반 가청: 내 영웅에서 먼 곳의 소리는 들리지 않는다(관전 중이면 전부 들림).
      if (me && f.x != null) {
        const range = cat === 'tower' || cat === 'nexus' ? AUDIO_RANGE_BIG : AUDIO_RANGE
        const dx = f.x - me.x
        const dz = f.z - me.z
        if (dx * dx + dz * dz > range * range) continue
      }
      if (now - (fxLast.current[cat] || 0) < FX_THROTTLE_MS) continue
      fxLast.current[cat] = now
      FX_PLAY[cat]()
    }
    fxSeen.current = Math.max(fxSeen.current, curMax)
    // 우리 수호석이 공격받기 시작하면 경고음
    const myTeam = me?.team
    const nexusAlert = !!(hud.nexus && (
      myTeam ? hud.nexus[myTeam]?.underAttack
        : (hud.nexus.blue?.underAttack || hud.nexus.red?.underAttack)
    ))
    if (nexusAlert && !p.nexusAlert) sound.thunder()
    if (hud.status === 'finished' && p.status && p.status !== 'finished') sound.win()
    prev.current = {
      countdown: hud.countdown,
      status: hud.status,
      feedSeq,
      respawnT: me?.respawnT ?? 0,
      lvl: me?.lvl,
      nexusAlert,
    }
  }, [hud, myId])
}

// 킬/오브젝트 피드 배너: 새 항목이 오면 잠깐 띄운다
function useFeedBanner(hud) {
  const [msg, setMsg] = useState(null)
  const lastSeq = useRef(0)
  const timerRef = useRef(null)
  useEffect(() => () => clearTimeout(timerRef.current), [])
  useEffect(() => {
    const last = hud?.feed?.[hud.feed.length - 1]
    if (!last) return
    // "한판 더!"로 새 판이 시작되면 feedSeq가 1부터 다시 시작 → 이전 값보다 작아진다.
    // 이때 추적값을 초기화하지 않으면 새 판의 이벤트 메시지가 전부 무시된다(버그).
    if (last.seq < lastSeq.current) lastSeq.current = 0
    if (last.seq <= lastSeq.current) return
    lastSeq.current = last.seq
    setMsg({ text: last.msg, key: last.seq })
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setMsg(null), 2600)
  }, [hud])
  return msg
}

const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

// 조작 방식 목록. 'lol'(롤 방식)은 아직 미구현이라 선택 불가(추후 도입).
const CONTROL_SCHEMES = [
  { id: 'wasd', icon: '⌨️', label: 'WASD 키보드', desc: 'WASD·화살표 이동, H/J/K 스킬, L 평타, 1·2 아이템' },
  { id: 'lol', icon: '🖱️', label: '롤 방식', desc: '추후 도입 예정', soon: true },
  { id: 'mobile', icon: '📱', label: '모바일', desc: '드래그 조이스틱 + 터치 버튼' },
  { id: 'xbox', icon: '🎮', label: 'Xbox 컨트롤러', desc: '스틱 이동, A 평타, X/Y/B 스킬, LB·RB 아이템' },
]

// 보스전 레이드 체력바 — 화면 상단 중앙 고정. 이름·레벨, 국면 색 채움(빨강→주황→보라),
// 70%/40% 국면 마커(금색), 각성 휴지기엔 💤 + 보라 광택으로 '무적·정비 시간'을 알린다.
const BOSS_FACE = { boss_colossus: '👹', boss_archmage: '🧙', boss_shadow: '👺' }
function BossRaidBar({ hud }) {
  const boss = hud.heroes?.find((h) => h.cls?.startsWith('boss_'))
  if (!boss || boss.hp <= 0) return null
  const frac = Math.max(0, Math.min(1, boss.hp / boss.maxHp))
  const ph = boss.bossPhase || 1
  const shielded = (boss.bossShieldT || 0) > 0
  const phColor = ph === 3 ? '#b266ff' : ph === 2 ? '#ff7d2a' : '#ff4d4d'
  return (
    <div className={`boss-bar ${shielded ? 'boss-bar--shield' : ''}`}>
      <div className="boss-bar__title">
        <span className="boss-bar__face">{BOSS_FACE[boss.cls] || '👹'}</span>
        <span className="boss-bar__name">{t(CLASSES[boss.cls]?.name || '보스')} · {boss.name}</span>
        {shielded && <span className="boss-bar__zzz">💤 {Math.ceil(boss.bossShieldT)}s</span>}
      </div>
      <div className="boss-bar__track">
        <div className="boss-bar__fill" style={{ width: `${frac * 100}%`, background: phColor }} />
        <span className="boss-bar__mark" style={{ left: '70%' }} />
        <span className="boss-bar__mark" style={{ left: '40%' }} />
        <span className="boss-bar__pct">{Math.ceil(frac * 100)}%</span>
      </div>
    </div>
  )
}

// 보스전 인트로 타이틀 카드 — 카운트다운 동안 카메라가 보스를 비추는 사이 중앙에 뜬다
function BossIntroCard({ hud }) {
  const boss = hud.heroes?.find((h) => h.cls?.startsWith('boss_'))
  if (!boss) return null
  return (
    <div className="boss-intro">
      <div className="boss-intro__type">{BOSS_FACE[boss.cls] || '👹'} {t(CLASSES[boss.cls]?.name || '보스')}</div>
      <div className="boss-intro__name">{boss.name}</div>
      <div className="boss-intro__sub">{t('쓰러뜨리면 승리 — 수호석을 지켜라')}</div>
    </div>
  )
}

// 양 팀 현황판(팀 킬 스코어 + 영웅별 K/D/A·레벨·아이템). 두 팀 카드를 나란히 반환한다 —
// 감싸는 래퍼(.rift__dead-board / .rift-result / .rift-board__panel)는 호출부가 정한다.
// 사망 화면·설정 팝업·결과창에서 공용으로 쓴다.
function RiftRoster({ hud, crown = null }) {
  return ['blue', 'red'].map((team) => (
    <div key={team} className={`rift-result__team rift-result__team--${team}`}>
      <h4>
        {team === 'blue' ? t('🔵 파랑팀') : t('🔴 빨강팀')} {crown === team ? '👑' : ''}
        <span className="rift-result__teamkills"> ⚔️ {hud.kills[team]}</span>
      </h4>
      {hud.heroes.filter((h) => h.team === team).map((h) => {
        const bounty = bountyGold(h.killStreak)
        return (
          <div key={h.id} className="rift-result__row">
            <span className="rift-result__zodiac">{getZodiac(h.zodiacId)?.emoji}</span>
            <span className="rift-result__cls" title={CLASSES[h.cls]?.name}>{CLASSES[h.cls]?.icon}</span>
            <span className="rift-result__name">
              <span className="rift-result__nick">{h.name}{h.isBot ? ' 🤖' : ''}</span>
              {bounty > 0 && (
                <span className="rift-result__bounty" title={`${t('연속')} ${h.killStreak}${t('킬 — 잡으면 현상금 +')}${bounty}`}>
                  🔥{bounty}
                </span>
              )}
            </span>
            <span className="rift-result__lvl">{h.cls?.startsWith('boss_') ? '👑' : `Lv.${h.lvl}`}</span>
            <span className="rift-result__kda">⚔️{h.kills} 💀{h.deaths} 🤝{h.assists}</span>
            <span className="rift-result__items">
              {(h.items || []).map((it) => getItem(it)?.icon).join('') || '—'}
            </span>
          </div>
        )
      })}
    </div>
  ))
}

// 우상단 설정 버튼 하나로 통합한 메뉴: 팀 현황·일시정지·소리·전체화면·조작 방식·나가기를 분기 메뉴로 띄운다.
const GFX_LABEL = { high: '상 (최고화질)', med: '중 (균형)', low: '하 (성능)' }

function RiftSettingsMenu({ paused, finished, onTogglePause, soundOn, onToggleSound, scheme, onSchemeChange, hitFx, onToggleHitFx, gfx, onCycleGfx, btnScale, onBtnScaleChange, onExit }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [open])

  return (
    <div className="rift-settings" ref={wrapRef}>
      <button
        className={`btn btn--ghost rift-settings__toggle ${open ? 'rift-settings__toggle--on' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-label={t('설정')}
        aria-expanded={open}
      >
        ⚙️
      </button>
      {/* 메뉴를 열면 화면 전체를 어둡게 덮어 조작 버튼과 겹쳐 보이지 않게 한다(누르면 닫힘) */}
      {open && <div className="rift-settings__backdrop" onClick={() => setOpen(false)} />}
      {open && (
        <div className="rift-settings__menu" role="menu">
          {onTogglePause && !finished && (
            <button className="rift-settings__item" onClick={() => { onTogglePause(); setOpen(false) }}>
              <span>{paused ? '▶️' : '⏸️'}</span> {paused ? t('재개') : t('일시정지')}
            </button>
          )}
          <button className="rift-settings__item" onClick={onToggleSound}>
            <span>{soundOn ? '🔊' : '🔇'}</span> {t('사운드')} {soundOn ? t('켜짐') : t('꺼짐')}
          </button>
          <button className="rift-settings__item" onClick={onToggleHitFx}>
            <span>{hitFx ? '💥' : '🚫'}</span> {t('타격 효과')} {hitFx ? t('켜짐') : t('꺼짐')}
          </button>
          <button className="rift-settings__item" onClick={onCycleGfx}>
            <span>🎨</span> {t('그래픽')} {t(GFX_LABEL[gfx] || GFX_LABEL.med)}
          </button>
          {!IS_APP_SHELL && (
            <div className="rift-settings__item rift-settings__item--full">
              <FullscreenButton />
            </div>
          )}
          {/* 전투 버튼 크기 — 자동(화면 높이) 배율 위에 유저 배율을 곱한다 */}
          <div className="rift-settings__slider">
            <span>🔘 {t('버튼 크기')}</span>
            <input
              type="range" min="0.7" max="1.3" step="0.05" value={btnScale}
              onChange={(e) => onBtnScaleChange(Number(e.target.value))}
              aria-label={t('버튼 크기')}
            />
            <b>{Math.round(btnScale * 100)}%</b>
          </div>

          <div className="rift-settings__sep" />
          <div className="rift-settings__label">{t('🎮 조작 방식')}</div>
          {CONTROL_SCHEMES.map((s) => (
            <button
              key={s.id}
              className={`rift-settings__scheme ${scheme === s.id ? 'rift-settings__scheme--on' : ''} ${s.soon ? 'rift-settings__scheme--soon' : ''}`}
              onClick={() => { if (!s.soon) onSchemeChange(s.id) }}
              disabled={s.soon}
            >
              <span className="rift-settings__scheme-icon">{s.icon}</span>
              <span className="rift-settings__scheme-text">
                <strong>{t(s.label)}{s.soon ? ` (${t('추후 도입')})` : ''}</strong>
                <small>{t(s.desc)}</small>
              </span>
              {scheme === s.id && <span className="rift-settings__scheme-check">✓</span>}
            </button>
          ))}

          <div className="rift-settings__sep" />
          <button className="rift-settings__item rift-settings__item--exit" onClick={() => { setOpen(false); onExit() }}>
            <span>🚪</span> {t('나가기')}
          </button>
        </div>
      )}
    </div>
  )
}

// 전투 화면 (호스트/게스트 공용). 3D 캔버스 + HUD + 터치 컨트롤.
function RiftPlay({
  hud, sample, myId, ctrlRef, onCast, onBuy, onSell, onResetShop, onUseItem, rtt = 0, onTogglePause, exitLabel = '🔁 새 매치 찾기', onExit, soundOn, onToggleSound, bonus = null, adButton = null,
}) {
  useRiftSounds(hud, myId)
  const banner = useFeedBanner(hud)
  const [shopOpen, setShopOpen] = useState(false)
  const [boardOpen, setBoardOpen] = useState(false) // 📊 전적판(양 팀 KDA·아이템) 오버레이
  const [scheme, setScheme] = useState(loadRiftControl) // 조작 방식: mobile/wasd/xbox
  function changeScheme(s) {
    setScheme(s)
    saveRiftControl(s)
  }
  const [hitFx, setHitFx] = useState(loadRiftHitFx) // 타격 효과(피격 테두리·화면 흔들림) on/off
  function toggleHitFx() {
    setHitFx((on) => {
      const n = !on
      saveRiftHitFx(n)
      return n
    })
  }
  const [gfx, setGfx] = useState(loadRiftGfx) // 그래픽 품질: high(상)/med(중)/low(하)
  function cycleGfx() {
    setGfx((q) => {
      const n = q === 'high' ? 'med' : q === 'med' ? 'low' : 'high' // 상→중→하→상 순환
      saveRiftGfx(n)
      return n
    })
  }
  const [btnScale, setBtnScale] = useState(loadRiftBtnScale) // 전투 버튼 크기 배율(유저 설정)
  function changeBtnScale(v) {
    setBtnScale(v)
    saveRiftBtnScale(v)
  }
  // 배경음악(칩튠 루프): 경기 중에만 흐르고, 어느 한쪽 수호석이 위태로우면 템포 업
  const bgmStatus = hud?.status
  const paused = !!hud?.paused
  const nexusCrisis = !!(
    hud?.nexus &&
    (hud.nexus.blue.hp < hud.nexus.blue.maxHp * 0.35 ||
      hud.nexus.red.hp < hud.nexus.red.maxHp * 0.35)
  )
  useEffect(() => {
    if (bgmStatus === 'playing' && soundOn && !paused) sound.musicStartLift()
    else sound.musicStop()
    sound.musicSetFast(nexusCrisis)
  }, [bgmStatus, nexusCrisis, soundOn, paused])
  useEffect(() => () => sound.musicStop(), [])
  // 승리 팝업은 수호석 폭발 연출(카메라 이동 + 펑)이 끝난 뒤 페이드인하도록 잠깐 늦춘다
  const finishedNow = hud?.status === 'finished'
  const [showWin, setShowWin] = useState(false)
  useEffect(() => {
    if (!finishedNow) { setShowWin(false); return undefined }
    const t = setTimeout(() => setShowWin(true), 1700)
    return () => clearTimeout(t)
  }, [finishedNow])
  // 보스 국면 전환 화면 연출 — 국면이 오르는 순간 국면 색 플래시(비네트) + 화면 흔들림
  const [phaseFx, setPhaseFx] = useState(null)
  const prevPhaseRef = useRef(1)
  useEffect(() => {
    const b = hud?.mode === 'boss' ? hud.heroes?.find((h) => h.cls?.startsWith('boss_')) : null
    const ph = b?.bossPhase || 1
    if (ph > prevPhaseRef.current) {
      prevPhaseRef.current = ph
      setPhaseFx({ color: ph === 3 ? '#b266ff' : '#ff7d2a', key: Date.now() })
      const timer = setTimeout(() => setPhaseFx(null), 1000)
      return () => clearTimeout(timer)
    }
    prevPhaseRef.current = ph
    return undefined
  }, [hud])
  // 상점은 우물 안에 있거나 사망(부활 대기) 중에 열 수 있다 — 그 밖이면 자동으로 닫힌다
  const me = hud?.heroes?.find((h) => h.id === myId)
  const meCanShop = !!(me && canShop(me))
  useEffect(() => {
    if (!meCanShop) setShopOpen(false)
  }, [meCanShop])
  if (!hud || hud.phase !== 'play') {
    return <NetWaiting text={t('전장을 준비하고 있어요... ⚔️')} onExit={onExit} />
  }

  const finished = hud.status === 'finished'
  const myTeam = me?.team
  // 승리 메시지를 한 글자씩 나타나게 — "파랑팀 승리"를 글자 단위로 쪼갠다(공백은 자리만 차지).
  // 보스전은 토벌 서사로: "카르곤 토벌!" / "토벌 실패..."
  const raidBoss = hud.mode === 'boss' ? hud.heroes?.find((h) => h.cls?.startsWith('boss_')) : null
  const winText = raidBoss
    ? hud.winner === 'blue' ? `${raidBoss.name} ${t('토벌!')}` : t('토벌 실패...')
    : hud.winner === 'blue' ? t('파랑팀 승리') : hud.winner === 'red' ? t('빨강팀 승리') : t('무승부')
  let winBeat = 0
  const winChars = [...winText].map((ch, i) => ({
    ch, key: i, space: ch === ' ', delay: ch === ' ' ? 0 : winBeat++ * 0.16,
  }))
  // 우리 수호석이 공격받고 있으면 경고 (관전자는 양 팀 모두 표시)
  const nexusUnderAttack = !finished && !!(hud.nexus && (
    myTeam ? hud.nexus[myTeam]?.underAttack
      : (hud.nexus.blue?.underAttack || hud.nexus.red?.underAttack)
  ))

  return (
    <div className={`rift ${phaseFx ? 'rift--quake' : ''}`} style={{ '--btn-user': btnScale }} onContextMenu={(e) => e.preventDefault()}>
      <Rift3D sample={sample} myId={myId} mode={hud.mode || '3v3'} hitFx={hitFx} gfx={gfx} />
      {phaseFx && <div key={phaseFx.key} className="boss-flash" style={{ '--fc': phaseFx.color }} />}

      {me && !finished && (
        <RiftControls
          onMove={(mx, mz) => {
            ctrlRef.current.mx = mx
            ctrlRef.current.mz = mz
          }}
          onAttack={() => onCast('atk')}
          onSkill={() => onCast('skill')}
          onSkill2={() => onCast('skill2')}
          onUlt={() => onCast('ult')}
          onRecall={() => onCast('recall')}
          onUseItem={onUseItem}
          me={me}
          disabled={me.respawnT > 0 || paused}
          scheme={scheme}
        />
      )}

      <div className="rift__hud">
        {hud.mode === 'boss' && !finished && <BossRaidBar hud={hud} />}
        {hud.mode === 'boss' && hud.status === 'countdown' && <BossIntroCard hud={hud} />}
        <div className="ladder__topbar rift__topbar">
          {/* 우상단(설정 옆): 개인 전적 — 킬/데스/어시 · 골드 · 진행 시간 */}
          <div className="topbar__right">
            <div className="rift__stats">
              {me && (
                <>
                  <span className="rift__stats-kda">
                    <span title="킬">⚔️{me.kills}</span>
                    <span title="데스">💀{me.deaths}</span>
                    <span title="어시스트">🤝{me.assists}</span>
                  </span>
                  <span className="rift__stats-gold">💰{me.gold}</span>
                </>
              )}
              <span className="rift__stats-time">⏱{fmtTime(hud.timePlayed || 0)}</span>
              {rtt > 0 && (
                <span
                  className="rift__stats-ping"
                  title={`서버 왕복 지연 ${rtt}ms`}
                  style={{ color: rtt < 80 ? '#7ae08a' : rtt < 150 ? '#ffd34d' : '#ff7a6a' }}
                >
                  📶{rtt}
                </span>
              )}
            </div>
            {/* 📊 전적판 — 설정과 분리된 전용 버튼 (양 팀 KDA·레벨·아이템) */}
            <button
              className={`btn btn--ghost rift-board__toggle ${boardOpen ? 'rift-board__toggle--on' : ''}`}
              onClick={() => setBoardOpen((o) => !o)}
              aria-label={t('전적판')}
              aria-expanded={boardOpen}
            >
              📊
            </button>
            <RiftSettingsMenu
              paused={paused}
              finished={finished}
              onTogglePause={onTogglePause}
              soundOn={soundOn}
              onToggleSound={onToggleSound}
              scheme={scheme}
              onSchemeChange={changeScheme}
              hitFx={hitFx}
              onToggleHitFx={toggleHitFx}
              gfx={gfx}
              onCycleGfx={cycleGfx}
              btnScale={btnScale}
              onBtnScaleChange={changeBtnScale}
              onExit={onExit}
            />
          </div>
        </div>

        {/* 전적판 오버레이 — 📊 버튼/바깥 클릭으로 여닫는다 */}
        {boardOpen && !finished && (
          <div className="rift-board" onClick={() => setBoardOpen(false)}>
            <div className="rift-board__panel rift-result" onClick={(e) => e.stopPropagation()}>
              <RiftRoster hud={hud} />
            </div>
          </div>
        )}

        {/* 좌상단: 미니맵 */}
        <div className="rift__side">
          <RiftMiniMap view={hud} myId={myId} />
        </div>

        {/* 하단 중앙: 내 영웅 명패 — 캐릭터/직업/레벨/HP/경험치 */}
        {me && !finished && (
          <div className="rift__me rift__nameplate">
            <span className="rift__me-emoji">{getZodiac(me.zodiacId)?.emoji}</span>
            <span className="rift__me-cls">{CLASSES[me.cls]?.icon}{t(CLASSES[me.cls]?.name)}</span>
            <span className="rift__me-lvl">Lv.{me.lvl}</span>
            <div className="rift__me-bars">
              <div className="rift__bar rift__bar--hp">
                <div style={{ width: `${(me.hp / me.maxHp) * 100}%` }} />
                <span>{me.hp} / {me.maxHp}</span>
              </div>
              <div className="rift__bar rift__bar--xp">
                <div style={{ width: me.xpNeed ? `${(me.xp / me.xpNeed) * 100}%` : '100%' }} />
              </div>
            </div>
            <span className="rift__me-items">
              {Array.from({ length: ITEM_SLOTS }).map((_, i) => {
                const it = getItem((me.items || [])[i])
                // 액티브 아이템(물병/종)은 아이콘 자체가 사용 버튼 — 쿨다운 중엔 남은 초를 덮어 보여 준다
                if (it?.active) {
                  const cd = me.itemCds?.[i] || 0
                  return (
                    <button
                      key={i}
                      className={`rift__me-item rift__me-item--active ${cd > 0 ? 'rift__me-item--cd' : ''}`}
                      disabled={cd > 0 || me.respawnT > 0}
                      onClick={() => onUseItem(i)}
                      title={`${it.name} — ${it.active.label} (쿨다운 ${it.active.cd}초)`}
                    >
                      {it.icon}
                      {cd > 0 && <span className="rift__me-item-cd">{Math.ceil(cd)}</span>}
                    </button>
                  )
                }
                return (
                  <span key={i} className="rift__me-item">
                    {it ? it.icon : '·'}
                  </span>
                )
              })}
            </span>
            {me.dragonT > 0 && <span title="용 버프">🐉</span>}
            {me.baronT > 0 && <span title="이무기 버프">👹</span>}
          </div>
        )}

        {hud.status === 'countdown' && hud.countdown > 0 && (
          <div className="rift__count" key={hud.countdown}>{hud.countdown}</div>
        )}
        {hud.go && <div className="rift__count rift__count--go">전투 개시!</div>}
        {banner && (
          <div className="rift__banner" key={banner.key}>{tFeed(banner.text)}</div>
        )}
        {nexusUnderAttack && (
          <div className="rift__nexus-alert">
            ⚠️ {t('수호석이 공격받고 있어요!')}
          </div>
        )}
        {me && me.respawnT > 0 && !finished && (
          <>
            <div className="rift__dead" />
            <div className="rift__respawn">
              💀 {t('부활까지')} <b>{Math.ceil(me.respawnT)}</b>{t('초')}...
            </div>
            {/* 사망 중엔 양 팀 킬스코어·아이템·레벨 현황을 한눈에 (상대 빌드 파악용) */}
            <div className="rift__dead-board">
              <RiftRoster hud={hud} />
            </div>
          </>
        )}
        {me && hud.status === 'playing' && hud.go && (
          <div className="rift__hint">
            🕹️ 드래그로 이동 · ⚔️ 자동 조준 · 🌿 수풀에 숨기 · 🏠 우물에서 🛒 상점!
          </div>
        )}
      </div>

      {/* 일시정지 오버레이 — 방장이 멈추면 모두에게 표시 */}
      {paused && !finished && (
        <div className="rift__pause">
          <div className="rift__pause-card">
            <div className="rift__pause-emoji">⏸️</div>
            <h2>{t('일시정지')}</h2>
            <p>{onTogglePause ? t('게임이 멈췄어요. 다시 시작하려면 재개를 눌러요.') : t('방장이 게임을 잠시 멈췄어요...')}</p>
            {onTogglePause && (
              <button className="btn btn--primary" onClick={onTogglePause}>{t('▶️ 재개하기')}</button>
            )}
          </div>
        </div>
      )}

      {/* 우물 안 또는 사망 중에 뜨는 상점 버튼 */}
      {me && !finished && meCanShop && !shopOpen && (
        <button className="rift-shop-fab" onClick={() => setShopOpen(true)}>
          🛒 <small>{me.respawnT > 0 ? t('상점 (대기중)') : t('상점')}</small>
        </button>
      )}
      {shopOpen && me && meCanShop && (
        <RiftShop me={me} onBuy={onBuy} onSell={onSell} onResetShop={onResetShop} onClose={() => setShopOpen(false)} />
      )}

      {finished && showWin && (
        <div className="win-modal" style={{ '--z-color': hud.winner === 'red' ? '#ff6b6b' : '#4f8cff' }}>
          {(!myTeam || hud.winner === myTeam) && <Fireworks />}
          {/* 위쪽: 트로피 + 한 글자씩 나타나는 승리 메시지 */}
          <div className="win-banner">
            <div className="win-banner__trophy">{raidBoss && hud.winner === 'blue' ? '👑' : hud.winner ? '🏆' : '🤝'}</div>
            <h2 className="win-banner__title" aria-label={winText}>
              {winChars.map((c) =>
                c.space
                  ? <span key={c.key} className="win-banner__space" aria-hidden="true">&nbsp;</span>
                  : (
                    <span key={c.key} className="win-banner__char" style={{ animationDelay: `${c.delay}s` }}>
                      {c.ch}
                    </span>
                  )
              )}
            </h2>
            {bonus && <p className="win-banner__bonus">{bonus}</p>}
          </div>
          {/* 아래쪽: 스코어 표 박스 */}
          <div className="win-modal__card">
            <div className="rift-result">
              <RiftRoster hud={hud} crown={hud.winner} />
            </div>
            <div className="win-modal__btns">
              {adButton /* 📺 광고 보고 2배 보상 — 배너가 아닌 버튼 줄(항상 보이고 눌리는 위치) */}
              <button className="btn btn--primary" onClick={onExit}>{exitLabel}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
