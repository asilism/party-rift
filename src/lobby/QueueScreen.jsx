import FullscreenButton from '../shared/FullscreenButton.jsx'
import { sound } from '../shared/sound.js'

// 매치메이킹 대기 화면 — 인원/남은 시간 표시. 1분이 지나면 봇으로 채워 시작된다.
export default function QueueScreen({ queue, onLeave, onStartNow }) {
  const count = queue?.count ?? 1
  const target = queue?.target ?? 6
  const sec = Math.ceil((queue?.remainingMs ?? 0) / 1000)
  const mode = queue?.mode === '5v5' ? '5 vs 5' : '3 vs 3'

  // 진행 바: 인원 충원도(목표 대비)
  const pct = Math.min(100, Math.round((count / target) * 100))

  return (
    <div className="queue">
      <div className="queue__top">
        <button className="btn btn--ghost" onClick={onLeave}>← 대기열 나가기</button>
        <FullscreenButton />
      </div>

      <div className="queue__center">
        <div className="queue__spinner">⚔️</div>
        <h1 className="queue__title">매칭 중… <span className="queue__mode">{mode}</span></h1>

        <div className="queue__count">
          <b>{count}</b> / {target} 명
        </div>
        <div className="queue__bar">
          <div className="queue__bar-fill" style={{ width: `${pct}%` }} />
        </div>

        <p className="queue__timer">
          {sec > 0 ? <>약 <b>{sec}</b>초 후 시작 (모자란 자리는 봇이 채워요)</> : <>곧 시작합니다…</>}
        </p>
        <p className="queue__hint gate__c-dim"># waiting for players… filling with bots in {Math.max(0, sec)}s</p>

        {onStartNow && (
          <button
            className="btn btn--primary queue__now"
            onClick={() => {
              sound.unlock()
              onStartNow()
            }}
          >
            ⚡ 바로 진행 (봇으로 채워 시작)
          </button>
        )}
      </div>
    </div>
  )
}
