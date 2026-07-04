// 조디악 러쉬 3D 렌더러 (three.js).
// 엔진의 makeView() 스냅샷만 보고 그린다 — 호스트/게스트 공용.
// 로블록스 풍 러프 3D: 단색 로우폴리 몸통 + 이모지 얼굴 스프라이트.
// 내 팀 시야 기준으로 전장의 안개(어둠)와 수풀 은신을 그린다.
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { getZodiac } from '../../shared/zodiac.js'
import {
  NEXUS_RADIUS, FOUNTAIN_RADIUS, LANE_IDS, WALL_RADIUS, RESPAWN_ARC_HALF, buildMap,
} from './map.js'
import { CLASSES, isHeroVisible, isUnitVisible, SIGHT_RANGE, TOWER_RANGE } from './engine.js'

// ── 그래픽 품질 프리셋 ──
// 티어는 선명도(픽셀레이트·AA)와 안개 갱신율만 조절한다. 월드의 장식 개수·배치는 전 티어 동일 —
// 정적 장식은 병합되고 산포물은 인스턴싱돼 개수가 성능에 거의 무관해졌기 때문(개수 줄여도 드로우콜 그대로).
// 그래서 상/중/하는 세계의 "모양"이 아니라 "화질"만 바꾼다. high = 현재와 픽셀 단위로 동일한 최고 화질.
//  픽셀레이트가 프래그먼트 비용의 지배적 요인. low는 1.25(1.0이면 이름표 한글이 뭉갠다) + AA 끔.
const QUALITY = {
  high: { pixelRatio: 2, antialias: true, fogEvery: 1 },
  med: { pixelRatio: 1.5, antialias: true, fogEvery: 2 },
  low: { pixelRatio: 1.25, antialias: false, fogEvery: 3 },
}

export const TEAM_COLOR = { blue: 0x4f8cff, red: 0xff6b6b }
const ALLY_HP = 0x4ade80
const ENEMY_HP = 0xff5f5f

// ── 타격감(피격 피드백) 공통 수치 ──
const HITFLASH_T = 0.18 // 피격 테두리가 빛나는 시간(초)

// 떠오르는 데미지 숫자 텍스처 — 같은 문구는 캐시해 재사용(캔버스 생성 비용 절감)
const dmgTexCache = new Map()
function dmgTexture(text, kind) {
  const key = `${kind}:${text}`
  const hit = dmgTexCache.get(key)
  if (hit) return hit
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 64
  const ctx = c.getContext('2d')
  ctx.font = '900 46px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineWidth = 8
  ctx.strokeStyle = 'rgba(8, 6, 3, 0.92)'
  ctx.strokeText(text, 64, 34)
  ctx.fillStyle = kind === 'me' ? '#ff7a6e' : kind === 'crit' ? '#ffd34d' : '#fff4e2'
  ctx.fillText(text, 64, 34)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  if (dmgTexCache.size > 240) {
    const old = dmgTexCache.keys().next().value
    dmgTexCache.get(old)?.dispose?.()
    dmgTexCache.delete(old)
  }
  dmgTexCache.set(key, tex)
  return tex
}

function emojiTexture(emoji, size = 128) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')
  ctx.font = `${size * 0.78}px serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(emoji, size / 2, size / 2 + size * 0.04)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function emojiSprite(emoji, scale = 2) {
  const sp = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: emojiTexture(emoji), depthWrite: false, transparent: true })
  )
  sp.scale.set(scale, scale, 1)
  return sp
}

// 부드러운 방사형 발광 텍스처 (가운데 흰빛 → 가장자리 투명). 발광체 후광·타격 스파크에 공용.
let _glowTex = null
function glowTexture() {
  if (_glowTex) return _glowTex
  const size = 128
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.22, 'rgba(255,255,255,0.85)')
  g.addColorStop(0.5, 'rgba(255,255,255,0.35)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  _glowTex = new THREE.CanvasTexture(c)
  _glowTex.colorSpace = THREE.SRGBColorSpace
  return _glowTex
}

// 결속의 끈: 두 영웅 사이를 잇는 투명한 청록 선 (매 프레임 양끝 좌표만 갱신)
function makeBindLine() {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3))
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
    color: 0xbfeeff, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending,
  }))
  line.frustumCulled = false
  return line
}

// 발광체 후광: 가산 합성으로 은은하게 빛나는 스프라이트 (구체 투사체를 "빛덩이"로 보이게)
function glowSprite(color, scale = 2) {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(), color, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, opacity: 0.9,
  }))
  sp.scale.set(scale, scale, 1)
  return sp
}

// ── 공용 파티클 스파크 시스템 ──
// 하나의 Points(가산 합성 + 발광 텍스처)로 타격 스파크·발자국 먼지·투사체 꼬리를 모두 그린다.
//  링버퍼로 파티클을 재사용하고, 개별 수명이 다하면 색을 0으로(가산→투명) 죽인다. 순수 클라 연출.
//  파티클마다 크기가 달라야 해서(타격은 크게, 먼지·꼬리는 작게) 커스텀 셰이더로 per-particle size를 준다.
function makeParticles(scene, max = 420) {
  const geo = new THREE.BufferGeometry()
  const pos = new Float32Array(max * 3)
  const col = new Float32Array(max * 3)
  const psize = new Float32Array(max)
  const phard = new Float32Array(max) // 0=부드러운 발광(꼬리·먼지), 1=각진 조각(타격)
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('acolor', new THREE.BufferAttribute(col, 3))
  geo.setAttribute('psize', new THREE.BufferAttribute(psize, 1))
  geo.setAttribute('phard', new THREE.BufferAttribute(phard, 1))
  const mat = new THREE.ShaderMaterial({
    uniforms: { map: { value: glowTexture() } },
    vertexShader: `
      attribute vec3 acolor;
      attribute float psize;
      attribute float phard;
      varying vec3 vColor;
      varying float vHard;
      void main() {
        vColor = acolor;
        vHard = phard;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = psize * (360.0 / -mv.z); // 원근 크기 감쇠
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform sampler2D map;
      varying vec3 vColor;
      varying float vHard;
      void main() {
        if (vHard > 0.5) {
          // 각진 조각: 다이아몬드꼴 하드 엣지 — 뿌옇게 번지지 않고 또렷한 파편으로 튄다
          vec2 d = abs(gl_PointCoord - 0.5);
          float m = d.x + d.y;
          if (m > 0.5) discard;
          float a = 1.0 - smoothstep(0.4, 0.5, m); // 가장자리만 살짝 정리
          gl_FragColor = vec4(vColor, a);
        } else {
          vec4 t = texture2D(map, gl_PointCoord); // 부드러운 발광
          gl_FragColor = vec4(vColor, t.a);
        }
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const points = new THREE.Points(geo, mat)
  points.frustumCulled = false
  scene.add(points)
  const vel = new Float32Array(max * 3)
  const base = new Float32Array(max * 3) // 원래 색 (수명따라 감쇠)
  const life = new Float32Array(max)
  const maxLife = new Float32Array(max)
  const grav = new Float32Array(max)
  let cursor = 0
  const _c = new THREE.Color()
  function emit(x, y, z, color, n, o = {}) {
    const spread = o.spread ?? 4
    const up = o.up ?? 3.5
    const lo = o.lifeMin ?? 0.25
    const hi = o.lifeMax ?? 0.5
    const g = o.gravity ?? 9
    const sz = o.size ?? 0.9
    const hard = o.hard ? 1 : 0
    _c.set(color)
    for (let k = 0; k < n; k++) {
      const i = cursor
      cursor = (cursor + 1) % max
      const a = Math.random() * Math.PI * 2
      const sp = spread * (0.35 + Math.random() * 0.65)
      pos[i * 3] = x
      pos[i * 3 + 1] = y
      pos[i * 3 + 2] = z
      vel[i * 3] = Math.cos(a) * sp
      vel[i * 3 + 1] = up * (0.25 + Math.random())
      vel[i * 3 + 2] = Math.sin(a) * sp
      base[i * 3] = _c.r
      base[i * 3 + 1] = _c.g
      base[i * 3 + 2] = _c.b
      psize[i] = sz * (0.75 + Math.random() * 0.5) // 알갱이 크기 살짝 들쭉날쭉
      phard[i] = hard
      const lf = lo + Math.random() * (hi - lo)
      life[i] = lf
      maxLife[i] = lf
      grav[i] = g
    }
    geo.attributes.psize.needsUpdate = true
    geo.attributes.phard.needsUpdate = true
  }
  function update(dt) {
    for (let i = 0; i < max; i++) {
      if (life[i] <= 0) continue
      life[i] -= dt
      if (life[i] <= 0) { col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = 0; continue }
      vel[i * 3 + 1] -= grav[i] * dt
      pos[i * 3] += vel[i * 3] * dt
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt
      if (pos[i * 3 + 1] < 0.1) { // 바닥에 튕겨 잦아든다
        pos[i * 3 + 1] = 0.1
        vel[i * 3 + 1] *= -0.28
        vel[i * 3] *= 0.6
        vel[i * 3 + 2] *= 0.6
      }
      const f = life[i] / maxLife[i] // 1→0
      col[i * 3] = base[i * 3] * f
      col[i * 3 + 1] = base[i * 3 + 1] * f
      col[i * 3 + 2] = base[i * 3 + 2] * f
    }
    geo.attributes.position.needsUpdate = true
    geo.attributes.acolor.needsUpdate = true
  }
  return { emit, update }
}

// 걷기 모션 상태: 이동 거리로 보폭 위상을 굴려 속도에 따라 자연히 걸음 빨라진다(순수 클라).
//  bounce(위아래 통통)·step(발 딛는 순간) 반환. 순간이동(blink/부활)은 큰 이동으로 걸러 튐 방지.
function walkBounce(u, x, z, dt) {
  const px = u.wx == null ? x : u.wx
  const pz = u.wz == null ? z : u.wz
  const moved = Math.hypot(x - px, z - pz)
  u.wx = x
  u.wz = z
  if (moved > 6) return { amt: 0, bounce: 0, step: false } // 순간이동
  const prev = u.wphase || 0
  u.wphase = prev + moved * 0.75 // 보폭(한 걸음 거리)을 넓게 — 뒤뚱이 느긋해진다
  const speed = dt > 0 ? moved / dt : 0
  const amt = Math.min(1, speed / 6)
  return {
    amt,
    bounce: Math.abs(Math.sin(u.wphase)) * amt,
    step: amt > 0.15 && Math.floor(u.wphase / Math.PI) !== Math.floor(prev / Math.PI),
  }
}

// 이름표 텍스처 (흰/노란 글씨 + 어두운 테두리)
function makeNameTexture(text, color) {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 64
  const ctx = c.getContext('2d')
  ctx.font = '800 27px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineWidth = 7
  ctx.strokeStyle = 'rgba(10, 16, 32, 0.85)'
  ctx.strokeText(text, 128, 34)
  ctx.fillStyle = color
  ctx.fillText(text, 128, 34)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

// 이름표 스프라이트 (레벨 + 직업 + 이름). 레벨이 오르면 setNameText로 다시 그린다.
function nameSprite(text, color = '#ffffff') {
  const sp = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: makeNameTexture(text, color), depthWrite: false, transparent: true })
  )
  sp.scale.set(7, 1.75, 1)
  return sp
}

function setNameText(sp, text, color) {
  sp.material.map?.dispose?.()
  sp.material.map = makeNameTexture(text, color)
  sp.material.needsUpdate = true
}

// 머리 위 이름표 문구: "Lv.3 ⚔️호랑이🤖" — 적·아군 모두 레벨이 항상 보인다
function heroLabel(h) {
  return `Lv.${h.lvl} ${CLASSES[h.cls]?.icon || ''}${h.name}${h.isBot ? '🤖' : ''}`
}

// 골드 획득 표시: 떠오르며 사라지는 금색 "+N" 스프라이트 (내 영웅 막타 때만)
function goldSprite(n) {
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 64
  const ctx = c.getContext('2d')
  ctx.font = '900 40px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineWidth = 7
  ctx.strokeStyle = 'rgba(60, 40, 0, 0.9)'
  ctx.strokeText(`+${n.n}`, 64, 32)
  ctx.fillStyle = '#ffd34d'
  ctx.fillText(`+${n.n}`, 64, 32)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }))
  sp.scale.set(4, 2, 1)
  sp.position.set(n.x, 5, n.z)
  return sp
}

// "🛡 공격불가" 라벨 — 선행 구조물이 안 부서져 무적인 포탑/넥서스 위에 띄운다
function lockLabel() {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 64
  const ctx = c.getContext('2d')
  ctx.font = '800 27px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineWidth = 7
  ctx.strokeStyle = 'rgba(10, 16, 32, 0.9)'
  ctx.strokeText('🛡 공격불가', 128, 34)
  ctx.fillStyle = '#ffd34d'
  ctx.fillText('🛡 공격불가', 128, 34)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }))
  sp.scale.set(7, 1.75, 1)
  return sp
}

// 체력바: 검정 배경 + 왼쪽 기준으로 줄어드는 색 막대 (스프라이트라 항상 카메라를 본다)
function makeHpBar(width = 2.6, color = ALLY_HP) {
  const g = new THREE.Group()
  const bg = new THREE.Sprite(
    new THREE.SpriteMaterial({ color: 0x101626, opacity: 0.85, transparent: true, depthWrite: false })
  )
  bg.scale.set(width, 0.36, 1)
  const fg = new THREE.Sprite(new THREE.SpriteMaterial({ color, depthWrite: false }))
  fg.center.set(0, 0.5)
  fg.position.x = -width / 2 + 0.05
  fg.scale.set(width - 0.1, 0.24, 1)
  // 보호막(흡수) 게이지 — 남은 체력 오른쪽에 흰색으로 덧붙는다(평소 숨김)
  const sh = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffffff, opacity: 0.9, transparent: true, depthWrite: false }))
  sh.center.set(0, 0.5)
  sh.position.set(-width / 2 + 0.05, 0, 0.02)
  sh.scale.set(0.001, 0.24, 1)
  sh.visible = false
  g.add(bg, fg, sh)
  g.userData = { fg, sh, width: width - 0.1, fgLeft: -width / 2 + 0.05, segMaxHp: -1, segs: [] }
  return g
}

function setHpBar(bar, frac) {
  bar.userData.fg.scale.x = Math.max(0.001, bar.userData.width * Math.max(0, Math.min(1, frac)))
}

// 체력바 위 보호막 표시: 남은 체력 끝에서 흰 막대를 오른쪽으로 덧그린다(바 끝까지만).
function setHpBarShield(bar, hpFrac, shFrac) {
  const u = bar.userData
  const sh = u.sh
  if (!sh) return
  const hp = Math.max(0, Math.min(1, hpFrac))
  const w = Math.min(Math.max(0, shFrac), 1 - hp) * u.width
  if (w <= 0.002) { sh.visible = false; return }
  sh.visible = true
  sh.scale.x = w
  sh.position.x = u.fgLeft + hp * u.width
}

// 체력바를 100단위로 칸 나눠 표시한다 — 칸(눈금)이 많을수록 최대 체력이 큰 캐릭터.
//  maxHp가 바뀔 때만(레벨업/아이템) 눈금을 다시 그린다.
const HP_PER_SEG = 100
function setHpBarSegments(bar, maxHp) {
  const u = bar.userData
  if (u.segMaxHp === maxHp) return
  u.segMaxHp = maxHp
  for (const s of u.segs) bar.remove(s)
  u.segs.length = 0
  const n = Math.floor(maxHp / HP_PER_SEG)
  for (let i = 1; i <= n; i++) {
    const frac = (i * HP_PER_SEG) / maxHp
    if (frac >= 1) break // 마지막 칸 경계(=바 끝)는 그리지 않는다
    const tick = new THREE.Sprite(
      new THREE.SpriteMaterial({ color: 0x101626, opacity: 0.92, transparent: true, depthWrite: false })
    )
    tick.center.set(0.5, 0.5)
    tick.scale.set(0.05, 0.24, 1)
    tick.position.set(u.fgLeft + frac * u.width, 0, 0.01) // 색 막대 위에 살짝 띄워 칸 구분선
    bar.add(tick)
    u.segs.push(tick)
  }
}

// 발밑 그림자: 유닛을 바닥에 붙여 보이게 하는 부드러운 어두운 원판
function blobShadow(r) {
  const m = new THREE.Mesh(
    new THREE.CircleGeometry(r, 20),
    new THREE.MeshBasicMaterial({ color: 0x0a1020, transparent: true, opacity: 0.26, depthWrite: false })
  )
  m.rotation.x = -Math.PI / 2
  m.position.y = 0.06
  return m
}

// 팀 색을 어둡게 (장식 트림/투구용)
function darken(hex, f = 0.6) {
  return new THREE.Color(hex).multiplyScalar(f).getHex()
}

// 두 점 A→B를 잇는 원통(팔·다리 연결용). 기본 원통은 Y축이라 방향에 맞춰 세운다.
function limbBetween(a, b, r0, r1, mat) {
  const dir = new THREE.Vector3().subVectors(b, a)
  const len = dir.length() || 0.001
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, len, 8), mat)
  m.position.copy(a).addScaledVector(dir, 0.5)
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.multiplyScalar(1 / len))
  return m
}

// 시드 고정 난수 (장식 나무 배치가 모든 기기에서 동일하게)
function lcg(seed) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

// ── 절차적 캔버스 텍스처 (단색 평면 대신 얼룩덜룩한 디테일을 입힌다) ──
// 잔디밭: 톤이 다른 풀 얼룩 + 가는 풀결으로 단조로움을 없앤다
function grassTexture(size = 512) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#69b85e'
  ctx.fillRect(0, 0, size, size)
  const rnd = lcg(1337)
  const tones = ['#5fa854', '#74c266', '#62ad58', '#7cc96e', '#5aa251', '#83cf73']
  for (let i = 0; i < 1500; i++) {
    ctx.fillStyle = tones[(rnd() * tones.length) | 0]
    ctx.globalAlpha = 0.14 + rnd() * 0.22
    ctx.beginPath()
    ctx.arc(rnd() * size, rnd() * size, 5 + rnd() * 26, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 0.22
  ctx.strokeStyle = '#4f9447'
  ctx.lineWidth = 1
  for (let i = 0; i < 1000; i++) {
    const x = rnd() * size
    const y = rnd() * size
    const h = 3 + rnd() * 7
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + (rnd() - 0.5) * 3, y - h)
    ctx.stroke()
  }
  ctx.globalAlpha = 1
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

// 강물: 가로 그라데이션 + 물결 하이라이트 (offset을 굴려 흐르게 만든다)
function waterTexture(size = 256) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')
  const g = ctx.createLinearGradient(0, 0, size, 0)
  g.addColorStop(0, '#4fa9d6')
  g.addColorStop(0.5, '#8ad6f2')
  g.addColorStop(1, '#4fa9d6')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  const rnd = lcg(909)
  ctx.lineWidth = 2
  for (let i = 0; i < 30; i++) {
    ctx.strokeStyle = `rgba(255,255,255,${0.12 + rnd() * 0.25})`
    const y = rnd() * size
    ctx.beginPath()
    ctx.moveTo(0, y)
    for (let x = 0; x <= size; x += 14) {
      ctx.lineTo(x, y + Math.sin((x / size) * Math.PI * 4 + i) * 4)
    }
    ctx.stroke()
  }
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

// 흙길: 모래·자갈 얼룩이 섞인 길바닥 텍스처
function laneTexture(size = 128) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#d9c79a'
  ctx.fillRect(0, 0, size, size)
  const rnd = lcg(555)
  const tones = ['#cdb98a', '#e3d3a8', '#c7b282', '#d2c191', '#bda674']
  for (let i = 0; i < 320; i++) {
    ctx.fillStyle = tones[(rnd() * tones.length) | 0]
    ctx.globalAlpha = 0.45
    ctx.beginPath()
    ctx.arc(rnd() * size, rnd() * size, 1.5 + rnd() * 6, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

// 인스턴싱 산포: 작은 장식(풀포기/꽃/자갈)을 한 번의 드로우콜로 흩뿌린다
const _scatterDummy = new THREE.Object3D()
const _scatterColor = new THREE.Color()
function makeScatter(geo, mat, items) {
  const mesh = new THREE.InstancedMesh(geo, mat, items.length)
  for (let i = 0; i < items.length; i++) {
    const p = items[i]
    _scatterDummy.position.set(p.x, p.y || 0, p.z)
    _scatterDummy.rotation.set(p.rx || 0, p.ry || 0, p.rz || 0)
    _scatterDummy.scale.setScalar(p.s || 1)
    _scatterDummy.updateMatrix()
    mesh.setMatrixAt(i, _scatterDummy.matrix)
    if (p.color != null) mesh.setColorAt(i, _scatterColor.set(p.color))
  }
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  mesh.frustumCulled = false // 인스턴스가 맵 전체에 퍼져 있어 컬링하면 사라질 수 있다
  return mesh
}

// ── 정적 장식 병합기 ──
// 안 움직이는 장식(나무·바위)을 셰이딩별(flat/smooth) 한 덩이로 병합해 드로우콜을 확 줄인다.
//  색은 각 메시의 머티리얼 색을 정점색(vertex color)으로 구워 넣고, 텍스처 없는 로우폴리라
//  uv는 버려 어트리뷰트를 통일한다(병합 조건). 전부 non-indexed로 맞춰 인덱스 유무 불일치를 피한다.
//  Lambert + 정점색은 단색 머티리얼과 픽셀 단위로 동일한 음영을 낸다.
function makeStaticMerger() {
  const buckets = { flat: [], smooth: [] }
  const _c = new THREE.Color()
  function addMesh(mesh) {
    mesh.updateWorldMatrix(true, false) // 씬에 안 올린 메시라 월드행렬을 직접 갱신
    const src = mesh.geometry
    const g = src.index ? src.toNonIndexed() : src.clone()
    g.applyMatrix4(mesh.matrixWorld) // 위치·회전·스케일을 정점에 굽는다(법선도 함께 변환)
    if (g.hasAttribute('uv')) g.deleteAttribute('uv')
    if (!g.hasAttribute('normal')) g.computeVertexNormals()
    const n = g.attributes.position.count
    _c.set(mesh.material.color)
    const col = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      col[i * 3] = _c.r
      col[i * 3 + 1] = _c.g
      col[i * 3 + 2] = _c.b
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3))
    ;(mesh.material.flatShading ? buckets.flat : buckets.smooth).push(g)
  }
  function addGroup(group) {
    group.traverse((o) => { if (o.isMesh) addMesh(o) })
  }
  function build(scene) {
    for (const key of ['flat', 'smooth']) {
      const geos = buckets[key]
      if (!geos.length) continue
      const merged = mergeGeometries(geos, false)
      for (const g of geos) g.dispose()
      merged.computeBoundingSphere()
      scene.add(new THREE.Mesh(
        merged,
        new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: key === 'flat' })
      ))
      buckets[key] = []
    }
  }
  return { addMesh, addGroup, build }
}

