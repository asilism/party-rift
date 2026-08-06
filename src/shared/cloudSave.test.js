import test from 'node:test'
import assert from 'node:assert/strict'
import { collectProgress, applyProgress, shouldApplyRemote } from './cloudSave.js'

// node 환경 localStorage 셔틀 — solo.test.js와 같은 방식
function shim(initial = {}) {
  const m = new Map(Object.entries(initial))
  globalThis.localStorage = {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size
    },
  }
  return m
}

test('클라우드 수집: bgp.* 진행만 싣고 — 동기화 메타·잡키는 뺀다', () => {
  try {
    shim({
      'bgp.rift.coins.v1': '1200',
      'bgp.rift.solo.v1': '{"cls":"warrior"}',
      'bgp.cloud.lastSavedAt': '999', // 메타 — 제외
      'theme': 'dark', // 접두사 밖 — 제외
    })
    const p = collectProgress(1234)
    assert.equal(p.v, 1)
    assert.equal(p.savedAt, 1234)
    assert.deepEqual(Object.keys(p.keys).sort(), ['bgp.rift.coins.v1', 'bgp.rift.solo.v1'])
  } finally {
    delete globalThis.localStorage
  }
})

test('클라우드 적용: 접두사 밖·메타 키가 섞인 악성 스냅샷은 그 키만 무시한다', () => {
  try {
    const m = shim()
    const n = applyProgress({
      v: 1,
      savedAt: 5,
      keys: {
        'bgp.rift.coins.v1': '500',
        'bgp.cloud.lastSavedAt': '77', // 메타 위조 — 무시
        'evil.key': 'x', // 접두사 밖 — 무시
        'bgp.rift.bad': 123, // 문자열 아님 — 무시
      },
    })
    assert.equal(n, 1, '진행 키 하나만 적용')
    assert.equal(m.get('bgp.rift.coins.v1'), '500')
    assert.ok(!m.has('bgp.cloud.lastSavedAt') && !m.has('evil.key') && !m.has('bgp.rift.bad'))
  } finally {
    delete globalThis.localStorage
  }
})

test('클라우드 적용: 형식이 깨진 페이로드는 통째로 거른다', () => {
  try {
    shim()
    assert.equal(applyProgress(null), 0)
    assert.equal(applyProgress({ v: 2, keys: { 'bgp.a': 'x' } }), 0, '모르는 버전')
    assert.equal(applyProgress({ v: 1, keys: null }), 0)
  } finally {
    delete globalThis.localStorage
  }
})

test('최신 승리: 클라우드가 내 마지막 저장보다 새로울 때만 적용한다', () => {
  assert.equal(shouldApplyRemote({ v: 1, savedAt: 100, keys: {} }, 50), true, '클라우드가 새것')
  assert.equal(shouldApplyRemote({ v: 1, savedAt: 100, keys: {} }, 100), false, '같으면 재적용 안 함')
  assert.equal(shouldApplyRemote({ v: 1, savedAt: 100, keys: {} }, 200), false, '내가 더 새것')
  assert.equal(shouldApplyRemote({ v: 1, savedAt: 100, keys: {} }, 0), true, '저장 이력 없음 = 적용')
  assert.equal(shouldApplyRemote(null, 0), false)
  assert.equal(shouldApplyRemote({ v: 1, savedAt: 'x', keys: {} }, 0), false, '시각이 숫자가 아니면 거른다')
})

test('수집→적용 왕복: 새 기기에서 진행이 그대로 복원된다', () => {
  try {
    shim({ 'bgp.rift.coins.v1': '777', 'bgp.rift.noads.v1': 'on' })
    const snap = collectProgress(42)
    shim() // 새 기기 — 빈 저장소
    const n = applyProgress(snap)
    assert.equal(n, 2)
    assert.equal(globalThis.localStorage.getItem('bgp.rift.coins.v1'), '777')
    assert.equal(globalThis.localStorage.getItem('bgp.rift.noads.v1'), 'on')
  } finally {
    delete globalThis.localStorage
  }
})
