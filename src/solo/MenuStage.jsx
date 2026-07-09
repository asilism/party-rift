import { useEffect, useRef, useState } from 'react'
import Rift3D from '../games/rift/Rift3D.jsx'
import { riftNet } from '../games/rift/netgame.js'
import { createLocalNet } from '../net/localNet.js'
import { useRealtimeGame } from '../net/useRealtimeGame.js'
import { CLASS_IDS } from '../games/rift/engine.js'
import { ZODIAC } from '../shared/zodiac.js'
import { buildSoloRoster } from './roster.js'

// 타이틀/메뉴 배경 — 봇 6명이 "실제로" 싸우는 라이브 전장(어트랙트 모드).
// 관전 카메라가 8초마다 다른 영웅을 따라다니고, 판이 끝나면 새 판을 다시 편성한다.
// 전투에 들어가면 언마운트되어 시뮬/렌더 자원을 돌려준다.

const FOLLOW_MS = 8000
const REMATCH_MS = 6000 // 넥서스 폭발 연출을 잠깐 보여준 뒤 새 판

function dioramaRoster() {
  const z = ZODIAC[Math.floor(Math.random() * ZODIAC.length)]
  const cls = CLASS_IDS[Math.floor(Math.random() * CLASS_IDS.length)]
  // buildSoloRoster의 "나" 자리도 봇으로 — 전원 AI 관전 경기
  return buildSoloRoster({ zodiacId: z.id, cls, mode: '3v3' }).map((p) => ({
    ...p, isBot: true, deviceId: undefined,
  }))
}

export default function MenuStage() {
  const [epoch, setEpoch] = useState(0) // 판이 끝나면 +1 → 통째로 새 경기
  return <StageMatch key={epoch} onRematch={() => setEpoch((e) => e + 1)} />
}

function StageMatch({ onRematch }) {
  const [net, setNet] = useState(null)
  useEffect(() => {
    const n = createLocalNet(riftNet, {
      players: [],
      config: { mode: '3v3', roster: dioramaRoster(), botLevel: 'normal' },
      deviceId: 'observer', // 로스터에 없는 기기 → 순수 관전
    })
    setNet(n)
    return () => n.close()
  }, [])
  return net ? <StageView net={net} onRematch={onRematch} /> : <div className="menustage" aria-hidden="true" />
}

function StageView({ net, onRematch }) {
  const ctrlRef = useRef({ mx: 0, mz: 0 })
  const { view, sample } = useRealtimeGame(net, riftNet, ctrlRef)

  // 관전 카메라: 주기적으로 다른 영웅에게 시선을 옮긴다
  const [followI, setFollowI] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setFollowI((i) => i + 1), FOLLOW_MS)
    return () => clearInterval(t)
  }, [])

  // 경기 종료 → 폭발 연출 잠깐 보여주고 새 판
  const finished = view?.status === 'finished'
  useEffect(() => {
    if (!finished) return undefined
    const t = setTimeout(onRematch, REMATCH_MS)
    return () => clearTimeout(t)
  }, [finished, onRematch])

  const heroes = view?.heroes || []
  const followId = !finished && heroes.length ? heroes[followI % heroes.length].id : null

  return (
    <div className="menustage" aria-hidden="true">
      {view?.phase === 'play' && (
        <Rift3D sample={sample} myId={followId} mode="3v3" hitFx={false} gfx="med" />
      )}
      <div className="menustage__tint" />
    </div>
  )
}
