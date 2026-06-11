import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import KartSetup from './KartSetup.jsx'
import Kart3D from './Kart3D.jsx'
import MiniMap from './MiniMap.jsx'
import TouchControls from './TouchControls.jsx'
import Fireworks from '../../shared/Fireworks.jsx'
import FullscreenButton from '../../shared/FullscreenButton.jsx'
import {
  createGame, setInput, fireItem, step, makeView, makeBot, STEP, LAPS, COUNTDOWN_TIME,
} from './engine.js'
import { ZODIAC, getZodiac } from '../../shared/zodiac.js'
import { sound } from '../../shared/sound.js'
import { useGameNet } from '../../net/useGameNet.js'
import { NetWaiting, GuestRestartNote } from '../../net/NetParts.jsx'

// 파티 카트 — 3D 레이싱. 온라인 방 전용(기기마다 조이스틱이 필요해서).
//  - 호스트 권위: 호스트가 60Hz로 물리를 돌리고 20Hz로 스냅샷을 publish.
//  - 게스트: 조향/브레이크를 15Hz action으로 보내고, 스냅샷을 보간해 그린다.
//  - 카트는 기기당 1대: 각 기기의 첫 번째 참가자가 달리고 나머지는 관전.
const PUBLISH_MS = 50 // 호스트 스냅샷 전파 주기
const INPUT_MS = 66 // 게스트 입력 전송 주기
const INTERP_DELAY = 120 // 게스트 렌더 지연(보간용, ms)
const RACE_SIZE = 4 // 레이스 정원 — 모자라면 CPU가 채운다

