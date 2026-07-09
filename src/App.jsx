import { lazy, Suspense } from 'react'
import SshGate from './lobby/SshGate.jsx'
import QueueScreen from './lobby/QueueScreen.jsx'
import DraftScreen from './lobby/DraftScreen.jsx'
import ErrorBoundary from './shared/ErrorBoundary.jsx'
import { MatchProvider, useMatch } from './net/MatchContext.jsx'

// 조디악 러쉬 — 단독 게임. three.js(3D)를 쓰므로 전장에 들어갈 때만 내려받는다(번들 분리).
const RiftGame = lazy(() => import('./games/rift/RiftGame.jsx'))

// 솔로(오프라인) 모드 — Electron 데스크톱(preload가 window.zodiacDesktop 주입) 또는 ?solo.
//  서버 연결 없이 로컬 시뮬 봇전만 돈다. 웹 온라인 플로우는 그대로.
const SoloApp = lazy(() => import('./solo/SoloApp.jsx'))
const soloMode =
  typeof window !== 'undefined' &&
  (!!window.zodiacDesktop || new URLSearchParams(window.location.search).has('solo'))

// 개발 검수용 — ?faces: 12지신 인게임 실물을 한 화면에 진열(얼굴 크기·크롭 비교)
const FaceGallery = lazy(() => import('./dev/FaceGallery.jsx'))
const facesMode =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('faces')

// 서버 권위 + 매치메이킹.  화면 흐름은 서버가 주도한다:
//   대문(SSH) → 대기열 → 드래프트(스네이크 픽) → 전투
//   진행 중 새로고침/끊김에도 같은 기기(deviceId)면 그 단계로 복구된다.
export default function App() {
  return (
    <div className="app">
      <div className="rotate-hint">
        <div className="rotate-hint__inner">
          <div className="rotate-hint__icon">📱↻</div>
          <p>가로로 돌려서 즐겨주세요</p>
        </div>
      </div>

      {facesMode ? (
        <Suspense fallback={<NetScreen icon="⏳" text="갤러리를 불러오는 중..." />}>
          <FaceGallery />
        </Suspense>
      ) : soloMode ? (
        <ErrorBoundary>
          <Suspense fallback={<NetScreen icon="⏳" text="게임을 불러오는 중..." />}>
            <SoloApp />
          </Suspense>
        </ErrorBoundary>
      ) : (
        <MatchProvider>
          <Flow />
        </MatchProvider>
      )}
    </div>
  )
}

function Flow() {
  const { status, queue, match, you, notice, joinQueue, leaveQueue, startNow, pick, leaveMatch, net } = useMatch()

  if (status === 'connecting') {
    return <NetScreen icon="🌐" text="서버에 연결하는 중..." />
  }

  if (status === 'gate') {
    return <SshGate onQueue={joinQueue} notice={notice} />
  }

  if (status === 'queue') {
    return <QueueScreen queue={queue} onLeave={leaveQueue} onStartNow={startNow} />
  }

  // status === 'match'
  if (!match) {
    return <NetScreen icon="⏳" text="매치를 준비하는 중..." />
  }

  if (match.phase === 'draft') {
    return (
      <DraftScreen match={match} you={you} onPick={pick} onLeave={leaveMatch} notice={notice} />
    )
  }

  // 전투(play)
  return (
    <ErrorBoundary onExit={leaveMatch}>
      {notice && <div className="net-toast net-toast--ingame">{notice}</div>}
      <Suspense fallback={<NetScreen icon="⏳" text="전장을 불러오는 중..." />}>
        <RiftGame roster={match.players} onExit={leaveMatch} net={net} />
      </Suspense>
    </ErrorBoundary>
  )
}

function NetScreen({ icon, text }) {
  return (
    <div className="net-screen">
      <div className="net-screen__icon">{icon}</div>
      <p>{text}</p>
    </div>
  )
}
