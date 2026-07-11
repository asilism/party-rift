import { useState } from 'react'
import { sound } from '../shared/sound.js'
import FullscreenButton from '../shared/FullscreenButton.jsx'
import { TEAM_SIZES } from '../games/rift/engine.js'
import { ZODIAC } from '../shared/zodiac.js'

// 접속 대문 — 타이틀 화면. 12지신이 로고 주위를 도는 궤도 링 + 모드(3:3 / 5:5) 선택.
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

      <div className="gate__term" role="group" aria-label="조디악 블리츠 접속">
        <div className="gate__bar">
          <span className="gate__dot gate__dot--r" />
          <span className="gate__dot gate__dot--y" />
          <span className="gate__dot gate__dot--g" />
          <span className="gate__bar-title">zodiac@rush — matchmaking</span>
        </div>

        <div className="gate__body">
          <div className="gate__brand">
            <div className="gate__orbit" aria-hidden="true">
              {ZODIAC.map((z, i) => (
                <span key={z.id} className="gate__zod" style={{ '--i': i }}>
                  <span className="gate__zod-e">{z.emoji}</span>
                </span>
              ))}
              <div className="gate__crest">⚡</div>
            </div>
            <h1 className="gate__name">ZODIAC<span> BLITZ</span></h1>
            <p className="gate__sub">조디악 블리츠</p>
            <p className="gate__tag">12지신이 달린다 · 넥서스를 터뜨려라!</p>
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
