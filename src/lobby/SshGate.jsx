import { useState } from 'react'
import { sound } from '../shared/sound.js'
import FullscreenButton from '../shared/FullscreenButton.jsx'
import { TEAM_SIZES } from '../games/rift/engine.js'

// 접속 대문 — SSH 터미널 "창" 느낌(상단 바 + 프롬프트)에 깔끔한 로고.
// 모드(3:3 / 5:5)를 고르고 대기열에 입장한다.
const MODES = [
  { id: '3v3', label: '3 vs 3', size: TEAM_SIZES['3v3'], desc: '빠른 교전 · 봇 의존 낮음', emoji: '⚔️' },
  { id: '5v5', label: '5 vs 5', size: TEAM_SIZES['5v5'], desc: '큰 맵 · 정글 오브젝트', emoji: '🐉' },
]

export default function SshGate({ onQueue, notice }) {
  const [mode, setMode] = useState('3v3')

  function enter() {
    sound.unlock()
    onQueue(mode)
  }

  return (
    <div className="gate">
      <div className="gate__top">
        <FullscreenButton />
      </div>

      <div className="gate__term" role="group" aria-label="파티 리프트 접속">
        <div className="gate__bar">
          <span className="gate__dot gate__dot--r" />
          <span className="gate__dot gate__dot--y" />
          <span className="gate__dot gate__dot--g" />
          <span className="gate__bar-title">rift@party — secure shell</span>
        </div>

        <div className="gate__body">
          <div className="gate__brand">
            <div className="gate__crest">⚔️</div>
            <h1 className="gate__name">PARTY<span> RIFT</span></h1>
            <p className="gate__tag">3D AOS · 레인을 밀고 넥서스를 터뜨려라</p>
          </div>

          <div className="gate__prompt">
            <p><span className="gate__c-acc">rift@party</span><span className="gate__c-dim">:~$</span> ssh --play</p>
            <p><span className="gate__c-ok">✔</span> connection established <span className="gate__c-dim">· 전장을 선택하세요</span></p>
          </div>

          <div className="gate__modes">
            {MODES.map((m) => (
              <button
                key={m.id}
                className={`gate__mode ${mode === m.id ? 'is-on' : ''}`}
                onClick={() => {
                  sound.step()
                  setMode(m.id)
                }}
              >
                <span className="gate__mode-emoji">{m.emoji}</span>
                <span className="gate__mode-main">
                  <span className="gate__mode-label">{m.label}</span>
                  <span className="gate__mode-desc">{m.desc}</span>
                </span>
                <span className="gate__mode-size">{m.size * 2}인</span>
                {mode === m.id && <span className="gate__mode-check">✓</span>}
              </button>
            ))}
          </div>

          <button className="btn btn--primary gate__enter" onClick={enter}>
            <span className="gate__enter-spark">▶</span> 대기열 입장
          </button>

          {notice && <p className="gate__notice">{notice}</p>}
        </div>
      </div>

      <p className="gate__foot">같은 서버에 접속한 누구와도 자동으로 매칭돼요 · 최대 1분 대기</p>
    </div>
  )
}
