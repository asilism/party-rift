// 파티 리프트 3D 렌더러 (three.js).
// 엔진의 makeView() 스냅샷만 보고 그린다 — 호스트/게스트 공용.
// 로블록스 풍 러프 3D: 단색 로우폴리 몸통 + 이모지 얼굴 스프라이트.
// 내 팀 시야 기준으로 전장의 안개(어둠)와 수풀 은신을 그린다.
import * as THREE from 'three'
import { getZodiac } from '../../shared/zodiac.js'
import {
  NEXUS_RADIUS, FOUNTAIN_RADIUS, LANE_IDS, WALL_RADIUS, buildMap,
} from './map.js'
import { CLASSES, isHeroVisible, isUnitVisible, SIGHT_RANGE, TOWER_RANGE } from './engine.js'

export const TEAM_COLOR = { blue: 0x4f8cff, red: 0xff6b6b }
const ALLY_HP = 0x4ade80
const ENEMY_HP = 0xff5f5f

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
  g.add(bg, fg)
  g.userData = { fg, width: width - 0.1 }
  return g
}

function setHpBar(bar, frac) {
  bar.userData.fg.scale.x = Math.max(0.001, bar.userData.width * Math.max(0, Math.min(1, frac)))
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

// 직업별 몸집: 탱커는 듬직하게, 암살자는 날렵하게
const CLS_SCALE = { tank: 1.25, warrior: 1.1, assassin: 0.9 }

const ATK_ANIM_T = 0.35 // 공격 모션 길이 (초)

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
  // 탱커 방패막기 보호막
  const shield = new THREE.Mesh(
    new THREE.SphereGeometry(2.6 * s, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0x9fd0ff, transparent: true, opacity: 0.3, depthWrite: false })
  )
  shield.position.y = 2.2 * s
  shield.visible = false
  const stun = emojiSprite('💫', 2)
  stun.position.y = 5.4 * s
  stun.visible = false
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
  // 직업 무기 — 몸통에 붙여 바라보는 방향과 함께 돈다
  const weapon = buildWeapon(h.cls)
  body.add(weapon)
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
  g.add(shadow, body, face, name, bar, ring, buff, shield, stun, recall, recallBeam, deathPts)
  g.userData = {
    body, face, name, nameColor, nameLvl: h.lvl, isMine: mine, shadow,
    bodyBaseY: 2.2 * s, bobPhase: (hashStr(h.id) % 628) / 100,
    bar, ring, buff, shield, stun, recall, recallBeam, weapon, lastAtkSeq: h.atkSeq, animT: 1,
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
    u.stun.visible = false
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
  dragon: { emoji: '🐉', size: 4.6, body: 0x59b96a, r: 2.4 },
  baron: { emoji: '👹', size: 5, body: 0x9b6bd6, r: 2.8 },
}

