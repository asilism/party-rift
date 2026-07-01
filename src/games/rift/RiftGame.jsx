import { useEffect, useRef, useState } from 'react'
import Rift3D from './Rift3D.jsx'
import RiftMiniMap from './RiftMiniMap.jsx'
import RiftControls from './RiftControls.jsx'
import RiftShop from './RiftShop.jsx'
import Fireworks from '../../shared/Fireworks.jsx'
import FullscreenButton from '../../shared/FullscreenButton.jsx'
import { canShop, CLASSES, bountyGold } from './engine.js'
import { getZodiac } from '../../shared/zodiac.js'
import { getItem, ITEM_SLOTS } from './items.js'
import { sound } from '../../shared/sound.js'
import { loadRiftControl, saveRiftControl, loadRiftHitFx, saveRiftHitFx } from '../../shared/storage.js'
import { useRealtimeGame } from '../../net/useRealtimeGame.js'
import { riftNet } from './netgame.js'
import { NetWaiting } from '../../net/NetParts.jsx'

// 파티 리프트 — 3:3 AOS. 온라인 방 전용(기기마다 조이스틱이 필요해서).
//  - 서버 권위(④): 서버가 60Hz로 시뮬레이션을 돌리고 20Hz로 바이너리 델타 스냅샷을 방송.
//  - 클라(①③): 내 영웅은 입력 즉시 반영(예측)·권위 보정, 남의 유닛은 보간으로 부드럽게.
//      모든 동기화 배관은 useRealtimeGame이 담당.
//  - 영웅은 기기당 1명: 그 기기가 드래프트에서 고른 영웅을 조종한다.
//  - 매치(팀/직업)는 서버가 드래프트로 확정·시작하므로, 이 컴포넌트는 전장을 그리기만 한다.
export default function RiftGame({ onExit, net }) {
  const online = !!net?.online
  const ctrlRef = useRef({ mx: 0, mz: 0 })
  const { view, sample, myId, sendAction } = useRealtimeGame(net, riftNet, ctrlRef)
  const [soundOn, setSoundOn] = useState(true)

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
        <p>파티 리프트는 온라인 방 전용이에요. 각자 기기로 접속해 주세요!</p>
        <button className="btn btn--primary" onClick={onExit}>← 돌아가기</button>
      </div>
    )
  }

  // 아직 서버 스냅샷을 못 받았을 때(전장 생성 직후) — 곧 엔진 카운트다운이 이어진다
  if (!view || view.phase !== 'play') {
    return <NetWaiting text="이제 곧 경기가 시작합니다… ⚔️" onExit={onExit} />
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
      onTogglePause={null}
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
    // 우리 넥서스가 공격받기 시작하면 경고음
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
  { id: 'wasd', icon: '⌨️', label: 'WASD 키보드', desc: 'WASD·화살표 이동, H/J/K 스킬, L 평타' },
  { id: 'lol', icon: '🖱️', label: '롤 방식', desc: '추후 도입 예정', soon: true },
  { id: 'mobile', icon: '📱', label: '모바일', desc: '드래그 조이스틱 + 터치 버튼' },
  { id: 'xbox', icon: '🎮', label: 'Xbox 컨트롤러', desc: '스틱 이동, A 평타, X/Y/B 스킬' },
]

