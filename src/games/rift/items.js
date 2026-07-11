// 조디악 블리츠 아이템 상점 데이터 (순수 JS — three.js / 엔진 의존 없음).
//  - 병사/정글몹/타워/적 영웅을 처치하면 골드를 얻는다.
//  - 수호석 회복 지대(우물)에서 상점을 열어 아이템을 산다 (인벤토리 5칸).
//  - 카테고리 4종(마법/공격/방어/유틸) × 8개 = 32종 (각 타입에 2천 골드 이상 최종 장비 1개).
//  - 조합: 상위 아이템의 from(재료)을 갖고 있으면 그 가격만큼 깎아 사고 재료는 소모된다(슬롯 확보).
//  - 액티브: active 필드가 있는 아이템은 전투 중 사용 효과(자힐/정화)를 쿨다운마다 쓸 수 있다.
//
// 각 아이템은 stats로 영웅 능력치에 더해진다(패시브):
//   atk        기본공격 공격력 +
//   power      스킬/궁극기(주문) 위력 +
//   hp         최대 체력 +
//   def        받는 피해 감소 비율 (0.1 = 10% 덜 받음, 합산 상한 0.6)
//   speed      이동 속도 +
//   atkSpeed   공격 쿨다운 감소 비율 (0.25 = 25% 빠름, 상한 0.5)
//   cdr        스킬/궁극기 쿨다운 감소 비율 (상한 0.45)
//   regen      초당 최대 체력 비율 회복 (전투 중에도 항상)
//   lifesteal  기본공격 피해의 이 비율만큼 흡혈
//   range      기본공격 사거리 +

export const ITEM_SLOTS = 5 // 인벤토리 칸 수 — 조합 도입으로 칸 순환이 빨라져 한 칸 더 연다
export const SELL_REFUND = 0.6 // 되팔 때 돌려받는 비율

// 카테고리 메타 (상점 탭)
export const CATEGORIES = [
  { id: 'magic', name: '마법', icon: '🔮', color: '#b07ef0' },
  { id: 'attack', name: '공격', icon: '⚔️', color: '#ff9a4d' },
  { id: 'defense', name: '방어', icon: '🛡️', color: '#6ec1ff' },
  { id: 'util', name: '유틸', icon: '✨', color: '#6ee7a0' },
]

// 능력치 키 (요약 표시/합산용)
export const STAT_KEYS = [
  'atk', 'power', 'hp', 'def', 'speed', 'atkSpeed', 'cdr', 'regen', 'lifesteal', 'range',
]

// 능력치 한글 라벨 (상점 툴팁용) — 값 포맷 함수 포함
export const STAT_LABEL = {
  atk: { name: '공격력', fmt: (v) => `+${v}` },
  power: { name: '주문 위력', fmt: (v) => `+${v}` },
  hp: { name: '체력', fmt: (v) => `+${v}` },
  def: { name: '피해 감소', fmt: (v) => `+${Math.round(v * 100)}%` },
  speed: { name: '이동 속도', fmt: (v) => `+${v}` },
  atkSpeed: { name: '공격 속도', fmt: (v) => `+${Math.round(v * 100)}%` },
  cdr: { name: '쿨다운 감소', fmt: (v) => `+${Math.round(v * 100)}%` },
  regen: { name: '체력 재생', fmt: (v) => `+${(v * 100).toFixed(1)}%/s` },
  lifesteal: { name: '흡혈', fmt: (v) => `+${Math.round(v * 100)}%` },
  range: { name: '사거리', fmt: (v) => `+${v}` },
}

// 합산 상한 (한 아이템에 몰빵 못하게 + 무한 누적 방지)
const CAPS = { def: 0.6, atkSpeed: 0.5, cdr: 0.45 }

// 아이템 효과 배율 — 장비 효과가 확실히 체감되게 표기값보다 강하게 적용.
export const EFFECT_MULT = 1.5

