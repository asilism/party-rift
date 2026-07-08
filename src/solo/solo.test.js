import test from 'node:test'
import assert from 'node:assert/strict'
import { CLASS_IDS, TEAM_SIZES } from '../games/rift/engine.js'
import { STARTER_COUNT, unlockedCount, unlockedClassIds, nextUnlock } from './unlocks.js'
import { buildSoloRoster } from './roster.js'

test('해금: 기본 6종에서 승리마다 1종씩, 정의 순서대로 열린다', () => {
  assert.equal(unlockedCount(0), STARTER_COUNT)
  assert.deepEqual(unlockedClassIds(0), CLASS_IDS.slice(0, STARTER_COUNT))
  assert.equal(unlockedCount(3), STARTER_COUNT + 3)
  assert.equal(nextUnlock(0), CLASS_IDS[STARTER_COUNT])
  assert.equal(nextUnlock(2), CLASS_IDS[STARTER_COUNT + 2])
  // 전부 열린 뒤엔 더 늘지 않고 다음 해금도 없다
  assert.equal(unlockedCount(999), CLASS_IDS.length)
  assert.equal(nextUnlock(999), null)
  // 음수/비정상 입력은 기본 6종
  assert.equal(unlockedCount(-5), STARTER_COUNT)
  assert.equal(unlockedCount(undefined), STARTER_COUNT)
})

test('솔로 로스터: 매치 전체에서 직업이 겹치지 않는다 (내 직업 포함)', () => {
  for (const mode of Object.keys(TEAM_SIZES)) {
    for (let run = 0; run < 20; run++) {
      const roster = buildSoloRoster({ zodiacId: 'tiger', cls: 'warrior', mode })
      assert.equal(roster.length, TEAM_SIZES[mode] * 2, `${mode} 정원`)
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
