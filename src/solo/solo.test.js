import test from 'node:test'
import assert from 'node:assert/strict'
import { CLASS_IDS, TEAM_SIZES } from '../games/rift/engine.js'
import { STARTER_COUNT, unlockedCount, unlockedClassIds, unlockPrice, UNLOCK_PRICES } from './unlocks.js'
import { addCoinUnlock } from '../shared/storage.js'
import { buildSoloRoster } from './roster.js'

test('해금: 승리 해금 폐지 — 기본 6종 + 코인 해금, 가격은 열수록 오른다', () => {
  const store = new Map()
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  }
  try {
    assert.equal(unlockedCount(), STARTER_COUNT)
    assert.deepEqual(unlockedClassIds(), CLASS_IDS.slice(0, STARTER_COUNT))
    assert.equal(unlockPrice(), UNLOCK_PRICES[0])
    // 코인 해금이 쌓일수록 다음 가격이 오른다
    addCoinUnlock(CLASS_IDS[STARTER_COUNT])
    assert.equal(unlockedCount(), STARTER_COUNT + 1)
    assert.equal(unlockPrice(), UNLOCK_PRICES[1])
    addCoinUnlock(CLASS_IDS[STARTER_COUNT + 1])
    addCoinUnlock(CLASS_IDS[STARTER_COUNT + 2])
    assert.equal(unlockedCount(), STARTER_COUNT + 3)
    assert.equal(unlockPrice(), UNLOCK_PRICES[3])
    // 중복 해금은 안 쌓인다
    addCoinUnlock(CLASS_IDS[STARTER_COUNT])
    assert.equal(unlockedCount(), STARTER_COUNT + 3)
    // 올인원 구매(유료): 전 캐릭터 해금
    globalThis.localStorage.setItem('bgp.rift.unlockall.v1', 'on')
    assert.equal(unlockedCount(), CLASS_IDS.length)
  } finally {
    delete globalThis.localStorage
  }
})

test('솔로 로스터: 매치 전체에서 직업이 겹치지 않는다 (내 직업 포함)', () => {
  for (const mode of Object.keys(TEAM_SIZES)) {
    for (let run = 0; run < 20; run++) {
      const roster = buildSoloRoster({ zodiacId: 'tiger', cls: 'warrior', mode })
      // 보스전은 아군 5 + 보스 1, 방어전은 아군 5뿐(레드는 파도), 나머지는 팀 정원 × 2
      const want = mode === 'boss' ? TEAM_SIZES.boss + 1 : mode === 'defense' ? TEAM_SIZES.defense : TEAM_SIZES[mode] * 2
      assert.equal(roster.length, want, `${mode} 정원`)
      if (mode === 'boss') {
        const reds = roster.filter((p) => p.team === 'red')
        assert.equal(reds.length, 1, '보스는 하나')
        assert.ok(reds[0].cls.startsWith('boss_'), '레드는 보스 클래스')
      }
      const clsList = roster.map((p) => p.cls)
      assert.equal(new Set(clsList).size, clsList.length, `직업 중복 없음 (${clsList.join(',')})`)
      // 적팀에 내 직업(전사)이 없다
      const redWarrior = roster.find((p) => p.team === 'red' && p.cls === 'warrior')
      assert.equal(redWarrior, undefined)
      // 조디악도 중복 없음
      const zList = roster.map((p) => p.zodiacId)
      assert.equal(new Set(zList).size, zList.length)
    }
  }
})
