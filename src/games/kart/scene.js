// 파티 카트 3D 렌더러 (three.js).
// 엔진의 makeView() 스냅샷만 보고 그린다 — 호스트/게스트 공용.
import * as THREE from 'three'
import { getZodiac } from '../../shared/zodiac.js'
import { BOX_SPOTS, BOX_ROWS, PAD_ROWS } from './track.js'

const SKY = 0x8ecdf5

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
function buildRoad(track) {
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
    new THREE.MeshLambertMaterial({ color: 0x474d59, side: THREE.DoubleSide })
  )
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

// 가속 발판: 진행 방향을 가리키는 무지개 그라데이션 화살표(Λ) 2개
function buildPads(track) {
  const g = new THREE.Group()
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.95,
  })
  const makeChevron = (pi, fwdOff) => {
    const s = track.samples[pi]
    const w = track.halfW * 0.85 // 트랙 폭 대부분을 덮는다
    const L = 3.4 // 꼭짓점이 앞으로 나오는 길이
    const T = 1.6 // 띠 두께
    const steps = 10
    const pos = []
    const col = []
    const idx = []
    const c = new THREE.Color()
    for (let i = 0; i <= steps; i++) {
      const f = (i / steps) * 2 - 1 // -1(왼쪽) ~ 1(오른쪽)
      const lat = f * w
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
  for (const pi of PAD_ROWS) {
    g.add(makeChevron(pi, 0))
    g.add(makeChevron(pi, 3))
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

// 트랙 바깥 나무들
function buildTrees(track) {
  const g = new THREE.Group()
  const rnd = lcg(20260610)
  const trunkGeo = new THREE.CylinderGeometry(0.3, 0.4, 1.6, 6)
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x7a5230 })
  const leafGeo = new THREE.ConeGeometry(1.8, 4, 8)
  const leafMat = new THREE.MeshLambertMaterial({ color: 0x2e8b46 })
  let placed = 0
  for (let tries = 0; tries < 1200 && placed < 80; tries++) {
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

// 아기자기한 장식: 구름/꽃밭/길가 깃발/아이템 구역 풍선 (이모지 스프라이트)
function buildDecor(track) {
  const group = new THREE.Group()
  const rnd = lcg(777)
  const clouds = []
  for (let i = 0; i < 9; i++) {
    const sp = emojiSprite('☁️', 14 + rnd() * 10)
    sp.position.set((rnd() - 0.5) * 520, 28 + rnd() * 20, (rnd() - 0.5) * 460)
    clouds.push(sp)
    group.add(sp)
  }
  const flora = ['🌼', '🌸', '🌷', '🍄', '🌻', '🪨', '🦋']
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
  for (const ri of BOX_ROWS) {
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

// 카트 1대: 색깔 몸체 + 바퀴 + 12지신 이모지 + 부스트 불꽃 (+X 방향이 정면).
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
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.32, 10)
  wheelGeo.rotateX(Math.PI / 2)
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x16181d })
  for (const [wx, wz] of [[0.85, 0.8], [0.85, -0.8], [-0.85, 0.8], [-0.85, -0.8]]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat)
    w.position.set(wx, 0.36, wz)
    kartBody.add(w)
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
  g.add(kartBody, rocket, face, flame)
  return { group: g, kartBody, rocket, flame }
}

const OBJ_EMOJI = { banana: '🍌', bomb: '💣' }

export function createKartScene(canvas, track) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(SKY)
  scene.fog = new THREE.Fog(SKY, 200, 560)
  const camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 1000)
  camera.position.set(0, 40, -80)
  scene.add(camera) // 카메라에 붙는 자식(스피드라인)을 렌더하기 위해

  scene.add(new THREE.HemisphereLight(0xffffff, 0x5e8c4f, 1.1))
  const sun = new THREE.DirectionalLight(0xffffff, 1.4)
  sun.position.set(60, 110, 40)
  scene.add(sun)

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1600, 1600),
    new THREE.MeshLambertMaterial({ color: 0x68b95c })
  )
  ground.geometry.rotateX(-Math.PI / 2)
  scene.add(ground)

  scene.add(buildRoad(track))
  scene.add(buildCurbs(track))
  scene.add(buildStart(track))
  scene.add(buildPads(track))
  scene.add(buildTrees(track))
  const decor = buildDecor(track)
  scene.add(decor.group)

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
  const boxNodes = BOX_SPOTS.map((spot, i) => {
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

  const kartNodes = new Map() // kartId -> {group, flame}
  const objNodes = new Map() // objectId -> Sprite

  const camPos = new THREE.Vector3(0, 40, -80)
  let lastT = performance.now()

  function render(view, myId) {
    const now = performance.now()
    const dt = Math.min(0.1, (now - lastT) / 1000)
    lastT = now

    // 카트
    for (const k of view.karts) {
      let node = kartNodes.get(k.id)
      if (!node) {
        node = buildKart(k.color, getZodiac(k.zodiacId)?.emoji)
        kartNodes.set(k.id, node)
        scene.add(node.group)
      }
      node.group.position.set(k.x, 0, k.z)
      node.group.rotation.y = -k.heading - (k.spin || 0)
      const riding = k.rocketT > 0 // 로켓 변신 중엔 몸체가 로켓으로
      node.kartBody.visible = !riding
      node.rocket.visible = riding
      node.flame.visible = k.boostT > 0 || riding
      if (node.flame.visible) {
        node.flame.scale.setScalar((riding ? 1.6 : 1.1) + Math.sin(now / 35) * 0.35) // 불꽃 펄럭임
        node.flame.position.y = riding ? 1 : 0.62
      }
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