function buildMonster(m) {
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

const PROJ_LOOK = {
  bolt: { r: 0.4, y: 2.4, color: null }, // null → 팀 색
  mbolt: { r: 0.26, y: 1.5, color: null }, // 원거리 미니언의 작은 화살 (낮고 작게)
  fireball: { r: 0.95, y: 2, color: 0xff8c2e },
  towerbolt: { r: 0.55, y: 4, color: null },
  pierce: { r: 0.34, y: 2.2, color: 0xfff0a0 }, // 궁수 꿰뚫는 화살 (밝은 노랑)
}

// 스킬 이펙트 색 + 파티클 모드 (kind → 색/파티클 움직임).
//  mode: out(바깥으로) · rise(위로) · fall(위에서 아래로) · forward(앞으로, dir 방향)
const FX_LOOK = {
  whirl: { color: 0xffa94d, ring: true, mode: 'out', pcolor: 0xffe0b0 },
  storm: { color: 0x9b6bd6, ring: true, mode: 'out', pcolor: 0xd0a0ff },
  rain: { color: 0xff5f5f, ring: true, mode: 'fall', pcolor: 0xffc0c0 },
  sanctuary: { color: 0x6ee7a0, ring: true, mode: 'rise', pcolor: 0xb6f5cf },
  heal: { color: 0x6ee7a0, ring: true, mode: 'rise', pcolor: 0xb6f5cf },
  boom: { color: 0xff8c2e, ring: true, mode: 'out', pcolor: 0xffd28a },
  blink: { color: 0x9a7bff, ring: true, mode: 'out', pcolor: 0xc9b8ff },
  execute: { color: 0xff3b3b, ring: true, mode: 'out', pcolor: 0xff9a9a },
  level: { color: 0xffe066, ring: true, mode: 'rise', pcolor: 0xfff0a0 },
  death: { color: 0x39405c, ring: true, mode: 'out' },
  shield: { color: 0x9fd0ff, ring: true, mode: 'rise', pcolor: 0xd0eaff },
  recall: { color: 0x4ad6e0, ring: true, mode: 'rise', pcolor: 0xa0f0f7 },
  // 앞으로 뻗는 방향성 스킬
  dash: { color: 0xffffff, line: true, mode: 'forward', pcolor: 0xffffff, w: 2.2 },
  fissure: { color: 0xc9863c, line: true, mode: 'forward', pcolor: 0xffb060, w: 3.4, ground: true },
  volley: { color: 0xfff0a0, line: true, mode: 'forward', pcolor: 0xfff4c0, w: 1.4 },
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
  if (look.pcolor !== undefined || look.mode) {
    const burst = makeBurst(n, look)
    g.add(burst)
    ups.push((t) => burst.userData.update(t))
  }
  g.userData.update = (t) => { for (const u of ups) u(t) }
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
    punch(map.NEXUS_POS[myTeam].x, map.NEXUS_POS[myTeam].z, SIGHT_RANGE)
    tex.needsUpdate = true
  }
  return { plane, update }
}

