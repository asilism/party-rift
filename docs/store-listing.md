# 스토어 출시 준비 문서 (조디악 블리츠)

출시 전 체크리스트와 스토어 등록 정보 초안. 2026-07-10 작성.

## ✅ 게임 이름: 조디악 블리츠 (ZODIAC BLITZ) — 2026-07-11 확정

- 원래 이름 "조디악 러쉬(ZODIAC RUSH)"는 Apple App Store에 동명 앱("Zodiac Rush", Backpack Games, 2021 캐주얼 퀴즈 — https://apps.apple.com/us/app/zodiac-rush/id1589745063 )이 있어 교체.
- 후보 검증(2026-07-11 검색): Zodiac Rumble/Blitz/Stampede/Summoner 모두 스토어 비어 있음 확인. Zodiac Arena는 기존 앱 존재로 탈락, Clash/Brawl은 Supercell 상표 공세 이력으로 배제. 1차 선택은 럼블이었으나 "~ Rumble"이 대형 IP(Pokémon/Warcraft/Sonic Rumble, Rumble Stars)의 흔한 접미사라 최종 선택: **조디악 블리츠**(Blitz = 번개 — 로고의 ⚡와 뜻이 맞고, 3~5분 속전속결 정체성 계승).
- 한국어 "조디악 블리츠" 충돌 없음. 정식 상표 등록 여부는 출시 직전 KIPRIS/USPTO에서 재확인 권장.

## 등록 정보 초안 (Google Play 기준)

- **앱 이름 (30자)**: 조디악 블리츠: 12지신 대난투
- **짧은 설명 (80자)**: 12지신 동물들의 3분 스피드 MOBA! 3:3·5:5·보스전·무한 방어·콜로세움, 스킬 콤보로 적진을 부수고 수호석을 지켜라
- **자세한 설명 (v1.1 갱신, 2026-07-18)**:

  > ⚡ 조디악 블리츠 (ZODIAC BLITZ)
  >
  > 12지신 동물 영웅들이 펼치는 캐주얼 3D MOBA!
  > 쥐부터 돼지까지, 너의 수호 지신을 골라 전장을 누벼라.
  >
  > 🗺️ 5가지 모드
  > - ⚔️ 3:3 / 5:5 — 한 판 3~5분, 타워를 부수고 수호석을 터뜨리는 정통 한판
  > - 👹 보스 레이드 — 5명이 힘을 합쳐 각성한 거대 보스에 도전, 쉬움·악몽·지옥 3단계
  > - 🌊 무한 방어 — 끝없이 밀려오는 파도에서 수호석을 사수, 몇 번째 파도까지 버틸까?
  > - 🏟️ 콜로세움 — 12지신이 모두 모이는 2:2 서바이벌 토너먼트, 매 라운드 무작위 경기장
  >
  > 🐯 이런 게임이에요
  > - 전사·마법사·암살자 등 20종의 개성 있는 직업
  > - 배후일섬, 그림자처형, 시간 되감기… 직업마다 고유 스킬 3종
  > - 병사·정글 괴물·용·이무기까지, MOBA의 재미를 압축
  > - 업적 40종 + 칭호 수집 — "콜로세움 챔피언"이 되어 보자
  > - 왕관·천사날개·성검… 모자·의상·무기로 내 영웅 꾸미기
  > - 승리할 때마다 새 직업·새 모드가 열려요
  >
  > 🎮 조작
  > - 모바일: 드래그 조이스틱 + 터치 버튼 (버튼 크기 조절 가능)
  > - 완전 오프라인 — 인터넷 없이 어디서나
  >
  > 📊 개인정보를 일절 수집하지 않습니다.

- **카테고리**: 게임 > 액션 (또는 전략)
- **콘텐츠 등급 설문 가이드**: 만화적/판타지 폭력(캐릭터가 쓰러지면 파티클로 분해, 유혈 없음) → 예상 등급: 만 7세+ (IARC), 폭력성 외 항목(선정성·도박·약물·욕설) 전부 "없음", 사용자 간 상호작용 "없음"(오프라인), 위치 공유 "없음", 디지털 구매 "없음"
- **개인정보처리방침 URL**: https://asilism.github.io/zodiacblitz/
  (별도 공개 저장소 `asilism/zodiacblitz`의 GitHub Pages에서 호스팅 — 코드 저장소 party-rift를 비공개로 돌려도 유지됨. 원본은 PRIVACY.md, 수정 시 함께 갱신)

## 수익화 체크리스트 (보상형 광고 + 광고 제거 IAP)

- [x] 보상 경제: 조디악 코인(승30/패10/첫승+50) · 모자 10종 · 일일 미션 3개
- [x] 보상형 광고 접점: 경기 종료 "광고 보고 2배" / 미션 수령 "📺x2" — 전부 선택형, 강제 광고 없음
- [x] AdMob 연동 — `src/shared/ads.js`, AndroidManifest APPLICATION_ID
- [x] **AdMob 실계정** 반영(2026-07-14): 앱 ID `…~3734985001`, 보상형 단위 "2배보상" `…/8280166455`
  - ⚠️ 기기 테스트 전에 AdMob 콘솔 > 설정 > 테스트 기기에 본인 폰 등록(실광고 반복 시청은 계정 정지 위험)
  - 신규 앱은 광고 게재 활성화까지 몇 시간~며칠 걸릴 수 있음 · 스토어 게시 후 앱↔리스팅 연결
- [x] UMP 동의 UI(유럽 대응): `AdMob.requestConsentInfo` + `showConsentForm` 연동 완료(`src/shared/ads.js`) — AdMob 콘솔에서 GDPR 메시지 생성은 별도 필요
- [ ] **광고 제거 IAP**: Play Console에 관리 상품(remove_ads, ₩3,300~5,500) 등록 → Play Billing 연동(@capacitor 계열 또는 RevenueCat) → 성공 시 `bgp.rift.noads.v1='on'` 세팅(코드는 이 플래그 기준으로 이미 동작: 광고 없이 상시 2배)
- [ ] Play 데이터 안전 섹션: "광고 ID 수집(광고 목적, AdMob)" 반영 — PRIVACY.md는 개정 완료

## 제출물 체크리스트

### Google Play
- [x] 오픈소스 고지 (THIRD_PARTY_NOTICES.md — 앱 내 메뉴에서 열람 가능)
- [x] 개인정보처리방침 공개 URL: https://asilism.github.io/zodiacblitz/ (별도 공개 저장소 호스팅 — party-rift 비공개와 무관)
- [x] 릴리즈 서명 설정 (`android/keystore.properties` — keystore.properties.example 참고)
- [x] 서명 키 생성 (keytool — 2026-07-15 완료, CN=Lee Sungjun/C=KR로 서명 검증됨)
- [x] `npm run aab` → `android/app/build/outputs/bundle/release/app-release.aab`(9.2MB, 릴리즈 서명 검증 완료) — 남은 건 Play Console 업로드
- [x] 스토어 그래픽: 아이콘 512×512(assets/icon.png), 피처 그래픽 1024×500, 폰 스크린샷 8장(보스전 phone-06-boss, 콜로세움 phone-07-colosseum, 무한 방어 phone-08-defense — v1.1 추가) — 태블릿은 동일 비율 재사용 가능
- [ ] 버전 관리: 업로드마다 android/app/build.gradle의 versionCode +1

### Steam (Electron)
- [x] 오픈소스 고지 + Electron/Chromium 라이선스 파일(빌드에 자동 포함 확인)
- [ ] Steamworks 파트너 등록(수수료 $100) + App ID 발급 (사용자 작업)
- [ ] Steamworks SDK 연동(도전과제·오버레이) — 로드맵상 다음 단계
- [ ] 스토어 페이지: 캡슐 이미지, 스크린샷 5장+, 트레일러(선택)

## 남은 리스크 메모

- 이름: iOS 진출 시 반드시 변형 필요. Play/Steam은 부제 붙이면 실질 문제 없음.
- 온라인 모드 개방 시 PRIVACY.md 갱신 필요(연결 정보 처리 명시).
