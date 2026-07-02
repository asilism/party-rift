import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { buildClassParts, CLS_SCALE } from './scene.js'
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