// 레인 리본: 경유지를 따라 일정 폭의 길을 깐다 (map을 주면 흙길 텍스처를 입힌다)
function buildLane(wps, width, color, y = 0.03, map = null) {
  const pos = []
  const uv = []
  const idx = []
  let dist = 0
  for (let i = 0; i < wps.length; i++) {
    if (i > 0) dist += Math.hypot(wps[i].x - wps[i - 1].x, wps[i].z - wps[i - 1].z)
    const prev = wps[Math.max(0, i - 1)]
    const next = wps[Math.min(wps.length - 1, i + 1)]
    let dx = next.x - prev.x
    let dz = next.z - prev.z
    const d = Math.hypot(dx, dz) || 1
    const nx = -dz / d
    const nz = dx / d
    pos.push(wps[i].x + nx * width, y, wps[i].z + nz * width)
    pos.push(wps[i].x - nx * width, y, wps[i].z - nz * width)
    const u = dist / 12
    uv.push(u, 0, u, 1)
    if (i > 0) {
      const a = (i - 1) * 2
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  const mat = map
    ? new THREE.MeshLambertMaterial({ map, side: THREE.DoubleSide })
    : new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide })
  return new THREE.Mesh(geo, mat)
}

function buildTower(team) {
  const g = new THREE.Group()
  const col = TEAM_COLOR[team]
  const stoneMat = new THREE.MeshLambertMaterial({ color: 0x8d99b5 })
  const stoneDark = new THREE.MeshLambertMaterial({ color: 0x6f7a93 })
  // body = 살아있을 때 보이는 석조 구조물 묶음 (파괴되면 통째로 숨긴다)
  const body = new THREE.Group()
  const base = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.0, 1.6, 10), stoneDark)
  base.position.y = 0.8
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 2.3, 5.2, 10), stoneMat)
  shaft.position.y = 4.0
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 1.9, 0.8, 10), stoneDark)
  cap.position.y = 6.9
  body.add(base, shaft, cap)
  // 흉벽 톱니
  const merlonN = 8
  for (let i = 0; i < merlonN; i++) {
    const a = (i / merlonN) * Math.PI * 2
    const mer = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.9, 0.7), stoneDark)
    mer.position.set(Math.cos(a) * 1.95, 7.6, Math.sin(a) * 1.95)
    mer.rotation.y = -a
    body.add(mer)
  }
  // 팀 깃발 (양옆)
  for (const sz of [1, -1]) {
    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(1.3, 1.0),
      new THREE.MeshLambertMaterial({ color: col, side: THREE.DoubleSide })
    )
    banner.position.set(0, 5.6, sz * 2.4)
    body.add(banner)
  }
  const crystal = new THREE.Mesh(
    new THREE.OctahedronGeometry(1.5),
    new THREE.MeshLambertMaterial({ color: col, emissive: col, emissiveIntensity: 0.45 })
  )
  crystal.position.y = 8.7
  g.add(body, crystal)
  const rubble = new THREE.Mesh(
    new THREE.CylinderGeometry(2.2, 2.5, 1.2, 8),
    new THREE.MeshLambertMaterial({ color: 0x5d6679 })
  )
  rubble.position.y = 0.6
  rubble.visible = false
  g.add(rubble)
  const bar = makeHpBar(4, col)
  bar.position.y = 10.8
  g.add(bar)
  // 적 타워 공격범위 경고 표시 — 가까이 가면 보인다 (붉은 원판 + 테두리)
  const range = new THREE.Group()
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(TOWER_RANGE, 40),
    new THREE.MeshBasicMaterial({ color: 0xff3b3b, transparent: true, opacity: 0.08, depthWrite: false })
  )
  disc.rotation.x = -Math.PI / 2
  disc.position.y = 0.08
  const edge = new THREE.Mesh(
    new THREE.RingGeometry(TOWER_RANGE - 0.7, TOWER_RANGE, 48),
    new THREE.MeshBasicMaterial({ color: 0xff3b3b, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false })
  )
  edge.rotation.x = -Math.PI / 2
  edge.position.y = 0.09
  range.add(disc, edge)
  range.visible = false
  g.add(range)
  const lock = lockLabel()
  lock.position.y = 11.8
  lock.visible = false
  g.add(lock)
  g.userData = { crystal, body, rubble, bar, range, disc, edge, lock }
  return g
}

function buildNexus(team) {
  const g = new THREE.Group()
  const col = TEAM_COLOR[team]
  const stone = new THREE.MeshLambertMaterial({ color: 0x768099 })
  const stoneDark = new THREE.MeshLambertMaterial({ color: 0x5b667e })
  // 3단 받침
  const base = new THREE.Mesh(new THREE.CylinderGeometry(NEXUS_RADIUS + 2, NEXUS_RADIUS + 3, 1.4, 12), stoneDark)
  base.position.y = 0.7
  const mid = new THREE.Mesh(new THREE.CylinderGeometry(NEXUS_RADIUS + 0.6, NEXUS_RADIUS + 1.6, 1.2, 12), stone)
  mid.position.y = 1.9
  const top = new THREE.Mesh(new THREE.CylinderGeometry(NEXUS_RADIUS - 0.4, NEXUS_RADIUS + 0.4, 1.0, 12), stoneDark)
  top.position.y = 2.9
  g.add(base, mid, top)
  // 바닥 광휘 링 (팀색으로 은은하게 빛난다)
  const glow = new THREE.Mesh(
    new THREE.RingGeometry(NEXUS_RADIUS + 1, NEXUS_RADIUS + 3.4, 44),
    new THREE.MeshBasicMaterial({
      color: col, transparent: true, opacity: 0.35, side: THREE.DoubleSide,
      depthWrite: false, blending: THREE.AdditiveBlending,
    })
  )
  glow.rotation.x = -Math.PI / 2
  glow.position.y = 0.09
  g.add(glow)
  // 코어를 감싸고 도는 빛의 고리 (장식)
  const ring2 = new THREE.Mesh(
    new THREE.TorusGeometry(4.4, 0.18, 8, 32),
    new THREE.MeshBasicMaterial({
      color: col, transparent: true, opacity: 0.7,
      blending: THREE.AdditiveBlending, depthWrite: false,
    })
  )
  ring2.position.y = 6.5
  ring2.rotation.x = Math.PI / 2.3
  g.add(ring2)
  // 떠 있는 코어 + 둘레를 도는 파편(코어 자식 → 회전·생사에 같이 묶인다)
  const core = new THREE.Mesh(
    new THREE.OctahedronGeometry(3.4),
    new THREE.MeshLambertMaterial({ color: col, emissive: col, emissiveIntensity: 0.5 })
  )
  core.position.y = 6.5
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2
    const shard = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.8),
      new THREE.MeshLambertMaterial({ color: col, emissive: col, emissiveIntensity: 0.6 })
    )
    shard.position.set(Math.cos(a) * 3.0, 0, Math.sin(a) * 3.0)
    core.add(shard)
  }
  const bar = makeHpBar(7, col)
  bar.position.y = 11.5
  const lock = lockLabel()
  lock.position.y = 13.5
  lock.visible = false
  g.add(core, bar, lock)
  g.userData = { core, bar, lock, ring2, glow }
  return g
}

// 직업별 몸집: 브루저·탱커는 듬직하게, 마법사·암살자 계열은 날렵하게 — 실루엣 1차 구분
export const CLS_SCALE = {
  tank: 1.25, gladiator: 1.18, guardian: 1.12, warrior: 1.1, catcher: 1.1,
  beastmaster: 1.08, swordmaster: 1.0, engineer: 1.0, snarer: 1.0,
  archer: 0.95, healer: 0.95, mage: 0.95, warlock: 0.95, cryomancer: 0.95, chronomancer: 0.95,
  windcaller: 0.92, assassin: 0.9,
  terramancer: 1.15, fearmonger: 0.95, illusionist: 0.9,
}

const ATK_ANIM_T = 0.35 // 공격 모션 길이 (초)

// 직업별 몸 파츠(어깨·등 장식) — 무기와 함께 실루엣만으로 직업이 읽히게 한다.
// 전부 몸통(body)의 "정적" 자식: 프레임별 갱신이 없고 바라보는 방향/까딱임과 함께 움직인다.
// 팀 식별색은 몸통 캡슐이 유지하고, 파츠는 직업 고유색 포인트만 얹는다. 로컬 +x = 정면, -x = 등.
// 주의: 얼굴 이모지 스프라이트(y≈4.4s)와 겹치지 않게 파츠 상단은 로컬 y 2.0s 아래로 유지한다.
export function buildClassParts(cls, s, body) {
  const metal = new THREE.MeshLambertMaterial({ color: 0xc9d2e0 })
  const dark = new THREE.MeshLambertMaterial({ color: 0x3c4358 })
  const wood = new THREE.MeshLambertMaterial({ color: 0x8a6242 })
  const glow = (color, intensity = 0.5) =>
    new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: intensity })
  if (cls === 'warrior') {
    // 뿔 달린 견갑 — 양어깨 스파이크
    for (const sz of [1, -1]) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.2 * s, 0.7 * s, 6), metal)
      spike.position.set(0, 1.5 * s, sz * 1.1 * s)
      spike.rotation.x = sz * 0.55
      body.add(spike)
    }
  } else if (cls === 'archer') {
    // 등에 비스듬한 화살통 + 삐져나온 화살 깃
    const quiver = new THREE.Mesh(new THREE.CylinderGeometry(0.28 * s, 0.32 * s, 1.4 * s, 8), wood)
    quiver.position.set(-0.8 * s, 0.7 * s, -0.35 * s)
    quiver.rotation.x = -0.35
    body.add(quiver)
    const feather = new THREE.MeshLambertMaterial({ color: 0xff8f5a })
    for (const dz of [-0.14, 0.12]) {
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.1 * s, 0.38 * s, 4), feather)
      f.position.set(-0.8 * s, 1.55 * s, (dz - 0.35 * 0.5) * s)
      body.add(f)
    }
  } else if (cls === 'mage') {
    // 등 뒤에 떠 있는 룬 구슬 3개 — 마력의 흔적
    const rune = glow(0xb07ef0, 0.65)
    for (const [dy, dz] of [[1.3, 0], [0.9, 0.55], [0.9, -0.55]]) {
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.17 * s, 8, 6), rune)
      orb.position.set(-1.15 * s, dy * s, dz * s)
      body.add(orb)
    }
  } else if (cls === 'healer') {
    // 등 뒤 연둣빛 광륜
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.62 * s, 0.09 * s, 8, 20), glow(0x6ee7a0, 0.6))
    halo.rotation.y = Math.PI / 2
    halo.position.set(-1.05 * s, 1.15 * s, 0)
    body.add(halo)
  } else if (cls === 'assassin') {
    // 등에 교차한 쌍단검 (X자)
    for (const dir of [1, -1]) {
      const sheath = new THREE.Mesh(new THREE.BoxGeometry(0.1 * s, 1.15 * s, 0.2 * s), dark)
      sheath.rotation.x = dir * 0.7
      sheath.position.set(-1.0 * s, 0.95 * s, 0)
      body.add(sheath)
      const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.11 * s, 6, 5), metal)
      pommel.position.set(-1.0 * s, (0.95 + 0.62 * Math.cos(0.7)) * s, dir * 0.62 * Math.sin(0.7) * s)
      body.add(pommel)
    }
  } else if (cls === 'tank') {
    // 대형 사각 파울드론 + 등에 원형 방패
    for (const sz of [1, -1]) {
      const pauldron = new THREE.Mesh(new THREE.BoxGeometry(0.85 * s, 0.4 * s, 0.6 * s), metal)
      pauldron.position.set(0, 1.42 * s, sz * 1.05 * s)
      pauldron.rotation.x = sz * 0.18
      body.add(pauldron)
    }
    const backShield = new THREE.Mesh(new THREE.CylinderGeometry(0.75 * s, 0.75 * s, 0.12 * s, 14), dark)
    backShield.rotation.z = Math.PI / 2
    backShield.position.set(-1.05 * s, 0.6 * s, 0)
    body.add(backShield)
  } else if (cls === 'cryomancer') {
    // 어깨의 얼음 결정들
    const ice = glow(0x8fdcff, 0.55)
    for (const [sz, sc] of [[1, 1], [-1, 0.7]]) {
      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.32 * s * sc), ice)
      crystal.position.set(0, 1.45 * s, sz * 1.0 * s)
      crystal.rotation.z = sz * 0.3
      body.add(crystal)
    }
  } else if (cls === 'gladiator') {
    // 한쪽 어깨만 가시 돋친 대형 견갑 — 비대칭 실루엣
    const pauldron = new THREE.Mesh(new THREE.SphereGeometry(0.72 * s, 10, 8), dark)
    pauldron.scale.y = 0.75
    pauldron.position.set(0, 1.4 * s, 1.0 * s)
    body.add(pauldron)
    for (const a of [-0.5, 0, 0.5]) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.12 * s, 0.45 * s, 5), metal)
      spike.position.set(Math.sin(a) * 0.5 * s, 1.85 * s, (1.0 + Math.abs(a) * 0.2) * s)
      spike.rotation.z = -a
      body.add(spike)
    }
  } else if (cls === 'warlock') {
    // 굽은 어깨 뿔 한 쌍 — 저주받은 실루엣
    const horn = new THREE.MeshLambertMaterial({ color: 0x4a3f66 })
    for (const sz of [1, -1]) {
      const base = new THREE.Mesh(new THREE.ConeGeometry(0.18 * s, 0.85 * s, 6), horn)
      base.position.set(-0.15 * s, 1.55 * s, sz * 1.05 * s)
      base.rotation.x = sz * 0.9
      body.add(base)
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.09 * s, 6, 5), glow(0x9ad06a, 0.7))
      tip.position.set(-0.15 * s, 1.9 * s, sz * 1.45 * s)
      body.add(tip)
    }
  } else if (cls === 'guardian') {
    // 등 뒤 금색 광륜 — 수호의 상징 (힐러의 연둣빛과 색으로 구분)
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.68 * s, 0.1 * s, 8, 20), glow(0xffdf8a, 0.55))
    halo.rotation.y = Math.PI / 2
    halo.position.set(-1.05 * s, 1.2 * s, 0)
    body.add(halo)
  } else if (cls === 'swordmaster') {
    // 등에 멘 긴 칼집 + 금장 매듭
    const sheath = new THREE.Mesh(new THREE.BoxGeometry(0.14 * s, 1.9 * s, 0.26 * s), dark)
    sheath.rotation.x = 0.6
    sheath.position.set(-1.0 * s, 0.7 * s, 0.1 * s)
    body.add(sheath)
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.18 * s, 0.16 * s, 0.3 * s), glow(0xffe8a8, 0.35))
    band.rotation.x = 0.6
    band.position.set(-1.0 * s, 1.35 * s, 0.55 * s)
    body.add(band)
  } else if (cls === 'catcher') {
    // 몸에 비스듬히 두른 사슬
    const chain = new THREE.Mesh(new THREE.TorusGeometry(1.12 * s, 0.11 * s, 6, 18), metal)
    chain.rotation.x = Math.PI / 2
    chain.rotation.z = 0.5
    chain.position.y = 0.35 * s
    body.add(chain)
  } else if (cls === 'beastmaster') {
    // 어깨에 두른 모피 + 목의 발톱 장식
    const fur = new THREE.MeshLambertMaterial({ color: 0x7a5a3a })
    for (const sz of [1, -1]) {
      const pelt = new THREE.Mesh(new THREE.SphereGeometry(0.62 * s, 8, 6), fur)
      pelt.scale.set(0.8, 0.55, 1)
      pelt.position.set(-0.15 * s, 1.4 * s, sz * 0.95 * s)
      body.add(pelt)
    }
    const claw = new THREE.Mesh(new THREE.ConeGeometry(0.1 * s, 0.4 * s, 5), new THREE.MeshLambertMaterial({ color: 0xf0e6d0 }))
    claw.position.set(0.95 * s, 0.85 * s, 0)
    claw.rotation.z = Math.PI // 아래로 향한 발톱 목걸이
    body.add(claw)
  } else if (cls === 'engineer') {
    // 등의 공구 배낭 + 안테나 불빛
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.55 * s, 1.0 * s, 0.9 * s), new THREE.MeshLambertMaterial({ color: 0x6a5a40 }))
    pack.position.set(-1.05 * s, 0.55 * s, 0)
    body.add(pack)
    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.035 * s, 0.035 * s, 0.9 * s), metal)
    antenna.position.set(-1.05 * s, 1.5 * s, -0.25 * s)
    body.add(antenna)
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.1 * s, 6, 5), glow(0xffcf4d, 0.8))
    bulb.position.set(-1.05 * s, 1.95 * s, -0.25 * s)
    body.add(bulb)
  } else if (cls === 'snarer') {
    // 어깨를 감은 넝쿨과 잎
    const vine = new THREE.MeshLambertMaterial({ color: 0x5aa34a })
    const wrap = new THREE.Mesh(new THREE.TorusGeometry(0.95 * s, 0.09 * s, 6, 16), vine)
    wrap.rotation.x = Math.PI / 2
    wrap.rotation.z = -0.35
    wrap.position.y = 0.9 * s
    body.add(wrap)
    const leafMat = new THREE.MeshLambertMaterial({ color: 0x8fd06a })
    for (const [dy, dz, rot] of [[1.25, 0.85, 0.5], [1.1, -0.9, -0.7]]) {
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.14 * s, 0.5 * s, 4), leafMat)
      leaf.position.set(-0.2 * s, dy * s, dz * s)
      leaf.rotation.x = rot
      body.add(leaf)
    }
  } else if (cls === 'windcaller') {
    // 등 뒤 바람 깃털 세 갈래
    const featherMat = glow(0xd6f0ff, 0.35)
    for (const [dz, rot] of [[-0.5, -0.4], [0, 0], [0.5, 0.4]]) {
      const plume = new THREE.Mesh(new THREE.ConeGeometry(0.13 * s, 0.9 * s, 4), featherMat)
      plume.position.set(-1.05 * s, 1.3 * s, dz * s)
      plume.rotation.x = rot
      plume.scale.z = 0.4 // 납작한 깃털
      body.add(plume)
    }
  } else if (cls === 'chronomancer') {
    // 등 뒤 시계 링 + 시침 — 시간의 고리
    const ringPart = new THREE.Mesh(new THREE.TorusGeometry(0.66 * s, 0.08 * s, 8, 20), glow(0x7ac0ff, 0.55))
    ringPart.rotation.y = Math.PI / 2
    ringPart.position.set(-1.05 * s, 1.15 * s, 0)
    body.add(ringPart)
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.05 * s, 0.5 * s, 0.06 * s), metal)
    hand.position.set(-1.05 * s, 1.3 * s, 0)
    hand.rotation.x = 0.6
    body.add(hand)
  } else if (cls === 'fearmonger') {
    // 어깨 위를 떠도는 창백한 혼불 한 쌍
    const soul = glow(0x9fc8e8, 0.7)
    for (const [dy, dz] of [[1.5, 0.85], [1.3, -0.95]]) {
      const wisp = new THREE.Mesh(new THREE.SphereGeometry(0.2 * s, 7, 6), soul)
      wisp.position.set(-0.5 * s, dy * s, dz * s)
      body.add(wisp)
    }
  } else if (cls === 'illusionist') {
    // 뒤통수의 하얀 가면 — 앞뒤 어느 쪽이 진짜 얼굴인가
    const mask = new THREE.Mesh(new THREE.SphereGeometry(0.55 * s, 9, 7), new THREE.MeshLambertMaterial({ color: 0xf0ead8 }))
    mask.scale.set(0.35, 1, 0.8)
    mask.position.set(-1.0 * s, 1.15 * s, 0)
    body.add(mask)
    const eyeMat = new THREE.MeshLambertMaterial({ color: 0x3a3550 })
    for (const dz of [0.2, -0.2]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.08 * s, 5, 4), eyeMat)
      eye.position.set(-1.18 * s, 1.25 * s, dz * s)
      body.add(eye)
    }
  } else if (cls === 'terramancer') {
    // 어깨의 바위 덩어리 + 등에 떠 있는 잔돌
    const stone = new THREE.MeshLambertMaterial({ color: 0x9a8f7c, flatShading: true })
    for (const sz of [1, -1]) {
      const chunk = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42 * s, 0), stone)
      chunk.position.set(0, 1.4 * s, sz * 1.05 * s)
      chunk.rotation.set(sz, sz * 2, 0)
      body.add(chunk)
    }
    const pebble = new THREE.Mesh(new THREE.IcosahedronGeometry(0.18 * s, 0), stone)
    pebble.position.set(-1.1 * s, 1.6 * s, 0)
    body.add(pebble)
  }
  // 그 외 직업은 파츠 없음 — 무기와 몸집만으로 구분
}

