// 파티 카트 3D 렌더러 (three.js).
// 엔진의 makeView() 스냅샷만 보고 그린다 — 호스트/게스트 공용.
import * as THREE from 'three'
import { getZodiac } from '../../shared/zodiac.js'
import { PAD_HALF_W, obstaclePose, obstacleVisible } from './track.js'
import { FLY_TIME } from './engine.js'

// 이모지 한 글자를 캔버스에 그려 스프라이트 텍스처로 만든다
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
    new THREE.SpriteMaterial({ map: emojiTexture(emoji), depthWrite: false })
  )
  sp.scale.set(scale, scale, 1)
  return sp
}

// 시드 고정 난수 (나무 배치가 모든 기기에서 동일하게)
function lcg(seed) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

// 도로 리본 (센터라인 ± halfW)
function buildRoad(track, color) {
  const { samples, n, halfW } = track
  const pos = []
  const idx = []
  for (let i = 0; i < n; i++) {
    const s = samples[i]
    pos.push(s.x + s.nx * halfW, 0.02, s.z + s.nz * halfW)
    pos.push(s.x - s.nx * halfW, 0.02, s.z - s.nz * halfW)
    const a = i * 2
    const b = ((i + 1) % n) * 2
    idx.push(a, a + 1, b, a + 1, b + 1, b)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  return new THREE.Mesh(
    geo,
    new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide })
  )
}

// 빙판 구간: 도로 전체 폭을 얼음색으로 칠한다 (눈꽃 빙판 전용).
// 도로 면에 딱 붙도록 폴리곤 오프셋으로 z-파이팅만 피하고(불투명),
// 입구/출구는 도로색과 섞어 자연스럽게 이어 붙인다.
function buildIce(track) {
  const g = new THREE.Group()
  const mat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  })
  const iceCol = new THREE.Color(0xb8e2f5)
  const roadCol = new THREE.Color(track.theme.road)
  const FADE = 6 // 입구/출구에서 도로색 → 얼음색으로 섞이는 샘플 수
  for (const zn of track.ice || []) {
    const pos = []
    const col = []
    const idx = []
    const c = new THREE.Color()
    let v = 0
    for (let i = zn.from; i <= zn.to; i++) {
      const s = track.samples[i % track.n]
      const w = track.halfW
      const into = Math.min(i - zn.from, zn.to - i) // 구간 끝에서의 거리
      c.copy(roadCol).lerp(iceCol, Math.min(1, into / FADE))
      pos.push(s.x + s.nx * w, 0.025, s.z + s.nz * w)
      pos.push(s.x - s.nx * w, 0.025, s.z - s.nz * w)
      col.push(c.r, c.g, c.b, c.r, c.g, c.b)
      if (i < zn.to) {
        idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2)
      }
      v += 2
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    geo.setIndex(idx)
    geo.computeVertexNormals()
    g.add(new THREE.Mesh(geo, mat))
  }
  return g
}

