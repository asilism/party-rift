import { useEffect, useMemo, useRef, useState } from 'react'
import { createFaceGallery } from '../games/rift/scene.js'
import { ZODIAC_FACES } from '../games/rift/zodiacFaces.js'
import { ZODIAC } from '../shared/zodiac.js'

// 개발용 얼굴 튜너 — 주소에 ?faces 를 붙여 접속.
// 12지신 인게임 실물을 진열해 두고, 캐릭터별로 크롭(zoom/ox/oy)·배율(scale)·
// 위치 보정(dx/dy)을 슬라이더로 조절한다. 값은 localStorage에 자동 저장되고
// "스펙 복사"로 zodiacFaces.js에 반영할 JSON을 뽑는다.
// WASD/방향키 = 인게임처럼 바라보는 방향 전환(제자리 걸음) — 이동은 하지 않는다.

const TUNE_KEY = 'bgp.rift.facetune.v1'

function loadTune() {
  try {
    const v = JSON.parse(localStorage.getItem(TUNE_KEY))
    if (v && typeof v === 'object') return v
  } catch { /* 무시 */ }
  return {}
}

function saveTune(t) {
  try {
    localStorage.setItem(TUNE_KEY, JSON.stringify(t))
  } catch { /* 무시 */ }
}

// zodiacFaces.js의 기본 스펙(url 제외)
function baseSpec(emoji) {
  const { url, ...rest } = ZODIAC_FACES[emoji] || {}
  return rest
}

function mergedSpec(emoji, tune) {
  return { ...baseSpec(emoji), ...(tune[emoji] || {}) }
}

const FIELDS = [
  { key: 'zoom', label: '크롭 배율', min: 1, max: 3.2, step: 0.05, def: 1, hint: '1 = 크롭 없음' },
  { key: 'ox', label: '크롭 중심 X', min: 0, max: 1, step: 0.01, def: 0.5, cropOnly: true },
  { key: 'oy', label: '크롭 중심 Y', min: 0, max: 1, step: 0.01, def: 0.5, cropOnly: true },
  { key: 'scale', label: '얼굴 배율', min: 0.6, max: 1.6, step: 0.02, def: 1 },
  { key: 'dx', label: '위치 보정 X', min: -0.8, max: 0.8, step: 0.02, def: 0, hint: '+ = 보는 방향 쪽' },
  { key: 'dy', label: '위치 보정 Y', min: -1.2, max: 1.2, step: 0.02, def: 0 },
]

// 방향키/WASD → 인게임 좌표계(오른쪽 +x, 아래 +z)
const KEYMAP = {
  KeyW: [0, -1], ArrowUp: [0, -1],
  KeyS: [0, 1], ArrowDown: [0, 1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0],
  KeyD: [1, 0], ArrowRight: [1, 0],
}

export default function FaceGallery() {
  const canvasRef = useRef(null)
  const stageRef = useRef(null)
  const [tune, setTune] = useState(loadTune)
  const [selected, setSelected] = useState(ZODIAC[0].id)
  const [copied, setCopied] = useState(false)
  const zSel = ZODIAC.find((z) => z.id === selected)
  const spec = useMemo(() => mergedSpec(zSel.emoji, tune), [zSel, tune])

  useEffect(() => {
    const stage = createFaceGallery(canvasRef.current)
    stageRef.current = stage
    const t = loadTune()
    for (const z of ZODIAC) stage.setSpec(z.emoji, mergedSpec(z.emoji, t))
    const holder = canvasRef.current.parentElement
    const fit = () => stage.resize(holder.clientWidth, holder.clientHeight)
    const ro = new ResizeObserver(fit)
    ro.observe(holder)
    fit()

    // 키보드 방향(인게임처럼) — 눌린 키 조합으로 8방향, 떼면 대기 자세
    const held = new Set()
    const apply = () => {
      let mx = 0
      let mz = 0
      for (const k of held) {
        mx += KEYMAP[k][0]
        mz += KEYMAP[k][1]
      }
      stage.setDir(mx || mz ? Math.atan2(mz, mx) : null)
    }
    const down = (e) => {
      if (!KEYMAP[e.code] || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return
      e.preventDefault()
      held.add(e.code)
      apply()
    }
    const up = (e) => {
      if (held.delete(e.code)) apply()
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      ro.disconnect()
      stage.dispose()
      stageRef.current = null
    }
  }, [])

  useEffect(() => {
    stageRef.current?.select(zSel.emoji)
  }, [zSel])

  function update(key, value) {
    const next = { ...tune, [zSel.emoji]: { ...mergedSpec(zSel.emoji, tune), [key]: value } }
    setTune(next)
    saveTune(next)
    stageRef.current?.setSpec(zSel.emoji, mergedSpec(zSel.emoji, next))
  }

  function resetOne() {
    const next = { ...tune }
    delete next[zSel.emoji]
    setTune(next)
    saveTune(next)
    stageRef.current?.setSpec(zSel.emoji, baseSpec(zSel.emoji))
  }

  function resetAll() {
    setTune({})
    saveTune({})
    for (const z of ZODIAC) stageRef.current?.setSpec(z.emoji, baseSpec(z.emoji))
  }

  function copySpec() {
    // 기본값과 같은 필드는 빼고, 캐릭터별 최종 스펙만 — zodiacFaces.js에 그대로 반영 가능
    const out = {}
    for (const z of ZODIAC) {
      if (tune[z.emoji]) out[z.emoji] = mergedSpec(z.emoji, tune)
    }
    navigator.clipboard?.writeText(JSON.stringify(out, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const cropOff = !spec.zoom || spec.zoom <= 1.001

  return (
    <div className="face-gallery">
      <canvas ref={canvasRef} />

      <aside className="face-tuner">
        <div className="face-tuner__head">
          <select value={selected} onChange={(e) => setSelected(e.target.value)}>
            {ZODIAC.map((z) => (
              <option key={z.id} value={z.id}>{z.emoji} {z.name}{tune[z.emoji] ? ' *' : ''}</option>
            ))}
          </select>
        </div>
        {FIELDS.map((f) => {
          const val = spec[f.key] ?? f.def
          const disabled = f.cropOnly && cropOff
          return (
            <label key={f.key} className={`face-tuner__row ${disabled ? 'is-off' : ''}`}>
              <span>{f.label}</span>
              <input
                type="range" min={f.min} max={f.max} step={f.step} value={val}
                disabled={disabled}
                onChange={(e) => update(f.key, Number(e.target.value))}
              />
              <b>{Number(val).toFixed(2)}</b>
              {f.hint && <small>{f.hint}</small>}
            </label>
          )
        })}
        <div className="face-tuner__btns">
          <button onClick={copySpec}>{copied ? '✅ 복사됨' : '📋 스펙 복사'}</button>
          <button onClick={resetOne}>이 캐릭터 초기화</button>
          <button onClick={resetAll}>전체 초기화</button>
        </div>
        <p className="face-tuner__hint">
          🎮 WASD/방향키 = 바라보는 방향(제자리 걸음) · 값은 자동 저장 · 다 되면 "스펙 복사" 결과를 넘겨줘
        </p>
      </aside>
    </div>
  )
}