// 직업별 무기: 몸통(바라보는 방향으로 회전하는 메시)에 붙어 함께 돈다.
// userData.pose(t)로 공격 모션 진행도(0→1)를 그린다. 로컬 +x = 정면.
function buildWeapon(cls) {
  const g = new THREE.Group()
  const metal = new THREE.MeshLambertMaterial({ color: 0xd9dee8 })
  const wood = new THREE.MeshLambertMaterial({ color: 0x8a6242 })
  const swing = (t) => Math.sin(Math.min(1, t) * Math.PI) // 0→1→0 펄스
  if (cls === 'warrior') {
    // 검: 크게 휘두른다
    const blade = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.1, 0.3), metal)
    blade.position.x = 1.2
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.2, 0.7), wood)
    guard.position.x = 0.35
    g.add(blade, guard)
    g.position.set(0.3, 0.3, 0.9)
    g.userData.pose = (t) => {
      g.rotation.y = 1.1 - swing(t) * 2.2 // 바깥→안쪽으로 베기
      g.rotation.z = swing(t) * 0.4
    }
  } else if (cls === 'assassin') {
    // 쌍단검: 빠른 찌르기
    for (const side of [0.55, -0.55]) {
      const dagger = new THREE.Mesh(new THREE.ConeGeometry(0.12, 1.0, 5), metal)
      dagger.rotation.z = -Math.PI / 2 // 칼끝이 +x(정면)
      dagger.position.set(0.6, 0.2, side)
      g.add(dagger)
    }
    g.userData.pose = (t) => {
      g.position.x = swing(t) * 0.9 // 푹!
    }
  } else if (cls === 'tank') {
    // 망치: 내려찍기
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.7), wood)
    handle.position.y = 0.5
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.45, 0.8), metal)
    head.position.y = 1.4
    g.add(handle, head)
    g.position.set(0.5, 0.2, 0.95)
    g.userData.pose = (t) => {
      g.rotation.z = 0.45 - swing(t) * 1.6 // 번쩍 들었다 쾅!
    }
  } else if (cls === 'archer') {
    // 활: 시위를 당겼다 놓는다
    const bow = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.07, 6, 14, Math.PI), wood)
    bow.rotation.z = -Math.PI / 2 // 활이 정면을 향한 반원
    bow.rotation.y = Math.PI / 2
    const string = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.7, 0.04), metal)
    g.add(bow, string)
    g.position.set(1.0, 0.4, 0)
    g.userData.pose = (t) => {
      string.position.x = -swing(t) * 0.5 // 시위 당김
      g.position.x = 1.0 - swing(t) * 0.25 // 반동
    }
  } else if (cls === 'swordmaster') {
    // 카타나: 가늘고 긴 검 — 번개같은 횡베기
    const blade = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.08, 0.16), new THREE.MeshLambertMaterial({ color: 0xeef2f8 }))
    blade.position.x = 1.3
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.42, 4), metal)
    tip.rotation.z = -Math.PI / 2
    tip.position.x = 2.45
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 0.5), wood)
    guard.position.x = 0.28
    g.add(blade, tip, guard)
    g.position.set(0.32, 0.32, 0.85)
    g.userData.pose = (t) => {
      g.rotation.y = 0.9 - swing(t) * 2.6 // 빠른 횡베기
    }
  } else if (cls === 'gladiator') {
    // 전투도끼: 묵직하게 휘두른다
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.8), wood)
    handle.position.y = 0.4
    const bit = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.72, 0.14), metal) // 도끼날
    bit.position.set(0.3, 1.2, 0)
    const edge = new THREE.Mesh(new THREE.ConeGeometry(0.36, 0.5, 3), metal)
    edge.rotation.z = -Math.PI / 2
    edge.position.set(0.62, 1.2, 0)
    g.add(handle, bit, edge)
    g.position.set(0.4, 0.2, 0.92)
    g.userData.pose = (t) => {
      g.rotation.z = 0.5 - swing(t) * 1.5
      g.rotation.y = swing(t) * 0.6
    }
  } else if (cls === 'catcher') {
    // 사슬 갈고리: 앞으로 휙 던진다
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.7), wood)
    shaft.rotation.z = Math.PI / 2
    shaft.position.x = 0.4
    const hook = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.07, 6, 10, Math.PI * 1.4), metal)
    hook.position.x = 1.0
    hook.rotation.y = Math.PI / 2
    g.add(shaft, hook)
    g.position.set(0.5, 0.45, 0.5)
    g.userData.pose = (t) => {
      g.position.x = 0.5 + swing(t) * 1.7 // 던졌다 회수
    }
  } else if (cls === 'beastmaster') {
    // 사냥 창: 찌른다
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.3), wood)
    shaft.rotation.z = Math.PI / 2
    shaft.position.x = 0.9
    const tipM = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.52, 6), metal)
    tipM.rotation.z = -Math.PI / 2
    tipM.position.x = 2.1
    g.add(shaft, tipM)
    g.position.set(0.2, 0.5, 0.4)
    g.userData.pose = (t) => {
      g.position.x = 0.2 + swing(t) * 1.0 // 찌르기
    }
  } else if (cls === 'engineer') {
    // 렌치(스패너): 비틀어 조인다
    const handle = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.16, 0.16), metal)
    handle.position.x = 0.8
    const jaw1 = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.52, 0.18), metal)
    jaw1.position.set(1.5, 0.2, 0)
    const jaw2 = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.3, 0.18), metal)
    jaw2.position.set(1.5, -0.2, 0)
    g.add(handle, jaw1, jaw2)
    g.position.set(0.3, 0.5, 0.6)
    g.userData.pose = (t) => {
      g.rotation.z = swing(t) * 0.9 // 비틀기
    }
  } else if (cls === 'guardian') {
    // 방패 + 짧은 철퇴 (보호막 인챈터)
    const shieldMat = new THREE.MeshLambertMaterial({ color: 0xbfcadb, emissive: 0x2a3550, emissiveIntensity: 0.3 })
    const shield = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.14, 16), shieldMat)
    shield.rotation.z = Math.PI / 2
    shield.position.set(0.55, 0.6, 0.35)
    const boss = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshLambertMaterial({ color: 0xffe8a8 }))
    boss.position.set(0.64, 0.6, 0.35)
    const mace = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.0), wood)
    mace.position.set(0.3, 0.5, -0.35)
    const macehead = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), metal)
    macehead.position.set(0.3, 1.0, -0.35)
    g.add(shield, boss, mace, macehead)
    g.position.set(0.2, 0.4, 0)
    g.userData.pose = (t) => {
      g.position.z = swing(t) * 0.3 // 방패를 들어 막기
      shieldMat.emissiveIntensity = 0.3 + swing(t) * 0.8
    }
  } else if (cls === 'cryomancer') {
    // 얼음 지팡이: 결정 끝의 한기
    const ice = 0x8fdcff
    const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 2.1), new THREE.MeshLambertMaterial({ color: 0x6a7a90 }))
    staff.position.y = 0.3
    const crystal = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.34),
      new THREE.MeshLambertMaterial({ color: ice, emissive: ice, emissiveIntensity: 0.5 })
    )
    crystal.position.y = 1.55
    g.add(staff, crystal)
    g.position.set(0.4, 0.2, 0.9)
    g.userData.pose = (t) => {
      const s = swing(t)
      g.rotation.z = -s * 0.8
      crystal.rotation.y += 0.1
      crystal.material.emissiveIntensity = 0.5 + s * 1.8
      crystal.scale.setScalar(1 + s * 0.6)
    }
  } else if (cls === 'warlock') {
    // 저주의 낫 지팡이: 병독빛 구슬 + 굽은 날
    const poison = 0x9ad06a
    const dark = new THREE.MeshLambertMaterial({ color: 0x3a3550 })
    const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 2.2), dark)
    staff.position.y = 0.3
    const orb = new THREE.Mesh(
      new THREE.SphereGeometry(0.26, 10, 8),
      new THREE.MeshLambertMaterial({ color: poison, emissive: poison, emissiveIntensity: 0.6 })
    )
    orb.position.y = 1.5
    const blade = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.06, 6, 10, Math.PI), new THREE.MeshLambertMaterial({ color: 0xbfc6d4 }))
    blade.position.y = 1.45
    blade.rotation.z = Math.PI / 2
    g.add(staff, orb, blade)
    g.position.set(0.4, 0.2, 0.9)
    g.userData.pose = (t) => {
      const s = swing(t)
      g.rotation.z = -s * 0.7
      orb.material.emissiveIntensity = 0.6 + s * 1.6
      orb.scale.setScalar(1 + s * 0.5)
    }
  } else if (cls === 'windcaller') {
    // 바람 부채: 휘둘러 강풍을 일으킨다
    const wind = 0xd6f0ff
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.7), wood)
    handle.position.y = -0.1
    const fan = new THREE.Mesh(
      new THREE.CircleGeometry(0.7, 16, 0, Math.PI * 0.9),
      new THREE.MeshLambertMaterial({ color: wind, emissive: wind, emissiveIntensity: 0.4, side: THREE.DoubleSide })
    )
    fan.position.y = 0.5
    fan.rotation.x = -Math.PI / 2
    g.add(handle, fan)
    g.position.set(0.4, 0.4, 0.85)
    g.userData.pose = (t) => {
      const s = swing(t)
      g.rotation.y = 1.0 - s * 2.0 // 부채를 크게 휘둘러 바람을 가른다
      fan.material.emissiveIntensity = 0.4 + s * 1.4
    }
  } else if (cls === 'chronomancer') {
    // 모래시계 지팡이: 시간을 비튼다
    const sand = 0x7ac0ff
    const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 2.0), new THREE.MeshLambertMaterial({ color: 0x4a5570 }))
    staff.position.y = 0.25
    const glassMat = new THREE.MeshLambertMaterial({ color: sand, emissive: sand, emissiveIntensity: 0.5 })
    const top = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.4, 8), glassMat)
    top.position.y = 1.65
    const bot = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.4, 8), glassMat)
    bot.position.y = 1.3
    bot.rotation.z = Math.PI // 아래로 향한 깔때기 → 모래시계
    g.add(staff, top, bot)
    g.position.set(0.4, 0.2, 0.9)
    g.userData.pose = (t) => {
      const s = swing(t)
      g.rotation.z = -s * 0.6
      top.material.emissiveIntensity = 0.5 + s * 1.6
      top.rotation.y += 0.15 // 모래시계가 빙글 — 시간이 도는 느낌
      bot.rotation.y = top.rotation.y
    }
  } else if (cls === 'snarer') {
    // 넝쿨 올가미: 앞으로 던졌다 회수하는 초록 덩굴 고리
    const vine = new THREE.MeshLambertMaterial({ color: 0x5aa34a })
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.8), vine)
    shaft.rotation.z = Math.PI / 2
    shaft.position.x = 0.4
    const loop = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.07, 6, 14), vine)
    loop.position.x = 1.0
    loop.rotation.y = Math.PI / 2
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.34, 4), new THREE.MeshLambertMaterial({ color: 0x8fd06a }))
    leaf.position.set(0.6, 0.14, 0)
    leaf.rotation.z = -Math.PI / 3
    g.add(shaft, loop, leaf)
    g.position.set(0.5, 0.45, 0.5)
    g.userData.pose = (t) => {
      g.position.x = 0.5 + swing(t) * 1.6 // 올가미를 던졌다 회수
    }
  } else if (cls === 'fearmonger') {
    // 유령 등불 지팡이: 검은 장대 끝에 창백하게 떠는 혼불
    const dark = new THREE.MeshLambertMaterial({ color: 0x2e2a44 })
    const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 2.1), dark)
    staff.position.y = 0.3
    const cage = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.05, 6, 10), dark)
    cage.position.y = 1.5
    const soul = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 8, 6),
      new THREE.MeshLambertMaterial({ color: 0xbfe8ff, emissive: 0x8ac0e8, emissiveIntensity: 0.7 })
    )
    soul.position.y = 1.5
    g.add(staff, cage, soul)
    g.position.set(0.4, 0.2, 0.9)
    g.userData.pose = (t) => {
      const s = swing(t)
      g.rotation.z = -s * 0.8
      soul.material.emissiveIntensity = 0.7 + s * 1.8
    }
  } else if (cls === 'illusionist') {
    // 쌍초승달 검: 좌우로 흩뿌리듯 교차 베기
    const blade = new THREE.MeshLambertMaterial({ color: 0xe8ddf5, emissive: 0x5a4a86, emissiveIntensity: 0.25 })
    for (const side of [0.5, -0.5]) {
      const crescent = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.09, 6, 12, Math.PI * 1.1), blade)
      crescent.rotation.x = Math.PI / 2
      crescent.position.set(0.55, 0.2, side)
      g.add(crescent)
    }
    g.userData.pose = (t) => {
      const s = swing(t)
      g.position.x = s * 0.7
      g.rotation.y = s * 1.4 // 교차 베기
    }
  } else if (cls === 'terramancer') {
    // 돌망치: 굵은 자루 + 큰 바윗덩이 — 땅을 쿵 찍는다
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 1.9), wood)
    handle.position.y = 0.45
    const rock = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.55, 0),
      new THREE.MeshLambertMaterial({ color: 0x9a8f7c, flatShading: true })
    )
    rock.position.y = 1.5
    g.add(handle, rock)
    g.position.set(0.5, 0.2, 0.95)
    g.userData.pose = (t) => {
      g.rotation.z = 0.5 - swing(t) * 1.7 // 번쩍 들었다 쿵!
    }
  } else {
    // 마법사/힐러: 지팡이 + 빛나는 구슬
    const color = cls === 'healer' ? 0x6ee7a0 : 0xb07ef0
    const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 2.1), wood)
    staff.position.y = 0.3
    const orb = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 10, 8),
      new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.5 })
    )
    orb.position.y = 1.5
    g.add(staff, orb)
    g.position.set(0.4, 0.2, 0.9)
    g.userData.pose = (t) => {
      const s = swing(t)
      g.rotation.z = -s * 0.8 // 지팡이를 앞으로 겨눈다
      orb.material.emissiveIntensity = 0.5 + s * 1.6 // 구슬 번쩍!
      orb.scale.setScalar(1 + s * 0.7)
    }
  }
  g.userData.pose(1)
  return g
}

// 영웅: 팀 색 캡슐 몸통 + 12지신 이모지 얼굴 + 직업 아이콘 이름표 + 체력바
function buildHero(h, mine, barColor) {
  const g = new THREE.Group()
  const col = TEAM_COLOR[h.team]
  const s = CLS_SCALE[h.cls] || 1
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(1.1 * s, 1.4 * s, 3, 10),
    new THREE.MeshLambertMaterial({ color: col, transparent: true })
  )
  body.position.y = 2.2 * s
  // 피격 테두리: 몸 실루엣 둘레만 잠깐 빛난다(BackSide 셸) — 전신 섬광보다 덜 과하다
  const outline = new THREE.Mesh(
    body.geometry,
    new THREE.MeshBasicMaterial({
      color: 0xff6a4a, side: THREE.BackSide, transparent: true, opacity: 0, depthWrite: false,
    })
  )
  outline.scale.setScalar(1.14)
  body.add(outline)
  // 갑옷 장식 (body 자식 → 바라보는 방향과 함께 돈다)
  const accentMat = new THREE.MeshLambertMaterial({ color: darken(col, 0.55) })
  const trimMat = new THREE.MeshLambertMaterial({ color: 0xffe8a8, emissive: 0x4a3a10, emissiveIntensity: 0.25 })
  for (const sz of [1, -1]) {
    const pad = new THREE.Mesh(new THREE.SphereGeometry(0.55 * s, 8, 6), accentMat)
    pad.scale.y = 0.7
    pad.position.set(0, 1.15 * s, sz * 1.0 * s)
    body.add(pad)
  }
  const emblem = new THREE.Mesh(new THREE.SphereGeometry(0.34 * s, 8, 6), trimMat)
  emblem.scale.set(0.45, 1, 1)
  emblem.position.set(0.98 * s, 0.35 * s, 0)
  body.add(emblem)
  const belt = new THREE.Mesh(new THREE.TorusGeometry(1.05 * s, 0.16 * s, 6, 16), accentMat)
  belt.rotation.x = Math.PI / 2
  belt.position.y = -0.25 * s
  body.add(belt)
  const cape = new THREE.Mesh(
    new THREE.PlaneGeometry(1.7 * s, 2.4 * s),
    new THREE.MeshLambertMaterial({ color: darken(col, 0.5), side: THREE.DoubleSide })
  )
  cape.rotation.y = Math.PI / 2
  cape.position.set(-0.85 * s, 0.2 * s, 0)
  body.add(cape)
  buildClassParts(h.cls, s, body) // 직업별 어깨·등 파츠 — 실루엣 구분
  // 팔·다리 — 짧고 길쭉한 원통(살짝 테이퍼). 몸통 자식이라 바라보는 방향/걷기와 함께 움직인다.
  const limbMat = new THREE.MeshLambertMaterial({ color: darken(col, 0.7) })
  // 다리: 고관절 피벗 그룹으로 감싸 걸을 때 앞뒤로 엇갈려 흔든다(legs[0]=오른쪽 +z, [1]=왼쪽 -z)
  const legs = []
  for (const sz of [1, -1]) {
    const hip = new THREE.Group()
    hip.position.set(0, -0.775 * s, sz * 0.42 * s) // 고관절 위치(다리 윗끝)
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.3 * s, 0.24 * s, 1.35 * s, 8), limbMat)
    leg.position.y = -0.675 * s // 다리 중심을 고관절 아래로 내려 다리가 밑으로 뻗는다
    hip.add(leg)
    body.add(hip)
    legs.push(hip)
  }
  // 왼팔(무기 없는 쪽) — 어깨 피벗 그룹. 걸을 때 앞뒤로 흔든다. 오른팔은 아래에서 무기와 함께 만든다.
  const armL = new THREE.Group()
  armL.position.set(0.05 * s, 0.95 * s, -1.0 * s) // 왼쪽 어깨
  const armLMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.22 * s, 0.17 * s, 1.2 * s, 8), limbMat)
  armLMesh.position.y = -0.6 * s // 어깨에서 아래로 늘어뜨림
  armLMesh.rotation.x = -0.12
  armL.add(armLMesh)
  body.add(armL)
  const shadow = blobShadow(2.0 * s)
  const face = emojiSprite(getZodiac(h.zodiacId)?.emoji || '🙂', 3.2)
  face.position.y = 4.4 * s
  const nameColor = mine ? '#ffe066' : '#ffffff'
  const name = nameSprite(heroLabel(h), nameColor)
  name.position.y = 6.6
  const bar = makeHpBar(3, barColor)
  bar.position.y = 5.7
  // 내 영웅 발밑 링
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(1.5, 2.1, 24),
    new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.85, side: THREE.DoubleSide })
  )
  ring.rotation.x = -Math.PI / 2
  ring.position.y = 0.06
  ring.visible = !!mine
  // 버프 링 (용=주황 / 바론=보라)
  const buff = new THREE.Mesh(
    new THREE.RingGeometry(1.2, 1.45, 20),
    new THREE.MeshBasicMaterial({ color: 0xffa94d, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
  )
  buff.rotation.x = -Math.PI / 2
  buff.position.y = 0.1
  buff.visible = false
  // 탱커 방패막기(피해 감소) — 파란 막 (막아낸다)
  const shield = new THREE.Mesh(
    new THREE.SphereGeometry(2.6 * s, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0x9fd0ff, transparent: true, opacity: 0.3, depthWrite: false })
  )
  shield.position.y = 2.2 * s
  shield.visible = false
  // 수호기사 흡수 보호막(barrierHp) — 금색 셸 (피해를 빨아들인다). 탱커 막기와 색으로 구분.
  const barrier = new THREE.Mesh(
    new THREE.SphereGeometry(2.75 * s, 14, 10),
    new THREE.MeshBasicMaterial({
      color: 0xffdf8a, transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending,
    })
  )
  barrier.position.y = 2.2 * s
  barrier.visible = false
  // 수호기사 결속 — 묶인 아군(+수호기사)을 감싸는 투명한 청록 구체
  const bindSphere = new THREE.Mesh(
    new THREE.SphereGeometry(2.95 * s, 14, 10),
    new THREE.MeshBasicMaterial({
      color: 0xafe4ff, transparent: true, opacity: 0.14, depthWrite: false, blending: THREE.AdditiveBlending,
    })
  )
  bindSphere.position.y = 2.2 * s
  bindSphere.visible = false
  const stun = emojiSprite('💫', 2)
  stun.position.y = 5.4 * s
  stun.visible = false
  const freeze = emojiSprite('❄️', 1.7)
  freeze.position.y = 5.0 * s
  freeze.visible = false
  const fear = emojiSprite('😱', 1.7)
  fear.position.y = 5.0 * s
  fear.visible = false
  // 귀환 채널링 링 (발밑에서 청록색으로 돈다)
  const recall = new THREE.Mesh(
    new THREE.RingGeometry(1.7, 2.4, 28),
    new THREE.MeshBasicMaterial({ color: 0x4ad6e0, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
  )
  recall.rotation.x = -Math.PI / 2
  recall.position.y = 0.14
  recall.visible = false
  // 귀환 빛기둥: 하늘에서 캐릭터로 내리쬐는 빛 (적도 보고 "귀환 중이군" 알 수 있게)
  const recallBeam = new THREE.Mesh(
    new THREE.CylinderGeometry(4, 1, 34, 18, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0x9af0ff, transparent: true, opacity: 0.28,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    })
  )
  recallBeam.position.y = 17
  recallBeam.visible = false
  // 직업 무기 — 오른팔(손)에 쥐게 한다. 팔 그룹은 어깨가 피벗이라 걸을 때 앞뒤로 흔들린다.
  const weapon = buildWeapon(h.cls)
  // 손 위치 = 무기 그룹의 원점(=손잡이). 무기마다 달라서 각자에 맞춰 팔을 뻗는다(고정값이면 어깨에 뜬 것처럼 보인다).
  const hand = weapon.position.clone()
  if (hand.lengthSq() < 0.04) hand.set(0.35, 0.2, 0.15) // 암살자 등 원점이 0인 무기는 손잡이 보정
  const shoulderR = new THREE.Vector3(0.05 * s, 0.95 * s, 1.0 * s)
  const armR = new THREE.Group()
  armR.position.copy(shoulderR) // 오른쪽 어깨(회전 피벗)
  armR.add(limbBetween(new THREE.Vector3(0, 0, 0), hand.clone().sub(shoulderR), 0.2 * s, 0.16 * s, limbMat))
  const handMesh = new THREE.Mesh(new THREE.SphereGeometry(0.2 * s, 8, 6), limbMat)
  handMesh.position.copy(hand).sub(shoulderR)
  armR.add(handMesh)
  // 무기를 손잡이(grip)를 축으로 45° 기울여 쥔 것처럼 보이게 한다.
  //  tilt : 손잡이 위치에서 기울임 / inner : 몸통 좌표를 복원(공격 모션 좌표계 보존)
  // → 손잡이는 손에 고정된 채 무기만 기울고, 팔이 흔들리면(armR) 함께 흔들린다.
  const tilt = new THREE.Group()
  tilt.position.copy(hand).sub(shoulderR) // 손잡이 위치(어깨 로컬)
  tilt.rotation.z = -Math.PI / 4 // 약 45° 앞으로 기울여 겨눈 각도(+z는 등 뒤로 넘어감)
  const inner = new THREE.Group()
  inner.position.copy(hand).multiplyScalar(-1) // 몸통 원점 좌표 복원
  inner.add(weapon)
  tilt.add(inner)
  armR.add(tilt)
  body.add(armR)
  // 사망 시 분해 파티클: 몸에서 튀어 올랐다가 바닥에 쌓여 부활까지 남는다 (공중에서 사라지지 않게)
  const DEATH_N = 28
  const deathGeo = new THREE.BufferGeometry()
  deathGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DEATH_N * 3), 3))
  const deathPts = new THREE.Points(
    deathGeo,
    new THREE.PointsMaterial({ color: col, size: 1.15, transparent: true, opacity: 0.92, depthWrite: false })
  )
  deathPts.visible = false
  deathPts.frustumCulled = false
  // 파티클별 고정 파라미터 (영웅 id 시드 — 같은 죽음이면 어느 기기에서나 같은 모양)
  const rnd = lcg((hashStr(h.id) + 1) >>> 0)
  const dpDir = new Float32Array(DEATH_N * 2)
  const dpRad = new Float32Array(DEATH_N)
  const dpStartY = new Float32Array(DEATH_N)
  const dpPeak = new Float32Array(DEATH_N)
  for (let i = 0; i < DEATH_N; i++) {
    const a = rnd() * Math.PI * 2
    dpDir[i * 2] = Math.cos(a)
    dpDir[i * 2 + 1] = Math.sin(a)
    dpRad[i] = 0.4 + rnd() * 2.1
    dpStartY[i] = 1.2 * s + rnd() * 2.6 * s
    dpPeak[i] = 0.3 + rnd() * 1.2
  }
  g.add(shadow, body, face, name, bar, ring, buff, shield, barrier, bindSphere, stun, freeze, fear, recall, recallBeam, deathPts)
  g.userData = {
    body, outline, face, name, nameColor, nameLvl: h.lvl, isMine: mine, shadow,
    bodyBaseY: 2.2 * s, faceBaseY: 4.4 * s, bobPhase: (hashStr(h.id) % 628) / 100,
    bar, ring, buff, shield, barrier, bindSphere, stun, freeze, fear, recall, recallBeam, weapon, legs, arms: [armR, armL], lastAtkSeq: h.atkSeq, animT: 1,
    deathPts, deathGeo, dpDir, dpRad, dpStartY, dpPeak, deathN: DEATH_N, dead: false, deathT: 0,
  }
  return g
}

