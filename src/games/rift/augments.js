// 조디악 증강 카드 (무한 방어 전용) — 순수 데이터 + 드로우 로직. three.js/엔진 의존 없음.
//  5의 배수 파도를 넘길 때마다 3장 중 1장을 고른다(롤 증강식). 능력치가 아니라 "규칙"을 바꿔
//  런마다 빌드가 달라지게 한다(하데스 신뽑기). 효과는 effect 키 묶음 — 엔진이 훅 지점에서 읽는다.
//
// effect 키(엔진 recomputeAugments가 합산 → 훅에서 적용):
//   atkMul/powerMul/hpMul  기본공격/주문력/최대체력 배율(+0.15 = +15%)
//   speed                  이동 속도 +
//   cdr                    스킬 쿨다운 감소(가산, 아이템과 합산 후 상한)
//   regen                  초당 최대체력 비율 회복 +
//   def                    받는 피해 감소(가산)
//   dealMul                주는 피해 전체 배율(+0.12 = +12%)
//   lowHpDR                체력 35% 이하일 때 추가 받는 피해 감소
//   killGold               적 처치 시 추가 골드(강화 자원 → 시너지)
//   perWaveAtk             파도를 넘길 때마다 영구 공격력 배율 누적(이 런)
//   thorns                 받은 피해의 이 비율을 공격자에게 반사
//   explode                처치 시 대상 최대체력의 이 비율만큼 주변 광역
//   execute                체력 30% 이하 적에게 주는 피해 +
//   ultCdMul               궁극기 쿨다운 배율(0.55 = 45% 단축) — 곱연산
//   skillRefund            스킬 시전 시 궁극기 쿨다운 이 초만큼 감소

export const RARITY_ORDER = { common: 0, rare: 1, legendary: 2 }
export const RARITY_META = {
  common: { label: '일반', color: '#9fb0c4' },
  rare: { label: '레어', color: '#5aa9ff' },
  legendary: { label: '전설', color: '#ffb43a' },
}
const BASE_WEIGHT = { common: 62, rare: 30, legendary: 8 }
export const AUG_PITY_LIMIT = 6 // 이 횟수 동안 전설이 안 나오면 다음 뽑기에 전설 보장

