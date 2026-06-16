import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import RiftSetup from './RiftSetup.jsx'
import Rift3D from './Rift3D.jsx'
import RiftMiniMap from './RiftMiniMap.jsx'
import RiftControls from './RiftControls.jsx'
import RiftShop from './RiftShop.jsx'
import Fireworks from '../../shared/Fireworks.jsx'
import FullscreenButton from '../../shared/FullscreenButton.jsx'
import {
  createGame, setInput, castAttack, castSkill, castUlt, castRecall, buyItem, sellItem, canShop,
  step, makeView, makeBot,
  STEP, TEAM_SIZE, TEAM_SIZES, ULT_LEVEL, CLASSES, CLASS_IDS,
} from './engine.js'
import { ZODIAC, getZodiac } from '../../shared/zodiac.js'
import { getItem } from './items.js'
import { sound } from '../../shared/sound.js'
import { useGameNet } from '../../net/useGameNet.js'
import { NetWaiting, GuestRestartNote } from '../../net/NetParts.jsx'

// 파티 리프트 — 3:3 AOS. 온라인 방 전용(기기마다 조이스틱이 필요해서).
//  - 호스트 권위: 호스트가 60Hz로 시뮬레이션을 돌리고 20Hz로 스냅샷을 publish.
//  - 게스트: 이동을 15Hz action으로, 버튼은 누를 때마다 보낸다. 스냅샷은 보간해 그린다.
//  - 영웅은 기기당 1명: 각 기기의 첫 번째 참가자가 싸우고 나머지는 관전.
const PUBLISH_MS = 50
const INPUT_MS = 66
const INTERP_DELAY = 120