// 문자열 id → 32비트 정수 시드 (사망 파티클 모양 고정용)
function hashStr(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

// 사망 시: 일반 부위는 숨기고 파티클만, 부활 시: 반대로
function setHeroDead(u, dead) {
  u.body.visible = !dead
  u.face.visible = !dead
  u.name.visible = !dead
  u.bar.visible = !dead
  u.ring.visible = !dead && u.isMine
  u.shadow.visible = !dead
  u.deathPts.visible = dead
  if (dead) {
    u.buff.visible = false
    u.shield.visible = false
    u.barrier.visible = false
    u.bindSphere.visible = false
    u.stun.visible = false
    u.freeze.visible = false
    u.fear.visible = false
    u.recall.visible = false
    u.recallBeam.visible = false
  }
}

// 사망 파티클 위치 갱신: deathT(초)에 따라 튀어올랐다 바닥(y≈0.18)에 쌓인다
function updateHeroDeathParticles(u) {
  const SETTLE = 0.7
  const GROUND = 0.18
  const tn = Math.min(1, u.deathT / SETTLE)
  const ease = 1 - (1 - tn) * (1 - tn) // 바깥으로 퍼졌다가 멈춤
  const pos = u.deathGeo.attributes.position.array
  for (let i = 0; i < u.deathN; i++) {
    const hr = u.dpRad[i] * ease
    pos[i * 3] = u.dpDir[i * 2] * hr
    pos[i * 3 + 1] = GROUND + (u.dpStartY[i] - GROUND) * (1 - tn) + u.dpPeak[i] * 4 * tn * (1 - tn)
    pos[i * 3 + 2] = u.dpDir[i * 2 + 1] * hr
  }
  u.deathGeo.attributes.position.needsUpdate = true
}

function buildMinion(m, barColor) {
  const g = new THREE.Group()
  const col = TEAM_COLOR[m.team]
  const dark = darken(col, 0.6)
  // body = 작은 병사 묶음 (애니메이션이 위치/회전을 준다)
  const body = new THREE.Group()
  const torso = new THREE.Mesh(
    m.ranged ? new THREE.ConeGeometry(0.7, 1.5, 7) : new THREE.CapsuleGeometry(0.55, 0.7, 3, 8),
    new THREE.MeshLambertMaterial({ color: col })
  )
  torso.position.y = 0.85
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.42, 8, 7),
    new THREE.MeshLambertMaterial({ color: 0xe8c9a0 })
  )
  head.position.y = 1.6
  // 팀색 투구 (윗머리 반구)
  const helm = new THREE.Mesh(
    new THREE.SphereGeometry(0.47, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: dark })
  )
  helm.position.y = 1.62
  body.add(torso, head, helm)
  if (m.ranged) {
    // 등에 멘 화살통
    const quiver = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.8, 7), new THREE.MeshLambertMaterial({ color: dark }))
    quiver.rotation.x = 0.5
    quiver.position.set(-0.35, 1.0, -0.15)
    body.add(quiver)
  } else {
    // 손에 든 둥근 방패
    const shield = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.12, 12), new THREE.MeshLambertMaterial({ color: dark }))
    shield.rotation.z = Math.PI / 2
    shield.position.set(0.55, 0.9, 0.3)
    body.add(shield)
  }
  const eye = emojiSprite(m.ranged ? '🏹' : '🗡️', 1.1)
  eye.position.y = 2.35
  const bar = makeHpBar(1.6, barColor)
  bar.position.y = 3
  const shadow = blobShadow(0.95)
  g.add(shadow, body, eye, bar)
  g.userData = { bar, body, lastAtkSeq: m.atkSeq, animT: 1 }
  return g
}

const MONSTER_LOOK = {
  wolf: { emoji: '🐺', size: 2.6, body: 0x9aa3b2, r: 1.2 },
  dragon: { emoji: '🐉', size: 4.6, body: 0x59b96a, r: 2.4 }, // r은 피격 파티클 높이로도 쓴다
  baron: { emoji: '👹', size: 5, body: 0x9b6bd6, r: 2.8 },
}

// 몬스터 회전 보간 — 공격 대상 쪽으로 부드럽게 돌아선다
function turnToward(obj, targetRotY, f = 0.14) {
  let d = targetRotY - obj.rotation.y
  while (d > Math.PI) d -= 2 * Math.PI
  while (d < -Math.PI) d += 2 * Math.PI
  obj.rotation.y += d * f
}

// 용: 웅크린 저폴리 드래곤 — 관절 날개(위로 솟았다 아래로 쓸어내리는 날갯짓) + 물기 공격 모션.
// 로컬 +x가 정면. userData: rageMats(분노 붉힘) / anim(유휴 동작) / turn(회전) / pose(공격 진행 0→1).
function buildDragon(m) {
  const g = new THREE.Group()
  const skin = new THREE.MeshLambertMaterial({ color: 0x4fae63 })
  const belly = new THREE.MeshLambertMaterial({ color: 0xcfe8a8 })
  const membrane = new THREE.MeshLambertMaterial({ color: 0x2e7a44, side: THREE.DoubleSide })
  const horn = new THREE.MeshLambertMaterial({ color: 0xe8e2d2 })
  const model = new THREE.Group()
  const body = new THREE.Mesh(new THREE.SphereGeometry(2.2, 10, 8), skin)
  body.scale.set(1.5, 0.95, 1.1)
  body.position.y = 2.2
  const chest = new THREE.Mesh(new THREE.SphereGeometry(1.6, 8, 7), belly)
  chest.scale.set(1.1, 0.8, 0.85)
  chest.position.set(1.2, 1.8, 0)
  model.add(body, chest)
  // 목~머리는 한 그룹 — 공격 때 앞으로 내리꽂는 물기 모션의 피벗(가슴 위)
  const neckG = new THREE.Group()
  neckG.position.set(2.0, 3.0, 0)
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.05, 3.4, 8), skin)
  neck.position.set(1.0, 1.0, 0)
  neck.rotation.z = -0.65 // 앞-위로 치켜든 목
  const head = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.1, 1.3), skin)
  head.position.set(2.5, 2.5, 0)
  const snout = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.55, 0.9), belly)
  snout.position.set(3.6, 2.25, 0)
  neckG.add(neck, head, snout)
  for (const sz of [1, -1]) {
    const hn = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.2, 5), horn)
    hn.position.set(1.85, 3.3, sz * 0.5)
    hn.rotation.z = 0.55 // 뒤로 휘어진 뿔
    neckG.add(hn)
    const eye = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 6, 5),
      new THREE.MeshLambertMaterial({ color: 0xffcf4d, emissive: 0xffb020, emissiveIntensity: 0.9 })
    )
    eye.position.set(2.85, 2.8, sz * 0.58)
    neckG.add(eye)
  }
  model.add(neckG)
  // 관절 날개 — 어깨(안쪽 판) + 팔꿈치(바깥 판) 2단 관절. 위로 접혔다 아래로 쓸어내린다.
  const wings = []
  for (const sz of [1, -1]) {
    const shoulder = new THREE.Group()
    shoulder.position.set(-0.3, 3.9, sz * 1.0)
    const inner = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.1, 2.3), membrane)
    inner.position.set(-0.3, 0, sz * 1.15)
    const innerRib = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.15, 2.3, 6), skin)
    innerRib.rotation.x = Math.PI / 2
    innerRib.position.set(0.75, 0, sz * 1.15)
    shoulder.add(inner, innerRib)
    const elbow = new THREE.Group()
    elbow.position.set(0.4, 0, sz * 2.3) // 안쪽 판 끝 = 바깥 판의 관절
    const outer = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.08, 2.5), membrane)
    outer.position.set(-0.45, 0, sz * 1.25)
    const tipClaw = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.6, 4), horn)
    tipClaw.rotation.x = sz * (Math.PI / 2) // 날개 끝 발톱
    tipClaw.position.set(0.5, 0, sz * 2.5)
    elbow.add(outer, tipClaw)
    shoulder.add(elbow)
    model.add(shoulder)
    wings.push({ shoulder, elbow, sz })
  }
  // 꼬리 — 뒤로 가늘어지는 마디 + 가시 끝
  const tailSegs = []
  for (let i = 0; i < 3; i++) {
    const seg = new THREE.Mesh(new THREE.SphereGeometry(1.0 - i * 0.28, 7, 6), skin)
    seg.position.set(-3.2 - i * 1.3, 1.7 - i * 0.35, 0)
    model.add(seg)
    tailSegs.push(seg)
  }
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.1, 5), horn)
  tip.rotation.z = Math.PI / 2 // 뒤(-x)를 향한 가시
  tip.position.set(-7.0, 0.9, 0)
  model.add(tip)
  model.rotation.y = -Math.atan2(0 - m.z, 0 - m.x) // 시작은 맵 중앙(강 건너편)을 바라본다
  const bar = makeHpBar(5.2, 0xffd34d)
  bar.position.y = 8.6
  const shadow = blobShadow(3.4)
  g.add(shadow, model, bar)
  g.userData = {
    bar, body: model, rageMats: [skin, membrane],
    turn: (dir) => turnToward(model, -dir),
    anim: (t) => {
      // 날갯짓: 위로 솟았다(접힘) 아래로 쓸어내림(펼침) — 바깥 관절이 한 박자 늦게 따라온다
      const flap = Math.sin(t * 3.1)
      for (const { shoulder, elbow, sz } of wings) {
        shoulder.rotation.x = -sz * (0.2 + flap * 0.5)
        elbow.rotation.x = -sz * (Math.sin(t * 3.1 - 0.75) * 0.5 - 0.12)
      }
      for (let i = 0; i < tailSegs.length; i++) tailSegs[i].position.z = Math.sin(t * 1.6 + i * 0.9) * (0.25 + i * 0.2) // 꼬리 살랑
    },
    pose: (p) => {
      // 물기: 목을 뒤로 젖혔다(0→0.3) 앞으로 콱 내리꽂는다(0.3→1). p≥1이면 휴식 자세.
      const s = p >= 1 ? 0 : Math.sin(Math.min(1, Math.max(0, p)) * Math.PI)
      const windup = p >= 1 ? 0 : p < 0.3 ? p / 0.3 : Math.max(0, 1 - (p - 0.3) / 0.25)
      neckG.rotation.z = windup * 0.28 - s * 0.55
      neckG.position.x = 2.0 + s * 1.1
    },
  }
  return g
}

// 바론: 또아리를 튼 채 우뚝 솟아오른 거대 독사 — 코브라 후드/송곳니/붉은 눈/낼름거리는 혀.
// 공격은 머리를 뒤로 젖혔다 내리꽂는 스트라이크(엔진이 표적 자리에 독 웅덩이를 남긴다).
function buildBaron(m) {
  const g = new THREE.Group()
  const skin = new THREE.MeshLambertMaterial({ color: 0x8a5fc0 })
  const dark = new THREE.MeshLambertMaterial({ color: 0x5a3a86 })
  const bellyM = new THREE.MeshLambertMaterial({ color: 0xc9b3e8 })
  const fang = new THREE.MeshLambertMaterial({ color: 0xf0ead8 })
  const model = new THREE.Group()
  // 또아리 — 바닥에 감긴 몸통 고리(위로 갈수록 좁아진다)
  for (const [rr, tube, y] of [[2.7, 0.85, 0.85], [2.1, 0.75, 2.1], [1.55, 0.65, 3.2]]) {
    const coil = new THREE.Mesh(new THREE.TorusGeometry(rr, tube, 8, 18), dark)
    coil.rotation.x = Math.PI / 2
    coil.position.y = y
    model.add(coil)
  }
  // 곧추선 몸통 — 위로 갈수록 가늘어지며 앞으로 살짝 숙인 기둥. 유휴 시 좌우로 흔들린다.
  const column = []
  for (let i = 0; i < 5; i++) {
    const seg = new THREE.Mesh(new THREE.SphereGeometry(1.25 - i * 0.13, 9, 7), skin)
    seg.userData.base = { x: 0.15 + i * i * 0.09, y: 4.0 + i * 1.25 }
    seg.position.set(seg.userData.base.x, seg.userData.base.y, 0)
    model.add(seg)
    column.push(seg)
  }
  // 배 비늘 — 기둥 앞면의 밝은 판들
  for (let i = 0; i < 4; i++) {
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.75, 1.15 - i * 0.16), bellyM)
    plate.userData.base = { x: 1.1 + i * i * 0.09, y: 4.1 + i * 1.25 }
    plate.position.set(plate.userData.base.x, plate.userData.base.y, 0)
    model.add(plate)
    column.push(plate) // 흔들림/스트라이크를 함께 따라간다
  }
  // 머리 그룹 — 후드(코브라 목판) + 쐐기 머리 + 송곳니 + 눈. 스트라이크의 피벗.
  const headG = new THREE.Group()
  const headBase = { x: 1.35, y: 9.6 }
  headG.position.set(headBase.x, headBase.y, 0)
  const hood = new THREE.Mesh(new THREE.SphereGeometry(1.5, 9, 7), dark)
  hood.scale.set(0.45, 1.25, 1.55) // 납작하고 넓은 후드
  hood.position.set(-0.4, 0.15, 0)
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.95, 9, 7), skin)
  skull.scale.set(1.45, 0.8, 1.0)
  skull.position.set(0.55, 0.3, 0)
  const jaw = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.35, 0.85), bellyM)
  jaw.position.set(0.9, -0.25, 0)
  headG.add(hood, skull, jaw)
  for (const sz of [1, -1]) {
    const eye = new THREE.Mesh(
      new THREE.SphereGeometry(0.17, 6, 5),
      new THREE.MeshLambertMaterial({ color: 0xff5a3a, emissive: 0xff2a1a, emissiveIntensity: 1 })
    )
    eye.position.set(1.15, 0.55, sz * 0.42)
    headG.add(eye)
    // 아래로 뻗은 송곳니
    const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.6, 4), fang)
    tooth.rotation.x = Math.PI
    tooth.position.set(1.5, -0.55, sz * 0.28)
    headG.add(tooth)
  }
  // 혀 — 앞으로 낼름거리는 가는 붉은 줄기
  const tongue = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.03, 1.0, 5),
    new THREE.MeshLambertMaterial({ color: 0xd23a5a })
  )
  tongue.rotation.z = Math.PI / 2
  tongue.position.set(2.1, -0.15, 0)
  headG.add(tongue)
  model.add(headG)
  model.rotation.y = -Math.atan2(0 - m.z, 0 - m.x) // 시작은 맵 중앙을 바라본다
  const bar = makeHpBar(5.6, 0xffd34d)
  bar.position.y = 12.2
  const shadow = blobShadow(3.8)
  g.add(shadow, model, bar)
  g.userData = {
    bar, body: model, rageMats: [skin, dark],
    turn: (dir) => turnToward(model, -dir),
    anim: (t) => {
      // 뱀의 몸놀림: 기둥이 높이에 비례해 좌우로 흔들리고, 혀를 낼름거린다
      for (const seg of column) {
        seg.position.z = Math.sin(t * 1.5 + seg.userData.base.y * 0.5) * (seg.userData.base.y - 3.5) * 0.06
      }
      headG.position.z = Math.sin(t * 1.5 + 9.6 * 0.5) * 0.38
      tongue.scale.x = 0.5 + Math.max(0, Math.sin(t * 4.6)) * 0.7 // 낼름
    },
    pose: (p) => {
      // 스트라이크: 머리를 뒤로 크게 젖혔다(0→0.3) 앞-아래로 내리꽂는다(0.3→1). p≥1이면 휴식.
      const s = p >= 1 ? 0 : Math.sin(Math.min(1, Math.max(0, p)) * Math.PI)
      const windup = p >= 1 ? 0 : p < 0.3 ? p / 0.3 : Math.max(0, 1 - (p - 0.3) / 0.2)
      headG.position.x = headBase.x - windup * 0.9 + s * 2.4
      headG.position.y = headBase.y + windup * 0.5 - s * 1.6
      headG.rotation.z = windup * 0.35 - s * 0.75 // 내리꽂는 각도
      // 상단 기둥도 함께 따라 숙인다
      for (const seg of column) {
        const w = Math.max(0, (seg.userData.base.y - 5) / 5)
        seg.position.x = seg.userData.base.x + s * 1.2 * w
        seg.position.y = seg.userData.base.y - s * 0.5 * w
      }
    },
  }
  return g
}

function buildMonster(m) {
  if (m.kind === 'dragon') return buildDragon(m)
  if (m.kind === 'baron') return buildBaron(m)
  const look = MONSTER_LOOK[m.kind]
  const g = new THREE.Group()
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(look.r, 10, 8),
    new THREE.MeshLambertMaterial({ color: look.body })
  )
  body.position.y = look.r
  const face = emojiSprite(look.emoji, look.size)
  face.position.y = look.r * 2 + look.size * 0.4
  const bar = makeHpBar(look.r * 2.2, 0xffd34d)
  bar.position.y = look.r * 2 + look.size * 0.9
  const shadow = blobShadow(look.r * 1.3)
  g.add(shadow, body, face, bar)
  g.userData = { bar, body }
  return g
}

// 소환물(야수조련사 펫 / 엔지니어 포탑) 외형
const SUMMON_LOOK = {
  wolfpet: { emoji: '🐺', size: 1.9, body: 0x9aa3b2, r: 0.9, turret: false },
  bear: { emoji: '🐻', size: 3.2, body: 0x9b6b4a, r: 1.6, turret: false },
  turret: { emoji: '🔧', size: 1.7, body: 0x8d99b5, r: 1.0, turret: true },
  cannon: { emoji: '💥', size: 2.6, body: 0x6f7a93, r: 1.5, turret: true },
}

function buildSummon(s, barColor) {
  // 환영무희 분신: 본체와 완전히 똑같이 그린다(몸/무기/이모지/이름표) — 적을 속이는 미끼
  if (s.kind === 'clone') {
    const g = buildHero({ ...s, id: String(s.id), atkSeq: 0 }, false, barColor)
    g.userData.isClone = true
    return g
  }
  const look = SUMMON_LOOK[s.kind] || SUMMON_LOOK.wolfpet
  const col = TEAM_COLOR[s.team]
  const g = new THREE.Group()
  let body
  if (look.turret) {
    body = new THREE.Group()
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(look.r * 0.9, look.r * 1.15, 0.7, 10),
      new THREE.MeshLambertMaterial({ color: 0x5b667e })
    )
    base.position.y = 0.35
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(look.r * 1.3, look.r * 1.0, look.r * 1.5),
      new THREE.MeshLambertMaterial({ color: look.body })
    )
    head.position.y = 0.35 + look.r * 0.7
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.18, look.r * 1.7, 8),
      new THREE.MeshLambertMaterial({ color: col, emissive: col, emissiveIntensity: 0.3 })
    )
    barrel.rotation.z = Math.PI / 2
    barrel.position.set(look.r * 0.95, 0.35 + look.r * 0.7, 0)
    body.add(base, head, barrel)
    body.userData = { head } // 회전은 head/barrel만
  } else {
    body = new THREE.Mesh(
      new THREE.SphereGeometry(look.r, 9, 7),
      new THREE.MeshLambertMaterial({ color: look.body })
    )
    body.position.y = look.r
  }
  const face = emojiSprite(look.emoji, look.size)
  face.position.y = look.r * 2 + 0.3
  const bar = makeHpBar(look.r * 2.0, barColor)
  bar.position.y = look.r * 2 + 0.9
  const shadow = blobShadow(look.r * 1.25)
  // 휴면(zzz) 표시 — 포탑이 주인 사거리 밖이면 보여 준다
  const zzz = emojiSprite('💤', 1.4)
  zzz.position.set(look.r * 0.7, look.r * 2 + 1.0, 0)
  zzz.visible = false
  // 휴면 유예 타이머 — 주인이 떠나면 발밑에서 줄어드는 링(3초 카운트다운)
  let timer = null
  if (look.turret) {
    timer = new THREE.Mesh(
      new THREE.RingGeometry(look.r * 1.25, look.r * 1.55, 28),
      new THREE.MeshBasicMaterial({ color: 0xffb020, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false })
    )
    timer.rotation.x = -Math.PI / 2
    timer.position.y = 0.16
    timer.visible = false
    g.add(timer)
  }
  g.add(shadow, body, face, bar, zzz)
  g.userData = { bar, body, turret: look.turret, zzz, face, timer }
  return g
}

// glow = 후광 크기(반지름 배율), trail = 꼬리 발광 입자를 흘릴지 (스킬 투사체만 켠다)
const PROJ_LOOK = {
  bolt: { r: 0.4, y: 2.4, color: null, glow: 3 }, // null → 팀 색
  mbolt: { r: 0.26, y: 1.5, color: null, glow: 2 }, // 원거리 미니언의 작은 화살 (낮고 작게)
  fireball: { r: 0.95, y: 2, color: 0xff8c2e, glow: 4, trail: true },
  towerbolt: { r: 0.55, y: 4, color: null, glow: 3 },
  pierce: { r: 0.34, y: 2.2, color: 0xfff0a0, glow: 3.6, trail: true }, // 궁수 꿰뚫는 화살 (밝은 노랑)
  lightarrow: { r: 0.6, y: 2.2, color: 0xfff4b0, glow: 5, trail: true }, // 빛의 화살 궁극기 (크고 환한 빛)
  hawk: { r: 0.7, y: 5.5, color: 0xffe066, glow: 4, trail: true }, // 궁수 사냥매 (높이 떠 날아가는 빛점)
  hook: { r: 0.55, y: 1.6, color: 0xcfd4e0, glow: 2.4 }, // 사슬잡이 갈고리 (낮게 직진하는 금속 집게)
}

// 대지술사 돌덩이 — 맵에 놓인 바위와 같은 저폴리 돌(면처리 회색)이 데굴데굴 구르며 날아간다
function buildRockProj(p) {
  const g = new THREE.Group()
  const main = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.62, 0),
    new THREE.MeshLambertMaterial({ color: 0x8a8f9c, flatShading: true })
  )
  const chip = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.3, 0),
    new THREE.MeshLambertMaterial({ color: 0x7c818d, flatShading: true })
  )
  chip.position.set(0.4, 0.25, 0.15)
  g.add(main, chip)
  g.position.y = 1.8
  const phase = (p.id % 20) * 0.7 // 돌마다 구르는 위상이 다르게
  g.userData.spin = (t) => {
    g.rotation.x = t * 9 + phase // 데굴데굴
    g.rotation.z = t * 7 + phase
  }
  return g
}

// 돌풍술사 회오리 투사체 — 위로 갈수록 넓어지는 고리들을 쌓아 통째로 돌린다(앞으로 굴러가며 적을 띄움).
function buildTornadoProj() {
  const g = new THREE.Group()
  const col = 0xd6f0ff
  const tiers = 5
  const rings = []
  for (let i = 0; i < tiers; i++) {
    const f = i / (tiers - 1)
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.0 + f * 2.4, 0.22 + 0.14 * (1 - f), 6, 18),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.5 + 0.35 * (1 - f), depthWrite: false, blending: THREE.AdditiveBlending })
    )
    ring.rotation.x = Math.PI / 2
    ring.position.y = 0.5 + f * 5.2
    g.add(ring)
    rings.push({ ring, f })
  }
  g.userData.spin = (time) => {
    g.rotation.y = time * 12
    for (const { ring, f } of rings) ring.scale.setScalar(0.9 + Math.sin(time * 9 + f * 5) * 0.12)
  }
  return g
}

