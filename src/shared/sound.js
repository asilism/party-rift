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

// ── 프로시저럴 BGM: 경쾌한 칩튠 루프 (에셋 없이 오실레이터 스케줄링) ──
// 32스텝(8분음표) 루프를 lookahead 스케줄러로 깔아준다. 마지막 바퀴엔 빨라진다!
const NOTE = {
  C3: 130.8, F3: 174.6, G3: 196.0, A3: 220.0,
  C5: 523.3, D5: 587.3, E5: 659.3, G5: 784.0, A5: 880.0, C6: 1046.5,
}
const MELODY = [
  'C5', 'E5', 'G5', null, 'E5', 'G5', 'A5', null,
  'G5', 'E5', 'C5', null, 'D5', 'E5', 'D5', null,
  'C5', 'E5', 'G5', null, 'A5', 'G5', 'E5', 'G5',
  'A5', null, 'G5', null, 'E5', 'D5', 'C5', null,
]
const BASS = ['C3', 'C3', 'A3', 'A3', 'F3', 'F3', 'G3', 'G3'] // 4스텝(4분음표)마다
let mTimer = null
let mStep = 0
let mNext = 0
let mFast = false

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

function scheduleStep(ac, i, t, dur) {
  const m = MELODY[i]
  if (m) playNote(ac, NOTE[m], t, dur * 0.95, 'square', 0.022)
  if (i % 4 === 0) playNote(ac, NOTE[BASS[(i / 4) % BASS.length]], t, dur * 3.6, 'triangle', 0.045)
  if (i % 8 === 0) {
    // 킥: 낮은 사인이 뚝 떨어진다
    const osc = ac.createOscillator()
    const g = ac.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(150, t)
    osc.frequency.exponentialRampToValueAtTime(50, t + 0.1)
    osc.connect(g)
    g.connect(ac.destination)
    g.gain.setValueAtTime(0.06, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12)
    osc.start(t)
    osc.stop(t + 0.12)
  }
}

export const sound = {
  setEnabled(v) {
    enabled = v
    if (!v) this.musicStop()
  },
  // 레이스 BGM 시작/정지. 이미 흐르는 중이면 무시.
  musicStart() {
    if (mTimer || !enabled) return
    const ac = getCtx()
    if (!ac) return
    mStep = 0
    mNext = ac.currentTime + 0.06
    mTimer = setInterval(() => {
      const a = getCtx()
      if (!a) return
      const dur = mFast ? 0.198 : 0.225 // 마지막 바퀴엔 템포 업!
      while (mNext < a.currentTime + 0.35) {
        scheduleStep(a, mStep, mNext, dur)
        mNext += dur
        mStep = (mStep + 1) % MELODY.length
      }
    }, 120)
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
  // 용암/낭떠러지에 풍덩~
  splash() {
    beep(520, 0.1, 'sawtooth', 0.06)
    setTimeout(() => beep(280, 0.14, 'sawtooth', 0.06), 90)
    setTimeout(() => beep(120, 0.3, 'sawtooth', 0.07), 200)
  },
}
