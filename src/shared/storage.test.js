import test from 'node:test'
import assert from 'node:assert/strict'

// node엔 localStorage가 없다 — 간단한 인메모리 목으로 대체 (storage.js는 호출 시점에만 접근)
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
}

const { addRiftRecord, loadRiftRecords } = await import('./storage.js')

test('전적: 직업별로 승패·KDA가 누적되고 localStorage에 남는다', () => {
  addRiftRecord('warrior', { win: true, kills: 5, deaths: 2, assists: 3 })
  const all = addRiftRecord('warrior', { win: false, kills: 1, deaths: 4, assists: 0 })
  assert.deepEqual(all.warrior, { games: 2, wins: 1, kills: 6, deaths: 6, assists: 3 })
  // 다시 읽어도(재방문) 그대로
  assert.deepEqual(loadRiftRecords().warrior, all.warrior)
  // 다른 직업은 독립 누적
  addRiftRecord('mage', { win: true })
  const again = loadRiftRecords()
  assert.equal(again.mage.games, 1)
  assert.equal(again.warrior.games, 2)
})
