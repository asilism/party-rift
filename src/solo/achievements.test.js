import test from 'node:test'
import assert from 'node:assert/strict'
import { ACHIEVEMENTS, recordMatchForAchievements } from './achievements.js'

// node 환경(localStorage 없음)에서 저장은 무해한 no-op — 한 번의 호출 안에서 판정만 검증한다.

test('업적: id 중복 없음 + 필수 필드', () => {
  const ids = new Set()
  for (const d of ACHIEVEMENTS) {
    assert.ok(!ids.has(d.id), `중복 id: ${d.id}`)
    ids.add(d.id)
    assert.ok(d.name && d.desc && d.icon, `${d.id} 표시 필드 누락`)
    assert.ok(d.target > 0 && d.reward > 0, `${d.id} 수치 이상`)
    assert.equal(typeof d.get, 'function', `${d.id} get 누락`)
  }
})

test('업적: 첫 판(승리·8킬·3연속킬)에 해당 업적 달성', () => {
  const me = { kills: 8, assists: 1, deaths: 2, jungleKills: 3, soldierKills: 40, dragonKills: 1, baronKills: 0, bestStreak: 3 }
  const newly = recordMatchForAchievements({ view: { mode: '3v3' }, me, win: true })
  const got = newly.map((d) => d.id)
  for (const want of ['kills_1', 'win_1', 'game_kills_8', 'streak_3', 'dragon_1']) {
    assert.ok(got.includes(want), `${want} 미달성 (got: ${got.join(',')})`)
  }
  assert.ok(!got.includes('kills_50'), '누적 8킬로 50킬 업적이 열리면 안 됨')
})

test('업적: 보스 악몽 클리어는 어려움 업적도 함께 충족', () => {
  const me = { kills: 2, assists: 0, deaths: 0, jungleKills: 0, soldierKills: 5, dragonKills: 0, baronKills: 0, bestStreak: 1 }
  const newly = recordMatchForAchievements({ view: { mode: 'boss', bossTier: 'nightmare', timePlayed: 280 }, me, win: true })
  const got = newly.map((d) => d.id)
  for (const want of ['boss_first', 'boss_hard', 'boss_nightmare', 'boss_fast', 'boss_nodeath']) {
    assert.ok(got.includes(want), `${want} 미달성 (got: ${got.join(',')})`)
  }
})

test('업적: 패배 판은 승리 카운트가 안 오른다', () => {
  const me = { kills: 0, assists: 0, deaths: 3, jungleKills: 0, soldierKills: 0, dragonKills: 0, baronKills: 0, bestStreak: 0 }
  const newly = recordMatchForAchievements({ view: { mode: 'boss', bossTier: 'normal' }, me, win: false })
  const got = newly.map((d) => d.id)
  assert.ok(!got.includes('win_1') && !got.includes('boss_first'), `패배인데 승리 업적: ${got.join(',')}`)
})
