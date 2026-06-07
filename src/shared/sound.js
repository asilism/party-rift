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

export const sound = {
  setEnabled(v) {
    enabled = v
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
}
