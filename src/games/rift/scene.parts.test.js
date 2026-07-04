import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { buildClassParts, CLS_SCALE, PROJ_BUILDERS } from './scene.js'
import { CLASS_IDS } from './engine.js'

// 직업 파츠는 몸통의 정적 자식이라 렌더 루프 검증이 없다 — 대신 여기서
// "만들어진다 + 좌표가 유한하다 + 얼굴 이모지 스프라이트 영역(로컬 y>2.1s)을 안 침범한다"를 못박는다.
test('직업 파츠: 전 직업이 예외 없이 만들어지고 얼굴 영역을 침범하지 않는다', () => {
  for (const cls of CLASS_IDS) {
    const s = CLS_SCALE[cls] || 1
    const body = new THREE.Group()
    buildClassParts(cls, s, body)
    body.traverse((o) => {
      if (!o.isMesh) return
      assert.ok(
        Number.isFinite(o.position.x) && Number.isFinite(o.position.y) && Number.isFinite(o.position.z),
        `${cls} 파츠 좌표가 유한값`
      )
      assert.ok(o.position.y <= 2.1 * s, `${cls} 파츠(y=${o.position.y.toFixed(2)})가 얼굴 영역 아래에 있다`)
    })
  }
})

test('직업 몸집: 모든 직업이 CLS_SCALE에 등록돼 있고 상식적 범위(0.85~1.3)다', () => {
  for (const cls of CLASS_IDS) {
    const v = CLS_SCALE[cls]
    assert.ok(typeof v === 'number' && v >= 0.85 && v <= 1.3, `${cls}=${v}`)
  }
})

// 스킬 투사체 전용 조형: 발광 구슬 폴백이 아니라 저마다의 모형으로 만들어지는지 못박는다.
//  규약 — 로컬 +x가 진행 방향, orient면 렌더러가 기수를 돌리고 anim(time, p)은 매 프레임 자체 연출.
test('스킬 투사체 조형: 전 종류가 예외 없이 만들어지고 anim/spin이 안전하게 돈다', () => {
  const kinds = ['tornado', 'rock', 'pierce', 'lightarrow', 'hawk', 'hook', 'fireball']
  for (const kind of kinds) {
    assert.ok(PROJ_BUILDERS[kind], `${kind} 빌더가 등록돼 있다`)
    const p = { id: 7, kind, team: 'blue', x: 10, z: -4 }
    const obj = PROJ_BUILDERS[kind](p)
    let meshes = 0
    obj.traverse((o) => {
      if (!o.isMesh) return
      meshes++
      assert.ok(
        Number.isFinite(o.position.x) && Number.isFinite(o.position.y) && Number.isFinite(o.position.z),
        `${kind} 파츠 좌표가 유한값`
      )
    })
    assert.ok(meshes >= 2, `${kind}가 단일 구체가 아닌 조형(메시 ${meshes}개)`)
    // 렌더 루프가 부르는 자체 연출이 예외 없이 돈다 (사슬 늘이기 등은 이동 후 좌표로)
    obj.userData.anim?.(1.23, { ...p, x: 16, z: -4 })
    obj.userData.spin?.(1.23)
  }
})
