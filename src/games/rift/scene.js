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

// 시드 고정 난수 (장식 나무 배치가 모든 기기에서 동일하게)
function lcg(seed) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

// 레인 리본: 경유지를 따라 일정 폭의 길을 깐다
function buildLane(wps, width, color, y = 0.03) {
  const pos = []
  const idx = []
  for (let i = 0; i < wps.length; i++) {
    const prev = wps[Math.max(0, i - 1)]
    const next = wps[Math.min(wps.length - 1, i + 1)]
    let dx = next.x - prev.x
    let dz = next.z - prev.z
    const d = Math.hypot(dx, dz) || 1
    const nx = -dz / d
    const nz = dx / d
    pos.push(wps[i].x + nx * width, y, wps[i].z + nz * width)
    pos.push(wps[i].x - nx * width, y, wps[i].z - nz * width)
    if (i > 0) {
      const a = (i - 1) * 2
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide }))
}

function buildTower(team) {
  const g = new THREE.Group()
  const col = TEAM_COLOR[team]
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(1.7, 2.4, 7, 8),
    new THREE.MeshLambertMaterial({ color: 0x8d99b5 })
  )
  body.position.y = 3.5
  const crystal = new THREE.Mesh(
    new THREE.OctahedronGeometry(1.5),
    new THREE.MeshLambertMaterial({ color: col, emissive: col, emissiveIntensity: 0.45 })
  )
  crystal.position.y = 8.2
  g.add(body, crystal)
  const rubble = new THREE.Mesh(
    new THREE.CylinderGeometry(2.2, 2.5, 1.2, 8),
    new THREE.MeshLambertMaterial({ color: 0x5d6679 })
  )
  rubble.position.y = 0.6
  rubble.visible = false
  g.add(rubble)
  const bar = makeHpBar(4, col)
  bar.position.y = 10.4
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
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(NEXUS_RADIUS + 1, NEXUS_RADIUS + 2, 2, 10),
    new THREE.MeshLambertMaterial({ color: 0x768099 })
  )
  base.position.y = 1
  const core = new THREE.Mesh(
    new THREE.OctahedronGeometry(3.4),
    new THREE.MeshLambertMaterial({ color: col, emissive: col, emissiveIntensity: 0.5 })
  )
  core.position.y = 6
  const bar = makeHpBar(7, col)
  bar.position.y = 11
  const lock = lockLabel()
  lock.position.y = 13
  lock.visible = false
  g.add(base, core, bar, lock)
  g.userData = { core, bar, lock }
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
  g.add(body, face, name, bar, ring, buff, shield, stun, recall, recallBeam)
  g.userData = {
    body, face, name, nameColor, nameLvl: h.lvl,
    bar, ring, buff, shield, stun, recall, recallBeam, weapon, lastAtkSeq: h.atkSeq, animT: 1,
  }
  return g
}

