import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AUGMENTS, AUG_BY_ID, rollAugmentChoices, AUG_PITY_LIMIT } from './augments.js'

const lcg = (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
const hero = (zodiacId = 'rat', augments = []) => ({ zodiacId, augments })

test('증강 데이터: id 유일 · 효과 존재 · 시그니처 12지신 각 1장', () => {
  const ids = AUGMENTS.map((a) => a.id)
  assert.equal(new Set(ids).size, ids.length, 'id 중복 없음')
  for (const a of AUGMENTS) {
    assert.ok(a.name && a.icon && a.rarity && a.effect, `${a.id} 필드 완비`)
    assert.ok(Object.keys(a.effect).length > 0, `${a.id} 효과 있음`)
  }
  const sigs = AUGMENTS.filter((a) => a.zodiac)
  const zodiacs = new Set(sigs.map((a) => a.zodiac))
  assert.equal(zodiacs.size, 12, '12지신 시그니처')
  assert.equal(sigs.length, 12, '지신당 1장')
})

test('드로우: 서로 다른 3장 + 최소 1장 레어+ 보장', () => {
  const rng = lcg(42)
  for (let i = 0; i < 200; i++) {
    const { choices } = rollAugmentChoices(rng, hero('tiger'), 10, 0)
    assert.equal(choices.length, 3)
    assert.equal(new Set(choices.map((c) => c.id)).size, 3, '중복 없음')
    assert.ok(choices.some((c) => c.rarity !== 'common'), '레어+ 최소 1장')
  }
})

test('드로우: 등급 빈도 — 일반 > 레어 > 전설', () => {
  const rng = lcg(7)
  const cnt = { common: 0, rare: 0, legendary: 0 }
  for (let i = 0; i < 1000; i++) {
    // pity 개입 없이 순수 빈도만 보려고 매번 pity=0
    for (const c of rollAugmentChoices(rng, hero('ox'), 10, 0).choices) cnt[c.rarity]++
  }
  assert.ok(cnt.common > cnt.rare, `일반(${cnt.common}) > 레어(${cnt.rare})`)
  assert.ok(cnt.rare > cnt.legendary, `레어(${cnt.rare}) > 전설(${cnt.legendary})`)
})

test('드로우: pity — 전설 미출현이 한계에 이르면 전설 보장', () => {
  const rng = lcg(99)
  // pity를 한계-1까지 올린 뒤 다음 뽑기는 전설 보장
  const { choices, pity } = rollAugmentChoices(rng, hero('rat'), 5, AUG_PITY_LIMIT - 1)
  assert.ok(choices.some((c) => c.rarity === 'legendary'), 'pity 한계에서 전설 보장')
  assert.equal(pity, 0, '전설 나오면 pity 리셋')
})

test('드로우: pity 증가/리셋 동작', () => {
  const rng = lcg(3)
  let pity = 0
  let sawReset = false
  for (let i = 0; i < 30; i++) {
    const r = rollAugmentChoices(rng, hero('dog'), 10, pity)
    const gotLego = r.choices.some((c) => c.rarity === 'legendary')
    assert.equal(r.pity, gotLego ? 0 : pity + 1, 'pity 규칙')
    if (gotLego) sawReset = true
    pity = r.pity
    assert.ok(pity < AUG_PITY_LIMIT + 1, 'pity가 한계를 넘지 않음(보장 발동)')
  }
  assert.ok(sawReset, '리셋이 한 번은 관측됨')
})

test('드로우: 조디악 시그니처는 본인에게만 등장', () => {
  const rng = lcg(11)
  // 용 시그니처(z_dragon)는 rat에게 절대 안 나오고, dragon에게는 후보에 있다
  let ratSawDragonSig = false
  for (let i = 0; i < 300; i++) {
    if (rollAugmentChoices(rng, hero('rat'), 10, 0).choices.some((c) => c.id === 'z_dragon')) ratSawDragonSig = true
  }
  assert.equal(ratSawDragonSig, false, '쥐에게 용 시그니처 안 나옴')
  assert.equal(AUG_BY_ID.z_dragon.zodiac, 'dragon')
})

test('드로우: 이미 가진 카드는 다시 안 나온다', () => {
  const rng = lcg(21)
  const owned = ['c_atk', 'c_hp', 'r_deal']
  for (let i = 0; i < 200; i++) {
    const { choices } = rollAugmentChoices(rng, hero('horse', owned), 10, 0)
    for (const c of choices) assert.ok(!owned.includes(c.id), `${c.id} 중복 미출현`)
  }
})
