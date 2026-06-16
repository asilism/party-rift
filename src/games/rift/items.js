// 파티 리프트 아이템 상점 데이터 (순수 JS — three.js / 엔진 의존 없음).
//  - 미니언/정글몹/타워/적 영웅을 처치하면 골드를 얻는다.
//  - 넥서스 회복 지대(우물)에서 상점을 열어 아이템을 산다 (인벤토리 3칸).
//  - 카테고리 4종(마법/공격/방어/유틸) × 6개 = 24종 (각 타입에 2천 골드 이상 최종 장비 1개). 조합은 없음(초안).
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

export const ITEM_SLOTS = 3 // 인벤토리 칸 수
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
  { id: 'flame_core', cat: 'magic', name: '화염의 핵', icon: '🔥', cost: 700,
    desc: '스킬·궁극기 위력이 크게 오른다.', stats: { power: 45 } },
  { id: 'wisdom_hat', cat: 'magic', name: '지혜의 모자', icon: '🎩', cost: 850,
    desc: '주문 위력 + 쿨다운 감소.', stats: { power: 30, cdr: 0.15 } },
  { id: 'frost_staff', cat: 'magic', name: '서리 지팡이', icon: '❄️', cost: 900,
    desc: '주문 위력 + 단단함.', stats: { power: 35, hp: 150 } },
  { id: 'void_staff', cat: 'magic', name: '공허의 지팡이', icon: '🌌', cost: 1150,
    desc: '주문 위력을 폭발적으로 올린다.', stats: { power: 70 } },
  { id: 'archmage_staff', cat: 'magic', name: '대마법사의 홀', icon: '🪄', cost: 2400,
    desc: '주문 위력 + 쿨다운 + 체력. 마법 최종 장비.', stats: { power: 90, cdr: 0.2, hp: 200 } },

  // ── 공격 (기본공격 위주) ──
  { id: 'dagger', cat: 'attack', name: '단검', icon: '🗡️', cost: 250,
    desc: '값싼 공격력.', stats: { atk: 12 } },
  { id: 'longsword', cat: 'attack', name: '장검', icon: '⚔️', cost: 550,
    desc: '묵직한 공격력.', stats: { atk: 30 } },
  { id: 'vampire_scythe', cat: 'attack', name: '흡혈낫', icon: '🩸', cost: 800,
    desc: '공격력 + 때릴 때마다 흡혈.', stats: { atk: 20, lifesteal: 0.15 } },
  { id: 'rage_gloves', cat: 'attack', name: '광폭의 장갑', icon: '🥊', cost: 800,
    desc: '공격 속도를 크게 올린다.', stats: { atkSpeed: 0.25, atk: 12 } },
  { id: 'executioner', cat: 'attack', name: '처형자의 대검', icon: '💀', cost: 1150,
    desc: '압도적인 공격력.', stats: { atk: 55 } },
  { id: 'dragon_blade', cat: 'attack', name: '용살자의 대검', icon: '🐲', cost: 2300,
    desc: '엄청난 공격력 + 공격 속도 + 흡혈. 공격 최종 장비.', stats: { atk: 75, atkSpeed: 0.2, lifesteal: 0.12 } },

  // ── 방어 (체력 / 피해 감소) ──
  { id: 'leather', cat: 'defense', name: '가죽 갑옷', icon: '🧥', cost: 300,
    desc: '값싼 체력.', stats: { hp: 150 } },
  { id: 'plate', cat: 'defense', name: '강철 판금', icon: '🛡️', cost: 750,
    desc: '체력 + 피해 감소.', stats: { hp: 250, def: 0.08 } },
  { id: 'guardian_cloak', cat: 'defense', name: '수호의 망토', icon: '🧣', cost: 750,
    desc: '받는 피해를 크게 줄인다.', stats: { def: 0.15 } },
  { id: 'giant_heart', cat: 'defense', name: '거인의 심장', icon: '🫀', cost: 1050,
    desc: '엄청난 체력.', stats: { hp: 450 } },
  { id: 'thornmail', cat: 'defense', name: '가시 갑옷', icon: '🌵', cost: 1000,
    desc: '체력 + 피해 감소 + 재생.', stats: { hp: 200, def: 0.1, regen: 0.01 } },
  { id: 'immortal_plate', cat: 'defense', name: '불멸의 갑주', icon: '🏰', cost: 2200,
    desc: '거대한 체력 + 피해 감소 + 재생. 방어 최종 장비.', stats: { hp: 500, def: 0.18, regen: 0.015 } },

  // ── 유틸 (속도 / 쿨다운 / 재생 / 사거리) ──
  { id: 'boots', cat: 'util', name: '신속의 장화', icon: '👟', cost: 300,
    desc: '발이 빨라진다.', stats: { speed: 2.8 } },
  { id: 'light_charm', cat: 'util', name: '빛의 부적', icon: '🪬', cost: 700,
    desc: '스킬을 더 자주 쓴다.', stats: { cdr: 0.2 } },
  { id: 'hunter_seal', cat: 'util', name: '사냥꾼의 인장', icon: '🎯', cost: 650,
    desc: '사거리 + 약간의 공격력.', stats: { range: 3, atk: 8 } },
  { id: 'regen_pendant', cat: 'util', name: '재생의 목걸이', icon: '📿', cost: 500,
    desc: '체력이 꾸준히 차오른다.', stats: { regen: 0.018, hp: 100 } },
  { id: 'sage_stone', cat: 'util', name: '현자의 돌', icon: '💎', cost: 1300,
    desc: '모든 능력치를 조금씩.', stats: { power: 15, atk: 10, hp: 120, cdr: 0.12, speed: 1 } },
  { id: 'time_hourglass', cat: 'util', name: '시간의 모래시계', icon: '⏳', cost: 2500,
    desc: '쿨다운·이동 속도·위력·체력을 두루. 유틸 최종 장비.', stats: { cdr: 0.25, speed: 3, power: 30, hp: 150 } },
]

export const ITEMS_BY_ID = Object.fromEntries(ITEMS.map((it) => [it.id, it]))
export const getItem = (id) => ITEMS_BY_ID[id] || null

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