// 양 팀 현황판(팀 킬 스코어 + 영웅별 K/D/A·레벨·아이템). 두 팀 카드를 나란히 반환한다 —
// 감싸는 래퍼(.rift__dead-board / .rift-result / .rift-settings__board)는 호출부가 정한다.
// 사망 화면·설정 팝업·결과창에서 공용으로 쓴다.
function RiftRoster({ hud, crown = null }) {
  return ['blue', 'red'].map((team) => (
    <div key={team} className={`rift-result__team rift-result__team--${team}`}>
      <h4>
        {team === 'blue' ? '🔵 파랑팀' : '🔴 빨강팀'} {crown === team ? '👑' : ''}
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
                <span className="rift-result__bounty" title={`연속 ${h.killStreak}킬 — 잡으면 현상금 +${bounty}`}>
                  🔥{bounty}
                </span>
              )}
            </span>
            <span className="rift-result__lvl">Lv.{h.lvl}</span>
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
function RiftSettingsMenu({ hud, paused, finished, onTogglePause, soundOn, onToggleSound, scheme, onSchemeChange, hitFx, onToggleHitFx, onExit }) {
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
        aria-label="설정"
        aria-expanded={open}
      >
        ⚙️
      </button>
      {/* 메뉴를 열면 화면 전체를 어둡게 덮어 조작 버튼과 겹쳐 보이지 않게 한다(누르면 닫힘) */}
      {open && <div className="rift-settings__backdrop" onClick={() => setOpen(false)} />}
      {open && (
        <div className="rift-settings__menu" role="menu">
          {/* 현재 팀 상황 — 사망 화면과 같은 양 팀 현황판을 여기서도 본다 */}
          {hud && (
            <>
              <div className="rift-settings__label">📊 팀 현황</div>
              <div className="rift-settings__board">
                <RiftRoster hud={hud} />
              </div>
              <div className="rift-settings__sep" />
            </>
          )}
          {onTogglePause && !finished && (
            <button className="rift-settings__item" onClick={() => { onTogglePause(); setOpen(false) }}>
              <span>{paused ? '▶️' : '⏸️'}</span> {paused ? '재개' : '일시정지'}
            </button>
          )}
          <button className="rift-settings__item" onClick={onToggleSound}>
            <span>{soundOn ? '🔊' : '🔇'}</span> 소리 {soundOn ? '켜짐' : '꺼짐'}
          </button>
          <button className="rift-settings__item" onClick={onToggleHitFx}>
            <span>{hitFx ? '💥' : '🚫'}</span> 타격 효과 {hitFx ? '켜짐' : '꺼짐'}
          </button>
          <div className="rift-settings__item rift-settings__item--full">
            <FullscreenButton />
          </div>

          <div className="rift-settings__sep" />
          <div className="rift-settings__label">🎮 조작 방식</div>
          {CONTROL_SCHEMES.map((s) => (
            <button
              key={s.id}
              className={`rift-settings__scheme ${scheme === s.id ? 'rift-settings__scheme--on' : ''} ${s.soon ? 'rift-settings__scheme--soon' : ''}`}
              onClick={() => { if (!s.soon) onSchemeChange(s.id) }}
              disabled={s.soon}
            >
              <span className="rift-settings__scheme-icon">{s.icon}</span>
              <span className="rift-settings__scheme-text">
                <strong>{s.label}{s.soon ? ' (추후 도입)' : ''}</strong>
                <small>{s.desc}</small>
              </span>
              {scheme === s.id && <span className="rift-settings__scheme-check">✓</span>}
            </button>
          ))}

          <div className="rift-settings__sep" />
          <button className="rift-settings__item rift-settings__item--exit" onClick={() => { setOpen(false); onExit() }}>
            <span>🚪</span> 나가기
          </button>
        </div>
      )}
    </div>
  )
}