// 글자 하나를 캔버스에 그려 스프라이트 텍스처로 (아이템 박스의 '?' 등)
function textTexture(text, size = 128) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')
  ctx.font = `900 ${size * 0.72}px system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineWidth = size * 0.09
  ctx.strokeStyle = 'rgba(20, 40, 80, 0.9)'
  ctx.strokeText(text, size / 2, size / 2 + size * 0.03)
  ctx.fillStyle = '#ffffff'
  ctx.fillText(text, size / 2, size / 2 + size * 0.03)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

// 가속 발판: 진행 방향을 가리키는 무지개 그라데이션 화살표(Λ) 2개.
// 폭은 카트 한 대 크기 (판정과 동일한 PAD_HALF_W).
function buildPads(track) {
  const g = new THREE.Group()
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.95,
  })
  const makeChevron = (pad, fwdOff) => {
    const s = track.samples[pad.i]
    const w = PAD_HALF_W
    const L = 2.2 // 꼭짓점이 앞으로 나오는 길이
    const T = 1.3 // 띠 두께
    const steps = 10
    const pos = []
    const col = []
    const idx = []
    const c = new THREE.Color()
    for (let i = 0; i <= steps; i++) {
      const f = (i / steps) * 2 - 1 // -1(왼쪽) ~ 1(오른쪽)
      const lat = pad.lat + f * w
      const fwd = (1 - Math.abs(f)) * L + fwdOff
      const bx = s.x + s.nx * lat + s.dx * fwd
      const bz = s.z + s.nz * lat + s.dz * fwd
      pos.push(bx, 0.05, bz, bx + s.dx * T, 0.05, bz + s.dz * T)
      c.setHSL(((f + 1) / 2) * 0.83, 1, 0.55) // 무지개: 빨강 → 보라
      col.push(c.r, c.g, c.b, c.r, c.g, c.b)
      if (i < steps) {
        const a = i * 2
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
      }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    geo.setIndex(idx)
    return new THREE.Mesh(geo, mat)
  }
  for (const pad of track.pads) {
    g.add(makeChevron(pad, 0))
    g.add(makeChevron(pad, 3))
  }
  return g
}

// 도로 가장자리 빨강/하양 연석
function buildCurbs(track) {
  const { samples, n, halfW } = track
  const pos = []
  const col = []
  const idx = []
  const red = new THREE.Color(0xe04646)
  const white = new THREE.Color(0xf2f2f2)
  let v = 0
  for (const side of [1, -1]) {
    for (let i = 0; i < n; i++) {
      const s = samples[i]
      const t = samples[(i + 1) % n]
      const c = Math.floor(i / 3) % 2 === 0 ? red : white
      for (const [p, off] of [
        [s, halfW], [s, halfW + 0.8], [t, halfW], [t, halfW + 0.8],
      ]) {
        pos.push(p.x + p.nx * off * side, 0.03, p.z + p.nz * off * side)
        col.push(c.r, c.g, c.b)
      }
      idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2)
      v += 4
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  return new THREE.Mesh(
    geo,
    new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })
  )
}

// 체크무늬 출발선 + 게이트
function buildStart(track) {
  const g = new THREE.Group()
  const s = track.samples[0]
  const angle = Math.atan2(s.nz, s.nx)

  const c = document.createElement('canvas')
  c.width = 64
  c.height = 16
  const ctx = c.getContext('2d')
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 2; y++) {
      ctx.fillStyle = (x + y) % 2 ? '#111' : '#fff'
      ctx.fillRect(x * 8, y * 8, 8, 8)
    }
  }
  const tex = new THREE.CanvasTexture(c)
  const line = new THREE.Mesh(
    new THREE.PlaneGeometry(track.halfW * 2, 2.4),
    new THREE.MeshLambertMaterial({ map: tex })
  )
  line.geometry.rotateX(-Math.PI / 2)
  line.position.set(s.x, 0.04, s.z)
  line.rotation.y = -angle
  g.add(line)

  const poleGeo = new THREE.CylinderGeometry(0.25, 0.25, 7, 8)
  const poleMat = new THREE.MeshLambertMaterial({ color: 0xdddddd })
  for (const side of [1, -1]) {
    const pole = new THREE.Mesh(poleGeo, poleMat)
    pole.position.set(
      s.x + s.nx * (track.halfW + 1) * side,
      3.5,
      s.z + s.nz * (track.halfW + 1) * side
    )
    g.add(pole)
  }
  const bar = new THREE.Mesh(
    new THREE.BoxGeometry((track.halfW + 1) * 2, 1.4, 0.6),
    new THREE.MeshLambertMaterial({ color: 0xffcf4d })
  )
  bar.position.set(s.x, 6.6, s.z)
  bar.rotation.y = -angle
  g.add(bar)
  return g
}

// 트랙 바깥 나무들 (테마별 색/개수: 초원 침엽수, 사막 관목, 눈 덮인 나무)
function buildTrees(track, theme) {
  const g = new THREE.Group()
  const rnd = lcg(20260610)
  const trunkGeo = new THREE.CylinderGeometry(0.3, 0.4, 1.6, 6)
  const trunkMat = new THREE.MeshLambertMaterial({ color: theme.treeTrunk })
  const leafGeo = new THREE.ConeGeometry(1.8, 4, 8)
  const leafMat = new THREE.MeshLambertMaterial({ color: theme.treeLeaf })
  let placed = 0
  for (let tries = 0; tries < 1200 && placed < theme.treeCount; tries++) {
    const x = (rnd() - 0.5) * 380
    const z = (rnd() - 0.5) * 340 + 12
    let minD = Infinity
    for (let i = 0; i < track.n; i += 4) {
      const s = track.samples[i]
      minD = Math.min(minD, Math.hypot(x - s.x, z - s.z))
    }
    if (minD < track.halfW + 10 || minD > 110) continue
    const tree = new THREE.Group()
    const trunk = new THREE.Mesh(trunkGeo, trunkMat)
    trunk.position.y = 0.8
    const leaf = new THREE.Mesh(leafGeo, leafMat)
    leaf.position.y = 3.4
    const sc = 0.7 + rnd() * 0.9
    tree.add(trunk, leaf)
    tree.scale.setScalar(sc)
    tree.position.set(x, 0, z)
    g.add(tree)
    placed++
  }
  return g
}

// 아기자기한 장식: 구름/테마 소품/길가 깃발/아이템 구역 풍선 (이모지 스프라이트)
function buildDecor(track, theme) {
  const group = new THREE.Group()
  const rnd = lcg(777)
  const clouds = []
  for (let i = 0; i < 9; i++) {
    const sp = emojiSprite('☁️', 14 + rnd() * 10)
    sp.position.set((rnd() - 0.5) * 520, 28 + rnd() * 20, (rnd() - 0.5) * 460)
    clouds.push(sp)
    group.add(sp)
  }
  const flora = theme.flora
  for (let i = 0; i < 80; i++) {
    const s = track.samples[Math.floor(rnd() * track.n)]
    const side = rnd() < 0.5 ? 1 : -1
    const off = track.halfW + 2.5 + rnd() * 6
    const sp = emojiSprite(flora[Math.floor(rnd() * flora.length)], 1.3 + rnd() * 1.3)
    sp.position.set(s.x + s.nx * off * side, 0.7, s.z + s.nz * off * side)
    group.add(sp)
  }
  // 길가 깃발: 일정 간격으로 좌우 번갈아
  for (let i = 0; i < track.n; i += 25) {
    const s = track.samples[i]
    const side = (i / 25) % 2 === 0 ? 1 : -1
    const sp = emojiSprite('🚩', 2.4)
    sp.position.set(
      s.x + s.nx * (track.halfW + 1.8) * side,
      2,
      s.z + s.nz * (track.halfW + 1.8) * side
    )
    group.add(sp)
  }
  // 아이템 구역 양옆 풍선
  const balloons = []
  for (const ri of track.boxRows) {
    const s = track.samples[ri]
    for (const side of [1, -1]) {
      const sp = emojiSprite('🎈', 3.4)
      sp.position.set(
        s.x + s.nx * (track.halfW + 2.5) * side,
        5,
        s.z + s.nz * (track.halfW + 2.5) * side
      )
      sp.userData.baseY = sp.position.y
      balloons.push(sp)
      group.add(sp)
    }
  }
  return { group, clouds, balloons }
}

// 카트 1대: 색깔 몸체 + 스포일러/범퍼 + 바퀴 + 12지신 이모지 + 부스트 불꽃 (+X 방향이 정면).
// 바퀴는 속도만큼 구르고 앞바퀴는 코너 방향으로 꺾인다 (render 루프에서 갱신).
// 추격 로켓 사용 중엔 카트 몸체 대신 로켓 모형으로 변신한다.
function buildKart(color, emoji) {
  const g = new THREE.Group()
  const kartBody = new THREE.Group()
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 0.55, 1.5),
    new THREE.MeshLambertMaterial({ color: new THREE.Color(color || '#cccccc') })
  )
  body.position.y = 0.62
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(1.1, 0.5, 1.1),
    new THREE.MeshLambertMaterial({ color: 0x222a3a })
  )
  cabin.position.set(-0.3, 1.05, 0)
  kartBody.add(body, cabin)
  // 뒤 스포일러 + 앞 범퍼 (몸체보다 살짝 어두운 포인트색)
  const accentMat = new THREE.MeshLambertMaterial({
    color: new THREE.Color(color || '#cccccc').offsetHSL(0, 0.05, -0.13),
  })
  const wing = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.13, 1.8), accentMat)
  wing.position.set(-1.2, 1.22, 0)
  kartBody.add(wing)
  for (const wz of [0.6, -0.6]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 0.12), accentMat)
    post.position.set(-1.2, 0.95, wz)
    kartBody.add(post)
  }
  const bumper = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.32, 1.0), accentMat)
  bumper.position.set(1.3, 0.56, 0)
  kartBody.add(bumper)

  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.32, 10)
  wheelGeo.rotateX(Math.PI / 2) // 축이 Z 방향 (rotation.z = 굴러가기, rotation.y = 조향)
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x16181d })
  const wheels = []
  const frontWheels = []
  for (const [wx, wz] of [[0.85, 0.8], [0.85, -0.8], [-0.85, 0.8], [-0.85, -0.8]]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat)
    w.rotation.order = 'YZX' // 조향(Y)을 먼저, 그 다음 굴러가기(Z)
    w.position.set(wx, 0.36, wz)
    kartBody.add(w)
    wheels.push(w)
    if (wx > 0) frontWheels.push(w)
  }

  // 로켓 변신 모형 (빨간 동체 + 노란 머리)
  const rocket = new THREE.Group()
  const tube = new THREE.Mesh(
    new THREE.CylinderGeometry(0.75, 0.75, 2.6, 12),
    new THREE.MeshLambertMaterial({ color: 0xe04646 })
  )
  tube.geometry.rotateZ(Math.PI / 2) // +X 방향으로 눕힘
  tube.position.y = 1
  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(0.75, 1.3, 12),
    new THREE.MeshLambertMaterial({ color: 0xffcf4d })
  )
  nose.geometry.rotateZ(-Math.PI / 2) // +X로 뾰족
  nose.position.set(1.95, 1, 0)
  const finGeo = new THREE.BoxGeometry(0.9, 0.9, 0.12)
  const finMat = new THREE.MeshLambertMaterial({ color: 0xffcf4d })
  for (const ry of [0, Math.PI / 2]) {
    const fin = new THREE.Mesh(finGeo, finMat)
    fin.position.set(-1.1, 1, 0)
    fin.rotation.x = ry
    rocket.add(fin)
  }
  rocket.add(tube, nose)
  rocket.visible = false

  const face = emojiSprite(emoji || '🙂', 2.1)
  face.position.y = 2.1
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.34, 1.2, 8),
    new THREE.MeshBasicMaterial({ color: 0xff9a2e })
  )
  flame.geometry.rotateZ(Math.PI / 2) // -X(뒤쪽)을 향하게
  flame.position.set(-1.7, 0.62, 0)
  flame.visible = false

  // 바닥 그림자: 회오리에 날아올라도 그림자는 땅에 남아 높이가 보인다
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(1.5, 16),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false })
  )
  shadow.geometry.rotateX(-Math.PI / 2)
  shadow.position.y = 0.045
  g.add(kartBody, rocket, face, flame, shadow)
  return { group: g, kartBody, rocket, flame, shadow, wheels, frontWheels }
}

// 지면: 단색 대신 테마색 기반의 얼룩덜룩한 패치 텍스처 (풀밭/모래/눈의 질감)
function groundTexture(color) {
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const ctx = c.getContext('2d')
  const base = new THREE.Color(color)
  ctx.fillStyle = `#${base.getHexString()}`
  ctx.fillRect(0, 0, 256, 256)
  const rnd = lcg(99)
  const p = new THREE.Color()
  for (let i = 0; i < 240; i++) {
    p.copy(base).offsetHSL(0, 0, (rnd() - 0.5) * 0.07)
    ctx.fillStyle = `#${p.getHexString()}`
    ctx.beginPath()
    ctx.arc(rnd() * 256, rnd() * 256, 4 + rnd() * 14, 0, Math.PI * 2)
    ctx.fill()
  }
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(14, 14)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