export const ITEMS = [
  // ── 마법 (주문 위력 / 쿨다운) ──
  { id: 'orb', cat: 'magic', name: '마력의 구슬', icon: '🔮', cost: 300,
    desc: '주문 위력을 살짝 올려준다.', stats: { power: 20 } },
  { id: 'flame_core', cat: 'magic', name: '화염의 핵', icon: '🔥', cost: 700, from: ['orb'],
    desc: '스킬·궁극기 위력이 크게 오른다.', stats: { power: 45 } },
  { id: 'wisdom_hat', cat: 'magic', name: '지혜의 모자', icon: '🎩', cost: 850, from: ['orb'],
    desc: '주문 위력 + 쿨다운 감소.', stats: { power: 30, cdr: 0.15 } },
  { id: 'frost_staff', cat: 'magic', name: '서리 지팡이', icon: '❄️', cost: 900, from: ['orb', 'leather'],
    desc: '주문 위력 + 단단함.', stats: { power: 35, hp: 150 } },
  { id: 'soul_lantern', cat: 'magic', name: '영혼의 등불', icon: '🏮', cost: 800, from: ['orb'],
    desc: '주문 위력 + 꾸준한 재생 — 라인에 오래 버티는 마법사용.', stats: { power: 30, regen: 0.015 } },
  { id: 'storm_scepter', cat: 'magic', name: '폭풍의 셉터', icon: '🌩️', cost: 1000, from: ['orb', 'dagger'],
    desc: '주문 위력 + 공격 속도 — 평타를 섞어 싸우는 전투 마법사용.', stats: { power: 40, atkSpeed: 0.15 } },
  { id: 'void_staff', cat: 'magic', name: '공허의 지팡이', icon: '🌌', cost: 1150, from: ['flame_core'],
    desc: '주문 위력을 폭발적으로 올린다.', stats: { power: 70 } },
  { id: 'archmage_staff', cat: 'magic', name: '대마법사의 홀', icon: '🪄', cost: 2400, from: ['void_staff', 'wisdom_hat'],
    desc: '주문 위력 + 쿨다운 + 체력. 마법 최종 장비.', stats: { power: 90, cdr: 0.2, hp: 200 } },

  // ── 공격 (기본공격 위주) ──
  { id: 'dagger', cat: 'attack', name: '단검', icon: '🗡️', cost: 250,
    desc: '값싼 공격력.', stats: { atk: 12 } },
  { id: 'longsword', cat: 'attack', name: '장검', icon: '⚔️', cost: 550, from: ['dagger'],
    desc: '묵직한 공격력.', stats: { atk: 30 } },
  { id: 'vampire_scythe', cat: 'attack', name: '흡혈낫', icon: '🩸', cost: 800, from: ['dagger'],
    desc: '공격력 + 때릴 때마다 흡혈.', stats: { atk: 20, lifesteal: 0.15 } },
  { id: 'rage_gloves', cat: 'attack', name: '광폭의 장갑', icon: '🥊', cost: 800, from: ['dagger'],
    desc: '공격 속도를 크게 올린다.', stats: { atkSpeed: 0.25, atk: 12 } },
  { id: 'berserker_axe', cat: 'attack', name: '광전사의 도끼', icon: '🪓', cost: 850, from: ['dagger'],
    desc: '공격력 + 이동 속도 — 추격전에 강하다.', stats: { atk: 25, speed: 1.8 } },
  { id: 'duelist_rapier', cat: 'attack', name: '결투가의 레이피어', icon: '🤺', cost: 900, from: ['dagger'],
    desc: '공격력 + 쿨다운 감소 — 스킬을 섞어 싸우는 전사용.', stats: { atk: 28, cdr: 0.12 } },
  { id: 'executioner', cat: 'attack', name: '처형자의 대검', icon: '💀', cost: 1150, from: ['longsword'],
    desc: '압도적인 공격력.', stats: { atk: 55 } },
  { id: 'dragon_blade', cat: 'attack', name: '용살자의 대검', icon: '🐲', cost: 2300, from: ['executioner', 'rage_gloves'],
    desc: '엄청난 공격력 + 공격 속도 + 흡혈. 공격 최종 장비.', stats: { atk: 75, atkSpeed: 0.2, lifesteal: 0.12 } },

  // ── 방어 (체력 / 피해 감소) ──
  { id: 'leather', cat: 'defense', name: '가죽 갑옷', icon: '🧥', cost: 300,
    desc: '값싼 체력.', stats: { hp: 150 } },
  { id: 'plate', cat: 'defense', name: '강철 판금', icon: '🛡️', cost: 750, from: ['leather'],
    desc: '체력 + 피해 감소.', stats: { hp: 250, def: 0.08 } },
  { id: 'guardian_cloak', cat: 'defense', name: '수호의 망토', icon: '🧣', cost: 850, from: ['leather', 'orb'],
    desc: '받는 피해를 크게 줄이고 주문 위력도 더해 준다 — 무른 마법사용 방어구.', stats: { def: 0.15, power: 25 } },
  { id: 'giant_heart', cat: 'defense', name: '거인의 심장', icon: '🫀', cost: 1050, from: ['leather'],
    desc: '엄청난 체력.', stats: { hp: 450 } },
  { id: 'war_banner', cat: 'defense', name: '전장의 깃발', icon: '🚩', cost: 800, from: ['leather'],
    desc: '체력 + 공격력 — 맞으면서 때리는 브루저용.', stats: { hp: 200, atk: 15 } },
  { id: 'mirror_shield', cat: 'defense', name: '거울 방패', icon: '🪞', cost: 950, from: ['leather'],
    desc: '피해 감소 + 체력 + 쿨다운 감소.', stats: { def: 0.12, hp: 120, cdr: 0.1 } },
  { id: 'thornmail', cat: 'defense', name: '가시 갑옷', icon: '🌵', cost: 1000, from: ['plate'],
    desc: '체력 + 피해 감소 + 재생.', stats: { hp: 200, def: 0.1, regen: 0.01 } },
  { id: 'immortal_plate', cat: 'defense', name: '불멸의 갑주', icon: '🏰', cost: 2400, from: ['giant_heart', 'plate'],
    desc: '거대한 체력 + 피해 감소 + 재생 + 주문 위력. 마법사도 단단해지는 방어 최종 장비.', stats: { hp: 500, def: 0.18, regen: 0.015, power: 50 } },

  // ── 유틸 (속도 / 쿨다운 / 재생 / 사거리 / 사용 효과) ──
  { id: 'boots', cat: 'util', name: '신속의 장화', icon: '👟', cost: 300,
    desc: '발이 빨라진다.', stats: { speed: 2.8 } },
  { id: 'light_charm', cat: 'util', name: '빛의 부적', icon: '🪬', cost: 700,
    desc: '스킬을 더 자주 쓴다.', stats: { cdr: 0.2 } },
  { id: 'hunter_seal', cat: 'util', name: '사냥꾼의 인장', icon: '🎯', cost: 650, from: ['dagger'],
    desc: '사거리 + 약간의 공격력.', stats: { range: 3, atk: 8 } },
  { id: 'regen_pendant', cat: 'util', name: '재생의 목걸이', icon: '📿', cost: 500,
    desc: '체력이 꾸준히 차오른다.', stats: { regen: 0.018, hp: 100 } },
  { id: 'heal_flask', cat: 'util', name: '회복의 물병', icon: '🧪', cost: 500,
    desc: '사용하면 즉시 최대 체력의 25%를 회복한다 (아이콘 탭/클릭).', stats: { hp: 80 },
    active: { kind: 'heal', cd: 45, label: '25% 회복' } },
  { id: 'cleanse_bell', cat: 'util', name: '정화의 종', icon: '🔔', cost: 700,
    desc: '사용하면 기절·빙결·속박·도발·둔화·중독·공포를 즉시 해제한다 (CC 중에도 사용 가능).', stats: { hp: 60, speed: 1 },
    active: { kind: 'cleanse', cd: 60, label: 'CC 해제' } },
  { id: 'sage_stone', cat: 'util', name: '현자의 돌', icon: '💎', cost: 1300, from: ['orb', 'dagger'],
    desc: '모든 능력치를 조금씩.', stats: { power: 15, atk: 10, hp: 120, cdr: 0.12, speed: 1 } },
  { id: 'time_hourglass', cat: 'util', name: '시간의 모래시계', icon: '⏳', cost: 2500, from: ['light_charm', 'sage_stone'],
    desc: '쿨다운·이동 속도·위력·체력을 두루. 유틸 최종 장비.', stats: { cdr: 0.25, speed: 3, power: 30, hp: 150 } },
]