export default function KartGame({ roster, onExit, net }) {
  const { online, isHost, remote, publish, sendAction, ownerDevice } = useGameNet(net, handleAction)

  // 기기당 1대 — 각 기기의 첫 참가자만 주행
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
  const [hud, setHud] = useState(null) // 20Hz로 갱신되는 HUD용 뷰
  const [soundOn, setSoundOn] = useState(true)
  const stateRef = useRef(null) // 호스트 권위 게임 상태 (렌더 루프가 직접 읽음)
  const ctrlRef = useRef({ steer: 0, brake: false, drift: false })
  const lastTrackRef = useRef(null) // "한판 더!" 즉시 리매치용
  const bufRef = useRef([]) // 게스트: 스냅샷 보간 버퍼
  const lastSentRef = useRef('')

  // 게스트 입력(호스트에서만 호출). 자기 기기의 참가자만 인정.
  function handleAction(a, fromDevice) {
    const st = stateRef.current
    if (!st || ownerDevice(a.playerId) !== fromDevice) return
    if (a.type === 'input') setInput(st, a.playerId, a)
    else if (a.type === 'item') fireItem(st, a.playerId)
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
    let pub = PUBLISH_MS // 첫 프레임에 바로 전파
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

  // 새 레이스가 시작되면(다시하기 포함) 남아 있던 입력을 깨끗이 비운다
  const lastStatusRef = useRef(null)
  useEffect(() => {
    if (hud?.status === 'countdown' && lastStatusRef.current !== 'countdown') {
      ctrlRef.current = { steer: 0, brake: false, drift: false }
      lastSentRef.current = ''
    }
    lastStatusRef.current = hud?.status ?? null
  }, [hud])

  // 게스트: 조향/브레이크를 주기적으로 전송 (변했을 때만)
  useEffect(() => {
    if (!online || isHost || !myId) return
    const t = setInterval(() => {
      const c = ctrlRef.current
      const sig = `${c.steer.toFixed(2)}|${c.brake}|${c.drift}`
      if (sig === lastSentRef.current) return
      lastSentRef.current = sig
      sendAction({ type: 'input', playerId: myId, steer: c.steer, brake: c.brake, drift: c.drift })
    }, INPUT_MS)
    return () => clearInterval(t)
  }, [online, isHost, myId, sendAction])

  // 게스트가 레이스 도중 방을 나가거나 연결이 끊기면 그 카트는 봇이 이어받는다
  // (서버가 이탈한 기기의 참가자를 명단에서 빼므로 roster 변화로 감지)
  useEffect(() => {
    if (!online || !isHost || phase !== 'play') return
    const st = stateRef.current
    if (!st) return
    const ids = new Set(roster.map((p) => p.id))
    for (const k of st.karts) {
      if (!k.isBot && !ids.has(k.id)) makeBot(st, k.id)
    }
  }, [online, isHost, phase, roster])

  const sampleHost = useCallback(() => (stateRef.current ? makeView(stateRef.current) : null), [])
  const sampleGuest = useCallback(() => interpolate(bufRef.current), [])

  function startGame(trackId) {
    lastTrackRef.current = trackId
    sound.setEnabled(soundOn)
    sound.unlock()
    const humans = racers.map((p) => ({
      id: p.id,
      name: p.name,
      zodiacId: p.zodiacId,
      color: getZodiac(p.zodiacId)?.color,
    }))
    // 정원이 안 차면 안 쓰는 12지신 중에서 CPU를 뽑아 채운다
    const used = new Set(roster.map((p) => p.zodiacId))
    const free = ZODIAC.filter((z) => !used.has(z.id)).sort(() => Math.random() - 0.5)
    const bots = free.slice(0, Math.max(0, RACE_SIZE - humans.length)).map((z) => ({
      id: `bot-${z.id}`,
      name: `${z.name}봇`,
      zodiacId: z.id,
      color: z.color,
      isBot: true,
    }))
    stateRef.current = createGame([...humans, ...bots], Math.random, trackId)
    ctrlRef.current = { steer: 0, brake: false, drift: false }
    setHud(makeView(stateRef.current))
    setPhase('play')
  }

  function onItem() {
    if (!myId) return
    if (isHost) fireItem(stateRef.current, myId)
    else sendAction({ type: 'item', playerId: myId })
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
        <div className="net-screen__icon">🏎️</div>
        <p>파티 카트는 온라인 방 전용이에요. 각자 기기로 접속해 주세요!</p>
        <button className="btn btn--primary" onClick={onExit}>← 돌아가기</button>
      </div>
    )
  }

  // ── 게스트 ──
  if (!isHost) {
    if (!hud) {
      return <NetWaiting text="호스트가 레이스를 준비하고 있어요... 🏎️" onExit={onExit} />
    }
    return (
      <KartPlay
        hud={hud}
        sample={sampleGuest}
        myId={myId}
        ctrlRef={ctrlRef}
        onItem={onItem}
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
    return <KartSetup racers={racers} benched={benched} onStart={startGame} onExit={onExit} />
  }
  return (
    <KartPlay
      hud={hud}
      sample={sampleHost}
      myId={myId}
      ctrlRef={ctrlRef}
      onItem={onItem}
      onRematch={() => startGame(lastTrackRef.current)} // 같은 맵으로 즉시 한판 더!
      onRestart={() => setPhase('setup')} // 맵 바꾸기 = 맵 선택부터
      onExit={onExit}
      soundOn={soundOn}
      onToggleSound={toggleSound}
    />
  )
}

// 게스트 렌더용: 스냅샷 두 장 사이를 보간해 카트/오브젝트를 부드럽게
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
  // 장애물은 시간의 함수로 그려지므로 time도 보간해 부드럽게
  const time = lerp(a.v.time ?? 0, b.v.time ?? 0)
  const karts = b.v.karts.map((kb) => {
    const ka = a.v.karts.find((k) => k.id === kb.id)
    if (!ka) return kb
    return {
      ...kb,
      x: lerp(ka.x, kb.x),
      z: lerp(ka.z, kb.z),
      heading: lerp(ka.heading, kb.heading),
      spin: lerp(ka.spin || 0, kb.spin || 0),
      flyT: lerp(ka.flyT || 0, kb.flyT || 0), // 회오리 비행 포물선을 부드럽게
    }
  })
  const objects = (b.v.objects || []).map((ob) => {
    const oa = a.v.objects?.find((o) => o.id === ob.id)
    if (!oa) return ob
    return { ...ob, x: lerp(oa.x, ob.x), z: lerp(oa.z, ob.z) }
  })
  return { ...b.v, time, karts, objects }
}

// HUD 효과음: 스냅샷 변화를 보고 호스트/게스트 동일하게 재생
function useKartSounds(hud, myId) {
  const prev = useRef({})
  useEffect(() => {
    if (!hud) return
    const p = prev.current
    const me = hud.karts?.find((k) => k.id === myId)
    // 카운트다운: 도(3) 도(2) 도(1)... 출발은 한 옥타브 위 도!
    if (hud.status === 'countdown' && hud.countdown > 0 && hud.countdown !== p.countdown) sound.count()
    if (hud.status === 'racing' && p.status === 'countdown') sound.go()
    // 아이템 획득음은 TouchControls의 슬롯머신 연출이 담당
    if (me && me.stunT > 0 && !(p.stunT > 0)) sound.chuteDown()
    if (me?.boostT > 0 && !(p.boostT > 0)) sound.ladderUp()
    if (me?.rocketT > 0 && !(p.rocketT > 0)) sound.rocket()
    if (me?.flyT > 0 && !(p.flyT > 0)) sound.rocket() // 회오리에 붕~ 떠오를 때
    if (hud.lightning && !p.lightning) sound.thunder() // 번개는 모두에게 들린다
    // 소/펭귄/눈사람 등 장애물과 쿵! (스턴형 장애물은 위의 스턴음이 담당)
    if (me && p.bumpSeq != null && me.bumpSeq > p.bumpSeq && !(me.stunT > 0)) sound.bounce()
    if (hud.status === 'finished' && p.status && p.status !== 'finished') sound.win()
    prev.current = {
      countdown: hud.countdown,
      status: hud.status,
      stunT: me?.stunT,
      boostT: me?.boostT,
      rocketT: me?.rocketT,
      flyT: me?.flyT,
      bumpSeq: me?.bumpSeq,
      lightning: hud.lightning,
    }
  }, [hud, myId])
}