// 스킬 이펙트 색 + 파티클 모드 (kind → 색/파티클 움직임).
//  mode: out(바깥으로) · rise(위로) · fall(위에서 아래로) · forward(앞으로, dir 방향)
// 추가 원형(archetype) 플래그:
//   ring2: true  — 한 박자 늦게 퍼지는 두 번째 충격파(큰 폭발의 여운)
//   slash: true  — 무기 높이에서 빠르게 한 바퀴 도는 베기 궤적(호)
//   spikes: 색   — 지면에서 원형으로 솟았다 가라앉는 가시들(얼음/넝쿨)
//   pillar: true — 땅에서 하늘로 솟는 빛기둥
const FX_LOOK = {
  whirl: { color: 0xffa94d, ring: true, mode: 'out', pcolor: 0xffe0b0, slash: true, ring2: true }, // 전사 회전베기 — 도는 칼날 궤적
  storm: { color: 0x9b6bd6, ring: true, mode: 'out', pcolor: 0xd0a0ff, ring2: true },
  rain: { color: 0xff5f5f, ring: true, mode: 'fall', pcolor: 0xffc0c0 },
  sanctuary: { color: 0x6ee7a0, ring: true, mode: 'rise', pcolor: 0xb6f5cf },
  heal: { color: 0x6ee7a0, ring: true, mode: 'rise', pcolor: 0xb6f5cf },
  holylight: { color: 0xfff3b0, ring: true, mode: 'rise', pcolor: 0xfff7d0, beam: true }, // 하늘에서 내리쬐는 성광
  meteorhit: { color: 0xff7a2e, ring: true, mode: 'out', pcolor: 0xffd28a, ring2: true }, // 운석 낙하 충격 — 이중 충격파
  boom: { color: 0xff8c2e, ring: true, mode: 'out', pcolor: 0xffd28a, ring2: true },
  blink: { color: 0x9a7bff, ring: true, mode: 'out', pcolor: 0xc9b8ff },
  execute: { color: 0xff3b3b, ring: true, mode: 'out', pcolor: 0xff9a9a, slash: true }, // 암살자 처형 — 붉은 참격
  level: { color: 0xffe066, ring: true, mode: 'rise', pcolor: 0xfff0a0, pillar: true }, // 레벨 업 — 금빛 기둥
  towerfall: { color: 0xff8c2e, ring: true, mode: 'out', pcolor: 0xffcaa0, ring2: true, debris: { count: 16, rock: 0x8c8c98, dur: 1.7 } }, // 포탑 붕괴 — 돌무더기 와르르
  nexusfall: { color: 0xffe066, ring: true, mode: 'out', pcolor: 0xfff3b0, ring2: true, debris: { count: 24, rock: 0xb0b6c4, burst: true, dur: 2.0 } }, // 넥서스 폭발 — 펑! 파편이 터져나간다
  death: { color: 0x39405c, ring: true, mode: 'out' },
  shield: { color: 0x9fd0ff, ring: true, mode: 'rise', pcolor: 0xd0eaff },
  recall: { color: 0x4ad6e0, ring: true, mode: 'rise', pcolor: 0xa0f0f7 },
  // 보조 스킬(Lv3) 이펙트
  berserk: { color: 0xff3b30, ring: true, mode: 'out', pcolor: 0xff8a7a, ring2: true }, // 전사 광폭화 — 붉은 이중 폭발
  taunt: { color: 0xff5fa0, ring: true, mode: 'out', pcolor: 0xffb0d0 }, // 탱커 도발 — 퍼지는 동심원
  haste: { color: 0x7ad8ff, ring: true, mode: 'rise', pcolor: 0xc0f0ff }, // 힐러 가속 — 시원한 바람
  stealth: { color: 0x8a8fb0, ring: true, mode: 'rise', pcolor: 0xcfd4f0 }, // 암살자 은신 — 연기처럼 사라짐
  hawk: { color: 0xffe066, ring: true, mode: 'rise', pcolor: 0xfff0a0 }, // 궁수 사냥매 — 날아오르는 깃털
  focus: { color: 0xfff4b0, ring: true, mode: 'rise', pcolor: 0xfffbe0 }, // 궁수 정신집중 — 모여드는 빛
  // 앞으로 뻗는 방향성 스킬
  dash: { color: 0xffffff, line: true, mode: 'forward', pcolor: 0xffffff, w: 2.2 },
  fissure: { color: 0xc9863c, line: true, mode: 'forward', pcolor: 0xffb060, w: 3.4, ground: true },
  volley: { color: 0xfff0a0, line: true, mode: 'forward', pcolor: 0xfff4c0, w: 1.4 },
  chain: { color: 0x9fd6ff, line: true, mode: 'forward', pcolor: 0xe0f2ff, w: 1.0 }, // 마법사 체인 라이트닝 — 푸른 번개 줄기
  frost: { color: 0x9fe0ff, line: true, mode: 'forward', pcolor: 0xe0f6ff, w: 3.2 }, // 한빙술사 서리파동 — 차가운 서리 분사
  curse: { color: 0xb46bff, line: true, mode: 'forward', pcolor: 0xd9b3ff, w: 1.2 }, // 주술사 저주살 — 보랏빛 저주 줄기
  lightarrow: { color: 0xfff4b0, line: true, mode: 'forward', pcolor: 0xfffbe0, w: 7 }, // 화면 끝까지 관통하는 넓은 빛줄기
  // 직업 전용 광역/소환 이펙트 (색을 직업 테마에 맞춤)
  frostnova: { color: 0x8fdcff, ring: true, mode: 'out', pcolor: 0xd6f3ff, spikes: 0xbfeaff }, // 한빙술사 서리고리 — 진짜로 솟는 얼음가시
  abszero: { color: 0x6fc8ff, ring: true, mode: 'rise', pcolor: 0xcdeeff, pillar: true, spikes: 0xbfeaff }, // 절대영도 — 거대한 한기 기둥 + 가시
  plague: { color: 0x7fc24a, ring: true, mode: 'rise', pcolor: 0xbfe88a }, // 주술사 역병안개 — 피어오르는 독 구름
  doom: { color: 0x8a3bd0, ring: true, mode: 'out', pcolor: 0xc89af0, ring2: true }, // 주술사 파멸의 낙인 — 이중 낙인
  summon: { color: 0xffd06a, ring: true, mode: 'rise', pcolor: 0xffe6a8 }, // 야수조련사 소환 — 솟아오르는 마력
  deploy: { color: 0x9fb0c4, ring: true, mode: 'out', pcolor: 0xd6e0ec }, // 엔지니어 설치 — 기계 조립 불꽃
  snare: { color: 0x6fbf3a, ring: true, mode: 'out', pcolor: 0xbfe88a, spikes: 0x77c24a }, // 넝쿨사냥꾼 포획망 — 솟는 넝쿨 가시
  vine: { color: 0x5fae33, line: true, mode: 'forward', pcolor: 0xbfe88a, w: 2.4, ground: true }, // 올가미 — 땅에서 솟아 앞으로 뻗는 넝쿨
  // 돌풍술사: 바람 계열(흰빛~하늘빛)
  gust: { color: 0xd6f0ff, line: true, mode: 'forward', pcolor: 0xffffff, w: 3.0 }, // 돌풍 — 앞으로 뿜는 강풍 줄기
  repulse: { color: 0xcfe8ff, ring: true, mode: 'out', pcolor: 0xffffff, ring2: true }, // 밀쳐내기 — 이중 바람 파동
  typhoon: { color: 0x9fd6f0, ring: true, mode: 'out', pcolor: 0xe6f6ff, ring2: true }, // 태풍 — 휘몰아치는 거대한 회오리
  // 시간술사: 시간 계열(청록~보랏빛)
  timeleap: { color: 0x6fe0d0, ring: true, mode: 'out', pcolor: 0xc0fff0, ring2: true }, // 시간 도약 — 겹잔상 파동
  timewarp: { color: 0x8a7bf0, ring: true, mode: 'rise', pcolor: 0xd6cdff }, // 시간 지연 장판 — 느려진 시간(보랏빛)
  rewind: { color: 0x7ac0ff, ring: true, mode: 'rise', pcolor: 0xd0eaff, pillar: true }, // 역행 — 시간을 거슬러 솟는 빛기둥
  // 회오리 기둥(돌풍술사 돌풍/태풍) — 실제로 빙글빙글 도는 입체 회오리
  tornado: { color: 0xd6f0ff, tornado: true, pcolor: 0xffffff },
  // 바론 독 뿜기 착탄 — 초록 튐 + 웅덩이는 zone(venom)이 그린다
  venom: { color: 0x86d94a, ring: true, mode: 'out', pcolor: 0xb7f06a },
  // 공포술사: 어둠 계열(창백한 보라)
  dread: { color: 0x7a5fae, line: true, mode: 'forward', pcolor: 0xb9a3e0, w: 5 }, // 공포의 시선 — 넓은 어둠 물결
  shriek: { color: 0x8a6bc0, ring: true, mode: 'out', pcolor: 0xcdb3f0, ring2: true }, // 단말마 — 이중 공포 파동
  // 대지술사: 대지 계열(황토)
  quake: { color: 0xc9863c, line: true, mode: 'forward', pcolor: 0xd9b586, w: 2.6, ground: true }, // 융기 — 벽이 솟는 자리
  cage: { color: 0xc9863c, ring: true, mode: 'out', pcolor: 0xd9b586, spikes: 0xa8927a }, // 바위감옥 — 돌가시 원환
  // 환영무희: 연기가 펑! — 분신 내리찍기 소멸/환영난무 연막
  poof: { color: 0xcfd4e0, ring: true, mode: 'rise', pcolor: 0xe8ecf5, ring2: true },
}

// 시드 고정 파티클 구름 — 호스트/게스트 모두 같은 fx(id)에서 같은 모양이 나오게 lcg 시드.
//  fx.t(0→0.8s)에 따라 퍼지며 사라진다.
function makeBurst(n, look) {
  const count = look.mode === 'forward' ? 22 : 18
  const reach = (n.r || 4) * (look.mode === 'forward' ? 1 : 0.9)
  const rnd = lcg(((n.id | 0) + 1) * 2654435761 >>> 0)
  const dir = new Float32Array(count * 3) // 단위 방향
  const mag = new Float32Array(count) // 거리 배율 0.4~1
  for (let i = 0; i < count; i++) {
    let ax = 0
    let ay = 0
    let az = 0
    if (look.mode === 'forward') {
      const a = (n.dir || 0) + (rnd() - 0.5) * 0.5
      ax = Math.cos(a)
      az = Math.sin(a)
      ay = rnd() * 0.5
    } else if (look.mode === 'rise') {
      const a = rnd() * Math.PI * 2
      ax = Math.cos(a) * 0.4
      az = Math.sin(a) * 0.4
      ay = 0.7 + rnd() * 0.9
    } else if (look.mode === 'fall') {
      const a = rnd() * Math.PI * 2
      ax = Math.cos(a) * rnd()
      az = Math.sin(a) * rnd()
      ay = 0 // 높이는 update에서 위→아래
    } else { // out
      const a = rnd() * Math.PI * 2
      ax = Math.cos(a)
      az = Math.sin(a)
      ay = rnd() * 0.5
    }
    dir[i * 3] = ax
    dir[i * 3 + 1] = ay
    dir[i * 3 + 2] = az
    mag[i] = 0.4 + rnd() * 0.6
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
  const mat = new THREE.PointsMaterial({
    color: look.pcolor ?? look.color, size: look.mode === 'forward' ? 1 : 1.1,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  })
  const pts = new THREE.Points(geo, mat)
  pts.userData.update = (t) => {
    const tn = Math.min(1, t / 0.8)
    const ease = 1 - (1 - tn) * (1 - tn)
    const pos = geo.attributes.position.array
    for (let i = 0; i < count; i++) {
      const rr = reach * mag[i] * ease
      pos[i * 3] = dir[i * 3] * rr
      if (look.mode === 'fall') pos[i * 3 + 1] = 1 + (1 - ease) * (n.r || 6) * 1.2
      else pos[i * 3 + 1] = 1.2 + dir[i * 3 + 1] * reach * 0.55 * ease
      pos[i * 3 + 2] = dir[i * 3 + 2] * rr
    }
    geo.attributes.position.needsUpdate = true
    mat.opacity = 1 - tn
  }
  return pts
}

// 붕괴 파편 — 입체 덩어리들이 솟구쳤다 중력으로 떨어져 바닥에 구른다.
//  burst=true(넥서스): 사방으로 강하게 터져나간다. burst 없음(포탑): 와르르 무너져 내린다.
//  dur(초)에 맞춰 마지막 0.4초간 사라진다. 시드(n.id)로 호스트/게스트가 같은 모양.
function makeDebris(n, dcfg, team) {
  const g = new THREE.Group()
  const rnd = lcg(((n.id | 0) + 7) * 2246822519 >>> 0)
  const grav = dcfg.burst ? 26 : 22
  const chunks = []
  for (let i = 0; i < dcfg.count; i++) {
    const a = rnd() * Math.PI * 2
    const sz = (dcfg.burst ? 0.5 : 0.55) + rnd() * (dcfg.burst ? 1.2 : 1.0)
    // 대부분 돌 파편, 넥서스는 일부를 팀색 결정 조각으로
    let col = dcfg.rock
    if (dcfg.burst && team != null && rnd() < 0.4) col = TEAM_COLOR[team]
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(sz, sz, sz),
      new THREE.MeshLambertMaterial({ color: col, transparent: true })
    )
    const vh = dcfg.burst ? 8 + rnd() * 9 : 2.5 + rnd() * 6
    chunks.push({
      m, sz,
      vx: Math.cos(a) * vh, vz: Math.sin(a) * vh,
      vy: dcfg.burst ? 9 + rnd() * 9 : rnd() * 3 - 0.5,
      startY: dcfg.burst ? 1 + rnd() * 3 : 2 + rnd() * 7,
      sx: (rnd() - 0.5) * 9, sy: (rnd() - 0.5) * 9, sz2: (rnd() - 0.5) * 9, // 텀블 회전 속도
      landed: false, lt: 0,
    })
    g.add(m)
  }
  g.userData.update = (t) => {
    const fade = Math.max(0, Math.min(1, (dcfg.dur - t) / 0.4))
    for (const c of chunks) {
      const rest = c.sz * 0.5
      let y = c.startY + c.vy * t - 0.5 * grav * t * t
      if (y < rest) { y = rest; if (!c.landed) { c.landed = true; c.lt = t } }
      const ht = c.landed ? c.lt : t // 착지 후엔 수평 이동 정지(마찰)
      c.m.position.set(c.vx * ht, y, c.vz * ht)
      if (!c.landed) c.m.rotation.set(c.sx * t, c.sy * t, c.sz2 * t) // 착지하면 회전도 멈춤
      c.m.material.opacity = fade
    }
  }
  return g
}

// fx 한 개를 3D 오브젝트(Group)로 — 동심원 링/방향성 직선 + 파티클.
function buildFxObject(n) {
  let look = FX_LOOK[n.kind] || { color: 0xffd34d, ring: true, mode: 'out' }
  // 사망 분해 효과는 쓰러진 유닛(또는 정글몹을 잡은 팀) 색으로 물들여 누가 쓰러졌는지 알린다.
  if (n.kind === 'death' && n.team != null) {
    look = { ...look, color: TEAM_COLOR[n.team], pcolor: TEAM_COLOR[n.team] }
  }
  const g = new THREE.Group()
  g.position.set(n.x, 0, n.z)
  const ups = []
  if (look.tornado) {
    // 회오리 기둥: 위로 갈수록 넓어지는 원뿔들을 쌓아 통째로 빠르게 회전 + 솟구쳤다 잦아든다.
    const life = n.life || 0.8
    const baseR = Math.max(1.6, (n.r || 4) * 0.5)
    const swirl = new THREE.Group()
    const rings = []
    const tiers = 5
    for (let i = 0; i < tiers; i++) {
      const f = i / (tiers - 1)
      const rr = baseR * (0.35 + f * 1.1)
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(rr, 0.18 + 0.12 * (1 - f), 6, 18),
        new THREE.MeshBasicMaterial({ color: look.color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
      )
      ring.rotation.x = Math.PI / 2
      ring.position.y = 0.4 + f * (baseR * 2.2)
      swirl.add(ring)
      rings.push({ ring, f })
    }
    g.add(swirl)
    ups.push((t) => {
      const tn = Math.min(1, t / life)
      swirl.rotation.y = t * 11 // 빙글빙글
      const grow = Math.min(1, t / 0.18)
      for (const { ring, f } of rings) {
        ring.scale.setScalar(grow * (0.85 + Math.sin(t * 9 + f * 5) * 0.12))
        ring.material.opacity = (1 - tn) * (0.5 + 0.4 * (1 - f))
      }
    })
  }
  if (look.line) {
    // 앞으로 뻗는 직선/균열 — 로컬 +x가 dir 방향이 되게 회전
    g.rotation.y = -(n.dir || 0)
    const len = n.r || 14
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(len, look.ground ? 0.4 : 0.9, look.w || 2),
      new THREE.MeshBasicMaterial({ color: look.color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
    )
    bar.position.set(len / 2, look.ground ? 0.25 : 1.1, 0)
    g.add(bar)
    ups.push((t) => {
      const tn = Math.min(1, t / 0.6)
      bar.material.opacity = (1 - tn) * 0.85
      bar.scale.x = Math.min(1, t / 0.1) // 앞으로 쭉 뻗어 나가는 느낌
      if (!look.ground) bar.scale.y = 1 + tn * 1.5
    })
  }
  if (look.ring) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.8, 1, 36),
      new THREE.MeshBasicMaterial({ color: look.color, transparent: true, side: THREE.DoubleSide })
    )
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 0.3
    g.add(ring)
    ups.push((t) => {
      const f = Math.min(1, t / 0.6)
      ring.scale.setScalar(1 + f * (n.r || 4))
      ring.material.opacity = 1 - f
    })
  }
  if (look.beam) {
    // 하늘에서 내리쬐는 빛기둥 (성광) — 위에서 쏟아져 서서히 옅어진다
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry((n.r || 4) * 0.5, (n.r || 4) * 0.32, 30, 18, 1, true),
      new THREE.MeshBasicMaterial({
        color: look.color, transparent: true, opacity: 0.4,
        side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
      })
    )
    beam.position.y = 15
    g.add(beam)
    ups.push((t) => {
      const tn = Math.min(1, t / 0.8)
      beam.material.opacity = (1 - tn) * 0.5
      beam.scale.set(1 + tn * 0.3, 1, 1 + tn * 0.3)
    })
  }
  if (look.ring2) {
    // 두 번째 충격파 — 한 박자(0.12초) 늦게, 더 얇고 빠르게 퍼져 폭발의 여운을 준다
    const ring2 = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.72, 32),
      new THREE.MeshBasicMaterial({ color: look.color, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })
    )
    ring2.rotation.x = -Math.PI / 2
    ring2.position.y = 0.42
    g.add(ring2)
    ups.push((t) => {
      const tt = Math.max(0, t - 0.12)
      const f = Math.min(1, tt / 0.55)
      ring2.scale.setScalar(1 + f * (n.r || 4) * 1.15)
      ring2.material.opacity = tt <= 0 ? 0 : (1 - f) * 0.8
    })
  }
  if (look.slash) {
    // 베기 궤적 — 무기 높이의 호가 빠르게 한 바퀴 돌며 커진다
    const wrap = new THREE.Group()
    const arc = new THREE.Mesh(
      new THREE.TorusGeometry(Math.max(2, (n.r || 4) * 0.72), 0.26, 6, 24, Math.PI * 0.9),
      new THREE.MeshBasicMaterial({ color: look.color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
    )
    arc.rotation.x = Math.PI / 2
    wrap.add(arc)
    wrap.position.y = 1.7
    g.add(wrap)
    ups.push((t) => {
      const tn = Math.min(1, t / 0.5)
      wrap.rotation.y = -t * 15 // 휙 도는 참격
      wrap.scale.setScalar(0.55 + tn * 0.55)
      arc.material.opacity = (1 - tn) * 0.95
    })
  }
  if (look.spikes) {
    // 지면에서 원형으로 솟았다 가라앉는 가시들 (얼음/넝쿨) — 시드 고정으로 모든 기기 동일
    const cnt = 8
    const rnd = lcg(((n.id | 0) + 3) * 3266489917 >>> 0)
    const mat = new THREE.MeshLambertMaterial({ color: look.spikes, transparent: true, flatShading: true })
    const spikes = []
    for (let i = 0; i < cnt; i++) {
      const a = (i / cnt) * Math.PI * 2 + rnd() * 0.6
      const rr = (n.r || 4) * (0.5 + rnd() * 0.42)
      const hgt = 1.5 + rnd() * 1.7
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.34, hgt, 5), mat)
      cone.position.set(Math.cos(a) * rr, 0, Math.sin(a) * rr)
      cone.rotation.y = rnd() * 3
      cone.rotation.x = (rnd() - 0.5) * 0.35
      cone.scale.y = 0.001
      g.add(cone)
      spikes.push({ cone, hgt, d: rnd() * 0.12 })
    }
    ups.push((t) => {
      for (const s of spikes) {
        const tt = Math.max(0, t - s.d)
        const up = Math.min(1, tt / 0.16) // 콱 솟았다가
        const down = Math.min(1, Math.max(0, (tt - 0.5) / 0.3)) // 스르륵 가라앉는다
        const k = Math.max(0.001, up * (1 - down))
        s.cone.scale.y = k
        s.cone.position.y = (s.hgt / 2) * k
      }
      mat.opacity = 1 - Math.min(1, Math.max(0, (t - 0.55) / 0.35))
    })
  }
  if (look.pillar) {
    // 땅에서 하늘로 솟는 빛기둥 — 성광(beam)과 반대로 아래에서 위로 자란다
    const pr = Math.max(1.2, (n.r || 4) * 0.26)
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(pr * 0.8, pr, 10, 12, 1, true),
      new THREE.MeshBasicMaterial({
        color: look.color, transparent: true, opacity: 0,
        side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
      })
    )
    pillar.scale.y = 0.001
    g.add(pillar)
    ups.push((t) => {
      const grow = Math.min(1, t / 0.22)
      const tn = Math.min(1, t / 0.8)
      pillar.scale.y = grow
      pillar.position.y = 5 * grow // 바닥에 발을 붙인 채 위로 자란다
      pillar.material.opacity = (1 - tn) * 0.55
    })
  }
  if (look.pcolor !== undefined || look.mode) {
    const burst = makeBurst(n, look)
    g.add(burst)
    ups.push((t) => burst.userData.update(t))
  }
  if (look.debris) {
    const debris = makeDebris(n, look.debris, n.team)
    g.add(debris)
    ups.push((t) => debris.userData.update(t))
  }
  g.userData.update = (t) => { for (const u of ups) u(t) }
  return g
}

// 대지술사 임시 돌벽 — 충돌 원 하나당 바위 기둥 하나. 콱 솟았다가 수명이 다하면 가라앉는다.
function buildStoneWall(w) {
  const g = new THREE.Group()
  g.position.set(w.x, 0, w.z)
  const rnd = lcg(((w.id | 0) + 5) * 2246822519 >>> 0)
  const stone = new THREE.MeshLambertMaterial({ color: 0x9a8f7c, flatShading: true })
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.3, 4.6, 7), stone)
  pillar.position.y = 2.3
  pillar.rotation.y = rnd() * 3
  const cap = new THREE.Mesh(new THREE.IcosahedronGeometry(1.6, 0), stone)
  cap.position.y = 4.8
  cap.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3)
  g.add(pillar, cap)
  g.userData.update = (ww) => {
    const rise = Math.min(1, ww.t / 0.18) // 콱 솟는다
    const rem = (ww.life ?? 3) - ww.t
    const k = Math.max(0.001, rem < 0.35 ? (rem / 0.35) * rise : rise) // 마지막 0.35초에 가라앉는다
    g.scale.y = k
  }
  return g
}

