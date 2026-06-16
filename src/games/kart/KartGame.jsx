import { useEffect, useRef, useState } from 'react'
import KartSetup from './KartSetup.jsx'
import Kart3D from './Kart3D.jsx'
import MiniMap from './MiniMap.jsx'
import TouchControls from './TouchControls.jsx'
import Fireworks from '../../shared/Fireworks.jsx'
import FullscreenButton from '../../shared/FullscreenButton.jsx'
import { LAPS, COUNTDOWN_TIME } from './engine.js'
import { getZodiac } from '../../shared/zodiac.js'
import { racers } from '../../net/realtime/roster.js'
import { sound } from '../../shared/sound.js'
import { useRealtimeGame } from '../../net/useRealtimeGame.js'
import { kartNet } from './netgame.js'
import { NetWaiting, GuestRestartNote } from '../../net/NetParts.jsx'

// 파티 카트 — 3D 레이싱. 온라인 방 전용(기기마다 조이스틱이 필요해서).
//  - 서버 권위(④): 서버가 60Hz로 물리를 돌리고 20Hz로 바이너리 델타 스냅샷을 방송.
//  - 클라(①③): 내 카트는 입력을 즉시 반영(예측)하고 권위값으로 보정,
//      남의 카트는 보간으로 부드럽게. 모든 배관은 useRealtimeGame이 담당.
//  - 카트는 기기당 1대: 각 기기의 첫 번째 참가자가 달리고 나머지는 관전.
export default function KartGame({ roster, onExit, net }) {
  const online = !!net?.online
  const ctrlRef = useRef({ steer: 0, brake: false, drift: false })
  const { view, sample, myId, isHost, start, stop, sendAction } = useRealtimeGame(net, kartNet, ctrlRef)
  const [soundOn, setSoundOn] = useState(true)
  const lastTrackRef = useRef(null) // "한판 더!" 즉시 리매치용

  function startGame(trackId) {
    lastTrackRef.current = trackId
    sound.setEnabled(soundOn)
    sound.unlock()
    ctrlRef.current = { steer: 0, brake: false, drift: false }
    start({ trackId }) // 서버가 레이스를 생성·시작 → 모두에게 스냅샷 방송
  }

  function onItem() {
    sendAction({ type: 'item' }) // 소유권은 서버가 판정(내 카트에만 적용)
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

  // 아직 서버 스냅샷을 못 받았을 때
  if (!view) {
    return <NetWaiting text="레이스에 접속하고 있어요... 🏎️" onExit={onExit} />
  }

  // ── 셋업 단계 ──
  if (view.phase !== 'play') {
    if (isHost) {
      const racing = racers(roster)
      const benched = roster.filter((p) => !racing.includes(p))
      return <KartSetup racers={racing} benched={benched} onStart={startGame} onExit={onExit} />
    }
    return <NetWaiting text="호스트가 레이스를 준비하고 있어요... 🏎️" onExit={onExit} />
  }

  // ── 주행 단계 (호스트/게스트 공용) ──
  return (
    <KartPlay
      hud={view}
      sample={sample}
      myId={myId}
      ctrlRef={ctrlRef}
      onItem={onItem}
      onRematch={isHost ? () => startGame(lastTrackRef.current) : null} // 같은 맵으로 한판 더!
      onRestart={isHost ? () => stop() : null} // 맵 바꾸기 = 셋업으로 복귀
      onExit={onExit}
      soundOn={soundOn}
      onToggleSound={toggleSound}
    />
  )
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
    if (me && p.jumpSeq != null && me.jumpSeq > p.jumpSeq) sound.jump() // 점프대 발사!
    if (me && p.fallSeq != null && me.fallSeq > p.fallSeq) {
      if (me.fallKind === 'pool') sound.splash() // 용암/강물에 풍덩~
      else sound.thunder() // 기차/불기둥에 펑!
    }
    if (hud.trainNear && !p.trainNear) sound.train() // 빵빵~ 기차가 와요!
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
      jumpSeq: me?.jumpSeq,
      fallSeq: me?.fallSeq,
      bumpSeq: me?.bumpSeq,
      lightning: hud.lightning,
      trainNear: hud.trainNear,
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
  magma: '🔥 용암 불덩이! 앗 뜨거!',
  barrier: '🚧 공사중! 쿵!',
  tractor: '🚜 트랙터랑 꽈당!',
  steam: '💨 증기에 휘말려 붕~!',
  snowball: '👹 눈도깨비의 눈덩이 명중! 꽁!',
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
      jumpSeq: me?.jumpSeq ?? 0,
      fallSeq: me?.fallSeq ?? 0,
      bumpSeq: me?.bumpSeq ?? 0,
      bumpKind: me?.bumpKind ?? null,
      botIds: hud.karts.filter((k) => k.isBot).map((k) => k.id).sort().join(','),
    }
    const p = prev.current
    prev.current = cur
    if (!p) return
    const show = (text) => {
      setMsg({ text, key: ++keyRef.current })
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setMsg(null), 2200)
    }
    // 출발 직전 🌀을 누르고 있었다면 출발과 동시에 부스트!
    if (p.status === 'countdown' && hud.status === 'racing' && me?.startDash) {
      show('🚀 스타트 대시!')
      return
    }
    // 새 레이스 시작/대기 중에는 비교하지 않는다
    if (p.status !== 'racing' || hud.status !== 'racing') return
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
    if (cur.fallSeq > p.fallSeq) {
      show(
        me.fallKind === 'train'
          ? '🚂 칙칙폭폭... 펑! 기차에 치였어!'
          : me.fallKind === 'erupt'
            ? '🌋 불기둥에 맞아 하늘로 펑!'
            : '😱 풍덩~! 낭떠러지 앞에서 재출발!'
      )
      return
    }
    if (cur.jumpSeq > p.jumpSeq) {
      show('🛫 점프~!')
      return
    }
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