export const AUGMENTS = [
  // ── 일반 (안정적 성장) ──
  { id: 'c_atk', rarity: 'common', icon: '⚔️', name: '날카로운 이빨', desc: '기본공격 +15%', effect: { atkMul: 0.15 } },
  { id: 'c_power', rarity: 'common', icon: '🔮', name: '마력 각성', desc: '주문력 +15%', effect: { powerMul: 0.15 } },
  { id: 'c_hp', rarity: 'common', icon: '❤️', name: '단단한 가죽', desc: '최대 체력 +18%', effect: { hpMul: 0.18 } },
  { id: 'c_speed', rarity: 'common', icon: '👟', name: '날랜 발', desc: '이동 속도 +2', effect: { speed: 2 } },
  { id: 'c_cdr', rarity: 'common', icon: '⏱️', name: '집중', desc: '스킬 쿨다운 -10%', effect: { cdr: 0.1 } },
  { id: 'c_regen', rarity: 'common', icon: '🌿', name: '재생의 숨결', desc: '초당 체력 +1.2% 회복', effect: { regen: 0.012 } },
  { id: 'c_def', rarity: 'common', icon: '🛡️', name: '굳은 각오', desc: '받는 피해 -8%', effect: { def: 0.08 } },
  { id: 'c_gold', rarity: 'common', icon: '🪙', name: '전리품', desc: '적 처치 시 +8골드', effect: { killGold: 8 } },

  // ── 레어 (조건부·시너지·빌드 조력) ──
  { id: 'r_deal', rarity: 'rare', icon: '💥', name: '맹공', desc: '주는 피해 +14%', effect: { dealMul: 0.14 } },
  { id: 'r_lowhp', rarity: 'rare', icon: '🩸', name: '배수진', desc: '체력 35% 이하일 때 받는 피해 -40%', effect: { lowHpDR: 0.4 } },
  { id: 'r_stack', rarity: 'rare', icon: '📈', name: '전장의 성장', desc: '파도를 넘길 때마다 공격력 +2.5% (영구)', effect: { perWaveAtk: 0.025 } },
  { id: 'r_thorns', rarity: 'rare', icon: '🌵', name: '가시 갑옷', desc: '받은 피해의 25%를 되돌린다', effect: { thorns: 0.25 } },
  { id: 'r_explode', rarity: 'rare', icon: '☄️', name: '연쇄 폭발', desc: '처치 시 주변에 광역 피해', effect: { explode: 0.35 } },
  { id: 'r_exec', rarity: 'rare', icon: '🎯', name: '처형자', desc: '체력 30% 이하 적에게 주는 피해 +35%', effect: { execute: 0.35 } },
  { id: 'r_gold', rarity: 'rare', icon: '💰', name: '노다지', desc: '적 처치 시 +18골드 (강화 자원)', effect: { killGold: 18 } },
  { id: 'r_bulwark', rarity: 'rare', icon: '🏰', name: '철벽', desc: '최대 체력 +20% · 받는 피해 -10%', effect: { hpMul: 0.2, def: 0.1 } },

  // ── 전설 (런을 정의하는 대박) ──
  { id: 'l_ult', rarity: 'legendary', icon: '🌟', name: '무한의 힘', desc: '궁극기 쿨다운 -45%', effect: { ultCdMul: 0.55 } },
  { id: 'l_deal', rarity: 'legendary', icon: '⚡', name: '파괴의 화신', desc: '주는 피해 +30%', effect: { dealMul: 0.3 } },
  { id: 'l_stack', rarity: 'legendary', icon: '🔥', name: '멈추지 않는 진격', desc: '공격력 +20% · 파도마다 +4% (영구)', effect: { atkMul: 0.2, perWaveAtk: 0.04 } },
  { id: 'l_nova', rarity: 'legendary', icon: '💫', name: '초신성', desc: '처치 시 강력한 광역 폭발 · 처치 골드 +15', effect: { explode: 0.7, killGold: 15 } },
  { id: 'l_immortal', rarity: 'legendary', icon: '👑', name: '불사의 군주', desc: '최대 체력 +40% · 받는 피해 -15% · 초당 +2% 회복', effect: { hpMul: 0.4, def: 0.15, regen: 0.02 } },
  { id: 'l_skill', rarity: 'legendary', icon: '🌀', name: '연쇄 시전', desc: '스킬을 쓸 때마다 궁극기 쿨다운 -3초', effect: { skillRefund: 3 } },

  // ── 조디악 시그니처 (그 지신에게만 등장 — 정체성 축) ──
  { id: 'z_rat', rarity: 'rare', icon: '🐭', name: '교활한 수집가', desc: '[쥐] 처치 시 +20골드 · 이동 속도 +2', zodiac: 'rat', effect: { killGold: 20, speed: 2 } },
  { id: 'z_ox', rarity: 'rare', icon: '🐮', name: '황소의 뚝심', desc: '[소] 최대 체력 +25% · 받는 피해 25% 반사', zodiac: 'ox', effect: { hpMul: 0.25, thorns: 0.25 } },
  { id: 'z_tiger', rarity: 'legendary', icon: '🐯', name: '호랑이의 이빨', desc: '[호랑이] 기본공격 +25% · 저체력 적 처형 +40%', zodiac: 'tiger', effect: { atkMul: 0.25, execute: 0.4 } },
  { id: 'z_rabbit', rarity: 'rare', icon: '🐰', name: '달빛 도약', desc: '[토끼] 이동 속도 +3 · 저체력일 때 받는 피해 -45%', zodiac: 'rabbit', effect: { speed: 3, lowHpDR: 0.45 } },
  { id: 'z_dragon', rarity: 'legendary', icon: '🐲', name: '용의 숨결', desc: '[용] 주는 피해 +22% · 처치 시 광역 폭발', zodiac: 'dragon', effect: { dealMul: 0.22, explode: 0.5 } },
  { id: 'z_snake', rarity: 'rare', icon: '🐍', name: '독사의 일격', desc: '[뱀] 저체력 적 처형 +35% · 주는 피해 +10%', zodiac: 'snake', effect: { execute: 0.35, dealMul: 0.1 } },
  { id: 'z_horse', rarity: 'rare', icon: '🐴', name: '질풍', desc: '[말] 이동 속도 +3 · 기본공격 +15%', zodiac: 'horse', effect: { speed: 3, atkMul: 0.15 } },
  { id: 'z_goat', rarity: 'rare', icon: '🐑', name: '양의 가호', desc: '[양] 초당 +2.5% 회복 · 최대 체력 +15%', zodiac: 'goat', effect: { regen: 0.025, hpMul: 0.15 } },
  { id: 'z_monkey', rarity: 'legendary', icon: '🐵', name: '재간둥이', desc: '[원숭이] 스킬 쿨 -15% · 스킬 시전 시 궁 쿨 -3초', zodiac: 'monkey', effect: { cdr: 0.15, skillRefund: 3 } },
  { id: 'z_rooster', rarity: 'rare', icon: '🐔', name: '새벽의 함성', desc: '[닭] 기본공격 +12% · 파도마다 +3% (영구)', zodiac: 'rooster', effect: { atkMul: 0.12, perWaveAtk: 0.03 } },
  { id: 'z_dog', rarity: 'rare', icon: '🐶', name: '충직한 수호', desc: '[개] 받는 피해 -12% · 25% 반사 · 최대 체력 +12%', zodiac: 'dog', effect: { def: 0.12, thorns: 0.25, hpMul: 0.12 } },
  { id: 'z_pig', rarity: 'rare', icon: '🐷', name: '풍요', desc: '[돼지] 최대 체력 +18% · 처치 시 +12골드 · 초당 +1.5% 회복', zodiac: 'pig', effect: { hpMul: 0.18, killGold: 12, regen: 0.015 } },
]

