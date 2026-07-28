import { IS_APP_SHELL } from './appShell.js'

// 유료 상품(비소모성) 2종 — 가격·이름의 원본은 플레이 콘솔, 클라는 표시와 지급만 담당.
//  zb_noads     : 광고 제거 + 보상 상시 2배
//  zb_unlock_all: 위 혜택 + 모든 캐릭터·모드·꾸미기 해금(보스 전리품 제외 — 토벌의 증표는 비매품)
// 구매 확인은 로컬 신뢰(서버 없음): 오프라인 우선 게임의 결이고, 스토어 영수증 검증 서버는
// 정식 출시 후 과제로 남긴다.
export const IAP_NOADS = 'zb_noads'
export const IAP_UNLOCK_ALL = 'zb_unlock_all'
const NOADS_KEY = 'bgp.rift.noads.v1' // ads.js hasNoAds()와 같은 키 — 광고 제거+상시 2배
const UNLOCK_ALL_KEY = 'bgp.rift.unlockall.v1'

export function hasUnlockAll() {
  try {
    return localStorage.getItem(UNLOCK_ALL_KEY) === 'on'
  } catch {
    return false
  }
}

// 상품 지급 — 올인원은 광고 제거 혜택을 포함한다
function grant(productId) {
  try {
    if (productId === IAP_NOADS || productId === IAP_UNLOCK_ALL) localStorage.setItem(NOADS_KEY, 'on')
    if (productId === IAP_UNLOCK_ALL) localStorage.setItem(UNLOCK_ALL_KEY, 'on')
  } catch {
    /* 저장 실패 — 다음 복원에서 다시 */
  }
}

const isNative = () =>
  IS_APP_SHELL && typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.()

// cordova-plugin-purchase는 네이티브에서 window.CdvPurchase 전역으로 노출된다
export function iapAvailable() {
  return isNative() && !!window.CdvPurchase
}

let inited = false
const products = {} // id → { price, title } — 스토어에서 받아 온 표시 정보

// 스토어 초기화 — 앱 시작·상점 진입에서 호출(멱등). 이미 산 상품(owned)은 자동 재지급되어
// 재설치·기기 이전에서도 복원된다. onChange는 가격 로드/소유 변화 때 UI 갱신용.
export async function initIap(onChange) {
  if (!iapAvailable() || inited) return
  inited = true
  try {
    const { store, ProductType, Platform } = window.CdvPurchase
    store.register([IAP_NOADS, IAP_UNLOCK_ALL].map((id) => ({
      id, type: ProductType.NON_CONSUMABLE, platform: Platform.GOOGLE_PLAY,
    })))
    store.when()
      .approved((tr) => {
        for (const p of tr.products || []) grant(p.id)
        tr.finish() // 지급 후 확정(acknowledge) — 3일 내 미확정 구매는 구글이 환불한다
        onChange?.()
      })
      .productUpdated((p) => {
        products[p.id] = { price: p.pricing?.price || '', title: p.title || '' }
        if (p.owned) grant(p.id) // 복원: 이미 소유한 상품은 조용히 다시 지급
        onChange?.()
      })
    await store.initialize([Platform.GOOGLE_PLAY])
  } catch {
    /* 스토어 초기화 실패 — 결제만 죽고 게임은 산다 */
  }
}

export function iapPrice(id) {
  return products[id]?.price || ''
}

export async function buyIap(id) {
  if (!iapAvailable()) return false
  try {
    const { store, Platform } = window.CdvPurchase
    const offer = store.get(id, Platform.GOOGLE_PLAY)?.getOffer()
    if (!offer) return false
    await offer.order() // 결과 지급은 approved 리스너가 처리
    return true
  } catch {
    return false
  }
}

export async function restoreIap() {
  if (!iapAvailable()) return
  try {
    await window.CdvPurchase.store.restorePurchases()
  } catch {
    /* 무시 */
  }
}