// 결과 시상대: 1·2·3등이 색깔 단상 위에서 폴짝폴짝 (가운데가 1등)
function KartPodium({ order }) {
  const cols = [
    { k: order[1], cls: 'p2', medal: '🥈' },
    { k: order[0], cls: 'p1', medal: '🥇' },
    { k: order[2], cls: 'p3', medal: '🥉' },
  ]
  return (
    <>
      <div className="kart-podium">
        {cols.map(({ k, cls, medal }) =>
          k ? (
            <div key={k.id} className={`kart-podium__col kart-podium__col--${cls}`}>
              <span className="kart-podium__char">{getZodiac(k.zodiacId)?.emoji}</span>
              <span className="kart-podium__name">
                {k.name}
                {k.isBot ? ' 🤖' : ''}
              </span>
              <div className="kart-podium__block" style={{ '--z-color': k.color }}>
                <span>{medal}</span>
              </div>
            </div>
          ) : (
            <div key={cls} className="kart-podium__col" />
          )
        )}
      </div>
      {order.length > 3 && (
        <p className="kart-podium__rest">
          {order
            .slice(3)
            .map((k, i) => `${i + 4}등 ${getZodiac(k.zodiacId)?.emoji}${k.name}`)
            .join(' · ')}
        </p>
      )}
    </>
  )
}

// 주행 화면 (호스트/게스트 공용). 3D 캔버스 + HUD + 터치 컨트롤.
function KartPlay({
  hud, sample, myId, ctrlRef, onItem, onRematch, onRestart, onExit, soundOn, onToggleSound,
}) {
  useKartSounds(hud, myId)
  const lapMsg = useRaceBanner(hud, myId)
  // BGM: 레이스 중에만 흐르고, 마지막 바퀴엔 템포가 빨라진다
  const status = hud?.status
  const finalLap = !!hud?.finalLap
  useEffect(() => {
    if (status === 'racing' && soundOn) sound.musicStart()
    else sound.musicStop()
    sound.musicSetFast(finalLap)
  }, [status, finalLap, soundOn])
  useEffect(() => () => sound.musicStop(), [])
  if (!hud || hud.phase !== 'play') {
    return <NetWaiting text="레이스를 준비하고 있어요... 🏎️" onExit={onExit} />
  }

  const me = hud.karts.find((k) => k.id === myId)
  const finished = hud.status === 'finished'
  const order = [...hud.karts].sort((a, b) => a.rank - b.rank)
  const win = order[0]

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
          disabled={me.finished} // 카운트다운 중에도 눌러둘 수 있다 (스타트 대시)
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
        {me && hud.status === 'countdown' && (
          <div className="kart__hint">🌀 버튼을 꾹 누른 채 출발하면 스타트 대시!</div>
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
            <KartPodium order={order} />
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
