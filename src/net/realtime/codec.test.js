import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  diffView, applyPatch, packValue, unpackValue, encodeSnapshot, decodeSnapshot,
} from './codec.js'

// f32로 반올림되는 값이라 정확 비교 대신 근사 비교가 필요한 경우용
function assertViewClose(actual, expected, eps = 1e-3) {
  assert.deepEqual(normalize(actual, eps), normalize(expected, eps))
}
function normalize(v, eps) {
  if (typeof v === 'number') return Number.isInteger(v) ? v : Math.round(v / eps) * eps
  if (Array.isArray(v)) return v.map((x) => normalize(x, eps))
  if (v && typeof v === 'object') {
    const o = {}
    for (const k of Object.keys(v)) o[k] = normalize(v[k], eps)
    return o
  }
  return v
}

test('packValue/unpackValue 왕복 — 원시값', () => {
  for (const v of [null, true, false, 0, 1, -1, 42, -2147483648, 2147483647, 'hi', '한글🏎️', '']) {
    assert.deepEqual(unpackValue(packValue(v)), v)
  }
})

test('packValue/unpackValue 왕복 — 소수(f32 근사)', () => {
  const v = { x: 12.34, z: -56.78, h: 3.141 }
  const out = unpackValue(packValue(v))
  assert.ok(Math.abs(out.x - 12.34) < 1e-3)
  assert.ok(Math.abs(out.z - -56.78) < 1e-3)
  assert.ok(Math.abs(out.h - 3.141) < 1e-3)
})

test('packValue/unpackValue 왕복 — 중첩 구조', () => {
  const v = {
    phase: 'play', status: 'racing', n: 3, flag: true, none: null,
    list: [{ id: 'a', x: 1, name: '쥐' }, { id: 'b', x: 2, name: '소' }],
    bools: [true, false, true],
    nested: { blue: 5, red: 7 },
  }
  assert.deepEqual(unpackValue(packValue(v)), v)
})

test('diffView/applyPatch — 스칼라 변경만 추린다', () => {
  const a = { time: 1, status: 'racing', countdown: 0 }
  const b = { time: 2, status: 'racing', countdown: 0 }
  const patch = diffView(a, b)
  assert.deepEqual(patch, { time: 2 }) // status/countdown은 빠진다
  assert.deepEqual(applyPatch(a, patch), b)
})

test('diffView/applyPatch — id 리스트의 변경 필드만 추린다(정적 필드 생략)', () => {
  const a = { karts: [{ id: 'a', name: '쥐', color: '#f00', x: 0, z: 0 }] }
  const b = { karts: [{ id: 'a', name: '쥐', color: '#f00', x: 5, z: 2 }] }
  const patch = diffView(a, b)
  assert.deepEqual(patch, { karts: { __l: { u: [{ id: 'a', x: 5, z: 2 }] } } })
  assert.deepEqual(applyPatch(a, patch), b)
})

test('diffView/applyPatch — 엔티티 추가/삭제/순서변경', () => {
  const a = { karts: [{ id: 'a', x: 0 }, { id: 'b', x: 0 }] }
  const b = { karts: [{ id: 'b', x: 1 }, { id: 'c', x: 9 }] } // a 삭제, c 추가, 순서 b,c
  const patch = diffView(a, b)
  const out = applyPatch(a, patch)
  assert.deepEqual(out, b)
})

test('encodeSnapshot full → decodeSnapshot 복원', () => {
  const v = {
    phase: 'play', time: 12.5, karts: [{ id: 'a', name: '쥐', x: 1.25, z: 2.5, lap: 1 }],
    boxes: [true, false], finishOrder: [],
  }
  const bytes = encodeSnapshot(null, v)
  const out = decodeSnapshot(null, bytes)
  assertViewClose(out, v)
})

test('연속 델타 누적 — 클라가 서버 view를 그대로 재구성', () => {
  const frames = [
    { time: 0, status: 'countdown', karts: [{ id: 'a', name: '쥐', color: '#f00', x: 0, z: 0, lap: 1 }, { id: 'b', name: '소', color: '#0f0', x: 0, z: 1, lap: 1 }] },
    { time: 0.05, status: 'racing', karts: [{ id: 'a', name: '쥐', color: '#f00', x: 1.1, z: 0, lap: 1 }, { id: 'b', name: '소', color: '#0f0', x: 0.9, z: 1, lap: 1 }] },
    { time: 0.1, status: 'racing', karts: [{ id: 'a', name: '쥐', color: '#f00', x: 2.2, z: 0.1, lap: 2 }, { id: 'b', name: '소', color: '#0f0', x: 1.8, z: 1, lap: 1 }] },
  ]
  // 서버: lastView 기준으로 인코딩 / 클라: 받아서 누적
  let serverPrev = null
  let clientView = null
  for (const f of frames) {
    const bytes = encodeSnapshot(serverPrev, f)
    clientView = decodeSnapshot(clientView, bytes)
    serverPrev = f
    assertViewClose(clientView, f)
  }
})

test('델타가 full보다 작다(정적 필드 미전송)', () => {
  const big = {
    time: 1,
    karts: Array.from({ length: 8 }, (_, i) => ({
      id: `k${i}`, name: `이름${i}`, color: '#abcdef', zodiacId: 'rat', isBot: false,
      x: i * 1.1, z: i * 0.7, heading: 0.5, speed: 30, lap: 1, rank: i + 1, item: null,
    })),
  }
  const moved = { ...big, time: 1.05, karts: big.karts.map((k) => ({ ...k, x: k.x + 1, z: k.z + 0.2 })) }
  const full = encodeSnapshot(null, moved)
  const delta = encodeSnapshot(big, moved)
  assert.ok(delta.length < full.length * 0.6, `delta ${delta.length} vs full ${full.length}`)
})