export default function RiftGame({ roster, onExit, net }) {
  const { online, isHost, remote, publish, sendAction, ownerDevice } = useGameNet(net, handleAction)

  // 기기당 1명 — 각 기기의 첫 참가자만 전투
  const racers = useMemo(() => {
    const seen = new Set()
    return roster.filter((p) => {
      const dev = p.deviceId ?? p.id
      if (seen.has(dev)) return false
      seen.add(dev)
      return true
    })
  }, [roster])
  const myId = (online && racers.find((p) => p.deviceId === net.deviceId)?.id) || null

  const [phase, setPhase] = useState('setup') // 'setup' | 'play'
  const [hud, setHud] = useState(null)
  const [soundOn, setSoundOn] = useState(true)
  const stateRef = useRef(null)
  const ctrlRef = useRef({ mx: 0, mz: 0 })
  const lastTeamsRef = useRef(null) // "한판 더!" 즉시 리매치용
  const bufRef = useRef([]) // 게스트: 스냅샷 보간 버퍼
  const lastSentRef = useRef('')

  // 게스트 입력(호스트에서만 호출). 자기 기기의 참가자만 인정.
  function handleAction(a, fromDevice) {
    const st = stateRef.current
    if (!st || ownerDevice(a.playerId) !== fromDevice) return
    if (a.type === 'input') setInput(st, a.playerId, a)
    else if (a.type === 'cast') {
      if (a.slot === 'atk') castAttack(st, a.playerId)
      else if (a.slot === 'skill') castSkill(st, a.playerId)
      else if (a.slot === 'ult') castUlt(st, a.playerId)
      else if (a.slot === 'recall') castRecall(st, a.playerId)
    } else if (a.type === 'buy') buyItem(st, a.playerId, a.itemId)
    else if (a.type === 'sell') sellItem(st, a.playerId, a.slot)
  }

  // 호스트: 셋업 중에도 게스트가 대기 화면을 보도록 phase 전파
  useEffect(() => {
    if (!online || !isHost) return
    if (phase !== 'play') publish({ phase: 'setup' })
  }, [online, isHost, phase, publish])

  // 호스트: 60Hz 시뮬레이션 + 20Hz publish/HUD
  useEffect(() => {
    if (!isHost || phase !== 'play') return
    let raf
    let last = performance.now()
    let acc = 0
    let pub = PUBLISH_MS
    const loop = (now) => {
      raf = requestAnimationFrame(loop)
      const ms = Math.min(100, now - last)
      last = now
      acc += ms
      pub += ms
      const st = stateRef.current
      if (!st) return
      if (myId) setInput(st, myId, ctrlRef.current)
      while (acc >= STEP * 1000) {
        step(st, STEP)
        acc -= STEP * 1000
      }
      if (pub >= PUBLISH_MS) {
        pub = 0
        const v = makeView(st)
        if (online) publish(v)
        setHud(v)
      }
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [isHost, phase, online, publish, myId])

  // 게스트: 스냅샷 버퍼 적재 + HUD 갱신
  useEffect(() => {
    if (isHost || !remote) return
    if (remote.phase !== 'play') {
      bufRef.current = []
      setHud(null)
      return
    }
    bufRef.current.push({ at: performance.now(), v: remote })
    if (bufRef.current.length > 12) bufRef.current.shift()
    setHud(remote)
  }, [isHost, remote])

  // 새 판이 시작되면 남아 있던 입력을 깨끗이 비운다
  const lastStatusRef = useRef(null)
  useEffect(() => {
    if (hud?.status === 'countdown' && lastStatusRef.current !== 'countdown') {
      ctrlRef.current = { mx: 0, mz: 0 }
      lastSentRef.current = ''
    }
    lastStatusRef.current = hud?.status ?? null
  }, [hud])

  // 게스트: 이동 입력을 주기적으로 전송 (변했을 때만)
  useEffect(() => {
    if (!online || isHost || !myId) return
    const t = setInterval(() => {
      const c = ctrlRef.current
      const sig = `${c.mx.toFixed(2)}|${c.mz.toFixed(2)}`
      if (sig === lastSentRef.current) return
      lastSentRef.current = sig
      sendAction({ type: 'input', playerId: myId, mx: c.mx, mz: c.mz })
    }, INPUT_MS)
    return () => clearInterval(t)
  }, [online, isHost, myId, sendAction])

  // 게스트가 전투 도중 방을 나가면 그 영웅은 봇이 이어받는다
  useEffect(() => {
    if (!online || !isHost || phase !== 'play') return
    const st = stateRef.current
    if (!st) return
    const ids = new Set(roster.map((p) => p.id))
    for (const h of st.heroes) {
      if (!h.isBot && !ids.has(h.id)) makeBot(st, h.id)
    }
  }, [online, isHost, phase, roster])

  const sampleHost = useCallback(() => (stateRef.current ? makeView(stateRef.current) : null), [])
  const sampleGuest = useCallback(() => interpolate(bufRef.current), [])

  function startGame(teams, classes, mode = '3v3') {
    lastTeamsRef.current = [teams, classes, mode]
    sound.setEnabled(soundOn)
    sound.unlock()
    const teamSize = TEAM_SIZES[mode] || TEAM_SIZE
    const humans = racers.map((p) => ({
      id: p.id,
      name: p.name,
      zodiacId: p.zodiacId,
      color: getZodiac(p.zodiacId)?.color,
      team: teams[p.id] || 'blue',
      cls: classes?.[p.id],
    }))
    // 빈자리는 안 쓰는 12지신 봇 + 남은 직업으로 팀 인원(3 또는 5)까지 채운다
    const used = new Set(roster.map((p) => p.zodiacId))
    const free = ZODIAC.filter((z) => !used.has(z.id))
    const bots = []
    for (const team of ['blue', 'red']) {
      const mine = humans.filter((h) => h.team === team)
      const takenCls = new Set(mine.map((h) => h.cls))
      for (let i = mine.length; i < teamSize; i++) {
        const z = free.shift()
        if (!z) break
        const cls = CLASS_IDS.find((c) => !takenCls.has(c))
        takenCls.add(cls)
        bots.push({
          id: `bot-${z.id}`, name: `${z.name}봇`, zodiacId: z.id, color: z.color,
          team, cls, isBot: true,
        })
      }
    }
    stateRef.current = createGame([...humans, ...bots], { mode, rng: Math.random })
    ctrlRef.current = { mx: 0, mz: 0 }
    setHud(makeView(stateRef.current))
    setPhase('play')
  }

  function cast(slot) {
    if (!myId) return
    const st = stateRef.current
    if (isHost && st) {
      if (slot === 'atk') castAttack(st, myId)
      else if (slot === 'skill') castSkill(st, myId)
      else if (slot === 'ult') castUlt(st, myId)
      else if (slot === 'recall') castRecall(st, myId)
    } else {
      sendAction({ type: 'cast', playerId: myId, slot })
    }
  }

  function buy(itemId) {
    if (!myId) return
    const st = stateRef.current
    if (isHost && st) buyItem(st, myId, itemId)
    else sendAction({ type: 'buy', playerId: myId, itemId })
  }

  function sell(slot) {
    if (!myId) return
    const st = stateRef.current
    if (isHost && st) sellItem(st, myId, slot)
    else sendAction({ type: 'sell', playerId: myId, slot })
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

  // ── 게스트 ──
  if (!isHost) {
    if (!hud) {
      return <NetWaiting text="호스트가 전장을 준비하고 있어요... ⚔️" onExit={onExit} />
    }
    return (
      <RiftPlay
        hud={hud}
        sample={sampleGuest}
        myId={myId}
        ctrlRef={ctrlRef}
        onCast={cast}
        onBuy={buy}
        onSell={sell}
        onRematch={null}
        onRestart={null}
        onExit={onExit}
        soundOn={soundOn}
        onToggleSound={toggleSound}
      />
    )
  }

  // ── 호스트 ──
  if (phase === 'setup') {
    const benched = roster.filter((p) => !racers.includes(p))
    return <RiftSetup racers={racers} benched={benched} onStart={startGame} onExit={onExit} />
  }
  return (
    <RiftPlay
      hud={hud}
      sample={sampleHost}
      myId={myId}
      ctrlRef={ctrlRef}
      onCast={cast}
      onBuy={buy}
      onSell={sell}
      onRematch={() => startGame(...lastTeamsRef.current)} // 같은 팀/직업으로 즉시 한판 더!
      onRestart={() => setPhase('setup')} // 팀 다시 나누기
      onExit={onExit}
      soundOn={soundOn}
      onToggleSound={toggleSound}
    />
  )
}

// 게스트 렌더용: 스냅샷 두 장 사이를 보간해 움직임을 부드럽게
function interpolate(buf) {
  if (!buf.length) return null
  const t = performance.now() - INTERP_DELAY
  let a = null
  let b = buf[buf.length - 1]
  for (let i = buf.length - 1; i >= 0; i--) {
    if (buf[i].at <= t) {
      a = buf[i]
      b = buf[i + 1] || buf[i]
      break
    }
  }
  if (!a || a === b || b.at <= a.at) return b.v
  const f = Math.min(1, (t - a.at) / (b.at - a.at))
  const lerp = (x, y) => x + (y - x) * f
  const lerpAng = (x, y) => {
    let d = y - x
    while (d > Math.PI) d -= 2 * Math.PI
    while (d < -Math.PI) d += 2 * Math.PI
    return x + d * f
  }
  const lerpList = (la, lb, extra) =>
    lb.map((eb) => {
      const ea = la?.find((o) => o.id === eb.id)
      if (!ea) return eb
      return { ...eb, x: lerp(ea.x, eb.x), z: lerp(ea.z, eb.z), ...(extra ? extra(ea, eb) : null) }
    })
  return {
    ...b.v,
    time: lerp(a.v.time ?? 0, b.v.time ?? 0),
    heroes: lerpList(a.v.heroes, b.v.heroes, (ea, eb) => ({ dir: lerpAng(ea.dir, eb.dir) })),
    minions: lerpList(a.v.minions, b.v.minions, (ea, eb) => ({ dir: lerpAng(ea.dir || 0, eb.dir || 0) })),
    monsters: lerpList(a.v.monsters, b.v.monsters),
    projectiles: lerpList(a.v.projectiles, b.v.projectiles),
  }
}

// HUD 효과음: 스냅샷 변화를 보고 호스트/게스트 동일하게 재생
function useRiftSounds(hud, myId) {
  const prev = useRef({})
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
    // 궁극기급 광역 이펙트가 터지면 우르릉!
    const BIG_FX = new Set(['whirl', 'storm', 'rain', 'fissure', 'boom', 'execute'])
    const bigFx = (hud.fx || []).filter((n) => BIG_FX.has(n.kind)).length
    if (bigFx > 0 && (p.bigFx || 0) === 0) sound.thunder()
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
      bigFx,
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

// 전투 화면 (호스트/게스트 공용). 3D 캔버스 + HUD + 터치 컨트롤.
function RiftPlay({
  hud, sample, myId, ctrlRef, onCast, onBuy, onSell, onRematch, onRestart, onExit, soundOn, onToggleSound,
}) {
  useRiftSounds(hud, myId)
  const banner = useFeedBanner(hud)
  const [shopOpen, setShopOpen] = useState(false)
  // 배경음악(칩튠 루프): 경기 중에만 흐르고, 어느 한쪽 넥서스가 위태로우면 템포 업
  const bgmStatus = hud?.status
  const nexusCrisis = !!(
    hud?.nexus &&
    (hud.nexus.blue.hp < hud.nexus.blue.maxHp * 0.35 ||
      hud.nexus.red.hp < hud.nexus.red.maxHp * 0.35)
  )
  useEffect(() => {
    if (bgmStatus === 'playing' && soundOn) sound.musicStart()
    else sound.musicStop()
    sound.musicSetFast(nexusCrisis)
  }, [bgmStatus, nexusCrisis, soundOn])
  useEffect(() => () => sound.musicStop(), [])
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
  const winnerLabel = hud.winner === 'blue' ? '🔵 파랑팀' : hud.winner === 'red' ? '🔴 빨강팀' : null
  // 우리 넥서스가 공격받고 있으면 경고 (관전자는 양 팀 모두 표시)
  const nexusUnderAttack = !finished && !!(hud.nexus && (
    myTeam ? hud.nexus[myTeam]?.underAttack
      : (hud.nexus.blue?.underAttack || hud.nexus.red?.underAttack)
  ))

  return (
    <div className="rift">
      <Rift3D sample={sample} myId={myId} mode={hud.mode || '3v3'} />

      {me && !finished && (
        <RiftControls
          onMove={(mx, mz) => {
            ctrlRef.current.mx = mx
            ctrlRef.current.mz = mz
          }}
          onAttack={() => onCast('atk')}
          onSkill={() => onCast('skill')}
          onUlt={() => onCast('ult')}
          onRecall={() => onCast('recall')}
          me={me}
          disabled={me.respawnT > 0}
        />
      )}

      <div className="rift__hud">
        <div className="ladder__topbar rift__topbar">
          <button className="btn btn--ghost" onClick={onExit}>← 나가기</button>
          <div className="rift__score">
            <span className="rift__score-side rift__score-side--blue">🔵 {hud.kills.blue}</span>
            <span className="rift__score-time">⏱ {fmtTime(hud.timeLeft)}</span>
            <span className="rift__score-side rift__score-side--red">{hud.kills.red} 🔴</span>
          </div>
          <div className="topbar__right">
            <button className="btn btn--ghost" onClick={onToggleSound} aria-label="소리">
              {soundOn ? '🔊' : '🔇'}
            </button>
            <FullscreenButton />
          </div>
        </div>

        {/* 우측 상단: 미니맵 */}
        <div className="rift__side">
          <RiftMiniMap view={hud} myId={myId} />
        </div>

        {/* 좌측 하단: 내 영웅 상태 */}
        {me && (
          <div className="rift__me">
            <div className="rift__me-top">
              <span className="rift__me-emoji">{getZodiac(me.zodiacId)?.emoji}</span>
              <span className="rift__me-cls">{CLASSES[me.cls]?.icon}{CLASSES[me.cls]?.name}</span>
              <span className="rift__me-lvl">Lv.{me.lvl}</span>
              <span className="rift__me-gold">💰 {me.gold}</span>
              {me.dragonT > 0 && <span title="용 버프">🐉</span>}
              {me.baronT > 0 && <span title="바론 버프">👹</span>}
            </div>
            <div className="rift__bar rift__bar--hp">
              <div style={{ width: `${(me.hp / me.maxHp) * 100}%` }} />
              <span>{me.hp} / {me.maxHp}</span>
            </div>
            <div className="rift__bar rift__bar--xp">
              <div style={{ width: me.xpNeed ? `${(me.xp / me.xpNeed) * 100}%` : '100%' }} />
            </div>
            <div className="rift__me-foot">
              <span className="rift__me-kd">⚔️{me.kills} 💀{me.deaths}</span>
              <span className="rift__me-items">
                {Array.from({ length: 3 }).map((_, i) => {
                  const it = (me.items || [])[i]
                  return (
                    <span key={i} className="rift__me-item">
                      {it ? getItem(it)?.icon : '·'}
                    </span>
                  )
                })}
              </span>
            </div>
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
            {/* 사망 중엔 양 팀 아이템/레벨 현황을 한눈에 (상대 빌드 파악용) */}
            <div className="rift__dead-board">
              {['blue', 'red'].map((team) => (
                <div key={team} className={`rift-result__team rift-result__team--${team}`}>
                  <h4>{team === 'blue' ? '🔵 파랑팀' : '🔴 빨강팀'}</h4>
                  {hud.heroes.filter((h) => h.team === team).map((h) => (
                    <div key={h.id} className="rift-result__row">
                      <span>{getZodiac(h.zodiacId)?.emoji}</span>
                      <span title={CLASSES[h.cls]?.name}>{CLASSES[h.cls]?.icon}</span>
                      <span className="rift-result__name">{h.name}{h.isBot ? ' 🤖' : ''}</span>
                      <span>Lv.{h.lvl}</span>
                      <span className="rift-result__items">
                        {(h.items || []).map((it) => getItem(it)?.icon).join('') || '—'}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </>
        )}
        {me && hud.status === 'playing' && hud.go && (
          <div className="rift__hint">
            🕹️ 드래그로 이동 · ⚔️ 자동 조준 · 🌿 수풀에 숨기 · 🏠 우물에서 🛒 상점!
          </div>
        )}
      </div>

      {/* 우물 안 또는 사망 중에 뜨는 상점 버튼 */}
      {me && !finished && meCanShop && !shopOpen && (
        <button className="rift-shop-fab" onClick={() => setShopOpen(true)}>
          🛒 <small>{me.respawnT > 0 ? '상점 (대기중)' : '넥서스 상점'}</small>
        </button>
      )}
      {shopOpen && me && meCanShop && (
        <RiftShop me={me} onBuy={onBuy} onSell={onSell} onClose={() => setShopOpen(false)} />
      )}

      {finished && (
        <div className="win-modal">
          {(!myTeam || hud.winner === myTeam) && <Fireworks />}
          <div className="win-modal__card" style={{ '--z-color': hud.winner === 'red' ? '#ff6b6b' : '#4f8cff' }}>
            <div className="win-modal__emoji">{hud.winner ? '🏆' : '🤝'}</div>
            <h2>{winnerLabel ? `${winnerLabel} 승리! 🎉` : '무승부!'}</h2>
            <div className="rift-result">
              {['blue', 'red'].map((team) => (
                <div key={team} className={`rift-result__team rift-result__team--${team}`}>
                  <h4>{team === 'blue' ? '🔵 파랑팀' : '🔴 빨강팀'} {hud.winner === team ? '👑' : ''}</h4>
                  {hud.heroes.filter((h) => h.team === team).map((h) => (
                    <div key={h.id} className="rift-result__row">
                      <span>{getZodiac(h.zodiacId)?.emoji}</span>
                      <span title={CLASSES[h.cls]?.name}>{CLASSES[h.cls]?.icon}</span>
                      <span className="rift-result__name">{h.name}{h.isBot ? ' 🤖' : ''}</span>
                      <span>Lv.{h.lvl}</span>
                      <span>⚔️{h.kills}</span>
                      <span>💀{h.deaths}</span>
                      <span className="rift-result__items">
                        {(h.items || []).map((it) => getItem(it)?.icon).join('')}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div className="win-modal__btns">
              {onRestart ? (
                <>
                  <button className="btn btn--primary" onClick={onRematch}>🔁 한판 더!</button>
                  <button className="btn btn--ghost" onClick={onRestart}>👥 팀 바꾸기</button>
                  <button className="btn btn--ghost" onClick={onExit}>로비로</button>
                </>
              ) : (
                <>
                  <GuestRestartNote />
                  <button className="btn btn--ghost" onClick={onExit}>방 나가기</button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