// 맵 명물 장애물에 부딪혔을 때의 한 마디
const BUMP_MSG = {
  cow: '🐄 음머~! 소를 들이받았어!',
  penguin: '🐧 펭귄이랑 꽈당!',
  snowman: '⛄ 눈사람 와장창!',
  cactus: '🌵 아야야! 따가워!',
  tornado: '🌪️ 회오리에 휘말려 붕~!',
}

// 레이스 드라마 배너: 랩 진입 / 장애물 사고 / 추월·역전 / 슬립스트림 / 번개를
// 화면 중앙에 잠깐씩 띄운다 (우선순위: 랩 > 번개 > 장애물 > 슬립스트림 > 순위 변동)
function useRaceBanner(hud, myId) {
  const [msg, setMsg] = useState(null)
  const prev = useRef(null)
  const keyRef = useRef(0)
  const timerRef = useRef(null)
  const lastRankMsgAt = useRef(-10)
  useEffect(() => () => clearTimeout(timerRef.current), [])
  useEffect(() => {
    if (!hud) return
    const me = hud.karts?.find((k) => k.id === myId)
    const cur = {
      status: hud.status,
      lightning: !!hud.lightning,
      lap: me?.lap ?? 1,
      rank: me?.rank ?? null,
      draftSeq: me?.draftSeq ?? 0,
      turboSeq: me?.turboSeq ?? 0,
      bumpSeq: me?.bumpSeq ?? 0,
      bumpKind: me?.bumpKind ?? null,
      botIds: hud.karts.filter((k) => k.isBot).map((k) => k.id).sort().join(','),
    }
    const p = prev.current
    prev.current = cur
    // 새 레이스 시작/대기 중에는 비교하지 않는다
    if (!p || p.status !== 'racing' || hud.status !== 'racing') return

    const show = (text) => {
      setMsg({ text, key: ++keyRef.current })
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setMsg(null), 2200)
    }
    if (me && !me.finished && cur.lap > p.lap) {
      sound.key()
      show(cur.lap >= LAPS ? '마지막 바퀴! 전력 질주!! 🔥' : `${cur.lap}바퀴째!`)
      return
    }
    if (cur.lightning && !p.lightning) {
      show('⚡ 꼴찌의 번개 반격!')
      return
    }
    // 도중에 연결이 끊긴 친구의 카트는 봇이 이어받는다 — 모두에게 알려준다
    if (cur.botIds !== p.botIds) {
      const before = new Set(p.botIds.split(','))
      const nb = hud.karts.find((k) => k.isBot && !before.has(k.id))
      if (nb) {
        show(`🤖 ${nb.name} 자리는 봇이 이어 달려요!`)
        return
      }
    }
    if (!me || me.finished) return
    if (cur.bumpSeq > p.bumpSeq && BUMP_MSG[cur.bumpKind]) {
      show(BUMP_MSG[cur.bumpKind])
      return
    }
    if (cur.turboSeq > p.turboSeq) {
      sound.key()
      show('🌀 드리프트 미니터보!')
      return
    }
    if (cur.draftSeq > p.draftSeq) {
      show('💨 슬립스트림 부스트!')
      return
    }
    // 순위 변동: 출발 직후의 자리싸움은 빼고, 너무 잦은 배너는 2초에 한 번만
    if (
      p.rank != null && cur.rank !== p.rank &&
      hud.time > COUNTDOWN_TIME + 3 && hud.time - lastRankMsgAt.current > 2
    ) {
      lastRankMsgAt.current = hud.time
      if (cur.rank < p.rank) {
        sound.key()
        show(`🔥 추월! 지금 ${cur.rank}등!`)
      } else {
        show('😱 추월당했어!')
      }
    }
  }, [hud, myId])
  return msg
}