// 바론 독 웅덩이 — 초록 원판 + 가장자리 링 + 보글보글 솟는 기포. life에 맞춰 페이드아웃.
function buildVenomZone(z) {
  const g = new THREE.Group()
  g.position.set(z.x, 0, z.z)
  const pool = new THREE.Mesh(
    new THREE.CircleGeometry(z.r, 26),
    new THREE.MeshLambertMaterial({ color: 0x5fae33, transparent: true, opacity: 0.42, depthWrite: false })
  )
  pool.rotation.x = -Math.PI / 2
  pool.position.y = 0.12
  const rim = new THREE.Mesh(
    new THREE.RingGeometry(z.r * 0.86, z.r, 26),
    new THREE.MeshBasicMaterial({ color: 0x8fd05a, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false })
  )
  rim.rotation.x = -Math.PI / 2
  rim.position.y = 0.14
  g.add(pool, rim)
  // 기포 — 시드 고정으로 모든 기기 동일. 웅덩이 안에서 솟았다 터진다(z.t 기반 루프).
  const rnd = lcg(((z.id | 0) + 11) * 2654435761 >>> 0)
  const bubbleMat = new THREE.MeshLambertMaterial({
    color: 0x9fe06a, emissive: 0x4a7a1a, emissiveIntensity: 0.5, transparent: true,
  })
  const bubbles = []
  for (let i = 0; i < 6; i++) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.2 + rnd() * 0.16, 6, 5), bubbleMat)
    const a = rnd() * Math.PI * 2
    const rr = rnd() * z.r * 0.75
    b.position.set(Math.cos(a) * rr, 0.1, Math.sin(a) * rr)
    bubbles.push({ b, phase: rnd() })
    g.add(b)
  }
  g.userData.update = (zz) => {
    const grow = Math.min(1, zz.t / 0.25) // 퍼지며 등장
    const fade = Math.min(1, Math.max(0, ((zz.life ?? 3.5) - zz.t) / 0.5)) // 사라지기 전 페이드
    pool.scale.setScalar(Math.max(0.001, grow))
    rim.scale.setScalar(Math.max(0.001, grow))
    pool.material.opacity = 0.42 * fade
    rim.material.opacity = 0.7 * fade
    bubbleMat.opacity = fade
    for (const { b, phase } of bubbles) {
      const cyc = (zz.t * 0.9 + phase) % 1 // 솟아오르며 커졌다 터진다
      b.position.y = 0.1 + cyc * 1.3
      b.scale.setScalar(Math.max(0.001, (0.5 + cyc) * (1 - cyc * cyc)))
    }
  }
  return g
}

// 운석 예고/낙하 — zone(예고형 지면 범위) 한 개를 3D로. zone.t/zone.delay로 진행.
//  땅엔 점점 또렷해지는 조준 링, 하늘에선 운석이 떨어져 바닥에 닿을 때 충격(meteorhit fx)로 이어진다.
function buildMeteorZone(z) {
  const g = new THREE.Group()
  g.position.set(z.x, 0, z.z)
  // 지면 조준 링 (목표 반경)
  const mark = new THREE.Mesh(
    new THREE.RingGeometry(z.r * 0.82, z.r, 40),
    new THREE.MeshBasicMaterial({ color: 0xff7a2e, transparent: true, opacity: 0.8, side: THREE.DoubleSide })
  )
  mark.rotation.x = -Math.PI / 2
  mark.position.y = 0.3
  // 위험 표시 안쪽 원판
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(z.r, 32),
    new THREE.MeshBasicMaterial({ color: 0xff5a1e, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false })
  )
  disc.rotation.x = -Math.PI / 2
  disc.position.y = 0.22
  // 떨어지는 운석
  const rock = new THREE.Mesh(
    new THREE.IcosahedronGeometry(z.r * 0.5, 0),
    new THREE.MeshStandardMaterial({ color: 0x4a3320, emissive: 0xff5a1e, emissiveIntensity: 0.9, flatShading: true })
  )
  g.add(mark, disc, rock)
  g.userData.update = (zz) => {
    const f = Math.max(0, Math.min(1, zz.t / (zz.delay || 0.5))) // 0→1 진행
    mark.material.opacity = 0.45 + 0.45 * f
    mark.scale.setScalar(1 + (1 - f) * 0.6) // 바깥에서 좁혀 들어오는 조준
    disc.material.opacity = 0.12 + 0.2 * f
    rock.position.y = 42 * (1 - f) + (z.r * 0.5) // 하늘 → 지면
    rock.rotation.x += 0.3
    rock.rotation.z += 0.22
  }
  return g
}

// 오브젝트의 geometry/material/texture를 정리 (풀에서 빠질 때 GPU 메모리 회수)
function disposeObject(obj) {
  obj.traverse?.((o) => {
    o.geometry?.dispose?.()
    if (o.material) {
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        m.map?.dispose?.()
        m.dispose?.()
      }
    }
  })
}

// id → 3D 오브젝트 풀 동기화: 스냅샷에 있으면 만들고/갱신, 없으면 치운다
function syncPool(scene, pool, items, create, update) {
  const seen = new Set()
  for (const it of items) {
    seen.add(it.id)
    let obj = pool.get(it.id)
    if (!obj) {
      obj = create(it)
      pool.set(it.id, obj)
      scene.add(obj)
    }
    update(obj, it)
  }
  for (const [id, obj] of pool) {
    if (seen.has(id)) continue
    scene.remove(obj)
    disposeObject(obj)
    pool.delete(id)
  }
}

// 전장의 안개: 캔버스에 아군 시야만큼 구멍을 뚫어 어둠 텍스처로 쓴다
function createFog(map) {
  const WORLD = map.WORLD
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 384
  const ctx = c.getContext('2d')
  const tex = new THREE.CanvasTexture(c)
  const w = WORLD.maxX - WORLD.minX + 60
  const h = WORLD.maxZ - WORLD.minZ + 60
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
  )
  plane.rotation.x = -Math.PI / 2
  plane.position.y = 0.45
  const toCx = (x) => ((x - WORLD.minX + 30) / w) * c.width
  const toCz = (z) => ((z - WORLD.minZ + 30) / h) * c.height
  const sx = c.width / w // 월드 → 캔버스 배율
  function update(view, myTeam) {
    ctx.globalCompositeOperation = 'source-over'
    ctx.clearRect(0, 0, c.width, c.height)
    ctx.fillStyle = 'rgba(2, 4, 10, 0.94)' // 안개 = 거의 칠흑 (밖은 안 보인다)
    ctx.fillRect(0, 0, c.width, c.height)
    ctx.globalCompositeOperation = 'destination-out'
    const punch = (x, z, r) => {
      const cx = toCx(x)
      const cz = toCz(z)
      const cr = r * sx
      const grad = ctx.createRadialGradient(cx, cz, cr * 0.55, cx, cz, cr)
      grad.addColorStop(0, 'rgba(0,0,0,1)')
      grad.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(cx, cz, cr, 0, Math.PI * 2)
      ctx.fill()
    }
    for (const o of view.heroes) {
      if (o.team === myTeam && o.respawnT <= 0) punch(o.x, o.z, SIGHT_RANGE)
    }
    for (const o of view.minions) if (o.team === myTeam) punch(o.x, o.z, SIGHT_RANGE * 0.75)
    for (const o of view.towers) if (o.team === myTeam && o.alive) punch(o.x, o.z, SIGHT_RANGE * 0.9)
    for (const rv of view.reveals || []) if (rv.team === myTeam) punch(rv.x, rv.z, rv.r) // 사냥매가 걷은 안개
    punch(map.NEXUS_POS[myTeam].x, map.NEXUS_POS[myTeam].z, SIGHT_RANGE)
    tex.needsUpdate = true
  }
  return { plane, update }
}

