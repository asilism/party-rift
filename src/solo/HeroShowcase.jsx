import { useEffect, useRef, useState } from 'react'
import Rift3D from '../games/rift/Rift3D.jsx'
import { riftNet } from '../games/rift/netgame.js'
import { createLocalNet } from '../net/localNet.js'
import { useRealtimeGame } from '../net/useRealtimeGame.js'
import { CLASSES, COUNTDOWN_TIME, MAX_LEVEL } from '../games/rift/engine.js'
import { getZodiac } from '../shared/zodiac.js'

// 캐릭터 쇼케이스 — 진짜 엔진을 훈련장 모드(sandbox: 웨이브·정글몹·타워 정지)로 돌려
// 선택한 직업의 전신 모델이 허공에 평타 스윙과 스킬 3종을 차례로 시전한다.
// 모션·이펙트가 전부 실제 게임 그대로라 별도 애니메이션 코드가 없다.

const CAM_ZOOM = 0.34 // 전신이 큼직하게 보이는 근접 카메라

// 시연 순서(초) — 평타 두 번 → 스킬 → 보조 → 궁극 → 한숨 돌리고 반복
const SEQ = [
  { slot: 'atk', dur: 1.1 },
  { slot: 'atk', dur: 1.1 },
  { slot: 'skill', dur: 2.4 },
  { slot: 'skill2', dur: 2.6 },
  { slot: 'ult', dur: 3.4 },
  { slot: 'rest', dur: 1.4 },
]

export default function HeroShowcase({ cls, zodiacId }) {
  // 직업이 바뀌면 훈련장을 통째로 새로 연다
  return <ShowcaseMatch key={cls} cls={cls} zodiacId={zodiacId} />
}

function ShowcaseMatch({ cls, zodiacId }) {
  const [net, setNet] = useState(null)
  const [caption, setCaption] = useState(null)

  useEffect(() => {
    const z = getZodiac(zodiacId)
    const n = createLocalNet(riftNet, {
      players: [],
      config: {
        mode: '3v3',
        sandbox: true,
        roster: [{ id: 'demo', name: z?.name || '데모', zodiacId, color: z?.color, team: 'blue', cls, deviceId: 'demo' }],
      },
      deviceId: 'demo',
    })
    // 훈련장 준비: 카운트다운 생략 + 전 스킬(궁극 포함) 해금 레벨
    const st = n._sim.state
    st.time = COUNTDOWN_TIME
    st.status = 'playing'
    const me = st.heroes[0]
    me.lvl = MAX_LEVEL
    setNet(n)

    const c = CLASSES[cls]
    let i = 0
    let timer
    const next = () => {
      const step = SEQ[i % SEQ.length]
      i++
      if (step.slot === 'rest') {
        // 한 바퀴 정리: 소환물·돌벽·장판·잔여 투사체를 치우고 쿨다운을 되감는다
        st.summons = []
        st.tempWalls = []
        st.projectiles = []
        st.zones = []
        st.hawks = []
        me.skillCd = 0
        me.skill2Cd = 0
        me.ultCd = 0
        me.castT = 0
        setCaption(null)
      } else if (step.slot === 'atk') {
        // 허공 평타: 표적이 없으면 엔진이 무시하므로 스윙 모션(atkSeq)만 직접 재생
        me.atkSeq++
        setCaption('⚔️ 평타')
      } else {
        me.skillCd = 0
        me.skill2Cd = 0
        me.ultCd = 0
        me.castT = 0
        n.rtAction({ type: 'cast', slot: step.slot })
        const s = step.slot === 'skill' ? c.skill : step.slot === 'skill2' ? c.skill2 : c.ult
        setCaption(`${s.icon} ${s.name}`)
      }
      timer = setTimeout(next, step.dur * 1000)
    }
    timer = setTimeout(next, 700)

    return () => {
      clearTimeout(timer)
      n.close()
    }
  }, [cls, zodiacId])

  return (
    <div className="hero-showcase">
      {net && <ShowcaseView net={net} />}
      {caption && (
        <span className="hero-showcase__caption" key={caption}>{caption}</span>
      )}
    </div>
  )
}

function ShowcaseView({ net }) {
  const ctrlRef = useRef({ mx: 0, mz: 0 })
  const { view, sample } = useRealtimeGame(net, riftNet, ctrlRef)
  if (!view || view.phase !== 'play') return null
  return <Rift3D sample={sample} myId="demo" mode="3v3" hitFx={false} gfx="med" camZoom={CAM_ZOOM} />
}
