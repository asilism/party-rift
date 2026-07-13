import { IS_APP_SHELL } from './appShell.js'

// 보상형 광고 래퍼 — 안드로이드(Capacitor)에서만 실제 광고, 그 외(웹/데스크톱)는 조용히 무시.
// 광고는 전부 "선택형 가산 보상"(안 봐도 기본 보상은 온전)이라는 원칙을 지킨다.
//
// 실계정 광고 단위(AdMob "2배보상"). 앱 ID는 AndroidManifest의 APPLICATION_ID meta-data.
// ⚠️ 개발 중 광고 확인은 AdMob 콘솔 > 설정 > 테스트 기기에 본인 폰을 등록하고 할 것 —
//    본인이 실광고를 반복 시청/클릭하면 계정 정지 위험. 공식 테스트 단위 ID가 필요하면:
//    ca-app-pub-3940256099942544/5224354917
const REWARDED_ID_ANDROID = 'ca-app-pub-9138089691431103/8280166455' // 2배보상(실계정)

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
async function ensureInit(mod) {
  if (inited) return
  const { AdMob, AdmobConsentStatus } = mod
  // UMP 동의(유럽 EEA 대응): 광고 초기화 전에 동의 정보를 확인하고, 폼이 필요하면
  // 띄운다. 비EEA 지역은 폼이 없어 그대로 통과. 동의 플로우가 실패해도(콘솔에
  // GDPR 메시지 미설정 등) 광고 초기화는 계속한다 — 광고가 죽어도 게임은 살아야 한다.
  // ※ AdMob 콘솔 > 개인 정보 보호 및 메시지에서 GDPR 메시지를 만들어야 폼이 나온다.
  try {
    const info = await AdMob.requestConsentInfo()
    if (info?.isConsentFormAvailable && info.status === (AdmobConsentStatus?.REQUIRED ?? 'REQUIRED')) {
      await AdMob.showConsentForm()
    }
  } catch {
    /* 동의 플로우 실패 — 초기화 계속 */
  }
  await AdMob.initialize({})
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
    const mod = await import('@capacitor-community/admob')
    const { AdMob, RewardAdPluginEvents } = mod
    await ensureInit(mod)
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