export function createRiftScene(canvas, map = buildMap('3v3'), quality = 'med') {
  const { WORLD, NEXUS_POS, FOUNTAIN_POS, LANES, ROCKS, BUSHES, WALL_LINES, DRAGON_PIT, BARON_PIT, WOLF_CAMPS } = map
  const Q = QUALITY[quality] || QUALITY.med
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: Q.antialias })
  renderer.setPixelRatio(Math.min(Q.pixelRatio, window.devicePixelRatio || 1))
  const scene = new THREE.Scene()
  // 무거운 황혼 분위기 — 어둑한 하늘 + 가까이 깔리는 대기 안개
  scene.background = new THREE.Color(0x2b3550)
  scene.fog = new THREE.Fog(0x2b3550, 95, 230)
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.5, 400)
  camera.position.set(0, 60, 50)

  // 전체적으로 빛을 낮춰 음영을 깊게 (차가운 하늘빛 + 어두운 땅반사)
  scene.add(new THREE.HemisphereLight(0x9aa8c4, 0x33402e, 0.62))
  const sun = new THREE.DirectionalLight(0xffe6bf, 0.95)
  sun.position.set(60, 90, 30)
  scene.add(sun)
  // 반대편 차가운 보조광 — 그림자 쪽을 살짝 살려 묵직한 입체감
  const fill = new THREE.DirectionalLight(0x5b6c92, 0.32)
  fill.position.set(-50, 40, -40)
  scene.add(fill)

  // ── 지형 ──
  const GW = WORLD.maxX - WORLD.minX + 80
  const GH = WORLD.maxZ - WORLD.minZ + 80
  const groundTex = grassTexture(512)
  groundTex.repeat.set(Math.max(4, Math.round(GW / 60)), Math.max(4, Math.round(GH / 60)))
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(GW, GH),
    new THREE.MeshLambertMaterial({ map: groundTex })
  )
  ground.rotation.x = -Math.PI / 2
  scene.add(ground)
  // 강 (가운데 세로 물길 — 용/바론 둥지를 잇는다). 흐르는 물 텍스처(render에서 천천히 굴린다)
  const waterTex = waterTexture(256)
  waterTex.repeat.set(1, Math.max(2, Math.round((WORLD.maxZ - WORLD.minZ) / 30)))
  const river = new THREE.Mesh(
    new THREE.PlaneGeometry(16, WORLD.maxZ - WORLD.minZ + 10, 1, 24),
    new THREE.MeshLambertMaterial({ map: waterTex }) // 불투명 — 투명 정렬로 캐릭터를 덮지 않게
  )
  river.rotation.x = -Math.PI / 2
  river.position.y = 0.02
  scene.add(river)
  // 강가 모래톱 (물길 양옆 젖은 둑)
  for (const side of [-1, 1]) {
    const bank = new THREE.Mesh(
      new THREE.PlaneGeometry(4.5, WORLD.maxZ - WORLD.minZ + 10),
      new THREE.MeshLambertMaterial({ color: 0x88a98e })
    )
    bank.rotation.x = -Math.PI / 2
    bank.position.set(side * 9.8, 0.015, 0)
    scene.add(bank)
  }
  // 레인 길 3갈래 — 어두운 흙 둑 + 그 위 흙길 텍스처
  const laneTex = laneTexture(128)
  for (const lane of LANE_IDS) {
    scene.add(buildLane(LANES[lane], 6.6, 0xb09a6c, 0.025)) // 가장자리(흙 둑)
    scene.add(buildLane(LANES[lane], 5, 0xd9c79a, 0.035, laneTex)) // 길 바닥
  }
  // 길가 돌멩이 — 길 양옆을 따라 작은 돌을 늘어놓아 경계를 또렷하게
  const laneStoneRnd = lcg(606)
  const laneStoneItems = []
  for (const lane of LANE_IDS) {
    const wps = LANES[lane]
    for (let i = 0; i < wps.length - 1; i++) {
      const a = wps[i]
      const b = wps[i + 1]
      const dx = b.x - a.x
      const dz = b.z - a.z
      const d = Math.hypot(dx, dz) || 1
      const nx = -dz / d
      const nz = dx / d
      for (let k = 0; k < 3; k++) {
        const t = (k + laneStoneRnd()) / 3
        const px = a.x + dx * t
        const pz = a.z + dz * t
        for (const sdir of [1, -1]) {
          if (laneStoneRnd() > 0.55) continue
          const off = 5.1 + laneStoneRnd() * 0.9
          laneStoneItems.push({ x: px + nx * off * sdir, y: 0.15, z: pz + nz * off * sdir,
            ry: laneStoneRnd() * 3, s: 0.4 + laneStoneRnd() * 0.6, color: laneStoneRnd() > 0.5 ? 0x9aa0ad : 0x8a8f9c })
        }
      }
    }
  }
  scene.add(makeScatter(
    new THREE.DodecahedronGeometry(0.5),
    new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), laneStoneItems))
  // 리스폰 존 (회복 지대) 표시 — 넥서스 뒤편에 원판 + 빛나는 테두리 + 회복 십자
  for (const team of ['blue', 'red']) {
    const fp = FOUNTAIN_POS[team]
    const pad = new THREE.Mesh(
      new THREE.CircleGeometry(FOUNTAIN_RADIUS, 40),
      new THREE.MeshLambertMaterial({ color: TEAM_COLOR[team], transparent: true, opacity: 0.32 })
    )
    pad.rotation.x = -Math.PI / 2
    pad.position.set(fp.x, 0.04, fp.z)
    const rim = new THREE.Mesh(
      new THREE.RingGeometry(FOUNTAIN_RADIUS - 0.9, FOUNTAIN_RADIUS, 48),
      new THREE.MeshBasicMaterial({ color: TEAM_COLOR[team], transparent: true, opacity: 0.6, side: THREE.DoubleSide })
    )
    rim.rotation.x = -Math.PI / 2
    rim.position.set(fp.x, 0.05, fp.z)
    // 회복 십자(+) — 여기가 부활·치유 지점임을 알린다
    const crossMat = new THREE.MeshBasicMaterial({ color: 0x8affc0, transparent: true, opacity: 0.7, side: THREE.DoubleSide })
    const bar1 = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.9), crossMat)
    const bar2 = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 3.2), crossMat)
    for (const b of [bar1, bar2]) { b.rotation.x = -Math.PI / 2; b.position.set(fp.x, 0.06, fp.z) }
    scene.add(pad, rim, bar1, bar2)
  }
  // 정적 장식(나무·바위·둥지돌)은 안 움직이므로 셰이딩별 한 덩이로 병합한다 → 드로우콜 대폭 절감.
  //  수풀(은신)·성벽은 병합 대상에서 제외(게임플레이/구조물).
  const staticDecor = makeStaticMerger()

  // 용/바론 둥지 — 같은 돌 테두리 구조에 서로 다른 테마를 입혀 멀리서도 구분되게 한다.
  //  용 굴: 그을린 모래 + 이글대는 호박빛 결정 / 바론 둥지: 창백한 보랏빛 + 마력 결정 + 짐승 뼈 가시
  const pitRnd = lcg(4242)
  const PIT_THEMES = [
    { pit: DRAGON_PIT, pad: 0xd4a878, rock: 0x99856e, crystal: 0xff9d4d, boneSpikes: 0 },
    { pit: BARON_PIT, pad: 0xaaa2bd, rock: 0x6d6a82, crystal: 0xc07dff, boneSpikes: 3 },
  ]
  for (const theme of PIT_THEMES) {
    const pit = theme.pit
    const pad = new THREE.Mesh(
      new THREE.CircleGeometry(8, 32),
      new THREE.MeshLambertMaterial({ color: theme.pad })
    )
    pad.rotation.x = -Math.PI / 2
    pad.position.set(pit.x, 0.05, pit.z)
    scene.add(pad)
    const ringN = 14
    for (let i = 0; i < ringN; i++) {
      const a = (i / ringN) * Math.PI * 2
      const rr = 0.6 + pitRnd() * 0.5
      const rock = new THREE.Mesh(
        new THREE.IcosahedronGeometry(rr, 0),
        new THREE.MeshLambertMaterial({ color: theme.rock, flatShading: true })
      )
      rock.position.set(pit.x + Math.cos(a) * 8, rr * 0.5, pit.z + Math.sin(a) * 8)
      rock.rotation.set(pitRnd() * 3, pitRnd() * 3, pitRnd() * 3)
      staticDecor.addMesh(rock)
    }
    // 서식지의 기운 — 빛나는 결정 4개 (발광이라 병합 불가 → 개별 메시, 둥지당 4드로우콜)
    const crysMat = new THREE.MeshLambertMaterial({
      color: theme.crystal, emissive: theme.crystal, emissiveIntensity: 0.55, flatShading: true,
    })
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.5
      const size = 0.5 + pitRnd() * 0.4
      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(size), crysMat)
      crystal.position.set(pit.x + Math.cos(a) * 6.4, size * 0.8, pit.z + Math.sin(a) * 6.4)
      crystal.rotation.y = pitRnd() * 3
      scene.add(crystal)
    }
    // 바론 둥지의 짐승 뼈 가시 (무광 → 병합)
    for (let i = 0; i < theme.boneSpikes; i++) {
      const a = (i / Math.max(1, theme.boneSpikes)) * Math.PI * 2 + 1.1
      const bone = new THREE.Mesh(
        new THREE.ConeGeometry(0.35, 3.2 + pitRnd() * 1.2, 5),
        new THREE.MeshLambertMaterial({ color: 0xe8e2d2, flatShading: true })
      )
      bone.position.set(pit.x + Math.cos(a) * 4.6, 1.5, pit.z + Math.sin(a) * 4.6)
      bone.rotation.set((pitRnd() - 0.5) * 0.7, 0, (pitRnd() - 0.5) * 0.7)
      staticDecor.addMesh(bone)
    }
  }
  // 강 건널목 유적 — 각 레인이 강(x=0)을 건너는 지점 양옆의 이끼 낀 부러진 돌기둥.
  //  옛 다리의 잔해가 "여기서 강을 건넌다"는 랜드마크가 된다. 전부 무광 정적 → 병합.
  const ruinRnd = lcg(1717)
  for (const lane of LANE_IDS) {
    const wps = LANES[lane]
    let crossZ = null
    for (let i = 0; i < wps.length - 1; i++) {
      const a = wps[i]
      const b = wps[i + 1]
      if ((a.x <= 0 && b.x >= 0) || (a.x >= 0 && b.x <= 0)) {
        const t = Math.abs(b.x - a.x) < 1e-6 ? 0 : (0 - a.x) / (b.x - a.x)
        crossZ = a.z + (b.z - a.z) * t
        break
      }
    }
    if (crossZ === null) continue
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const h = 1.6 + ruinRnd() * 1.4 // 부러진 높이가 제각각
        const g = new THREE.Group()
        const stump = new THREE.Mesh(
          new THREE.CylinderGeometry(0.8, 0.95, h, 7),
          new THREE.MeshLambertMaterial({ color: 0xa8a495, flatShading: true })
        )
        stump.position.y = h / 2
        g.add(stump)
        const moss = new THREE.Mesh(
          new THREE.SphereGeometry(0.75, 7, 5, 0, Math.PI * 2, 0, Math.PI / 2.2),
          new THREE.MeshLambertMaterial({ color: 0x4a7a3e })
        )
        moss.position.y = h
        moss.scale.y = 0.45
        g.add(moss)
        g.position.set(sx * 9.8, 0, crossZ + sz * 5.6) // 강둑 양옆 × 길 양옆 = 기둥 4개
        g.rotation.y = ruinRnd() * 3
        staticDecor.addGroup(g)
      }
    }
  }
  // 늑대 캠프 표식 — 물어뜯긴 뼈 무더기: 정글러가 캠프 위치를 한눈에 알아본다. 무광 정적 → 병합.
  const campRnd = lcg(909)
  const boneColor = 0xe8e2d2
  for (const c of WOLF_CAMPS) {
    const g = new THREE.Group()
    for (let i = 0; i < 3; i++) {
      const stick = new THREE.Mesh(
        new THREE.CylinderGeometry(0.09, 0.13, 1.1 + campRnd() * 0.5, 5),
        new THREE.MeshLambertMaterial({ color: boneColor, flatShading: true })
      )
      const a = campRnd() * Math.PI * 2
      const r = 3.4 + campRnd() * 1.2
      stick.position.set(Math.cos(a) * r, 0.12, Math.sin(a) * r)
      stick.rotation.set(Math.PI / 2, 0, campRnd() * 3) // 바닥에 눕힌 뼈
      g.add(stick)
    }
    const skull = new THREE.Mesh(
      new THREE.SphereGeometry(0.34, 7, 5),
      new THREE.MeshLambertMaterial({ color: boneColor, flatShading: true })
    )
    const sa = campRnd() * Math.PI * 2
    skull.position.set(Math.cos(sa) * 3.2, 0.28, Math.sin(sa) * 3.2)
    g.add(skull)
    g.position.set(c.x, 0, c.z)
    staticDecor.addGroup(g)
  }
  // 바위 — 큰 돌 + 둘레에 작은 돌이 흩어진 군집 (저폴리 면처리로 거칠게)
  const rockRnd = lcg(88)
  for (const r of ROCKS) {
    const g = new THREE.Group()
    const main = new THREE.Mesh(
      new THREE.IcosahedronGeometry(r.r, 0),
      new THREE.MeshLambertMaterial({ color: 0x8a8f9c, flatShading: true })
    )
    main.position.y = r.r * 0.5
    main.rotation.set(rockRnd() * 3, rockRnd() * 3, rockRnd() * 3)
    g.add(main)
    // 바위 위 이끼 캡 (윗부분 반구를 납작하게)
    const moss = new THREE.Mesh(
      new THREE.SphereGeometry(r.r * 0.82, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2.3),
      new THREE.MeshLambertMaterial({ color: 0x4a7a3e })
    )
    moss.position.y = r.r * 0.72
    moss.scale.y = 0.5
    g.add(moss)
    const sat = 2 + ((rockRnd() * 3) | 0)
    for (let i = 0; i < sat; i++) {
      const sr = r.r * (0.35 + rockRnd() * 0.3)
      const a = rockRnd() * Math.PI * 2
      const m = new THREE.Mesh(
        new THREE.IcosahedronGeometry(sr, 0),
        new THREE.MeshLambertMaterial({ color: rockRnd() > 0.5 ? 0x7c818d : 0x969cab, flatShading: true })
      )
      m.position.set(Math.cos(a) * r.r, sr * 0.4, Math.sin(a) * r.r)
      m.rotation.set(rockRnd() * 3, rockRnd() * 3, rockRnd() * 3)
      g.add(m)
    }
    g.position.set(r.x, 0, r.z)
    staticDecor.addGroup(g)
  }
  // 성벽: 길이 아닌 곳을 막는 능선 + 윗면에 성가퀴(merlon) 톱니
  const wallMat = new THREE.MeshLambertMaterial({ color: 0x7d8494 })
  const wallTopMat = new THREE.MeshLambertMaterial({ color: 0x69b85e })
  const merlonMat = new THREE.MeshLambertMaterial({ color: 0x6b7280 })
  for (const w of WALL_LINES) {
    const len = Math.hypot(w.x2 - w.x1, w.z2 - w.z1) + WALL_RADIUS * 2
    const g = new THREE.Group()
    const body = new THREE.Mesh(new THREE.BoxGeometry(len, 4.6, WALL_RADIUS * 2), wallMat)
    body.position.y = 2.3
    const top = new THREE.Mesh(new THREE.BoxGeometry(len, 0.7, WALL_RADIUS * 2 - 0.8), wallTopMat)
    top.position.y = 4.7 // 능선 위 풀
    g.add(body, top)
    const n = Math.max(2, Math.floor(len / 3.2))
    for (let i = 0; i <= n; i += 2) {
      const mer = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.4, WALL_RADIUS * 2), merlonMat)
      mer.position.set(-len / 2 + (i / n) * len, 5.4, 0)
      g.add(mer)
    }
    g.position.set((w.x1 + w.x2) / 2, 0, (w.z1 + w.z2) / 2)
    g.rotation.y = -Math.atan2(w.z2 - w.z1, w.x2 - w.x1)
    scene.add(g)
  }

  // 리스폰 존 뒤쪽 절반을 감싸는 반호(半弧) 성벽 — 부활 지점을 등지고 보호하는 물리 구조물.
  //  맵 중앙 반대편(블루 -x / 레드 +x) 절반만 두른다. 두께 있는 곡면 슬래브로, 충돌(map.js)과
  //  반경을 공유한다: 안쪽 면 = FOUNTAIN_RADIUS, 중심선 = FOUNTAIN_RADIUS + RESPAWN_ARC_HALF.
  const t = RESPAWN_ARC_HALF
  const Ri = FOUNTAIN_RADIUS // 안쪽 면(회복 원판 가장자리)
  const Ro = FOUNTAIN_RADIUS + 2 * t // 바깥 면
  const Rmid = FOUNTAIN_RADIUS + t // 중심선(성가퀴 배치)
  const H = 4.6
  for (const team of ['blue', 'red']) {
    const fp = FOUNTAIN_POS[team]
    const g = new THREE.Group()
    // 반호 링을 위로 밀어 세운 곡면 벽체. ExtrudeGeometry는 shape의 (x,y)→월드(x,-z)로 눕힌다.
    //  월드 x<0(블루)/x>0(레드) 절반이 되도록 각을 잡는다.
    const a0 = team === 'blue' ? Math.PI / 2 : -Math.PI / 2
    const a1 = team === 'blue' ? (3 * Math.PI) / 2 : Math.PI / 2
    const shape = new THREE.Shape()
    shape.absarc(0, 0, Ro, a0, a1, false)
    shape.absarc(0, 0, Ri, a1, a0, true)
    const bodyGeo = new THREE.ExtrudeGeometry(shape, { depth: H, bevelEnabled: false, curveSegments: 28 })
    bodyGeo.rotateX(-Math.PI / 2) // depth(0..H)를 높이(y)로 세운다
    const body = new THREE.Mesh(bodyGeo, wallMat)
    body.position.set(fp.x, 0, fp.z)
    g.add(body)
    // 윗면 이끼 띠(살짝 얇게 얹은 같은 반호) — 성벽 능선 위 풀과 통일
    const capGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.6, bevelEnabled: false, curveSegments: 28 })
    capGeo.rotateX(-Math.PI / 2)
    const cap = new THREE.Mesh(capGeo, wallTopMat)
    cap.position.set(fp.x, H, fp.z)
    g.add(cap)
    // 성가퀴(merlon) 톱니 — 반호를 따라 일정 간격으로 (충돌 각 규칙: x=R·sinθ, z=R·cosθ)
    const thetaStart = team === 'blue' ? Math.PI : 0
    const mn = 10
    for (let i = 0; i <= mn; i++) {
      const theta = thetaStart + (i / mn) * Math.PI
      const mer = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.5, 2 * t + 0.3), merlonMat)
      mer.position.set(fp.x + Rmid * Math.sin(theta), H + 0.75, fp.z + Rmid * Math.cos(theta))
      mer.rotation.y = theta // 폭이 벽면 접선을 따르도록
      g.add(mer)
    }
    scene.add(g)
  }

  // 수풀 (들어가면 은신!) — 잎뭉치 + 작은 열매로 풍성하게
  const bushRnd = lcg(7)
  for (const b of BUSHES) {
    const g = new THREE.Group()
    const blobs = 9
    for (let i = 0; i < blobs; i++) {
      const blob = new THREE.Mesh(
        new THREE.SphereGeometry(b.r * (0.4 + bushRnd() * 0.3), 10, 8),
        new THREE.MeshLambertMaterial({ color: i % 3 === 0 ? 0x276b34 : 0x2f7d3d, transparent: true, opacity: 0.94 })
      )
      blob.scale.y = 0.6
      const ring = i < 6 ? b.r * 0.5 : b.r * 0.22
      const ang = (i / blobs) * Math.PI * 2 * 1.6
      blob.position.set(Math.cos(ang) * ring, 0.7 + bushRnd() * 0.7, Math.sin(ang) * ring)
      g.add(blob)
    }
    for (let i = 0; i < 4; i++) {
      const berry = new THREE.Mesh(
        new THREE.SphereGeometry(0.22, 6, 5),
        new THREE.MeshLambertMaterial({ color: [0xff5f7e, 0xffd34d, 0xffffff][(bushRnd() * 3) | 0] })
      )
      const ang = bushRnd() * Math.PI * 2
      const rr = bushRnd() * b.r * 0.6
      berry.position.set(Math.cos(ang) * rr, 1.2 + bushRnd() * 0.6, Math.sin(ang) * rr)
      g.add(berry)
    }
    g.position.set(b.x, 0, b.z)
    scene.add(g)
  }

  // ── 바닥 디테일: 풀포기 · 들꽃 · 자갈 (인스턴싱으로 가볍게 흩뿌린다) ──
  const decoRnd = lcg(31337)
  const inRiver = (x) => Math.abs(x) < 10
  const spanX = WORLD.maxX - WORLD.minX
  const spanZ = WORLD.maxZ - WORLD.minZ
  const grassItems = []
  const flowerItems = []
  const pebbleItems = []
  const FLOWER_COLORS = [0xffffff, 0xffe066, 0xff8fae, 0xb084ff, 0xff6b6b]
  for (let i = 0; i < 520; i++) {
    const x = WORLD.minX + decoRnd() * spanX
    const z = WORLD.minZ + decoRnd() * spanZ
    if (inRiver(x)) continue
    grassItems.push({ x, y: 0.65, z, ry: decoRnd() * Math.PI, s: 0.7 + decoRnd() * 0.9,
      color: decoRnd() > 0.5 ? 0x5aa251 : 0x74c266 })
  }
  for (let i = 0; i < 150; i++) {
    const x = WORLD.minX + decoRnd() * spanX
    const z = WORLD.minZ + decoRnd() * spanZ
    if (inRiver(x)) continue
    flowerItems.push({ x, y: 0.6, z, s: 0.7 + decoRnd() * 0.7,
      color: FLOWER_COLORS[(decoRnd() * FLOWER_COLORS.length) | 0] })
  }
  for (let i = 0; i < 220; i++) {
    pebbleItems.push({ x: WORLD.minX + decoRnd() * spanX, y: 0.18, z: WORLD.minZ + decoRnd() * spanZ,
      rx: decoRnd() * 3, ry: decoRnd() * 3, s: 0.5 + decoRnd() * 0.8,
      color: decoRnd() > 0.5 ? 0x9aa0ad : 0x7e8492 })
  }
  scene.add(makeScatter(
    new THREE.ConeGeometry(0.35, 1.3, 4),
    new THREE.MeshLambertMaterial({ color: 0xffffff }), grassItems))
  scene.add(makeScatter(
    new THREE.SphereGeometry(0.3, 6, 5),
    new THREE.MeshLambertMaterial({ color: 0xffffff }), flowerItems))
  scene.add(makeScatter(
    new THREE.DodecahedronGeometry(0.4),
    new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), pebbleItems))

  // 장식 나무 (맵 밖 둘레) — 침엽수(원뿔 3겹)와 활엽수(둥근 잎뭉치)를 섞는다
  const rnd = lcg(20260612)
  for (let i = 0; i < 140; i++) {
    const ang = rnd() * Math.PI * 2
    const rad = 1.05 + rnd() * 0.4
    const x = Math.cos(ang) * (WORLD.maxX + 8 + rnd() * 30)
    const z = Math.sin(ang) * (WORLD.maxZ + 6 + rnd() * 24)
    // 전장 안(직사각형)에 떨어지는 나무는 건너뛴다 — 유령 나무 방지
    if (x > WORLD.minX - 2 && x < WORLD.maxX + 2 && z > WORLD.minZ - 2 && z < WORLD.maxZ + 2) continue
    const tree = new THREE.Group()
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.45, 0.7, 3),
      new THREE.MeshLambertMaterial({ color: 0x7a5a3a })
    )
    trunk.position.y = 1.5
    tree.add(trunk)
    const leaf = rnd() > 0.4 ? 0x2f7d3d : 0x3c9150
    if (rnd() > 0.35) {
      for (let k = 0; k < 3; k++) {
        const cone = new THREE.Mesh(
          new THREE.ConeGeometry((2.6 - k * 0.6) * rad, 3.2 * rad, 7),
          new THREE.MeshLambertMaterial({ color: leaf })
        )
        cone.position.y = 3 + k * 1.9 * rad
        tree.add(cone)
      }
    } else {
      const blobs = 3 + ((rnd() * 2) | 0)
      for (let k = 0; k < blobs; k++) {
        const ball = new THREE.Mesh(
          new THREE.SphereGeometry((1.6 + rnd() * 0.8) * rad, 8, 6),
          new THREE.MeshLambertMaterial({ color: leaf })
        )
        const a = (k / blobs) * Math.PI * 2
        ball.position.set(Math.cos(a) * 1.1 * rad, 4 + rnd() * 1.6 * rad, Math.sin(a) * 1.1 * rad)
        tree.add(ball)
      }
    }
    tree.position.set(x, 0, z)
    tree.rotation.y = rnd() * Math.PI
    staticDecor.addGroup(tree)
  }
  staticDecor.build(scene) // 나무·바위·둥지돌을 flat/smooth 두 메시로 병합 완료

  // ── 전장의 안개 ──
  const fog = createFog(map)
  fog.plane.visible = false
  scene.add(fog.plane)

  // ── 떠다니는 빛 입자 (반딧불/꽃가루) — 전장에 생기를 준다 ──
  const MOTE_N = 130
  const moteGeo = new THREE.BufferGeometry()
  const motePos = new Float32Array(MOTE_N * 3)
  const moteBaseY = new Float32Array(MOTE_N)
  const moteRnd = lcg(99)
  for (let i = 0; i < MOTE_N; i++) {
    motePos[i * 3] = WORLD.minX + moteRnd() * (WORLD.maxX - WORLD.minX)
    moteBaseY[i] = 2 + moteRnd() * 11
    motePos[i * 3 + 1] = moteBaseY[i]
    motePos[i * 3 + 2] = WORLD.minZ + moteRnd() * (WORLD.maxZ - WORLD.minZ)
  }
  moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3))
  const motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({
    color: 0xfff3c0, size: 0.7, transparent: true, opacity: 0.55,
    depthWrite: false, blending: THREE.AdditiveBlending,
  }))
  motes.frustumCulled = false
  scene.add(motes)

  // ── 동적 오브젝트 ──
  const towerObjs = new Map() // id → group (스냅샷 towers 순서 고정)
  const nexusObjs = {
    blue: buildNexus('blue'),
    red: buildNexus('red'),
  }
  nexusObjs.blue.position.set(NEXUS_POS.blue.x, 0, NEXUS_POS.blue.z)
  nexusObjs.red.position.set(NEXUS_POS.red.x, 0, NEXUS_POS.red.z)
  scene.add(nexusObjs.blue, nexusObjs.red)

  const heroPool = new Map()
  const minionPool = new Map()
  const monsterPool = new Map()
  const summonPool = new Map()
  const projPool = new Map()
  const zonePool = new Map()
  const stoneWallPool = new Map() // 대지술사 임시 돌벽
  const fxPool = new Map()
  const bindPool = new Map() // 결속 끈: 묶인 아군 id → 수호기사에게 잇는 선
  const particles = makeParticles(scene) // 타격 스파크·발자국 먼지·투사체 꼬리 공용

  // 시간술사 역행 미리보기: 내 영웅이 되돌아갈 과거 지점을 반투명 그림자로 보여 준다(궁극기 켜졌을 때만)
  const rewindGhost = new THREE.Group()
  const ghostBody = new THREE.Mesh(
    new THREE.CapsuleGeometry(1.1, 1.4, 3, 10),
    new THREE.MeshBasicMaterial({ color: 0x7ac0ff, transparent: true, opacity: 0.32, depthWrite: false })
  )
  ghostBody.position.y = 2.2
  const ghostRing = new THREE.Mesh(
    new THREE.RingGeometry(1.5, 1.9, 28),
    new THREE.MeshBasicMaterial({ color: 0x7ac0ff, transparent: true, opacity: 0.5, side: THREE.DoubleSide })
  )
  ghostRing.rotation.x = -Math.PI / 2
  ghostRing.position.y = 0.2
  rewindGhost.add(ghostBody, ghostRing)
  rewindGhost.visible = false
  scene.add(rewindGhost)

  // 넥서스 폭발 섬광: 경기 종료 순간 진 쪽 넥서스 자리에서 크게 "펑" 번쩍인다(클라 연출)
  const endFlash = new THREE.Mesh(
    new THREE.SphereGeometry(1, 16, 12),
    new THREE.MeshBasicMaterial({
      color: 0xfff2c0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
    })
  )
  endFlash.visible = false
  scene.add(endFlash)

  const camTarget = new THREE.Vector3(0, 0, 0)
  const _want = new THREE.Vector3() // 카메라 목표점 — 매 프레임 재사용(할당 방지)
  let camInit = false
  let frameN = 0 // 안개 갱신 스로틀용 프레임 카운터
  let lastT = null // 공격 모션 진행용 프레임 시간
  let hitFxOn = true // 피격 테두리 on/off (데미지 숫자는 항상 표시)
  let prevStatus = null // 직전 프레임의 경기 상태 (finished 전환 감지)
  let endT = -1 // 넥서스 폭발 연출 진행 시간(>=0이면 진행 중)

  // 떠오르는 데미지 숫자 풀 — 다 쓴 스프라이트를 재활용한다
  const dmgNumbers = []
  function popDamage(x, z, amount, kind) {
    const amt = Math.round(amount)
    if (amt <= 0) return
    let sp = dmgNumbers.find((d) => d.userData.t >= d.userData.life)
    if (!sp) {
      if (dmgNumbers.length >= 48) return // 동시에 너무 많이 띄우지 않는다
      sp = new THREE.Sprite(new THREE.SpriteMaterial({ depthWrite: false, transparent: true, depthTest: false }))
      sp.renderOrder = 999
      dmgNumbers.push(sp)
      scene.add(sp)
    }
    sp.material.map = dmgTexture(String(amt), kind)
    sp.material.needsUpdate = true
    const big = Math.min(1, amt / 220) // 큰 피해일수록 숫자도 크게
    const s = 2.2 + big * 2.4
    sp.userData = {
      t: 0, life: 0.85, x0: x + (Math.random() - 0.5) * 1.4, z0: z,
      vx: (Math.random() - 0.5) * 2.2, vy: 5.2, s, kind,
    }
    sp.scale.set(s, s * 0.5, 1)
    sp.position.set(sp.userData.x0, 6, z)
    sp.visible = true
  }

  function render(view, myId) {
    const dt = lastT == null ? 0 : Math.max(0, Math.min(0.1, view.time - lastT))
    lastT = view.time
    frameN++
    waterTex.offset.y -= dt * 0.04 // 강물이 천천히 흐른다
    // 빛 입자: 위아래로 흔들리며 옆으로 살랑인다
    const mp = moteGeo.attributes.position.array
    for (let i = 0; i < MOTE_N; i++) {
      mp[i * 3] += Math.sin(view.time * 0.2 + i) * 0.02
      mp[i * 3 + 1] = moteBaseY[i] + Math.sin(view.time * 0.6 + i * 1.3) * 1.2
    }
    moteGeo.attributes.position.needsUpdate = true
    particles.update(dt) // 타격 스파크·발자국 먼지·투사체 꼬리 전진
    const me = view.heroes.find((h) => h.id === myId)
    const myTeam = me?.team || null // 관전이면 모든 게 보인다
    // 역행 미리보기 그림자: 궁극기가 켜져 있으면(view에 rewindGhost가 실림) 그 자리에 반투명 그림자
    if (me?.rewindGhost) {
      rewindGhost.visible = true
      rewindGhost.position.set(me.rewindGhost.x, 0, me.rewindGhost.z)
      ghostBody.material.opacity = 0.22 + Math.abs(Math.sin(view.time * 3)) * 0.18
      ghostRing.rotation.z = view.time * 1.5
    } else {
      rewindGhost.visible = false
    }
    const barColorOf = (team) =>
      myTeam ? (team === myTeam ? ALLY_HP : ENEMY_HP) : TEAM_COLOR[team]
    // 안개 밖(아군 시야 없는 곳)인가? — 안개 구멍과 같은 규칙. 관전은 늘 보인다.
    const SIGHT2 = SIGHT_RANGE * SIGHT_RANGE
    const inVision = (x, z) => {
      if (!myTeam) return true
      for (const a of view.heroes) {
        if (a.team === myTeam && a.respawnT <= 0 && (a.x - x) ** 2 + (a.z - z) ** 2 <= SIGHT2) return true
      }
      for (const m of view.minions) {
        if (m.team === myTeam && (m.x - x) ** 2 + (m.z - z) ** 2 <= SIGHT2) return true
      }
      for (const t of view.towers) {
        if (t.team === myTeam && t.alive && (t.x - x) ** 2 + (t.z - z) ** 2 <= SIGHT2) return true
      }
      const nx = NEXUS_POS[myTeam]
      if ((nx.x - x) ** 2 + (nx.z - z) ** 2 <= SIGHT2) return true
      // 사냥매가 걷어 둔 안개 흔적 안이면 보인다
      for (const rv of view.reveals || []) {
        if (rv.team === myTeam && (rv.x - x) ** 2 + (rv.z - z) ** 2 <= rv.r * rv.r) return true
      }
      return false
    }

    // 타워
    for (const t of view.towers) {
      let obj = towerObjs.get(t.id)
      if (!obj) {
        obj = buildTower(t.team)
        obj.position.set(t.x, 0, t.z)
        towerObjs.set(t.id, obj)
        scene.add(obj)
      }
      const u = obj.userData
      u.body.visible = t.alive
      u.crystal.visible = t.alive
      u.bar.visible = t.alive
      u.rubble.visible = !t.alive
      if (t.alive) {
        u.crystal.rotation.y += 0.02
        setHpBar(u.bar, t.hp / t.maxHp)
        // 아직 공격 못 하는 타워는 크리스탈이 흐릿하게 + "공격불가" 라벨
        // 공격 가능 타워는 크리스탈이 은은하게 명멸한다
        u.crystal.material.emissiveIntensity = t.vuln ? 0.4 + Math.sin(view.time * 3 + t.x) * 0.15 : 0.15
      }
      const dToMe = me ? Math.hypot(me.x - t.x, me.z - t.z) : Infinity
      // "공격불가" 라벨: 무적인 적 구조물에 다가가면 띄운다 (관전이면 전부)
      u.lock.visible =
        t.alive && !t.vuln && (!myTeam || (t.team !== myTeam && dToMe < TOWER_RANGE + 16))
      // 적 타워 사거리 경고: 내 영웅이 가까워지면 미리 범위를 보여 준다
      let warn = false
      if (t.alive && me && myTeam && t.team !== myTeam) {
        const WARN_PAD = 9 // 사거리 밖 이만큼부터 미리 표시
        if (dToMe < TOWER_RANGE + WARN_PAD) {
          warn = true
          const inside = dToMe <= TOWER_RANGE
          // 가까울수록(또는 사거리 안이면) 진하게 + 안에 들어가면 깜빡인다
          const near = Math.min(1, (TOWER_RANGE + WARN_PAD - dToMe) / WARN_PAD)
          const pulse = inside ? 0.6 + Math.sin(view.time * 9) * 0.35 : 1
          u.edge.material.opacity = (0.2 + near * 0.45) * pulse
          u.disc.material.opacity = (0.04 + near * 0.12) * (inside ? 1.4 : 1)
        }
      }
      u.range.visible = warn
    }
    // 넥서스
    for (const team of ['blue', 'red']) {
      const nx = view.nexus[team]
      const u = nexusObjs[team].userData
      u.core.rotation.y += 0.015
      u.core.position.y = 6.5 + Math.sin(view.time * 1.6) * 0.3 // 둥실
      u.ring2.rotation.z = view.time * 0.8 // 빛 고리가 돈다
      u.glow.material.opacity = 0.3 + Math.sin(view.time * 2) * 0.08 // 바닥 광휘 맥동
      u.core.visible = nx.hp > 0
      setHpBar(u.bar, nx.hp / nx.maxHp)
      u.core.material.emissiveIntensity = nx.vuln ? 0.7 : 0.4
      const dToNexus = me ? Math.hypot(me.x - NEXUS_POS[team].x, me.z - NEXUS_POS[team].z) : Infinity
      u.lock.visible =
        nx.hp > 0 && !nx.vuln && (!myTeam || (team !== myTeam && dToNexus < 28))
      const low = nx.hp > 0 && nx.hp < nx.maxHp * 0.35
      u.core.scale.setScalar(low ? 1 + Math.sin(view.time * 10) * 0.06 : 1)
    }
    // 영웅 — 적은 시야/수풀 규칙에 걸리면 안 보인다
    syncPool(
      scene, heroPool, view.heroes,
      (h) => buildHero(h, h.id === myId, barColorOf(h.team)),
      (obj, h) => {
        const dead = h.respawnT > 0
        const u = obj.userData
        // 사망: 그 자리에서 파티클로 분해되어 바닥에 쌓이고 부활까지 남는다
        if (dead) {
          obj.visible = true // 시체 파티클은 늘 보인다 (쓰러뜨렸음을 알림)
          obj.position.set(h.x, 0, h.z)
          if (!u.dead) {
            u.dead = true
            u.deathT = 0
          }
          u.deathT += dt
          updateHeroDeathParticles(u)
          setHeroDead(u, true)
          return
        }
        if (u.dead) {
          u.dead = false
          setHeroDead(u, false) // 부활 — 파티클 제거하고 영웅 복원
          u.lastHp = h.hp // 부활 회복을 피해로 오인하지 않게 기준 갱신
        }
        obj.visible = isHeroVisible(view, h, myTeam)
        if (!obj.visible) return
        // 돌풍에 띄워지면(airT) 몸이 공중으로 떠오른다 — 띄운 동안 빙글빙글 + 위로 솟았다 내려온다
        const air = h.airT > 0 ? Math.sin(Math.min(1, (1.5 - h.airT) / 1.5 + 0.0) * Math.PI) : 0
        obj.position.set(h.x, air * 3.2, h.z)
        // 회전베기(궁극기) 중엔 팽이처럼 빠르게 돈다, 띄워지면 허우적, 평소엔 바라보는 방향
        u.body.rotation.y = h.whirlT > 0 ? -view.time * 16 : h.airT > 0 ? -view.time * 8 : -h.dir
        // 걷기: 서 있으면 숨쉬기 둥실, 움직이면 통통 튀며 좌우로 뒤뚱(속도에 따라 걸음 빨라짐)
        const wk = walkBounce(u, h.x, h.z, dt)
        const idleBob = Math.sin(view.time * 2.2 + u.bobPhase) * 0.12 * (1 - wk.amt)
        const bobOff = idleBob + wk.bounce * 0.55
        u.body.position.y = u.bodyBaseY + bobOff
        u.face.position.y = u.faceBaseY + bobOff // 얼굴도 함께 떠올라 몸통이 뚫지 않게
        if (h.whirlT <= 0 && h.airT <= 0) u.body.rotation.z = Math.sin(u.wphase) * 0.06 * wk.amt
        else u.body.rotation.z = 0
        // 다리 성큼성큼 + 팔 흔들기: 다리는 반대 위상, 팔은 같은 쪽 다리와 반대로(자연스러운 걸음)
        if (u.legs) {
          const stride = Math.sin(u.wphase) * 0.6 * wk.amt
          u.legs[0].rotation.z = stride
          u.legs[1].rotation.z = -stride
          if (u.arms) {
            u.arms[0].rotation.z = -stride * 0.65 // 오른팔(무기)은 오른다리와 반대로
            u.arms[1].rotation.z = stride * 0.65 // 왼팔
          }
        }
        // 발 딛는 순간 발밑에서 흙먼지가 퍼진다
        if (wk.step && obj.visible) {
          particles.emit(h.x, 0.2, h.z, 0xcbb894, 4, { spread: 2, up: 0.9, gravity: 4, size: 1.1, lifeMin: 0.22, lifeMax: 0.4 })
        }
        if (h.lvl !== u.nameLvl) {
          u.nameLvl = h.lvl
          setNameText(u.name, heroLabel(h), u.nameColor) // 레벨이 오르면 이름표 갱신
        }
        setHpBar(u.bar, h.hp / h.maxHp)
        setHpBarSegments(u.bar, h.maxHp) // 100단위 칸 — 최대 체력이 큰 캐릭터는 칸이 많다
        // ── 타격감: 체력이 줄면 데미지 숫자 + 피격 섬광/움찔, 내 영웅이면 화면 흔들림 ──
        const dHp = (u.lastHp == null ? h.hp : u.lastHp) - h.hp
        u.lastHp = h.hp
        if (dHp > 0.5) {
          u.hitFlash = HITFLASH_T
          u.dmgAccum = (u.dmgAccum || 0) + dHp
          // 타격 조각: 맞은 몸통 높이에서 선명한 주황빛 파편이 퐉! 사방으로 날카롭게 튀어 흩어진다(피 아님)
          if (obj.visible) {
            const n = Math.min(14, 6 + Math.round(dHp / 9))
            particles.emit(h.x, u.bodyBaseY + 0.6, h.z, 0xffb42a, n, { spread: 9, up: 9, gravity: 22, size: 1.5, hard: true, lifeMin: 0.16, lifeMax: 0.34 })
          }
        }
        u.dmgFlush = (u.dmgFlush || 0) - dt
        if ((u.dmgAccum || 0) > 0 && (u.dmgFlush <= 0 || u.dmgAccum >= 18)) {
          popDamage(h.x, h.z, u.dmgAccum, h.id === myId ? 'me' : 'dmg') // 도트는 잠깐 모아 한 덩이로
          u.dmgAccum = 0
          u.dmgFlush = 0.22
        }
        // 기절: 머리 위 💫가 빙글빙글 돈다 (어지러운 상태 표시) — 공중에 띄워진 동안은 띄우기 연출로 대체
        u.stun.visible = h.stunT > 0 && !(h.airT > 0)
        if (u.stun.visible) u.stun.material.rotation = view.time * 6
        // 공포: 머리 위 😱 — 부들부들 떨며 강제로 도망치는 중
        u.fear.visible = h.fearT > 0
        if (u.fear.visible) u.fear.material.rotation = Math.sin(view.time * 14) * 0.25
        // 빙결: 머리 위 ❄️ + 몸이 푸르게 얼어붙는다 / 광폭화: 몸이 빨갛게 달아오른다
        const frozen = h.freezeT > 0
        u.freeze.visible = frozen
        if (frozen) u.freeze.material.rotation = Math.sin(view.time * 4) * 0.4
        if (frozen) u.body.material.emissive?.setRGB(0.18, 0.35, 0.6)
        else if (h.berserkT > 0) {
          // 첫 3초 전력(1) → 이후 서서히 잦아듦. 빨갛게 + 살짝 맥동
          const st = h.berserkT > 3 ? 1 : h.berserkT / 3
          const pulse = 0.85 + Math.sin(view.time * 12) * 0.15
          u.body.material.emissive?.setRGB(0.7 * st * pulse, 0.05 * st, 0)
        } else if (h.castT > 0) {
          // 정신집중(빛의 화살): 금빛으로 점점 차오른다
          const g = 0.3 + Math.abs(Math.sin(view.time * 9)) * 0.4
          u.body.material.emissive?.setRGB(g, g * 0.85, 0.2)
        } else if (h.parryT > 0) {
          // 검성 발도 카운터: 자세를 잡는 1초 동안 은빛-청록 오라가 또렷이 맥동한다(반격 대기 신호)
          const p = 0.45 + Math.abs(Math.sin(view.time * 14)) * 0.4
          u.body.material.emissive?.setRGB(p * 0.7, p, p)
        } else u.body.material.emissive?.setRGB(0, 0, 0)
        // 피격 테두리: 맞은 순간 몸 실루엣 둘레만 잠깐 빛난다(전신 섬광 대신). 끄면 안 보인다.
        if (u.hitFlash > 0) u.hitFlash = Math.max(0, u.hitFlash - dt)
        u.outline.material.opacity = hitFxOn && u.hitFlash > 0 ? (u.hitFlash / HITFLASH_T) * 0.85 : 0
        u.recall.visible = h.recallT > 0
        u.recallBeam.visible = h.recallT > 0
        if (h.recallT > 0) {
          u.recall.rotation.z = view.time * 3
          u.recallBeam.rotation.y = view.time * 1.2
          u.recallBeam.material.opacity = 0.22 + Math.abs(Math.sin(view.time * 4)) * 0.22 // 깜빡이는 빛
        }
        u.shield.visible = h.shieldT > 0 // 탱커 방패막기(파란 막)
        // 수호기사 흡수 보호막: barrierHp가 남아 있는 동안 금색 셸 + 체력바에 흰 게이지
        const hasBarrier = h.barrierHp > 0
        u.barrier.visible = hasBarrier
        if (hasBarrier) {
          const p = 0.26 + Math.abs(Math.sin(view.time * 5)) * 0.14 // 은은한 맥동
          u.barrier.material.opacity = p
          u.barrier.scale.setScalar(1 + Math.sin(view.time * 5) * 0.03)
        }
        setHpBarShield(u.bar, h.hp / h.maxHp, (h.barrierHp || 0) / h.maxHp)
        // 수호기사 결속: 묶인 아군·수호기사를 투명한 청록 구체로 감싼다(끈 연출은 아래 별도 풀에서)
        const bound = h.bindT > 0 || h.bindAnchorT > 0
        u.bindSphere.visible = bound
        if (bound) {
          u.bindSphere.material.opacity = 0.12 + Math.abs(Math.sin(view.time * 4)) * 0.1
          u.bindSphere.rotation.y = view.time * 1.5
        }
        u.buff.visible = h.dragonT > 0 || h.baronT > 0
        u.buff.material.color.set(h.baronT > 0 ? 0x9b6bd6 : 0xffa94d)
        // 아군이 수풀에 숨거나 은신하면 반투명하게 (적에겐 아예 안 보인다)
        const hide = h.bushI >= 0 || h.stealthT > 0
        u.body.material.opacity = hide ? 0.45 : 1
        u.face.material.opacity = hide ? 0.55 : 1
        // 공격 모션: atkSeq가 바뀌면 무기를 휘두른다
        if (h.atkSeq !== u.lastAtkSeq) {
          u.lastAtkSeq = h.atkSeq
          u.animT = 0
        }
        u.animT = Math.min(1, u.animT + dt / ATK_ANIM_T)
        u.weapon.userData.pose(u.animT)
        if (h.id === myId) u.ring.rotation.z = view.time * 1.5
      }
    )
    // 결속의 끈: 묶인 아군 → 수호기사(bindBy)로 잇는 투명한 선. 양쪽이 다 보일 때만 그린다.
    {
      const seen = new Set()
      for (const h of view.heroes) {
        if (!(h.bindT > 0) || h.bindBy == null) continue
        const gh = view.heroes.find((o) => o.id === h.bindBy)
        if (!gh) continue
        const ao = heroPool.get(h.id)
        const go = heroPool.get(gh.id)
        if (!ao || !go || !ao.visible || !go.visible) continue
        seen.add(h.id)
        let line = bindPool.get(h.id)
        if (!line) { line = makeBindLine(); bindPool.set(h.id, line); scene.add(line) }
        const p = line.geometry.attributes.position.array
        p[0] = h.x; p[1] = 2.4; p[2] = h.z
        p[3] = gh.x; p[4] = 2.4; p[5] = gh.z
        line.geometry.attributes.position.needsUpdate = true
        line.material.opacity = 0.4 + Math.abs(Math.sin(view.time * 5)) * 0.25 // 맥동하는 끈
      }
      for (const [id, line] of bindPool) {
        if (seen.has(id)) continue
        scene.remove(line)
        line.geometry.dispose()
        line.material.dispose()
        bindPool.delete(id)
      }
    }
    // 미니언 — 시야 밖 적 미니언은 안 보인다
    syncPool(
      scene, minionPool, view.minions,
      (m) => buildMinion(m, barColorOf(m.team)),
      (obj, m) => {
        obj.visible = isUnitVisible(view, m, myTeam)
        obj.position.set(m.x, 0, m.z)
        const u = obj.userData
        setHpBar(u.bar, m.hp / m.maxHp)
        // 타격감: 미니언이 맞으면 데미지 숫자 + (옵션 켜짐 시) 잠깐 붉게 물든다 (막타 손맛)
        const mdHp = (u.lastHp == null ? m.hp : u.lastHp) - m.hp
        u.lastHp = m.hp
        if (mdHp > 0.5 && obj.visible) {
          popDamage(m.x, m.z, mdHp, 'dmg')
          u.hitFlash = HITFLASH_T
          particles.emit(m.x, 1.3, m.z, 0xffb42a, 6, { spread: 6, up: 7, gravity: 22, size: 1.2, hard: true, lifeMin: 0.13, lifeMax: 0.3 })
        }
        if (u.hitFlash > 0) u.hitFlash = Math.max(0, u.hitFlash - dt)
        const mf = hitFxOn && u.hitFlash > 0 ? (u.hitFlash / HITFLASH_T) * 0.55 : 0
        u.body.material?.emissive?.setRGB(mf, mf * 0.45, mf * 0.4)
        // 공격 모션: 근접은 푹 찌르고(앞으로 쿵), 원거리는 반동으로 움찔
        u.body.rotation.y = -(m.dir || 0)
        if (m.atkSeq !== u.lastAtkSeq) {
          u.lastAtkSeq = m.atkSeq
          u.animT = 0
        }
        u.animT = Math.min(1, u.animT + dt / ATK_ANIM_T)
        const pulse = Math.sin(u.animT * Math.PI)
        const lunge = (m.ranged ? -0.3 : 0.55) * pulse // 원거리는 뒤로 반동
        u.body.position.x = Math.cos(m.dir || 0) * lunge
        u.body.position.z = Math.sin(m.dir || 0) * lunge
        u.body.position.y = walkBounce(u, m.x, m.z, dt).bounce * 0.35 // 걸을 때 통통
        u.body.rotation.z = m.ranged ? pulse * 0.3 : -pulse * 0.35 // 기울이기
      }
    )
    // 정글몹/용/바론 (중립 — 늘 보인다)
    syncPool(
      scene, monsterPool,
      view.monsters.filter((m) => m.alive),
      buildMonster,
      (obj, m) => {
        obj.visible = inVision(m.x, m.z) // 안개 속 정글몹은 안 보인다
        obj.position.set(m.x, Math.sin(view.time * 2 + m.x) * 0.15, m.z)
        setHpBar(obj.userData.bar, m.hp / m.maxHp)
        // 타격감: 정글몹/용/바론이 맞으면 데미지 숫자 (오브젝트 다굴 손맛)
        const ud2 = obj.userData
        const jdHp = (ud2.lastHp == null ? m.hp : ud2.lastHp) - m.hp
        ud2.lastHp = m.hp
        if (jdHp > 0.5 && obj.visible) {
          popDamage(m.x, m.z, jdHp, 'dmg')
          particles.emit(m.x, (MONSTER_LOOK[m.kind]?.r || 2), m.z, 0xffb42a, 9, { spread: 10, up: 10, gravity: 22, size: 1.6, hard: true, lifeMin: 0.16, lifeMax: 0.34 })
        }
        // 분노(enrage): 교전이 길어질수록 붉게 달아오르고 거칠게 떤다
        //  용/바론은 멀티파트 모델이라 살갗 재질 목록(rageMats)을 물들인다
        const body = obj.userData.body
        if (body) {
          const rage = Math.min(1, (m.enrage || 0) / 6)
          const mats = ud2.rageMats || (body.material ? [body.material] : [])
          for (const mt of mats) {
            mt.emissive.setRGB(rage, 0, 0)
            mt.emissiveIntensity = rage
          }
          const shake = rage > 0 ? 1 + Math.sin(view.time * 18) * 0.06 * rage : 1
          body.scale.setScalar(shake)
        }
        ud2.anim?.(view.time) // 용 날갯짓·꼬리 / 바론 몸놀림·혀
        ud2.turn?.(m.dir ?? 0) // 공격 대상(또는 복귀 방향)을 부드럽게 바라본다
        // 공격 모션: atkSeq가 바뀌면 0.45초짜리 물기/스트라이크 포즈를 재생한다
        if (ud2.pose) {
          if (m.atkSeq !== ud2.lastAtkSeq) {
            ud2.lastAtkSeq = m.atkSeq
            if (m.atkSeq > 0) ud2.atkAt = view.time
          }
          ud2.pose(ud2.atkAt != null ? (view.time - ud2.atkAt) / 0.45 : 1)
        }
      }
    )
    // 소환물(펫/포탑) — 적 소환물은 시야 밖이면 안 보인다
    syncPool(
      scene, summonPool, view.summons || [],
      (s) => buildSummon(s, barColorOf(s.team)),
      (obj, s) => {
        obj.visible = isUnitVisible(view, s, myTeam)
        const u = obj.userData
        // 분신: 영웅과 같은 몸이라 위치/회전/체력바 + 걷기 다리 흔들기만 얹는다
        if (u.isClone) {
          obj.position.set(s.x, 0, s.z)
          u.body.rotation.y = -(s.dir || 0)
          setHpBar(u.bar, s.hp / s.maxHp)
          const stride = Math.sin(view.time * 9 + s.id) * 0.55
          if (u.legs) {
            u.legs[0].rotation.z = stride * 0.65
            u.legs[1].rotation.z = -stride * 0.65
          }
          if (u.arms) {
            u.arms[0].rotation.z = -stride * 0.5
            u.arms[1].rotation.z = stride * 0.5
          }
          // 전투형 분신의 평타: 본체와 같은 무기 휘두름 모션
          if (s.atkSeq !== u.lastAtkSeq) {
            u.lastAtkSeq = s.atkSeq
            u.animT = 0
          }
          if (u.weapon?.userData.pose && u.animT < 1) {
            u.animT = Math.min(1, u.animT + dt / ATK_ANIM_T)
            u.weapon.userData.pose(u.animT)
          }
          // 미끼 분신의 내리찍기: 살짝 떠올라 몸을 앞으로 크게 숙이며 내려찍는다 (끝나면 poof fx가 이어진다)
          if (s.slam > 0) {
            const p = 1 - s.slam / 0.35 // CLONE_SLAM_WINDUP 진행도 0→1
            obj.position.y = Math.sin(p * Math.PI) * 1.3
            u.body.rotation.z = -Math.sin(p * Math.PI) * 0.65
          } else {
            u.body.rotation.z = 0
          }
          return
        }
        // 포탑은 고정, 펫은 걸을 때 통통 튄다(멈추면 숨쉬기 둥실)
        const wkS = u.turret ? null : walkBounce(u, s.x, s.z, dt)
        const bob = u.turret ? 0
          : Math.sin(view.time * 3 + s.x) * 0.12 * (1 - wkS.amt) + wkS.bounce * 0.4
        // 사냥 명령 도약: leap(1→0) 동안 포물선으로 뛰어오른다
        const jump = s.leap ? Math.sin((1 - s.leap) * Math.PI) * 3.4 : 0
        obj.position.set(s.x, bob + jump, s.z)
        setHpBar(u.bar, s.hp / s.maxHp)
        // 포탑은 포신만, 펫은 몸 전체가 바라보는 방향으로 돈다
        const turn = u.turret ? u.body.userData?.head : u.body
        if (turn) turn.rotation.y = -(s.dir || 0)
        // 휴면(zzz): 잠든 포탑은 표시를 띄우고 얼굴을 흐리게
        if (u.zzz) {
          u.zzz.visible = obj.visible && !!s.dormant
          if (u.face) u.face.material.opacity = s.dormant ? 0.4 : 1
        }
        // 휴면 유예 타이머: 주인 이탈 후 남은 시간(s.idle, 3→0초)만큼 링이 줄어든다
        if (u.timer) {
          const frac = s.idle ? Math.min(1, s.idle / 3) : 0
          u.timer.visible = obj.visible && frac > 0
          if (frac > 0) {
            u.timer.scale.setScalar(Math.max(0.15, frac))
            u.timer.rotation.z = view.time * 2.5 // 빙글 도는 카운트다운 느낌
          }
        }
        // 과부하(엔지니어)/광폭화(야수조련사)면 살짝 달아오른다
        if (u.body.material) {
          const c = s.charge ? 1 : 0
          u.body.material.emissive?.setRGB(c * 0.6, c * 0.2, 0)
          if (u.body.material.emissiveIntensity != null) u.body.material.emissiveIntensity = c * 0.6
        }
      }
    )
    // 투사체
    syncPool(scene, projPool, view.projectiles, (p) => {
      if (p.kind === 'tornado') return buildTornadoProj() // 돌풍술사 회오리 — 빙글빙글 도는 입체 회오리
      if (p.kind === 'rock') return buildRockProj(p) // 대지술사 돌덩이 — 발광체가 아니라 진짜 돌
      const look = PROJ_LOOK[p.kind] || PROJ_LOOK.bolt
      const color = look.color ?? TEAM_COLOR[p.team]
      // 단색 구체 대신 "발광체": 밝은 코어 + 가산 후광 스프라이트(맥동) + (스킬은) 혜성 꼬리
      const g = new THREE.Group()
      const core = new THREE.Mesh(
        new THREE.SphereGeometry(look.r, 8, 6),
        new THREE.MeshBasicMaterial({ color })
      )
      const halo = glowSprite(color, look.r * (look.glow || 3))
      g.add(core, halo)
      g.position.y = look.y
      g.userData = { core, halo, color, haloBase: look.r * (look.glow || 3), trail: !!look.trail }
      return g
    }, (obj, p) => {
      obj.position.x = p.x
      obj.position.z = p.z
      obj.visible = inVision(p.x, p.z) // 안개 속 투사체도 숨긴다
      if (obj.userData.spin) { obj.userData.spin(view.time); return } // 회오리
      const u = obj.userData
      const pulse = 1 + Math.sin(view.time * 16 + p.x) * 0.2 // 발광 맥동
      u.halo.scale.set(u.haloBase * pulse, u.haloBase * pulse, 1)
      u.core.scale.setScalar(0.85 + Math.sin(view.time * 22 + p.z) * 0.15)
      // 혜성 꼬리: 지나온 자리에 발광 알갱이를 흘려 서서히 잦아든다
      if (u.trail && obj.visible) {
        particles.emit(p.x, obj.position.y, p.z, u.color, 1, { spread: 0.6, up: 0.5, gravity: 2, size: 0.8, lifeMin: 0.18, lifeMax: 0.34 })
      }
    })
    // 대지술사 임시 돌벽 — 물리적 지형이라 안개와 무관하게 항상 보인다(안 보이는 벽에 막히면 억울하다)
    syncPool(scene, stoneWallPool, view.stoneWalls || [], buildStoneWall, (obj, w) => {
      obj.userData.update?.(w)
    })
    // 지면 범위 장판 (운석 조준+낙하 / 바론 독 웅덩이)
    syncPool(
      scene, zonePool, view.zones || [],
      (z) => (z.kind === 'venom' ? buildVenomZone(z) : buildMeteorZone(z)),
      (obj, z) => {
        obj.visible = inVision(z.x, z.z) // 안개 속 장판은 숨긴다
        obj.userData.update?.(z)
      }
    )
    // 스킬/이벤트 이펙트 (동심원 링 + 방향성 직선 + 파티클). 골드 표시는 내 막타만.
    const fxList = view.fx.filter((n) => n.kind !== 'gold' || n.owner === myId)
    syncPool(scene, fxPool, fxList,
      (n) => (n.kind === 'gold' ? goldSprite(n) : buildFxObject(n)),
      (obj, n) => {
        obj.visible = inVision(n.x, n.z) // 안개 속 이펙트도 숨긴다
        if (obj.isSprite) { // 골드 "+N"
          obj.position.y = 5 + n.t * 7 // 위로 떠오르며
          obj.material.opacity = Math.max(0, 1 - n.t / 0.8) // 서서히 사라진다
          return
        }
        obj.userData.update?.(n.t)
      })

    // 떠오르는 데미지 숫자 — 솟았다 천천히 내려오며 사라진다(피격 위치가 안개면 숨긴다)
    for (const d of dmgNumbers) {
      const ud = d.userData
      if (ud.t >= ud.life) { d.visible = false; continue }
      ud.t += dt
      const k = ud.t / ud.life
      d.position.set(ud.x0 + ud.vx * ud.t, 6 + ud.vy * ud.t - 4.6 * ud.t * ud.t, ud.z0)
      const pop = ud.t < 0.1 ? 1 + (0.1 - ud.t) / 0.1 * 0.7 : 1 // 등장 팝
      d.scale.set(ud.s * pop, ud.s * 0.5 * pop, 1)
      d.material.opacity = k < 0.55 ? 1 : Math.max(0, 1 - (k - 0.55) / 0.45)
      d.visible = inVision(d.position.x, d.position.z)
    }

    // 전장의 안개 (관전자는 안개 없음 / 경기가 끝나면 걷어 폭발 연출이 또렷이 보이게)
    // 시야는 천천히 변하므로 품질에 따라 몇 프레임에 한 번만 캔버스를 다시 그려 재업로드 비용을 아낀다.
    const fogVisible = !!myTeam && view.status !== 'finished'
    if (fogVisible) {
      if (!fog.plane.visible || frameN % Q.fogEvery === 0) fog.update(view, myTeam) // 켜진 첫 프레임엔 즉시 갱신
    }
    fog.plane.visible = fogVisible

    // 넥서스 폭발 연출: finished로 막 바뀐 순간 진 쪽 넥서스를 크게 "펑" 번쩍(+카메라가 그리로 모인다)
    const loser = view.winner === 'blue' ? 'red' : view.winner === 'red' ? 'blue' : null
    if (view.status === 'finished' && prevStatus !== 'finished' && loser) {
      endT = 0
      endFlash.position.set(NEXUS_POS[loser].x, 6, NEXUS_POS[loser].z)
    }
    prevStatus = view.status
    if (endT >= 0) {
      endT += dt
      const k = Math.min(1, endT / 0.7)
      endFlash.visible = k < 1
      endFlash.scale.setScalar(2 + k * 20)
      endFlash.material.opacity = (1 - k) * 0.92
      if (k >= 1) { endT = -1; endFlash.visible = false }
    }

    // 카메라: 평소엔 내 영웅을, 경기가 끝나면 터진 넥서스로 모아 폭발을 보여 준다(관전은 위에서 전체)
    const want = _want
    let offY = 42
    let offZ = 30
    const endNexus = view.status === 'finished' && loser ? NEXUS_POS[loser] : null
    if (endNexus) {
      want.set(endNexus.x, 0, endNexus.z) // 터진 최종 건물로 시선 집중
      offY = 30
      offZ = 24
    } else if (me) {
      want.set(me.x, 0, me.z)
    } else {
      want.set(0, 0, 0)
      offY = 95
      offZ = 60
    }
    if (!camInit) {
      camTarget.copy(want)
      camInit = true
    } else {
      camTarget.lerp(want, endNexus ? 0.08 : 0.12)
    }
    camera.position.set(camTarget.x, camTarget.y + offY, camTarget.z + offZ)
    camera.lookAt(camTarget.x, 0, camTarget.z - 6)
    renderer.render(scene, camera)
  }

  return {
    resize(w, h) {
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    },
    render,
    setHitFx(on) { hitFxOn = !!on }, // 피격 테두리·화면 흔들림 켜고 끄기(데미지 숫자는 유지)
    dispose() {
      renderer.dispose()
      scene.traverse((o) => {
        o.geometry?.dispose?.()
        if (o.material) {
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
            m.map?.dispose?.()
            m.dispose?.()
          }
        }
      })
    },
  }
}
