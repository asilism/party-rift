// 에셋 파일 없이 Web Audio API로 간단한 효과음을 생성한다.
// 전역 on/off 토글 지원. (MVP: 주사위 굴림 틱, 이동, 골인 팡파르)
let ctx = null
let enabled = true

function getCtx() {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    ctx = new AC()
  }
  // 모바일 브라우저는 사용자 제스처 후 resume 필요
  if (ctx.state === 'suspended') ctx.resume()
  return ctx
}

function beep(freq, duration = 0.08, type = 'square', gain = 0.06) {
  if (!enabled) return
  const ac = getCtx()
  if (!ac) return
  const osc = ac.createOscillator()
  const g = ac.createGain()
  osc.type = type
  osc.frequency.value = freq
  g.gain.value = gain
  osc.connect(g)
  g.connect(ac.destination)
  const now = ac.currentTime
  g.gain.setValueAtTime(gain, now)
  g.gain.exponentialRampToValueAtTime(0.0001, now + duration)
  osc.start(now)
  osc.stop(now + duration)
}

// ── 프로시저럴 BGM: 에셋 없이 오실레이터 스케줄링 ──
// lookahead 스케줄러로 "트랙"(멜로디/베이스/스텝 스케줄)을 깔아준다.
const NOTE = {
  // 베이스 음역
  A2: 110.0, B2: 123.5, C3: 130.8, D3: 146.8, E3: 164.8,
  F3: 174.6, G3: 196.0, A3: 220.0,
  // 멜로디 음역
  A4: 440.0, B4: 493.9, C5: 523.3, D5: 587.3, E5: 659.3,
  F5: 698.5, G5: 784.0, Gs5: 830.6, A5: 880.0, B5: 987.8,
  C6: 1046.5, D6: 1174.7,
}

// ── 카트: 경쾌한 메이저 칩튠 루프 (32스텝) ──
const MELODY = [
  'C5', 'E5', 'G5', null, 'E5', 'G5', 'A5', null,
  'G5', 'E5', 'C5', null, 'D5', 'E5', 'D5', null,
  'C5', 'E5', 'G5', null, 'A5', 'G5', 'E5', 'G5',
  'A5', null, 'G5', null, 'E5', 'D5', 'C5', null,
]
const BASS = ['C3', 'C3', 'A3', 'A3', 'F3', 'F3', 'G3', 'G3'] // 4스텝(4분음표)마다

// ── 리프트: 어둡고 묵직한 마이너 재즈 (128스텝 = 16마디, 카트의 4배 길이) ──
// 진행: Am7 | Am7 | Dm7 | Dm7 | Bm7b5 | E7 | Am7 | Am7
//       Cmaj7 | Fmaj7 | Bm7b5 | E7 | Am7 | Dm7 | Bm7b5 | E7→Am
const MELODY_LIFT = [
  // Am7
  'A4', 'C5', 'E5', 'G5', null, 'E5', null, 'C5',
  // Am7
  'D5', 'E5', null, 'A5', 'G5', 'E5', null, null,
  // Dm7
  'D5', 'F5', 'A5', 'C6', null, 'A5', null, 'F5',
  // Dm7
  'E5', 'F5', null, 'D5', null, 'A4', null, null,
  // Bm7b5
  'B4', 'D5', 'F5', 'A5', null, 'F5', null, 'D5',
  // E7  (Gs5 = E7의 3음, 재즈 텐션)
  'Gs5', 'B5', null, 'E5', null, 'D5', null, 'B4',
  // Am7
  'C5', 'E5', 'A5', 'G5', 'E5', null, 'C5', null,
  // Am7
  'A4', null, 'B4', 'C5', null, 'E5', null, 'D5',
  // Cmaj7
  'C5', 'E5', 'G5', 'B5', null, 'G5', null, 'E5',
  // Fmaj7
  'F5', 'A5', 'C6', null, 'A5', null, 'F5', null,
  // Bm7b5
  'B4', 'D5', 'F5', null, 'A5', 'F5', 'D5', null,
  // E7
  'E5', 'Gs5', 'B5', 'D6', null, 'B5', null, 'Gs5',
  // Am7
  'A5', null, 'G5', 'E5', null, 'C5', null, 'A4',
  // Dm7
  'D5', 'F5', 'A5', null, 'C6', 'A5', 'F5', null,
  // Bm7b5
  'B4', 'D5', 'F5', null, 'Gs5', 'B5', null, 'D6',
  // E7 → Am (해결하며 처음으로 회귀)
  'E5', null, 'D5', null, 'C5', null, 'B4', null,
]
// 워킹 베이스: 마디마다 루트 + 다음 코드로의 접근음 (4스텝마다, 마디당 2음)
const BASS_LIFT = [
  'A2', 'E3', 'A2', 'C3', 'D3', 'A2', 'D3', 'C3', // 1~4마디
  'B2', 'F3', 'E3', 'B2', 'A2', 'E3', 'A2', 'B2', // 5~8마디
  'C3', 'G3', 'F3', 'C3', 'B2', 'F3', 'E3', 'D3', // 9~12마디
  'A2', 'E3', 'D3', 'A2', 'B2', 'E3', 'E3', 'B2', // 13~16마디
]

