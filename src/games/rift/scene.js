// 파티 리프트 3D 렌더러 (three.js).
// 엔진의 makeView() 스냅샷만 보고 그린다 — 호스트/게스트 공용.
// 로블록스 풍 러프 3D: 단색 로우폴리 몸통 + 이모지 얼굴 스프라이트.
// 내 팀 시야 기준으로 전장의 안개(어둠)와 수풀 은신을 그린다.
import * as THREE from 'three'
import { getZodiac } from '../../shared/zodiac.js'
import {
  WORLD, NEXUS_POS, NEXUS_RADIUS, FOUNTAIN_RADIUS, LANES, LANE_IDS, ROCKS, BUSHES,
  DRAGON_PIT, BARON_PIT,
} from './map.js'
import { CLASSES, isHeroVisible, isUnitVisible, SIGHT_RANGE } from './engine.js'

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

// 이름표 스프라이트 (흰 글씨 + 어두운 테두리)
function nameSprite(text, color = '#ffffff') {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 64
  const ctx = c.getContext('2d')
  ctx.font = '800 30px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineWidth = 7
  ctx.strokeStyle = 'rgba(10, 16, 32, 0.85)'
  ctx.strokeText(text, 128, 34)
  ctx.fillStyle = color
  ctx.fillText(text, 128, 34)
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
  g.userData = { crystal, body, rubble, bar }
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
  g.add(base, core, bar)
  g.userData = { core, bar }
  return g
}

// 직업별 몸집: 탱커는 듬직하게, 암살자는 날렵하게
const CLS_SCALE = { tank: 1.25, warrior: 1.1, assassin: 0.9 }

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
  const cls = CLASSES[h.cls]
  const name = nameSprite(
    `${cls?.icon || ''}${h.name}${h.isBot ? '🤖' : ''}`,
    mine ? '#ffe066' : '#ffffff'
  )
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
  g.add(body, face, name, bar, ring, buff, shield, stun)
  g.userData = { body, face, bar, ring, buff, shield, stun }
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
  g.userData = { bar }
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
  g.userData = { bar }
  return g
}

const PROJ_LOOK = {
  bolt: { r: 0.4, y: 2.4, color: null }, // null → 팀 색
  fireball: { r: 0.95, y: 2, color: 0xff8c2e },
  towerbolt: { r: 0.55, y: 4, color: null },
}

// 스킬 이펙트 링 색 (kind → 색/높이)
const FX_LOOK = {
  whirl: { color: 0xffa94d },
  storm: { color: 0x9b6bd6 },
  rain: { color: 0xff5f5f },
  slam: { color: 0xc9a06a },
  sanctuary: { color: 0x6ee7a0 },
  heal: { color: 0x6ee7a0 },
  boom: { color: 0xff8c2e },
  dash: { color: 0xffffff },
  blink: { color: 0x6b6f8a },
  execute: { color: 0xff3b3b },
  level: { color: 0xffe066 },
  death: { color: 0x39405c },
  shield: { color: 0x9fd0ff },
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
    pool.delete(id)
  }
}

// 전장의 안개: 캔버스에 아군 시야만큼 구멍을 뚫어 어둠 텍스처로 쓴다
function createFog() {
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
    punch(NEXUS_POS[myTeam].x, NEXUS_POS[myTeam].z, SIGHT_RANGE)
    tex.needsUpdate = true
  }
  return { plane, update }
}

export function createRiftScene(canvas) {
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
  const fog = createFog()
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

  function render(view, myId) {
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
        // 아직 공격 못 하는 타워는 크리스탈이 흐릿하게
        u.crystal.material.emissiveIntensity = t.vuln ? 0.45 : 0.15
      }
    }
    // 넥서스
    for (const team of ['blue', 'red']) {
      const nx = view.nexus[team]
      const u = nexusObjs[team].userData
      u.core.rotation.y += 0.015
      u.core.visible = nx.hp > 0
      setHpBar(u.bar, nx.hp / nx.maxHp)
      u.core.material.emissiveIntensity = nx.vuln ? 0.7 : 0.4
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
        setHpBar(u.bar, h.hp / h.maxHp)
        u.stun.visible = h.stunT > 0
        u.shield.visible = h.shieldT > 0
        u.buff.visible = h.dragonT > 0 || h.baronT > 0
        u.buff.material.color.set(h.baronT > 0 ? 0x9b6bd6 : 0xffa94d)
        // 아군이 수풀에 숨으면 반투명하게 (적에겐 아예 안 보인다)
        const hide = h.bushI >= 0
        u.body.material.opacity = hide ? 0.5 : 1
        u.face.material.opacity = hide ? 0.6 : 1
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
        setHpBar(obj.userData.bar, m.hp / m.maxHp)
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
    // 스킬/이벤트 이펙트 링 (퍼져나가며 사라진다)
    syncPool(scene, fxPool, view.fx, (n) => {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.8, 1, 36),
        new THREE.MeshBasicMaterial({
          color: FX_LOOK[n.kind]?.color ?? 0xffd34d, transparent: true, side: THREE.DoubleSide,
        })
      )
      ring.rotation.x = -Math.PI / 2
      ring.position.set(n.x, 0.3, n.z)
      return ring
    }, (obj, n) => {
      const f = Math.min(1, n.t / 0.6)
      obj.scale.setScalar(1 + f * (n.r || 4))
      obj.material.opacity = 1 - f
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