function buildMinion(m, barColor) {
  const g = new THREE.Group()
  const col = TEAM_COLOR[m.team]
  const body = new THREE.Mesh(
    m.ranged ? new THREE.ConeGeometry(0.8, 1.9, 6) : new THREE.BoxGeometry(1.2, 1.5, 1.2),
    new THREE.MeshLambertMaterial({ color: col })
  )
  body.position.y = 0.95
  const eye = emojiSprite(m.ranged ? '🏹' : '🗡️', 1.2)
  eye.position.y = 2.2
  const bar = makeHpBar(1.6, barColor)
  bar.position.y = 3
  g.add(body, eye, bar)
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
  g.add(body, face, bar)
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
  c.width = 256
  c.height = 192
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
    ctx.fillStyle = 'rgba(8, 12, 28, 0.55)'
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
  scene.background = new THREE.Color(0x9fd4f0)
  scene.fog = new THREE.Fog(0x9fd4f0, 120, 260)
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.5, 400)
  camera.position.set(0, 60, 50)

  scene.add(new THREE.HemisphereLight(0xeaf4ff, 0x5e7a4e, 1.0))
  const sun = new THREE.DirectionalLight(0xfff4d6, 1.4)
  sun.position.set(60, 90, 30)
  scene.add(sun)

  // ── 지형 ──
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD.maxX - WORLD.minX + 80, WORLD.maxZ - WORLD.minZ + 80),
    new THREE.MeshLambertMaterial({ color: 0x69b85e })
  )
  ground.rotation.x = -Math.PI / 2
  scene.add(ground)
  // 강 (가운데 세로 물길 — 용/바론 둥지를 잇는다)
  const river = new THREE.Mesh(
    new THREE.PlaneGeometry(15, WORLD.maxZ - WORLD.minZ + 10),
    new THREE.MeshLambertMaterial({ color: 0x6cc4e8 })
  )
  river.rotation.x = -Math.PI / 2
  river.position.y = 0.02
  scene.add(river)
  // 레인 길 3갈래
  for (const lane of LANE_IDS) scene.add(buildLane(LANES[lane], 5, 0xd9c79a))
  // 우물 (회복 지대) 표시
  for (const team of ['blue', 'red']) {
    const pad = new THREE.Mesh(
      new THREE.CircleGeometry(FOUNTAIN_RADIUS, 28),
      new THREE.MeshLambertMaterial({ color: TEAM_COLOR[team], transparent: true, opacity: 0.3 })
    )
    pad.rotation.x = -Math.PI / 2
    pad.position.set(NEXUS_POS[team].x, 0.04, NEXUS_POS[team].z)
    scene.add(pad)
  }
  // 용/바론 둥지 (모래 바닥)
  for (const pit of [DRAGON_PIT, BARON_PIT]) {
    const pad = new THREE.Mesh(
      new THREE.CircleGeometry(8, 22),
      new THREE.MeshLambertMaterial({ color: 0xc9b285 })
    )
    pad.rotation.x = -Math.PI / 2
    pad.position.set(pit.x, 0.05, pit.z)
    scene.add(pad)
  }
  // 바위
  for (const r of ROCKS) {
    const rock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(r.r),
      new THREE.MeshLambertMaterial({ color: 0x8a8f9c })
    )
    rock.position.set(r.x, r.r * 0.5, r.z)
    rock.rotation.set(r.x * 0.3, r.z * 0.3, 0)
    scene.add(rock)
  }
  // 성벽: 길이 아닌 곳을 막는 바위 능선 (충돌 원들과 같은 라인)
  const wallMat = new THREE.MeshLambertMaterial({ color: 0x7d8494 })
  const wallTopMat = new THREE.MeshLambertMaterial({ color: 0x69b85e })
  for (const w of WALL_LINES) {
    const len = Math.hypot(w.x2 - w.x1, w.z2 - w.z1) + WALL_RADIUS * 2
    const g = new THREE.Group()
    const body = new THREE.Mesh(new THREE.BoxGeometry(len, 4.6, WALL_RADIUS * 2), wallMat)
    body.position.y = 2.3
    const top = new THREE.Mesh(new THREE.BoxGeometry(len, 0.7, WALL_RADIUS * 2 - 0.8), wallTopMat)
    top.position.y = 4.7 // 능선 위 풀
    g.add(body, top)
    g.position.set((w.x1 + w.x2) / 2, 0, (w.z1 + w.z2) / 2)
    g.rotation.y = -Math.atan2(w.z2 - w.z1, w.x2 - w.x1)
    scene.add(g)
  }

  // 수풀 (들어가면 은신!) — 잎뭉치 여러 개로 풍성하게
  const bushRnd = lcg(7)
  for (const b of BUSHES) {
    const g = new THREE.Group()
    for (let i = 0; i < 5; i++) {
      const blob = new THREE.Mesh(
        new THREE.SphereGeometry(b.r * (0.45 + bushRnd() * 0.25), 8, 6),
        new THREE.MeshLambertMaterial({ color: 0x2f7d3d, transparent: true, opacity: 0.92 })
      )
      blob.scale.y = 0.55
      const ang = (i / 5) * Math.PI * 2
      blob.position.set(Math.cos(ang) * b.r * 0.45, 0.8 + bushRnd() * 0.5, Math.sin(ang) * b.r * 0.45)
      g.add(blob)
    }
    g.position.set(b.x, 0, b.z)
    scene.add(g)
  }
  // 장식 나무 (맵 밖 둘레)
  const rnd = lcg(20260612)
  for (let i = 0; i < 70; i++) {
    const ang = rnd() * Math.PI * 2
    const rad = 1.1 + rnd() * 0.35
    const x = Math.cos(ang) * (WORLD.maxX + 8 + rnd() * 26)
    const z = Math.sin(ang) * (WORLD.maxZ + 6 + rnd() * 20)
    // 전장 안(직사각형)에 떨어지는 나무는 건너뛴다 — 유령 나무 방지
    if (x > WORLD.minX - 2 && x < WORLD.maxX + 2 && z > WORLD.minZ - 2 && z < WORLD.maxZ + 2) continue
    const tree = new THREE.Group()
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.7, 3),
      new THREE.MeshLambertMaterial({ color: 0x7a5a3a })
    )
    trunk.position.y = 1.5
    const top = new THREE.Mesh(
      new THREE.ConeGeometry(2.6 * rad, 6 * rad, 7),
      new THREE.MeshLambertMaterial({ color: 0x2f7d3d })
    )
    top.position.y = 3 + 3 * rad
    tree.add(trunk, top)
    tree.position.set(x, 0, z)
    scene.add(tree)
  }

  // ── 전장의 안개 ──
  const fog = createFog(map)
  fog.plane.visible = false
  scene.add(fog.plane)

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
    const me = view.heroes.find((h) => h.id === myId)
    const myTeam = me?.team || null // 관전이면 모든 게 보인다
    const barColorOf = (team) =>
      myTeam ? (team === myTeam ? ALLY_HP : ENEMY_HP) : TEAM_COLOR[team]

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
        u.crystal.material.emissiveIntensity = t.vuln ? 0.45 : 0.15
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
        obj.visible = !dead && isHeroVisible(view, h, myTeam)
        if (!obj.visible) return
        obj.position.set(h.x, 0, h.z)
        const u = obj.userData
        u.body.rotation.y = -h.dir
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
    })
    // 스킬/이벤트 이펙트 (동심원 링 + 방향성 직선 + 파티클). 골드 표시는 내 막타만.
    const fxList = view.fx.filter((n) => n.kind !== 'gold' || n.owner === myId)
    syncPool(scene, fxPool, fxList,
      (n) => (n.kind === 'gold' ? goldSprite(n) : buildFxObject(n)),
      (obj, n) => {
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