let mTimer = null
let mStep = 0
let mNext = 0
let mFast = false
let mTrack = null

function playNote(ac, freq, t, dur, type, vol) {
  const osc = ac.createOscillator()
  const g = ac.createGain()
  osc.type = type
  osc.frequency.value = freq
  osc.connect(g)
  g.connect(ac.destination)
  g.gain.setValueAtTime(vol, t)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  osc.start(t)
  osc.stop(t + dur)
}

// 낮은 사인이 뚝 떨어지는 킥
function kick(ac, t, vol) {
  const osc = ac.createOscillator()
  const g = ac.createGain()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(150, t)
  osc.frequency.exponentialRampToValueAtTime(50, t + 0.1)
  osc.connect(g)
  g.connect(ac.destination)
  g.gain.setValueAtTime(vol, t)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12)
  osc.start(t)
  osc.stop(t + 0.12)
}

// 노이즈 버퍼(라이드/브러시용)
let noiseBuf = null
function getNoise(ac) {
  if (!noiseBuf) {
    noiseBuf = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.2), ac.sampleRate)
    const d = noiseBuf.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  }
  return noiseBuf
}
// 하이패스된 짧은 노이즈 = 재즈 라이드/브러시 느낌
function cymbal(ac, t, vol, hpFreq, dur) {
  const s = ac.createBufferSource()
  s.buffer = getNoise(ac)
  const hp = ac.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = hpFreq
  const g = ac.createGain()
  s.connect(hp)
  hp.connect(g)
  g.connect(ac.destination)
  g.gain.setValueAtTime(vol, t)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  s.start(t)
  s.stop(t + dur + 0.02)
}

// 카트: 메이저 칩튠 스텝
function scheduleStepCart(ac, i, t, dur) {
  const m = MELODY[i]
  if (m) playNote(ac, NOTE[m], t, dur * 0.95, 'square', 0.022)
  if (i % 4 === 0) playNote(ac, NOTE[BASS[(i / 4) % BASS.length]], t, dur * 3.6, 'triangle', 0.045)
  if (i % 8 === 0) kick(ac, t, 0.06)
}

// 리프트: 스윙하는 마이너 재즈 스텝
function scheduleStepLift(ac, i, t, dur) {
  // 스윙: 홀수 8분음표(오프비트)를 살짝 뒤로 민다
  const swing = i % 2 === 1 ? dur * 0.34 : 0
  const m = MELODY_LIFT[i]
  if (m) {
    const mt = t + swing
    const md = (i % 2 === 1 ? 0.7 : 1.05) * dur
    playNote(ac, NOTE[m], mt, md, 'square', 0.017)
  }
  // 워킹 베이스(4스텝마다)
  if (i % 4 === 0) {
    const b = BASS_LIFT[(i / 4) % BASS_LIFT.length]
    if (b) playNote(ac, NOTE[b], t, dur * 1.8, 'triangle', 0.05)
  }
  // 스윙 라이드: 비트 + 스윙한 '앤(and)' — 재즈의 ding-da-ding 느낌
  if (i % 2 === 0) cymbal(ac, t, 0.016, 8000, 0.06)
  else cymbal(ac, t + swing, 0.011, 9000, 0.05)
  // 소프트 킥: 마디 머리(8스텝)마다
  if (i % 8 === 0) kick(ac, t, 0.04)
  // 브러시 스네어: 마디 3박(스텝 4)에 살짝
  if (i % 8 === 4) cymbal(ac, t, 0.02, 2500, 0.09)
}