export function createRiftScene(canvas, map = buildMap('3v3')) {
  const { WORLD, NEXUS_POS, LANES, ROCKS, BUSHES, WALL_LINES, DRAGON_PIT, BARON_PIT } = map
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
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
  // 우물 (회복 지대) 표시 — 원판 + 빛나는 테두리
  for (const team of ['blue', 'red']) {
    const pad = new THREE.Mesh(
      new THREE.CircleGeometry(FOUNTAIN_RADIUS, 40),
      new THREE.MeshLambertMaterial({ color: TEAM_COLOR[team], transparent: true, opacity: 0.3 })
    )
    pad.rotation.x = -Math.PI / 2
    pad.position.set(NEXUS_POS[team].x, 0.04, NEXUS_POS[team].z)
    const rim = new THREE.Mesh(
      new THREE.RingGeometry(FOUNTAIN_RADIUS - 0.9, FOUNTAIN_RADIUS, 48),
      new THREE.MeshBasicMaterial({ color: TEAM_COLOR[team], transparent: true, opacity: 0.55, side: THREE.DoubleSide })
    )
    rim.rotation.x = -Math.PI / 2
    rim.position.set(NEXUS_POS[team].x, 0.05, NEXUS_POS[team].z)
    scene.add(pad, rim)
  }
  // 용/바론 둥지 (모래 바닥 + 테두리 돌무더기)
  const pitRnd = lcg(4242)
  for (const pit of [DRAGON_PIT, BARON_PIT]) {
    const pad = new THREE.Mesh(
      new THREE.CircleGeometry(8, 32),
      new THREE.MeshLambertMaterial({ color: 0xc9b285 })
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
        new THREE.MeshLambertMaterial({ color: 0x8a8f9c, flatShading: true })
      )
      rock.position.set(pit.x + Math.cos(a) * 8, rr * 0.5, pit.z + Math.sin(a) * 8)
      rock.rotation.set(pitRnd() * 3, pitRnd() * 3, pitRnd() * 3)
      scene.add(rock)
    }
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
    scene.add(g)
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
    scene.add(tree)
  }

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
  const projPool = new Map()
  const fxPool = new Map()

  const camTarget = new THREE.Vector3(0, 0, 0)
  let camInit = false
  let lastT = null // 공격 모션 진행용 프레임 시간

  function render(view, myId) {
    const dt = lastT == null ? 0 : Math.max(0, Math.min(0.1, view.time - lastT))
    lastT = view.time
    waterTex.offset.y -= dt * 0.04 // 강물이 천천히 흐른다
    // 빛 입자: 위아래로 흔들리며 옆으로 살랑인다
    const mp = moteGeo.attributes.position.array
    for (let i = 0; i < MOTE_N; i++) {
      mp[i * 3] += Math.sin(view.time * 0.2 + i) * 0.02
      mp[i * 3 + 1] = moteBaseY[i] + Math.sin(view.time * 0.6 + i * 1.3) * 1.2
    }
    moteGeo.attributes.position.needsUpdate = true
    const me = view.heroes.find((h) => h.id === myId)
    const myTeam = me?.team || null // 관전이면 모든 게 보인다
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
      return (nx.x - x) ** 2 + (nx.z - z) ** 2 <= SIGHT2
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
        }
        obj.visible = isHeroVisible(view, h, myTeam)
        if (!obj.visible) return
        obj.position.set(h.x, 0, h.z)
        u.body.rotation.y = -h.dir
        // 미세한 숨쉬기/제자리 둥실 모션
        u.body.position.y = u.bodyBaseY + Math.sin(view.time * 2.2 + u.bobPhase) * 0.12
        if (h.lvl !== u.nameLvl) {
          u.nameLvl = h.lvl
          setNameText(u.name, heroLabel(h), u.nameColor) // 레벨이 오르면 이름표 갱신
        }
        setHpBar(u.bar, h.hp / h.maxHp)
        u.stun.visible = h.stunT > 0
        u.recall.visible = h.recallT > 0
        u.recallBeam.visible = h.recallT > 0
        if (h.recallT > 0) {
          u.recall.rotation.z = view.time * 3
          u.recallBeam.rotation.y = view.time * 1.2
          u.recallBeam.material.opacity = 0.22 + Math.abs(Math.sin(view.time * 4)) * 0.22 // 깜빡이는 빛
        }
        u.shield.visible = h.shieldT > 0
        u.buff.visible = h.dragonT > 0 || h.baronT > 0
        u.buff.material.color.set(h.baronT > 0 ? 0x9b6bd6 : 0xffa94d)
        // 아군이 수풀에 숨으면 반투명하게 (적에겐 아예 안 보인다)
        const hide = h.bushI >= 0
        u.body.material.opacity = hide ? 0.5 : 1
        u.face.material.opacity = hide ? 0.6 : 1
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
    // 미니언 — 시야 밖 적 미니언은 안 보인다
    syncPool(
      scene, minionPool, view.minions,
      (m) => buildMinion(m, barColorOf(m.team)),
      (obj, m) => {
        obj.visible = isUnitVisible(view, m, myTeam)
        obj.position.set(m.x, 0, m.z)
        const u = obj.userData
        setHpBar(u.bar, m.hp / m.maxHp)
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
        // 분노(enrage): 교전이 길어질수록 붉게 달아오르고 거칠게 떤다
        const body = obj.userData.body
        if (body) {
          const rage = Math.min(1, (m.enrage || 0) / 6)
          body.material.emissive.setRGB(rage, 0, 0)
          body.material.emissiveIntensity = rage
          const shake = rage > 0 ? 1 + Math.sin(view.time * 18) * 0.06 * rage : 1
          body.scale.setScalar(shake)
        }
      }
    )
    // 투사체
    syncPool(scene, projPool, view.projectiles, (p) => {
      const look = PROJ_LOOK[p.kind] || PROJ_LOOK.bolt
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(look.r, 8, 6),
        new THREE.MeshBasicMaterial({ color: look.color ?? TEAM_COLOR[p.team] })
      )
      m.position.y = look.y
      return m
    }, (obj, p) => {
      obj.position.x = p.x
      obj.position.z = p.z
      obj.visible = inVision(p.x, p.z) // 안개 속 투사체도 숨긴다
    })
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

    // 전장의 안개 (관전자는 안개 없음)
    fog.plane.visible = !!myTeam
    if (myTeam) fog.update(view, myTeam)

    // 카메라: 내 영웅 따라가기 (관전이면 전체가 보이게 위에서)
    const want = new THREE.Vector3()
    let offY = 42
    let offZ = 30
    if (me) {
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
      camTarget.lerp(want, 0.12)
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
