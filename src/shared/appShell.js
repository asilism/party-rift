// 앱 셸(Electron 데스크톱 / 안드로이드 Capacitor) 안에서 실행 중인지 판별.
// 셸이 이미 창/전체화면을 관리하므로, 브라우저용 전체화면 토글 UI는 숨긴다.
export const IS_APP_SHELL =
  typeof window !== 'undefined' &&
  (!!window.zodiacDesktop || !!window.Capacitor?.isNativePlatform?.())
