// 주간 한정 상점 — 서버 없이 클라만으로 "이번 주 진열"을 결정론적으로 만든다.
//  같은 주(weekIndex)에는 모든 유저가 같은 featured 순서를 본다(전역 결정론).
//  각 유저는 그 순서에서 "아직 안 산 것" 앞에서부터 count개를 본다(항상 살 수 있는 선반).
//  기기 시계 조작으로 미래 주를 미리 보는 건 수용한다(오프라인 게임).

// 기준 월요일(UTC) — 이 날 0시부터 1주 단위로 진열이 바뀐다. 고정 상수.
const EPOCH = Date.UTC(2026, 0, 5) // 2026-01-05 (월)
const WEEK_MS = 7 * 24 * 60 * 60 * 1000
export const WEEKLY_DISCOUNT = 0.3 // 할인 상품 30% off
const DISCOUNT_SLOTS = 2 // 진열 중 몇 칸을 할인하나

// 결정론 난수 — 같은 시드면 같은 수열(mulberry32)
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// 기준일부터 몇 번째 주인가 (음수 방지)
export function weekIndex(now = Date.now()) {
  return Math.max(0, Math.floor((now - EPOCH) / WEEK_MS))
}

// 다음 교체까지 남은 밀리초
export function weeklyResetIn(now = Date.now()) {
  const elapsed = now - EPOCH
  if (elapsed < 0) return -elapsed
  return WEEK_MS - (elapsed % WEEK_MS)
}

// 결정론 셔플(Fisher–Yates, 시드 rng)
function shuffled(arr, rng) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// 이번 주 진열을 만든다.
//  catalog: [{ tab, id, name, price }] — 살 수 있는 코스메틱만(전리품·null·가격0 제외).
//  owned: (tab,id)=>boolean — 이미 보유했는지. 진열은 "안 산 것"만 채운다.
//  반환: { weekIndex, resetInMs, items: [{ tab,id,name,price, discPrice|null }] }
export function weeklyShop({ catalog, owned = () => false, now = Date.now(), count = 5 }) {
  const wk = weekIndex(now)
  const rng = mulberry32(0x9e3779b1 ^ (wk * 2654435761))
  // 1) 전역 결정론 순서 — 같은 주면 모두 같은 featured 배열
  const order = shuffled(catalog, rng)
  // 2) 이 주에 할인할 카탈로그 인덱스(전역 결정론) — featured 앞쪽에서 DISCOUNT_SLOTS개
  const discountSet = new Set(order.slice(0, DISCOUNT_SLOTS).map((it) => `${it.tab}:${it.id}`))
  // 3) 각 유저: featured 순서에서 미보유 앞에서부터 count개 (항상 살 수 있는 선반)
  const items = []
  for (const it of order) {
    if (items.length >= count) break
    if (owned(it.tab, it.id)) continue
    const disc = discountSet.has(`${it.tab}:${it.id}`)
    items.push({
      tab: it.tab, id: it.id, name: it.name, price: it.price,
      discPrice: disc ? Math.round((it.price * (1 - WEEKLY_DISCOUNT)) / 10) * 10 : null,
    })
  }
  return { weekIndex: wk, resetInMs: weeklyResetIn(now), items }
}
