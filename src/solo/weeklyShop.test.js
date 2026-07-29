import test from 'node:test'
import assert from 'node:assert/strict'
import { weeklyShop, weekIndex, weeklyResetIn, WEEKLY_DISCOUNT } from './weeklyShop.js'

const CATALOG = [
  { tab: 'hat', id: 'straw', name: '밀짚', price: 200 },
  { tab: 'hat', id: 'cap', name: '야구모자', price: 300 },
  { tab: 'costume', id: 'scarf', name: '목도리', price: 250 },
  { tab: 'costume', id: 'armor', name: '갑옷', price: 700 },
  { tab: 'weapon', id: 'pan', name: '프라이팬', price: 300 },
  { tab: 'weapon', id: 'scythe', name: '낫', price: 750 },
  { tab: 'trail', id: 'flame', name: '불꽃', price: 450 },
  { tab: 'trail', id: 'rainbow', name: '무지개', price: 800 },
]
const NOW = Date.UTC(2026, 5, 15) // 임의 고정 시각

test('주간 상점: 같은 주는 같은 진열(전역 결정론)', () => {
  const a = weeklyShop({ catalog: CATALOG, now: NOW })
  const b = weeklyShop({ catalog: CATALOG, now: NOW })
  assert.deepEqual(a.items, b.items)
  assert.equal(a.items.length, 5)
  // 진열은 카탈로그의 부분집합, 중복 없음
  const keys = a.items.map((it) => `${it.tab}:${it.id}`)
  assert.equal(new Set(keys).size, keys.length)
})

test('주간 상점: 다른 주는 대체로 다른 진열', () => {
  const wk1 = weeklyShop({ catalog: CATALOG, now: NOW }).items.map((i) => i.id).join(',')
  const wk2 = weeklyShop({ catalog: CATALOG, now: NOW + 7 * 24 * 3600 * 1000 }).items.map((i) => i.id).join(',')
  assert.notEqual(wk1, wk2) // 순서/구성이 바뀐다
})

test('주간 상점: 보유 상품은 진열에서 빠지고 다음 후보가 채운다', () => {
  const full = weeklyShop({ catalog: CATALOG, now: NOW })
  const firstId = full.items[0].id
  const firstTab = full.items[0].tab
  const withOwned = weeklyShop({
    catalog: CATALOG, now: NOW,
    owned: (tab, id) => tab === firstTab && id === firstId,
  })
  // 보유한 첫 상품은 진열에 없다
  assert.ok(!withOwned.items.some((it) => it.tab === firstTab && it.id === firstId))
  assert.equal(withOwned.items.length, 5) // 다음 후보로 5칸 유지
})

test('주간 상점: 할인 2칸 — 30% off, 10원 단위 반올림', () => {
  const s = weeklyShop({ catalog: CATALOG, now: NOW })
  const discounted = s.items.filter((it) => it.discPrice != null)
  assert.ok(discounted.length >= 1 && discounted.length <= 2, '진열 중 최대 2칸 할인')
  for (const it of discounted) {
    const expected = Math.round((it.price * (1 - WEEKLY_DISCOUNT)) / 10) * 10
    assert.equal(it.discPrice, expected)
    assert.ok(it.discPrice < it.price, '할인가 < 정가')
  }
})

test('주간 상점: 카탈로그가 count보다 작으면 있는 만큼만', () => {
  const small = CATALOG.slice(0, 3)
  const s = weeklyShop({ catalog: small, now: NOW })
  assert.equal(s.items.length, 3)
})

test('weekIndex/weeklyResetIn: 단조 증가·양수 잔여', () => {
  const wk = weekIndex(NOW)
  assert.ok(wk >= 0)
  assert.ok(weekIndex(NOW + 7 * 24 * 3600 * 1000) === wk + 1)
  const left = weeklyResetIn(NOW)
  assert.ok(left > 0 && left <= 7 * 24 * 3600 * 1000)
})
