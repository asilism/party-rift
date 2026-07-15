import test from 'node:test'
import assert from 'node:assert/strict'

// node엔 localStorage가 없다 — 간단한 인메모리 목으로 대체 (storage.js는 호출 시점에만 접근)
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
}

const { addRiftRecord, loadRiftRecords, loadRiftRecordsByMode } = await import('./storage.js')

test('전적: 직업별로 승패·KDA가 누적되고 localStorage에 남는다', () => {
  addRiftRecord('warrior', { win: true, kills: 5, deaths: 2, assists: 3 })
  addRiftRecord('warrior', { win: false, kills: 1, deaths: 4, assists: 0 })
  // 전 모드 합산(평면)으로 읽으면 누적된다
  assert.deepEqual(loadRiftRecords().warrior, { games: 2, wins: 1, kills: 6, deaths: 6, assists: 3 })
  // 다른 직업은 독립 누적
  addRiftRecord('mage', { win: true })
  const again = loadRiftRecords()
  assert.equal(again.mage.games, 1)
  assert.equal(again.warrior.games, 2)
})

test('전적: 모드(3v3/5v5)별로 나뉘어 저장되고, 합산은 두 모드를 더한다', () => {
  addRiftRecord('archer', { win: true, mode: '3v3' })
  addRiftRecord('archer', { win: true, mode: '5v5' })
  addRiftRecord('archer', { win: false, mode: '5v5' })
  const byMode = loadRiftRecordsByMode()
  assert.equal(byMode['3v3'].archer.games, 1)
  assert.equal(byMode['3v3'].archer.wins, 1)
  assert.equal(byMode['5v5'].archer.games, 2)
  assert.equal(byMode['5v5'].archer.wins, 1)
  // 합산 = 3v3 + 5v5
  assert.equal(loadRiftRecords().archer.games, 3)
  assert.equal(loadRiftRecords().archer.wins, 2)
})