// 도로 중앙 점선 (하양 반투명)
function buildCenterline(track) {
  const pos = []
  const idx = []
  const W = 0.16
  let v = 0
  for (let i = 0; i < track.n; i += 8) {
    const a = track.samples[i]
    const b = track.samples[(i + 4) % track.n]
    pos.push(
      a.x - a.nx * W, 0.028, a.z - a.nz * W,
      a.x + a.nx * W, 0.028, a.z + a.nz * W,
      b.x - b.nx * W, 0.028, b.z - b.nz * W,
      b.x + b.nx * W, 0.028, b.z + b.nz * W
    )
    idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2)
    v += 4
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setIndex(idx)
  return new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide,
    })
  )
}

// 멀리 보이는 low-poly 언덕 — 지평선이 심심하지 않게 (안개에 살짝 잠긴다)
function buildHills(theme) {
  const g = new THREE.Group()
  const rnd = lcg(4242)
  const base = new THREE.Color(theme.ground)
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + rnd() * 0.4
    const r = 250 + rnd() * 130
    const h = 22 + rnd() * 34
    const m = new THREE.Mesh(
      new THREE.ConeGeometry(45 + rnd() * 55, h, 7),
      new THREE.MeshLambertMaterial({
        color: base.clone().offsetHSL(0, -0.04, -0.05 - rnd() * 0.07),
      })
    )
    m.position.set(Math.cos(a) * r, h / 2 - 2, Math.sin(a) * r)
    m.rotation.y = rnd() * Math.PI
    g.add(m)
  }
  return g
}