export const AUG_BY_ID = Object.fromEntries(AUGMENTS.map((a) => [a.id, a]))

// 이 영웅이 뽑을 수 있는 후보 풀 — 조디악 시그니처는 본인 것만, 이미 가진 유니크 카드는 제외.
function candidatePool(hero) {
  const owned = new Set(hero.augments || [])
  return AUGMENTS.filter((a) => (!a.zodiac || a.zodiac === hero.zodiacId) && !owned.has(a.id))
}

// 가중 무작위로 서로 다른 n장을 뽑는다.
function weightedSampleDistinct(items, weightOf, n, rng) {
  const pool = [...items]
  const out = []
  while (out.length < n && pool.length) {
    const total = pool.reduce((s, it) => s + weightOf(it), 0)
    if (total <= 0) { out.push(pool.shift()); continue }
    let r = rng() * total
    let idx = 0
    for (; idx < pool.length; idx++) { r -= weightOf(pool[idx]); if (r <= 0) break }
    idx = Math.min(idx, pool.length - 1)
    out.push(pool.splice(idx, 1)[0])
  }
  return out
}

// 뽑기: 영웅의 후보에서 서로 다른 3장. 최소 1장 레어+ 보장, pity면 전설 1장 보장,
//  깊은 웨이브일수록 전설 가중치↑. 반환 { choices, pity(갱신) }.
export function rollAugmentChoices(rng, hero, wave, pity = 0) {
  const pool = candidatePool(hero)
  const legoBonus = Math.max(0, Math.floor((wave - 20) / 10)) // 20웨 이후 10웨마다 전설 가중 +1
  const weightOf = (a) => BASE_WEIGHT[a.rarity] + (a.rarity === 'legendary' ? legoBonus : 0)
  const N = Math.min(3, pool.length)
  const choices = weightedSampleDistinct(pool, weightOf, N, rng)

  const hasRarity = (r) => choices.some((c) => c.rarity === r)
  const rankOf = (c) => RARITY_ORDER[c.rarity]
  // pity: 전설 강제
  const forceLego = pity + 1 >= AUG_PITY_LIMIT
  if (forceLego && !hasRarity('legendary')) {
    const legos = pool.filter((a) => a.rarity === 'legendary' && !choices.includes(a))
    if (legos.length) {
      const pick = legos[Math.floor(rng() * legos.length)]
      // 가장 낮은 등급 한 장을 전설로 교체
      let worst = 0
      for (let i = 1; i < choices.length; i++) if (rankOf(choices[i]) < rankOf(choices[worst])) worst = i
      choices[worst] = pick
    }
  }
  // 최소 1장 레어+ 보장
  if (!hasRarity('rare') && !hasRarity('legendary')) {
    const rares = pool.filter((a) => a.rarity !== 'common' && !choices.includes(a))
    if (rares.length && choices.length) {
      const pick = rares[Math.floor(rng() * rares.length)]
      choices[Math.floor(rng() * choices.length)] = pick
    }
  }
  const gotLego = choices.some((c) => c.rarity === 'legendary')
  return { choices, pity: gotLego ? 0 : pity + 1 }
}