// 주행 화면 (호스트/게스트 공용). 3D 캔버스 + HUD + 터치 컨트롤.
function KartPlay({
  hud, sample, myId, ctrlRef, onItem, onRematch, onRestart, onExit, soundOn, onToggleSound,
}) {
  useKartSounds(hud, myId)
  const lapMsg = useRaceBanner(hud, myId)
  if (!hud || hud.phase !== 'play') {
    return <NetWaiting text="레이스를 준비하고 있어요... 🏎️" onExit={onExit} />
  }

  const me = hud.karts.find((k) => k.id === myId)
  const finished = hud.status === 'finished'
  const order = [...hud.karts].sort((a, b) => a.rank - b.rank)
  const win = order[0]
  const medals = ['🥇', '🥈', '🥉', '4등', '5등']

  return (
    <div className="kart">
      <Kart3D sample={sample} myId={myId} trackId={hud.trackId} />

      {me && !finished && (
        <TouchControls
          onSteer={(v) => (ctrlRef.current.steer = v)}
          onBrake={(v) => (ctrlRef.current.brake = v)}
          onDrift={(v) => (ctrlRef.current.drift = v)}
          onItem={onItem}
          item={me.item}
          itemSeq={me.itemSeq}
          drifting={!!me.drift}
          driftLvl={me.driftLvl}
          disabled={hud.status !== 'racing' || me.finished}
        />
      )}

      <div className="kart__hud">
        <div className="ladder__topbar kart__topbar">
          <button className="btn btn--ghost" onClick={onExit}>
            ← 나가기
          </button>
          <div className="turn-indicator kart__status">
            {me ? '🏎️ 파티 카트' : '👀 관전 중'}
          </div>
          <div className="topbar__right">
            <button className="btn btn--ghost" onClick={onToggleSound} aria-label="소리">
              {soundOn ? '🔊' : '🔇'}
            </button>
            <FullscreenButton />
          </div>
        </div>

        {/* 우측 상단: 미니맵 + 현재 순위 */}
        <div className="kart__side">
          <MiniMap karts={hud.karts} myId={myId} trackId={hud.trackId} />
          <div className="kart-ranks">
            {order.map((k, i) => (
              <div
                key={k.id}
                className={`kart-ranks__row ${k.id === myId ? 'kart-ranks__row--me' : ''}`}
                style={{ '--z-color': k.color }}
              >
                <span className="kart-ranks__pos">{i + 1}</span>
                <span>{getZodiac(k.zodiacId)?.emoji}</span>
                <span className="kart-ranks__name">{k.name}</span>
                {k.isBot && <span className="kart-ranks__bot">🤖</span>}
                {k.finished && <span>🏁</span>}
              </div>
            ))}
          </div>
        </div>

        {/* 좌측 하단: 현재 랩 */}
        {me && (
          <div className="kart__lap">
            🏁 <b>{me.lap}</b> <span>/ {LAPS}</span>
          </div>
        )}

        {hud.status === 'countdown' && hud.countdown > 0 && (
          <div className="kart__count" key={hud.countdown}>
            {hud.countdown}
          </div>
        )}
        {hud.go && <div className="kart__count kart__count--go">출발!</div>}
        {lapMsg && (
          <div className="kart__lapmsg" key={lapMsg.key}>
            {lapMsg.text}
          </div>
        )}

        {me && !me.finished && hud.endTimer != null && !finished && (
          <div className="kart__endtimer">⏱ {hud.endTimer}초 안에 골인!</div>
        )}
        {me?.finished && !finished && (
          <div className="kart__endtimer">🏁 골인! 친구들을 기다려요...</div>
        )}
        {me && hud.status === 'racing' && hud.go && (
          <div className="kart__hint">🕹️ 드래그로 핸들 · 코너에서 🌀 누르고 있으면 미니터보!</div>
        )}
      </div>

      {finished && (
        <div className="win-modal">
          <Fireworks />
          <div className="win-modal__card" style={{ '--z-color': win?.color }}>
            <div className="win-modal__emoji">🏆</div>
            <h2>{win?.name} 우승! 🎉</h2>
            <p>
              {order
                .map((k, i) => `${medals[i] || `${i + 1}등`} ${getZodiac(k.zodiacId)?.emoji}${k.name}`)
                .join('  ·  ')}
            </p>
            <div className="win-modal__btns">
              {onRestart ? (
                <>
                  <button className="btn btn--primary" onClick={onRematch}>
                    🔁 한판 더!
                  </button>
                  <button className="btn btn--ghost" onClick={onRestart}>
                    🗺️ 맵 바꾸기
                  </button>
                  <button className="btn btn--ghost" onClick={onExit}>
                    로비로
                  </button>
                </>
              ) : (
                <>
                  <GuestRestartNote />
                  <button className="btn btn--ghost" onClick={onExit}>
                    방 나가기
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