// 전투 화면 (호스트/게스트 공용). 3D 캔버스 + HUD + 터치 컨트롤.
function RiftPlay({
  hud, sample, myId, ctrlRef, onCast, onBuy, onSell, onResetShop, onTogglePause, onExit, soundOn, onToggleSound,
}) {
  useRiftSounds(hud, myId)
  const banner = useFeedBanner(hud)
  const [shopOpen, setShopOpen] = useState(false)
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
  // 배경음악(칩튠 루프): 경기 중에만 흐르고, 어느 한쪽 넥서스가 위태로우면 템포 업
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
  // 승리 팝업은 넥서스 폭발 연출(카메라 이동 + 펑)이 끝난 뒤 페이드인하도록 잠깐 늦춘다
  const finishedNow = hud?.status === 'finished'
  const [showWin, setShowWin] = useState(false)
  useEffect(() => {
    if (!finishedNow) { setShowWin(false); return undefined }
    const t = setTimeout(() => setShowWin(true), 1700)
    return () => clearTimeout(t)
  }, [finishedNow])
  // 상점은 우물 안에 있거나 사망(부활 대기) 중에 열 수 있다 — 그 밖이면 자동으로 닫힌다
  const me = hud?.heroes?.find((h) => h.id === myId)
  const meCanShop = !!(me && canShop(me))
  useEffect(() => {
    if (!meCanShop) setShopOpen(false)
  }, [meCanShop])
  if (!hud || hud.phase !== 'play') {
    return <NetWaiting text="전장을 준비하고 있어요... ⚔️" onExit={onExit} />
  }

  const finished = hud.status === 'finished'
  const myTeam = me?.team
  // 승리 메시지를 한 글자씩 나타나게 — "파랑팀 승리"를 글자 단위로 쪼갠다(공백은 자리만 차지)
  const winText = hud.winner === 'blue' ? '파랑팀 승리' : hud.winner === 'red' ? '빨강팀 승리' : '무승부'
  let winBeat = 0
  const winChars = [...winText].map((ch, i) => ({
    ch, key: i, space: ch === ' ', delay: ch === ' ' ? 0 : winBeat++ * 0.16,
  }))
  // 우리 넥서스가 공격받고 있으면 경고 (관전자는 양 팀 모두 표시)
  const nexusUnderAttack = !finished && !!(hud.nexus && (
    myTeam ? hud.nexus[myTeam]?.underAttack
      : (hud.nexus.blue?.underAttack || hud.nexus.red?.underAttack)
  ))

  return (
    <div className="rift" onContextMenu={(e) => e.preventDefault()}>
      <Rift3D sample={sample} myId={myId} mode={hud.mode || '3v3'} hitFx={hitFx} />

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
          me={me}
          disabled={me.respawnT > 0 || paused}
          scheme={scheme}
        />
      )}

      <div className="rift__hud">
        <div className="ladder__topbar rift__topbar">
          {/* 우상단(설정 옆): 개인 전적 — 킬/데스/어시 · 골드 · 남은 시간 */}
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
              <span className="rift__stats-time">⏱{fmtTime(hud.timeLeft)}</span>
            </div>
            <RiftSettingsMenu
              hud={hud}
              paused={paused}
              finished={finished}
              onTogglePause={onTogglePause}
              soundOn={soundOn}
              onToggleSound={onToggleSound}
              scheme={scheme}
              onSchemeChange={changeScheme}
              hitFx={hitFx}
              onToggleHitFx={toggleHitFx}
              onExit={onExit}
            />
          </div>
        </div>

        {/* 좌상단: 미니맵 */}
        <div className="rift__side">
          <RiftMiniMap view={hud} myId={myId} />
        </div>

        {/* 하단 중앙: 내 영웅 명패 — 캐릭터/직업/레벨/HP/경험치 */}
        {me && !finished && (
          <div className="rift__me rift__nameplate">
            <span className="rift__me-emoji">{getZodiac(me.zodiacId)?.emoji}</span>
            <span className="rift__me-cls">{CLASSES[me.cls]?.icon}{CLASSES[me.cls]?.name}</span>
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
                const it = (me.items || [])[i]
                return (
                  <span key={i} className="rift__me-item">
                    {it ? getItem(it)?.icon : '·'}
                  </span>
                )
              })}
            </span>
            {me.dragonT > 0 && <span title="용 버프">🐉</span>}
            {me.baronT > 0 && <span title="바론 버프">👹</span>}
          </div>
        )}

        {hud.status === 'countdown' && hud.countdown > 0 && (
          <div className="rift__count" key={hud.countdown}>{hud.countdown}</div>
        )}
        {hud.go && <div className="rift__count rift__count--go">전투 개시!</div>}
        {banner && (
          <div className="rift__banner" key={banner.key}>{banner.text}</div>
        )}
        {nexusUnderAttack && (
          <div className="rift__nexus-alert">
            ⚠️ {myTeam ? '우리' : ''} 넥서스가 공격받고 있어요!
          </div>
        )}
        {me && me.respawnT > 0 && !finished && (
          <>
            <div className="rift__dead" />
            <div className="rift__respawn">
              💀 부활까지 <b>{Math.ceil(me.respawnT)}</b>초...
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
            <h2>일시정지</h2>
            <p>{onTogglePause ? '게임이 멈췄어요. 다시 시작하려면 재개를 눌러요.' : '방장이 게임을 잠시 멈췄어요...'}</p>
            {onTogglePause && (
              <button className="btn btn--primary" onClick={onTogglePause}>▶️ 재개하기</button>
            )}
          </div>
        </div>
      )}

      {/* 우물 안 또는 사망 중에 뜨는 상점 버튼 */}
      {me && !finished && meCanShop && !shopOpen && (
        <button className="rift-shop-fab" onClick={() => setShopOpen(true)}>
          🛒 <small>{me.respawnT > 0 ? '상점 (대기중)' : '상점'}</small>
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
            <div className="win-banner__trophy">{hud.winner ? '🏆' : '🤝'}</div>
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
          </div>
          {/* 아래쪽: 스코어 표 박스 */}
          <div className="win-modal__card">
            <div className="rift-result">
              <RiftRoster hud={hud} crown={hud.winner} />
            </div>
            <div className="win-modal__btns">
              <button className="btn btn--primary" onClick={onExit}>🔁 새 매치 찾기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