export const ITEMS_BY_ID = Object.fromEntries(ITEMS.map((it) => [it.id, it]))
export const getItem = (id) => ITEMS_BY_ID[id] || null

// 조합 구매 견적: 인벤토리에서 소모될 재료 슬롯(consumes)과 실제 지불가(price)를 계산한다.
//  직접 재료(from)만 인정 — 재료의 재료까지 재귀하진 않는다(단계적으로 사 올라가는 구조).
export function buildQuote(ownedIds, itemId) {
  const item = ITEMS_BY_ID[itemId]
  if (!item) return null
  const consumes = []
  if (item.from) {
    const used = new Set()
    for (const compId of item.from) {
      const idx = (ownedIds || []).findIndex((id, i) => id === compId && !used.has(i))
      if (idx >= 0) {
        used.add(idx)
        consumes.push(idx)
      }
    }
  }
  const discount = consumes.reduce((sum, i) => sum + ITEMS_BY_ID[ownedIds[i]].cost, 0)
  return { price: Math.max(0, item.cost - discount), consumes }
}

// 가진 아이템 id 목록 → 합산 보너스(능력치). 효과 배율 후 상한을 적용한다.
export function sumStats(itemIds) {
  const b = { atk: 0, power: 0, hp: 0, def: 0, speed: 0, atkSpeed: 0, cdr: 0, regen: 0, lifesteal: 0, range: 0 }
  for (const id of itemIds || []) {
    const it = ITEMS_BY_ID[id]
    if (!it) continue
    for (const k in it.stats) b[k] += it.stats[k]
  }
  // 정수형 능력치(공격력/체력 등)는 반올림해 깔끔하게
  const round = new Set(['atk', 'power', 'hp'])
  for (const k in b) {
    b[k] *= EFFECT_MULT
    if (round.has(k)) b[k] = Math.round(b[k])
  }
  for (const k in CAPS) b[k] = Math.min(CAPS[k], b[k])
  return b
}