const TRACK_CART = {
  melody: MELODY,
  scheduleStep: scheduleStepCart,
  durNormal: 0.225,
  durFast: 0.198,
}
const TRACK_LIFT = {
  melody: MELODY_LIFT,
  scheduleStep: scheduleStepLift,
  durNormal: 0.26, // 카트보다 느긋하고 묵직하게
  durFast: 0.224,
}

function startTrack(track) {
  if (mTimer || !enabled) return
  const ac = getCtx()
  if (!ac) return
  mTrack = track
  mStep = 0
  mNext = ac.currentTime + 0.06
  mTimer = setInterval(() => {
    const a = getCtx()
    if (!a || !mTrack) return
    const dur = mFast ? mTrack.durFast : mTrack.durNormal
    while (mNext < a.currentTime + 0.35) {
      mTrack.scheduleStep(a, mStep, mNext, dur)
      mNext += dur
      mStep = (mStep + 1) % mTrack.melody.length
    }
  }, 120)
}

export const sound = {
  setEnabled(v) {
    enabled = v
    if (!v) this.musicStop()
  },
  // 카트 레이스 BGM 시작. 이미 흐르는 중이면 무시.
  musicStart() {
    startTrack(TRACK_CART)
  },
  // 리프트 전용 BGM: 마이너 재즈 (카트의 4배 길이 리프)
  musicStartLift() {
    startTrack(TRACK_LIFT)
  },
  musicStop() {
    if (mTimer) clearInterval(mTimer)
    mTimer = null
  },
  musicSetFast(v) {
    mFast = !!v
  },
  isEnabled() {
    return enabled
  },
  // 사용자 제스처 시점에 오디오 컨텍스트를 깨운다.
  unlock() {
    getCtx()
  },
  diceTick() {
    beep(220 + Math.random() * 180, 0.04, 'square', 0.04)
  },
  step() {
    beep(520, 0.06, 'triangle', 0.05)
  },
  ladderUp() {
    beep(440, 0.1, 'sine', 0.06)
    setTimeout(() => beep(660, 0.12, 'sine', 0.06), 90)
    setTimeout(() => beep(880, 0.14, 'sine', 0.06), 200)
  },
  chuteDown() {
    beep(440, 0.12, 'sawtooth', 0.05)
    setTimeout(() => beep(300, 0.14, 'sawtooth', 0.05), 100)
    setTimeout(() => beep(200, 0.16, 'sawtooth', 0.05), 220)
  },
  win() {
    const notes = [523, 659, 784, 1047]
    notes.forEach((f, i) => setTimeout(() => beep(f, 0.18, 'sine', 0.07), i * 130))
  },
  // 열쇠카드 칸 발동 / 카드 공개
  key() {
    beep(880, 0.08, 'sine', 0.06)
    setTimeout(() => beep(1175, 0.12, 'sine', 0.06), 90)
  },
  // 레이스 카운트다운: 도(C5)... 출발은 한 옥타브 위 도(C6)!
  count() {
    beep(523, 0.13, 'square', 0.07)
  },
  go() {
    beep(1047, 0.5, 'square', 0.08)
  },
  // 장애물에 쿵 — 통! 하고 튕기는 소리
  bounce() {
    beep(180, 0.07, 'square', 0.07)
    setTimeout(() => beep(320, 0.1, 'square', 0.06), 60)
  },
  // 번개 우르릉 쾅!
  thunder() {
    beep(110, 0.4, 'sawtooth', 0.09)
    setTimeout(() => beep(70, 0.5, 'sawtooth', 0.08), 110)
    setTimeout(() => beep(50, 0.6, 'sawtooth', 0.06), 260)
  },
  // 로켓 발사 슈웅~
  rocket() {
    beep(300, 0.15, 'sawtooth', 0.06)
    setTimeout(() => beep(520, 0.15, 'sawtooth', 0.06), 120)
    setTimeout(() => beep(840, 0.3, 'sawtooth', 0.07), 240)
  },
  // 점프대 발사 — 휘리릭 위로!
  jump() {
    beep(420, 0.08, 'square', 0.06)
    setTimeout(() => beep(640, 0.09, 'square', 0.06), 70)
    setTimeout(() => beep(900, 0.14, 'square', 0.06), 140)
  },
  // 기차 경적 빵~ 빵~!
  train() {
    beep(311, 0.3, 'square', 0.07)
    beep(415, 0.3, 'square', 0.05)
    setTimeout(() => {
      beep(311, 0.45, 'square', 0.07)
      beep(415, 0.45, 'square', 0.05)
    }, 420)
  },
  // 용암/낭떠러지에 풍덩~
  splash() {
    beep(520, 0.1, 'sawtooth', 0.06)
    setTimeout(() => beep(280, 0.14, 'sawtooth', 0.06), 90)
    setTimeout(() => beep(120, 0.3, 'sawtooth', 0.07), 200)
  },

  // ── 전투 타격음 (Rift): 근접 / 원거리 / 마법 / 건물 파괴 ──
  // 근접 타격: 퍽! 하고 둔탁하게 꽂히는 물리 가격
  meleeHit() {
    beep(170, 0.05, 'square', 0.07)
    setTimeout(() => beep(95, 0.07, 'square', 0.06), 26)
    setTimeout(() => beep(320, 0.03, 'triangle', 0.04), 8)
  },
  // 원거리 타격: 슉~ 날아와 탁 꽂히는 화살/탄
  rangedHit() {
    beep(1150, 0.05, 'sawtooth', 0.045)
    setTimeout(() => beep(640, 0.05, 'sawtooth', 0.05), 45)
    setTimeout(() => beep(250, 0.05, 'square', 0.05), 95)
  },
  // 마법 타격: 낮은 붐 + 디튠 화음 + 반짝이는 잔향
  magicHit() {
    beep(185, 0.18, 'sine', 0.06)
    beep(415, 0.14, 'sawtooth', 0.03)
    beep(622, 0.14, 'sawtooth', 0.025)
    setTimeout(() => beep(1245, 0.1, 'sine', 0.04), 70)
    setTimeout(() => beep(1661, 0.12, 'sine', 0.03), 150)
  },
  // 포탑 파괴: 낮은 럼블 + 돌 파편이 부서지는 소리
  towerFall() {
    if (!enabled) return
    const ac = getCtx()
    beep(120, 0.3, 'sawtooth', 0.07)
    setTimeout(() => beep(80, 0.35, 'sawtooth', 0.06), 120)
    setTimeout(() => beep(55, 0.4, 'sawtooth', 0.05), 260)
    if (ac) cymbal(ac, ac.currentTime, 0.05, 3000, 0.25) // 파편
  },
  // 넥서스 파괴: 거대한 폭발 — 하강하는 굉음 + 무너지는 파편
  nexusFall() {
    if (!enabled) return
    const ac = getCtx()
    if (ac) {
      const osc = ac.createOscillator()
      const g = ac.createGain()
      osc.type = 'sine'
      const now = ac.currentTime
      osc.frequency.setValueAtTime(160, now)
      osc.frequency.exponentialRampToValueAtTime(35, now + 0.7)
      osc.connect(g)
      g.connect(ac.destination)
      g.gain.setValueAtTime(0.12, now)
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.9)
      osc.start(now)
      osc.stop(now + 0.9)
      cymbal(ac, now, 0.07, 2000, 0.5)
      setTimeout(() => {
        const a = getCtx()
        if (a) cymbal(a, a.currentTime, 0.05, 4000, 0.3)
      }, 150)
    }
    beep(300, 0.4, 'sawtooth', 0.06)
    setTimeout(() => beep(150, 0.5, 'sawtooth', 0.05), 200)
  },
  // 회복/성광: 부드럽게 차오르는 차임
  healChime() {
    beep(659, 0.12, 'sine', 0.05)
    setTimeout(() => beep(880, 0.12, 'sine', 0.05), 90)
    setTimeout(() => beep(1175, 0.16, 'sine', 0.05), 180)
  },
  // 보호막: 금속성 반짝임
  shield() {
    beep(740, 0.08, 'triangle', 0.05)
    setTimeout(() => beep(988, 0.12, 'triangle', 0.04), 60)
  },
}