// 빛나는 태양 (캔버스 radial gradient 스프라이트). 노을 때 함께 물든다.
function glowTexture(size = 128) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.25, 'rgba(255,255,240,0.9)')
  grad.addColorStop(1, 'rgba(255,255,220,0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

const OBJ_EMOJI = { banana: '🍌', bomb: '💣' }

// 드리프트 스파크 색: 충전 전(하양) → 1단계 파랑 → 2단계 주황 → 3단계 보라
const DRIFT_SPARK = [
  { r: 0.92, g: 0.92, b: 0.92 },
  { r: 0.35, g: 0.65, b: 1 },
  { r: 1, g: 0.62, b: 0.18 },
  { r: 0.85, g: 0.45, b: 1 },
]

// 맵별 명물 장애물 (이모지 스프라이트 + 크기/높이)
const OBSTACLE_LOOK = {
  cow: { emoji: '🐄', scale: 3.2, y: 1.4 },
  tornado: { emoji: '🌪️', scale: 4, y: 1.9 },
  cactus: { emoji: '🌵', scale: 3, y: 1.4 },
  snowman: { emoji: '⛄', scale: 3.2, y: 1.5 },
  penguin: { emoji: '🐧', scale: 2.4, y: 1 },
}

// 마지막 바퀴엔 하늘이 노을빛으로 물든다 (드라마 연출)
const SUN_DAY = 0xffffff
const SUN_DUSK = 0xffb27a

export function createKartScene(canvas, track) {
  const theme = track.theme
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(theme.sky)
  scene.fog = new THREE.Fog(theme.sky, 200, 560)
  const camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 1000)
  camera.position.set(0, 40, -80)
  scene.add(camera) // 카메라에 붙는 자식(스피드라인)을 렌더하기 위해

  scene.add(new THREE.HemisphereLight(0xffffff, theme.ground, 1.1)) // 지면 반사광은 테마색
  const sun = new THREE.DirectionalLight(0xffffff, 1.4)
  sun.position.set(60, 110, 40)
  scene.add(sun)
  // 하늘에 떠 있는 빛나는 태양 (노을 때 같이 물든다)
  const sunSprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTexture(), color: 0xfff2b8, depthWrite: false, fog: false })
  )
  sunSprite.scale.set(70, 70, 1)
  sunSprite.position.set(260, 170, 175)
  scene.add(sunSprite)

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1600, 1600),
    new THREE.MeshLambertMaterial({ map: groundTexture(theme.ground) })
  )
  ground.geometry.rotateX(-Math.PI / 2)
  scene.add(ground)

  scene.add(buildRoad(track, theme.road))
  scene.add(buildCenterline(track))
  if (track.ice) scene.add(buildIce(track))
  scene.add(buildCurbs(track))
  scene.add(buildStart(track))
  scene.add(buildPads(track))
  scene.add(buildTrees(track, theme))
  scene.add(buildHills(theme))
  const decor = buildDecor(track, theme)
  scene.add(decor.group)

  // 맵별 명물 장애물 (위치는 매 프레임 obstaclePose로 갱신)
  const obstacleNodes = (track.obstacles || []).map((ob) => {
    const look = OBSTACLE_LOOK[ob.kind] || { emoji: '❓', scale: 2.4, y: 1.2 }
    const sp = emojiSprite(look.emoji, look.scale)
    sp.position.y = look.y
    scene.add(sp)
    return { sp, ob, look, prevAlive: true }
  })

  // 부스트 스피드라인: 카메라 주변을 휙휙 지나가는 선 (하이퍼스페이스 느낌)
  const SL_COUNT = 90
  const slPts = []
  for (let i = 0; i < SL_COUNT; i++) {
    const a = Math.random() * Math.PI * 2
    const r = 1.5 + Math.random() * 5
    slPts.push({
      x: Math.cos(a) * r,
      y: Math.sin(a) * r * 0.6,
      z: -(4 + Math.random() * 36),
      len: 2.5 + Math.random() * 3.5,
    })
  }
  const slPos = new Float32Array(SL_COUNT * 6)
  const slGeo = new THREE.BufferGeometry()
  slGeo.setAttribute('position', new THREE.BufferAttribute(slPos, 3))
  const slMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 })
  const speedLines = new THREE.LineSegments(slGeo, slMat)
  speedLines.frustumCulled = false
  speedLines.visible = false
  camera.add(speedLines)

  // 파티클 풀 (부스트 불꽃 트레일 / 스턴 충격 / 골인 색종이 공용)
  const P_MAX = 600
  const pPos = new Float32Array(P_MAX * 3)
  const pCol = new Float32Array(P_MAX * 3)
  const parts = [] // {x,y,z,vx,vy,vz,life,grav,r,g,b}
  const pGeo = new THREE.BufferGeometry()
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3))
  pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3))
  const points = new THREE.Points(
    pGeo,
    new THREE.PointsMaterial({
      size: 0.55,
      map: glowTexture(64), // 거친 사각형 대신 부드러운 원형 입자
      vertexColors: true,
      transparent: true,
      depthWrite: false,
    })
  )
  points.frustumCulled = false
  scene.add(points)

  function spawnParts(n, make) {
    for (let i = 0; i < n; i++) {
      if (parts.length >= P_MAX) parts.shift()
      parts.push(make(i))
    }
  }
  // 골인 색종이: 카트 위로 알록달록 펑!
  function confettiBurst(x, z) {
    spawnParts(90, () => {
      const a = Math.random() * Math.PI * 2
      const r = 2 + Math.random() * 7
      const c = new THREE.Color().setHSL(Math.random(), 0.95, 0.6)
      return {
        x, y: 1 + Math.random(), z,
        vx: Math.cos(a) * r, vy: 7 + Math.random() * 8, vz: Math.sin(a) * r,
        life: 1.4 + Math.random() * 0.8, grav: 11,
        r: c.r, g: c.g, b: c.b,
      }
    })
  }
  // 스턴 충격: 노랑/하양 불꽃이 사방으로 튄다
  function stunBurst(x, z) {
    spawnParts(26, () => {
      const a = Math.random() * Math.PI * 2
      const r = 3 + Math.random() * 6
      const yellow = Math.random() < 0.6
      return {
        x, y: 0.8, z,
        vx: Math.cos(a) * r, vy: 2 + Math.random() * 5, vz: Math.sin(a) * r,
        life: 0.5 + Math.random() * 0.3, grav: 9,
        r: 1, g: yellow ? 0.85 : 1, b: yellow ? 0.2 : 1,
      }
    })
  }
  function updateParts(dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i]
      p.life -= dt
      if (p.life <= 0) {
        parts.splice(i, 1)
        continue
      }
      p.vy -= (p.grav || 0) * dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.z += p.vz * dt
      if (p.y < 0.06 && p.grav) {
        p.y = 0.06 // 색종이는 바닥에 깔렸다가 사라진다
        p.vy = 0
        p.vx *= 0.9
        p.vz *= 0.9
      }
    }
    parts.forEach((p, i) => {
      pPos[i * 3] = p.x
      pPos[i * 3 + 1] = p.y
      pPos[i * 3 + 2] = p.z
      pCol[i * 3] = p.r
      pCol[i * 3 + 1] = p.g
      pCol[i * 3 + 2] = p.b
    })
    pGeo.setDrawRange(0, parts.length)
    pGeo.attributes.position.needsUpdate = true
    pGeo.attributes.color.needsUpdate = true
  }

  // 드리프트 스키드 마크: 뒷바퀴 두 줄의 타이어 자국이 남았다 서서히 사라진다.
  // 곱셈 블렌딩이라 도로/빙판/연석 어디서든 자연스럽게 어두워진다 (흰색 = 흔적 없음).
  const SKID_MAX = 480 // 세그먼트 풀 (세그먼트 = 좌우 바퀴 quad 한 쌍)
  const SKID_LIFE = 5 // 자국이 사라지기까지 (초)
  const SKID_DARK = 0.62 // 갓 생긴 자국의 밝기 (0=검정, 1=안 보임)
  const skidPos = new Float32Array(SKID_MAX * 8 * 3)
  const skidCol = new Float32Array(SKID_MAX * 8 * 3).fill(1)
  const skidAge = new Float32Array(SKID_MAX).fill(SKID_LIFE)
  const skidIdx = []
  for (let s = 0; s < SKID_MAX; s++) {
    for (const b of [s * 8, s * 8 + 4]) {
      skidIdx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2)
    }
  }
  const skidGeo = new THREE.BufferGeometry()
  skidGeo.setAttribute('position', new THREE.BufferAttribute(skidPos, 3))
  skidGeo.setAttribute('color', new THREE.BufferAttribute(skidCol, 3))
  skidGeo.setIndex(skidIdx)
  const skidMesh = new THREE.Mesh(
    skidGeo,
    new THREE.MeshBasicMaterial({
      vertexColors: true,
      blending: THREE.MultiplyBlending,
      premultipliedAlpha: true, // 곱셈 블렌딩 필수 (없으면 일반 블렌딩으로 떨어진다)
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  )
  skidMesh.renderOrder = 1
  skidMesh.frustumCulled = false
  scene.add(skidMesh)
  let skidHead = 0

  // 이전 지점 → 현재 지점으로 좌우 바퀴 자국 한 칸을 찍는다
  function dropSkid(x1, z1, x2, z2, latX, latZ) {
    const HW = 0.17 // 자국 반폭
    const o = skidHead * 24
    let j = o
    for (const side of [0.8, -0.8]) {
      for (const [px, pz] of [[x1, z1], [x2, z2]]) {
        const cx = px + latX * side
        const cz = pz + latZ * side
        skidPos[j] = cx - latX * HW
        skidPos[j + 1] = 0.034
        skidPos[j + 2] = cz - latZ * HW
        skidPos[j + 3] = cx + latX * HW
        skidPos[j + 4] = 0.034
        skidPos[j + 5] = cz + latZ * HW
        j += 6
      }
    }
    skidAge[skidHead] = 0
    skidHead = (skidHead + 1) % SKID_MAX
    skidGeo.attributes.position.needsUpdate = true
  }

  function updateSkids(dt) {
    let dirty = false
    for (let s = 0; s < SKID_MAX; s++) {
      if (skidAge[s] >= SKID_LIFE) continue
      skidAge[s] += dt
      const v = Math.min(1, SKID_DARK + (1 - SKID_DARK) * (skidAge[s] / SKID_LIFE))
      const o = s * 24
      for (let i = 0; i < 24; i++) skidCol[o + i] = v
      dirty = true
    }
    if (dirty) skidGeo.attributes.color.needsUpdate = true
  }

  // 아이템 박스: 유리 질감의 투명 큐브 안에 '?' 글자
  const boxGeo = new THREE.BoxGeometry(1.6, 1.6, 1.6)
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xbfe4ff,
    transparent: true,
    opacity: 0.34,
    roughness: 0.06,
    metalness: 0,
    clearcoat: 1,
    depthWrite: false, // 안의 '?'가 비쳐 보이게
  })
  const qTex = textTexture('?')
  const boxNodes = track.boxSpots.map((spot, i) => {
    const grp = new THREE.Group()
    const glass = new THREE.Mesh(boxGeo, glassMat)
    glass.rotation.y = i
    const q = new THREE.Sprite(new THREE.SpriteMaterial({ map: qTex, depthWrite: false }))
    q.scale.set(1.15, 1.15, 1)
    q.renderOrder = 2
    grp.add(glass, q)
    grp.position.set(spot.x, 1.2, spot.z)
    scene.add(grp)
    return { grp, glass }
  })

  const kartNodes = new Map() // kartId -> {group, flame, prevStun, prevFin}
  const objNodes = new Map() // objectId -> Sprite

  const camPos = new THREE.Vector3(0, 40, -80)
  let lastT = performance.now()
  // 하늘 연출 상태: 노을 전환 정도(0~1) + 번개 플래시 남은 시간
  let duskMix = 0
  let flashT = 0
  let prevLightning = false
  const dayCol = new THREE.Color(theme.sky)
  const duskCol = new THREE.Color(theme.dusk)
  const whiteCol = new THREE.Color(0xffffff)
  const skyCol = new THREE.Color()
  const sunDay = new THREE.Color(SUN_DAY)
  const sunDusk = new THREE.Color(SUN_DUSK)
  const glowDay = new THREE.Color(0xfff2b8)
  const glowDusk = new THREE.Color(0xff9a5e)
  const dustCol = new THREE.Color(theme.ground).lerp(whiteCol, 0.35) // 오프로드 먼지색

  function render(view, myId) {
    const now = performance.now()
    const dt = Math.min(0.1, (now - lastT) / 1000)
    lastT = now

    // 카트
    for (const k of view.karts) {
      let node = kartNodes.get(k.id)
      if (!node) {
        node = buildKart(k.color, getZodiac(k.zodiacId)?.emoji)
        node.prevStun = false
        node.prevFin = k.finished // 중간 합류 시 이미 골인한 카트엔 색종이 생략
        kartNodes.set(k.id, node)
        scene.add(node.group)
      }
      // 회오리에 휘말리면 포물선을 그리며 하늘로 붕 떴다 떨어진다
      const flying = k.flyT > 0
      const airY = flying ? Math.sin(Math.PI * (1 - k.flyT / FLY_TIME)) * 5 : 0
      node.group.position.set(k.x, airY, k.z)
      node.group.rotation.y = -k.heading - (k.spin || 0)
      // 그림자는 땅에 남아 높이를 보여준다
      node.shadow.position.y = 0.045 - airY
      const shScale = Math.max(0.45, 1 - airY * 0.1)
      node.shadow.scale.setScalar(shScale)
      // 바퀴는 속도만큼 구르고 앞바퀴는 코너 방향으로 꺾인다.
      // 차체는 코너 안쪽으로 기울고(드리프트는 더 깊게) 부스트 땐 앞이 살짝 들린다.
      let dh = k.heading - (node.prevHeading ?? k.heading)
      while (dh > Math.PI) dh -= 2 * Math.PI
      while (dh < -Math.PI) dh += 2 * Math.PI
      node.prevHeading = k.heading
      const turn = dt > 0 ? Math.max(-1, Math.min(1, dh / dt / 2.6)) : 0
      node.wheelSpin = (node.wheelSpin || 0) - (k.speed * dt) / 0.36
      for (const w of node.wheels) w.rotation.z = node.wheelSpin
      for (const w of node.frontWheels) {
        w.rotation.y += (-turn * 0.45 - w.rotation.y) * Math.min(1, dt * 12)
      }
      const wantRoll = turn * (k.drift ? 0.34 : 0.13)
      const wantPitch = k.boostT > 0 ? 0.1 : 0
      node.roll = (node.roll || 0) + (wantRoll - (node.roll || 0)) * Math.min(1, dt * 10)
      node.pitch = (node.pitch || 0) + (wantPitch - (node.pitch || 0)) * Math.min(1, dt * 7)
      node.kartBody.rotation.x = node.roll
      node.kartBody.rotation.z = node.pitch
      // 패널티 후 무적: 카트가 반투명하게 깜빡인다
      const blinking = k.invT > 0 && !flying && !(k.stunT > 0)
      node.group.visible = !blinking || Math.floor(now / 90) % 2 === 0
      const riding = k.rocketT > 0 // 로켓 변신 중엔 몸체가 로켓으로
      node.kartBody.visible = !riding
      node.rocket.visible = riding
      node.flame.visible = k.boostT > 0 || riding
      if (node.flame.visible) {
        node.flame.scale.setScalar((riding ? 1.6 : 1.1) + Math.sin(now / 35) * 0.35) // 불꽃 펄럭임
        node.flame.position.y = riding ? 1 : 0.62

        // 부스트 불꽃 트레일: 꽁무니에서 불티가 흩날린다
        const fx = Math.cos(k.heading)
        const fz = Math.sin(k.heading)
        spawnParts(2, () => ({
          x: k.x - fx * 1.8 + (Math.random() - 0.5) * 0.8,
          y: 0.5 + Math.random() * 0.5,
          z: k.z - fz * 1.8 + (Math.random() - 0.5) * 0.8,
          vx: -fx * (6 + Math.random() * 5),
          vy: 1.5 + Math.random() * 2,
          vz: -fz * (6 + Math.random() * 5),
          life: 0.3 + Math.random() * 0.25,
          grav: 4,
          r: 1, g: 0.45 + Math.random() * 0.45, b: 0.1,
        }))
      }
      // 드리프트 스파크: 미끄러지는 바깥쪽 뒷바퀴에서 충전 단계 색의 불티가 튄다
      if (k.drift) {
        const c = DRIFT_SPARK[Math.min(k.driftLvl || 0, DRIFT_SPARK.length - 1)]
        const fx = Math.cos(k.heading)
        const fz = Math.sin(k.heading)
        const px = fz * k.drift // 드리프트 반대쪽(바깥) 법선
        const pz = -fx * k.drift
        spawnParts(2, () => ({
          x: k.x - fx * 1.4 + px * 0.8 + (Math.random() - 0.5) * 0.5,
          y: 0.18,
          z: k.z - fz * 1.4 + pz * 0.8 + (Math.random() - 0.5) * 0.5,
          vx: -fx * 4 + px * (3 + Math.random() * 3),
          vy: 2 + Math.random() * 2.5,
          vz: -fz * 4 + pz * (3 + Math.random() * 3),
          life: 0.22 + Math.random() * 0.2,
          grav: 9,
          r: c.r, g: c.g, b: c.b,
        }))
      }
      // 드리프트 타이어 자국: 뒷바퀴 위치를 이전 프레임과 이어 quad를 찍는다
      if (k.drift && !flying) {
        const fx = Math.cos(k.heading)
        const fz = Math.sin(k.heading)
        const rx = k.x - fx * 0.9
        const rz = k.z - fz * 0.9
        const last = node.lastSkid
        if (!last) {
          node.lastSkid = { x: rx, z: rz }
        } else {
          const d = Math.hypot(rx - last.x, rz - last.z)
          if (d > 6) {
            node.lastSkid = { x: rx, z: rz } // 순간이동(리스폰 등)은 잇지 않는다
          } else if (d > 0.45) {
            dropSkid(last.x, last.z, rx, rz, -fz, fx)
            node.lastSkid = { x: rx, z: rz }
          }
        }
      } else {
        node.lastSkid = null
      }
      // 잔디/모래/눈밭을 달리면 먼지가 풀풀
      if (k.offroad && k.speed > 8 && !flying && Math.random() < 0.6) {
        const fx = Math.cos(k.heading)
        const fz = Math.sin(k.heading)
        spawnParts(1, () => ({
          x: k.x - fx * 1.2 + (Math.random() - 0.5) * 1.4,
          y: 0.25,
          z: k.z - fz * 1.2 + (Math.random() - 0.5) * 1.4,
          vx: -fx * 2 + (Math.random() - 0.5) * 2,
          vy: 1.2 + Math.random() * 1.6,
          vz: -fz * 2 + (Math.random() - 0.5) * 2,
          life: 0.45 + Math.random() * 0.3,
          grav: 2,
          r: dustCol.r, g: dustCol.g, b: dustCol.b,
        }))
      }
      // 스턴 순간: 충격 불꽃 / 골인 순간: 색종이 폭발
      const stunned = k.stunT > 0
      if (stunned && !node.prevStun) stunBurst(k.x, k.z)
      node.prevStun = stunned
      if (k.finished && !node.prevFin) confettiBurst(k.x, k.z)
      node.prevFin = k.finished
    }
    // 지난 판 카트(다시하기로 멤버가 바뀐 경우) 정리
    for (const [id, node] of kartNodes) {
      if (view.karts.some((k) => k.id === id)) continue
      scene.remove(node.group)
      node.group.traverse((o) => {
        o.geometry?.dispose?.()
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []
        mats.forEach((m) => {
          m.map?.dispose?.()
          m.dispose?.()
        })
      })
      kartNodes.delete(id)
    }

    // 바나나/로켓 스프라이트
    const alive = new Set()
    for (const o of view.objects || []) {
      alive.add(o.id)
      let sp = objNodes.get(o.id)
      if (!sp) {
        sp = emojiSprite(OBJ_EMOJI[o.kind] || '❓', o.kind === 'rocket' ? 2.2 : 1.7)
        objNodes.set(o.id, sp)
        scene.add(sp)
      }
      sp.position.set(o.x, o.kind === 'rocket' ? 1.2 : 0.8, o.z)
    }
    for (const [id, sp] of objNodes) {
      if (alive.has(id)) continue
      scene.remove(sp)
      sp.material.map?.dispose()
      sp.material.dispose()
      objNodes.delete(id)
    }

    // 맵 명물 장애물: 시간의 순수 함수로 움직인다 (엔진 충돌 판정과 동일 위치).
    // 눈사람은 부서지는 순간 눈보라가 펑! → 잠시 후 반짝이며 재생성.
    // 건너가던 소는 코스 밖으로 나가면 사라졌다 반대편에서 다시 나타난다.
    for (let idx = 0; idx < obstacleNodes.length; idx++) {
      const node = obstacleNodes[idx]
      const alive = !view.obs || view.obs[idx] !== false
      const burst = (n, color, vy) =>
        spawnParts(n, () => {
          const a = Math.random() * Math.PI * 2
          const r = 2 + Math.random() * 6
          return {
            x: node.sp.position.x, y: 1 + Math.random() * 1.5, z: node.sp.position.z,
            vx: Math.cos(a) * r, vy: vy + Math.random() * 5, vz: Math.sin(a) * r,
            life: 0.7 + Math.random() * 0.5, grav: 10,
            ...color,
          }
        })
      if (!alive && node.prevAlive) burst(36, { r: 1, g: 1, b: 1 }, 3) // 와장창!
      if (alive && !node.prevAlive) burst(20, { r: 0.75, g: 0.95, b: 1 }, 4) // 재생성 반짝
      node.prevAlive = alive
      const shown = alive && obstacleVisible(track, node.ob, view.time)
      node.sp.visible = shown
      if (!shown) continue
      const pos = obstaclePose(track, node.ob, view.time)
      // 소는 느긋하게 끄덕끄덕, 펭귄은 배 깔고 통통
      let y = node.look.y
      let sx = node.look.scale
      let sy = node.look.scale
      if (node.ob.kind === 'cow') y += Math.sin(view.time * 2.2 + idx) * 0.12
      if (node.ob.kind === 'penguin') y += Math.abs(Math.sin(view.time * 5 + idx)) * 0.35
      if (node.ob.kind === 'tornado') {
        // 회오리는 굴러가지 않는다 — 부르르 흔들리고 들썩이며 출렁인다
        node.sp.material.rotation = Math.sin(now / 110 + idx * 2) * 0.18
        y += Math.abs(Math.sin(now / 160 + idx)) * 0.5
        const pulse = 1 + Math.sin(now / 130 + idx) * 0.08
        sx = node.look.scale * pulse
        sy = node.look.scale * (2 - pulse)
      }
      node.sp.scale.set(sx, sy, 1)
      node.sp.position.set(pos.x + (node.ob.kind === 'tornado' ? Math.sin(now / 70 + idx) * 0.25 : 0), y, pos.z)
    }

    // 아이템 박스 회전/표시 (유리 큐브가 빙글빙글, '?'는 항상 카메라를 본다)
    boxNodes.forEach(({ grp, glass }, i) => {
      grp.visible = !view.boxes || view.boxes[i] !== false
      glass.rotation.y += dt * 1.6
      glass.rotation.x += dt * 0.8
      grp.position.y = 1.2 + Math.sin(now / 320 + i) * 0.15
    })

    // 구름은 천천히 흐르고, 풍선은 둥실둥실
    for (const c of decor.clouds) {
      c.position.x += dt * 1.6
      if (c.position.x > 280) c.position.x = -280
    }
    decor.balloons.forEach((b, i) => {
      b.position.y = b.userData.baseY + Math.sin(now / 600 + i * 1.7) * 0.5
    })

    // 카메라: 내 카트(없으면 1등)를 3인칭으로 따라간다
    const target =
      view.karts.find((k) => k.id === myId) ||
      view.karts.find((k) => k.rank === 1) ||
      view.karts[0]
    if (target) {
      const fx = Math.cos(target.heading)
      const fz = Math.sin(target.heading)
      const want = new THREE.Vector3(target.x - fx * 7.5, 3.6, target.z - fz * 7.5)
      camPos.lerp(want, 1 - Math.exp(-dt * 6))
      camera.position.copy(camPos)
      // 스턴당하면 화면이 덜덜 흔들린다 (충돌의 임팩트)
      const shake = target.stunT > 0 ? Math.min(0.45, target.stunT * 0.45) : 0
      if (shake > 0) {
        camera.position.x += (Math.random() - 0.5) * shake
        camera.position.y += (Math.random() - 0.5) * shake
        camera.position.z += (Math.random() - 0.5) * shake
      }
      camera.lookAt(target.x + fx * 4, 1.1, target.z + fz * 4)
    }

    // 부스트/로켓: 스피드라인이 휙휙 지나가고 화각이 넓어져 빨려드는 느낌
    const boosting = !!(target && (target.boostT > 0 || target.rocketT > 0))
    slMat.opacity += ((boosting ? 0.85 : 0) - slMat.opacity) * (1 - Math.exp(-dt * 8))
    speedLines.visible = slMat.opacity > 0.02
    if (speedLines.visible) {
      for (let i = 0; i < SL_COUNT; i++) {
        const p = slPts[i]
        p.z += dt * 60 // 카메라 쪽으로 돌진
        if (p.z > -2) p.z = -40 - Math.random() * 5
        const o = i * 6
        slPos[o] = p.x
        slPos[o + 1] = p.y
        slPos[o + 2] = p.z
        slPos[o + 3] = p.x
        slPos[o + 4] = p.y
        slPos[o + 5] = p.z - p.len
      }
      slGeo.attributes.position.needsUpdate = true
    }
    const wantFov = boosting ? 76 : 62
    if (Math.abs(camera.fov - wantFov) > 0.05) {
      camera.fov += (wantFov - camera.fov) * (1 - Math.exp(-dt * 5))
      camera.updateProjectionMatrix()
    }

    // 하늘 드라마: 마지막 바퀴엔 노을, 번개 아이템이 터지면 하늘이 번쩍!
    if (view.lightning && !prevLightning) flashT = 0.4
    prevLightning = !!view.lightning
    flashT = Math.max(0, flashT - dt)
    duskMix += ((view.finalLap ? 1 : 0) - duskMix) * (1 - Math.exp(-dt * 1.2))
    skyCol.copy(dayCol).lerp(duskCol, duskMix)
    if (flashT > 0) skyCol.lerp(whiteCol, Math.min(1, flashT * 2.6))
    scene.background.copy(skyCol)
    scene.fog.color.copy(skyCol)
    sun.color.copy(sunDay).lerp(sunDusk, duskMix)
    sunSprite.material.color.copy(glowDay).lerp(glowDusk, duskMix)

    updateParts(dt)
    updateSkids(dt)

    renderer.render(scene, camera)
  }

  function resize(w, h) {
    if (!w || !h) return
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }

  function dispose() {
    scene.traverse((o) => {
      o.geometry?.dispose?.()
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []
      mats.forEach((m) => {
        m.map?.dispose?.()
        m.dispose?.()
      })
    })
    renderer.dispose()
  }

  return { render, resize, dispose }
}
