import { IS_APP_SHELL } from './appShell.js'

// 유료 상품(비소모성) 2종 — 가격·이름의 원본은 플레이 콘솔, 클라는 표시와 지급만 담당.
//  zb_noads     : 광고 제거 + 보상 상시 2배
//  zb_unlock_all: 위 혜택 + 모든 캐릭터·모드·꾸미기 해금(보스 전리품 제외 — 토벌의 증표는 비매품)
// 구매 확인은 "서명 검증 + 스토어 소유 상태" 2중 로컬 신뢰(서버 없음):
//  - 구글이 모든 구매 영수증에 RSA 서명을 붙여 준다 → 라이선스 공개키로 앱 안에서 검증
//    (원클릭 위조 앱 차단. APK 패치까지 막는 서버 검증은 서버 기능이 생길 때 과제로)
//  - 환불하면 스토어가 소유 아님으로 답한다 → 초기화 후 소유 확인이 되면 혜택 회수
export const IAP_NOADS = 'zb_noads'
export const IAP_UNLOCK_ALL = 'zb_unlock_all'
const NOADS_KEY = 'bgp.rift.noads.v1' // ads.js hasNoAds()와 같은 키 — 광고 제거+상시 2배
const UNLOCK_ALL_KEY = 'bgp.rift.unlockall.v1'

// 플레이 콘솔 → 수익 창출 설정 → 라이선스의 Base64 RSA 공개키. 비워 두면 서명 검증을 건너뛴다.
const PLAY_LICENSE_KEY = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAuXRqenYhQZZSTEl1IFP2VGBG5VdK90V9Qq0EzmD4j2wwBe3H+luBss9J27nC7RvGoQ/qYyGFR2XjU0CPu6Fa61OwRPvgZCcE+dz4pl97e5kzMd7H4lWZWnh1l2b0drZCKPI/OKEfKHaseqlddl1G0QXy+i5HTbwj0ftPdCTvavtPmPecsB/JTvRG9WOnDa1BY8o8HatNdAKknbgYddDAVliZfcnRIijm5cfFDy90rOve66X1vOXqlIe47FU5nigTqRYOAfoHpR1R948M+dU/v3RA2DK0nYuXZKXqbuiONNGjIRKzhpunCD+LyxMbhrucHrJ4B0MJSCC8m7b3gaH12QIDAQAB'

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

// 🔏 영수증 서명 검증 — 구글이 구매 원문(JSON)에 붙여 준 RSA-SHA1 서명을 라이선스 공개키로 확인.
//  위조 앱(Lucky Patcher류)의 가짜 영수증은 여기서 떨어진다. 키 미설정·검증 불가 경로(웹뷰 제약,
//  복원 등 원문이 없는 트랜잭션)는 통과 — 그쪽은 스토어 소유 상태(owned)가 근거다.
async function verifyPurchase(tr) {
  try {
    if (!PLAY_LICENSE_KEY) return true
    const np = tr?.nativePurchase
    const receipt = np?.receipt
    const signature = np?.signature
    if (!receipt || !signature || !globalThis.crypto?.subtle) return true
    const der = Uint8Array.from(atob(PLAY_LICENSE_KEY), (c) => c.charCodeAt(0))
    const key = await crypto.subtle.importKey(
      'spki', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-1' }, false, ['verify']
    )
    const sig = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0))
    return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, new TextEncoder().encode(receipt))
  } catch {
    return true // 검증 자체가 불가능한 환경 — 막지 않는다(정상 유저 보호 우선)
  }
}

// 💸 환불 회수 — 스토어 조회가 실제로 성공했는데(가격이 왔는데) 소유가 아니면 혜택을 거둔다.
//  오프라인·조회 실패는 회수하지 않는다(통신 실패 ≠ 환불). noads 키는 올인원도 켜 주므로
//  두 상품 모두 소유 아님이 확인될 때만 끈다. 잘못 회수돼도 다음 초기화의 owned 재지급이 복구.
function revokeIfRefunded(store, Platform) {
  let changed = false
  try {
    const p1 = store.get(IAP_NOADS, Platform.GOOGLE_PLAY)
    const p2 = store.get(IAP_UNLOCK_ALL, Platform.GOOGLE_PLAY)
    const loaded = (p) => !!p?.pricing // 가격이 있다 = 스토어 응답이 진짜로 왔다
    if (loaded(p2) && !p2.owned && localStorage.getItem(UNLOCK_ALL_KEY) === 'on') {
      localStorage.removeItem(UNLOCK_ALL_KEY)
      changed = true
    }
    if (loaded(p1) && loaded(p2) && !p1.owned && !p2.owned && localStorage.getItem(NOADS_KEY) === 'on') {
      localStorage.removeItem(NOADS_KEY)
      changed = true
    }
  } catch {
    /* 조회 실패 — 회수하지 않는다 */
  }
  return changed
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
      .approved(async (tr) => {
        if (await verifyPurchase(tr)) {
          for (const p of tr.products || []) grant(p.id)
        }
        tr.finish() // 지급 후 확정(acknowledge) — 3일 내 미확정 구매는 구글이 환불한다
        onChange?.()
      })
      .productUpdated((p) => {
        products[p.id] = { price: p.pricing?.price || '', title: p.title || '' }
        if (p.owned) grant(p.id) // 복원: 이미 소유한 상품은 조용히 다시 지급
        onChange?.()
      })
    await store.initialize([Platform.GOOGLE_PLAY])
    // 환불 회수는 초기화가 상품·영수증을 다 물어온 뒤에 — 잠깐 여유를 두고 한 번만
    setTimeout(() => {
      if (revokeIfRefunded(store, Platform)) onChange?.()
    }, 3000)
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
