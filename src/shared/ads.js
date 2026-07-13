import { IS_APP_SHELL } from './appShell.js'

// 보상형 광고 래퍼 — 안드로이드(Capacitor)에서만 실제 광고, 그 외(웹/데스크톱)는 조용히 무시.
// 광고는 전부 "선택형 가산 보상"(안 봐도 기본 보상은 온전)이라는 원칙을 지킨다.
//
// ⚠️ 지금은 Google 공식 테스트 광고 단위 ID — 출시 전에 AdMob 계정을 만들고
//    앱 ID(AndroidManifest의 APPLICATION_ID meta-data)와 아래 단위 ID를 실제 값으로 교체할 것.
//    docs/store-listing.md의 광고 체크리스트 참고.
const REWARDED_ID_ANDROID = 'ca-app-pub-3940256099942544/5224354917' // 공식 테스트 ID

// "광고 제거 + 보상 상시 2배" 구매 여부 — 결제 연동(Play Billing) 전까지는 항상 false.
//  결제 성공 콜백이 이 플래그를 세팅하는 구조로만 잡아 둔다.
export function hasNoAds() {
  try {
    return localStorage.getItem('bgp.rift.noads.v1') === 'on'
  } catch {
    return false
  }
}

const isNative = () =>
  IS_APP_SHELL && typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.()

let inited = false
async function ensureInit(AdMob) {
  if (inited) return
  await AdMob.initialize({}) // 동의 UI(UMP)는 실계정 전환 시 requestConsentInfo로 확장
  inited = true
}

// 광고를 보여줄 수 있는 환경인가 — UI가 "📺 2배" 버튼을 그릴지 판단할 때 쓴다.
export function adsAvailable() {
  return isNative() && !hasNoAds()
}

// 보상형 광고를 띄우고, 끝까지 보면 onReward를 호출한다.
// 로드 실패·중도 이탈이면 조용히 아무 일도 없다(보상 없음, 게임 흐름 유지).
export async function showRewarded(onReward) {
  if (hasNoAds()) {
    onReward?.() // 광고 제거 구매자는 광고 없이 항상 2배
    return true
  }
  if (!isNative()) return false
  try {
    const { AdMob, RewardAdPluginEvents } = await import('@capacitor-community/admob')
    await ensureInit(AdMob)
    let rewarded = false
    const sub = await AdMob.addListener(RewardAdPluginEvents.Rewarded, () => {
      rewarded = true
    })
    await AdMob.prepareRewardVideoAd({ adId: REWARDED_ID_ANDROID })
    await AdMob.showRewardVideoAd()
    // Dismissed 시점까지 대기 — 보상 이벤트가 왔으면 지급
    await new Promise((resolve) => {
      AdMob.addListener(RewardAdPluginEvents.Dismissed, resolve)
      setTimeout(resolve, 90000) // 안전망
    })
    sub.remove?.()
    if (rewarded) onReward?.()
    return rewarded
  } catch {
    return false // 광고 로드 실패 — 조용히 넘어간다
  }
}
