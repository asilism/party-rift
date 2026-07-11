# 스토어 출시 준비 문서 (조디악 블리츠)

출시 전 체크리스트와 스토어 등록 정보 초안. 2026-07-10 작성.

## ✅ 게임 이름: 조디악 블리츠 (ZODIAC BLITZ) — 2026-07-11 확정

- 원래 이름 "조디악 러쉬(ZODIAC RUSH)"는 Apple App Store에 동명 앱("Zodiac Rush", Backpack Games, 2021 캐주얼 퀴즈 — https://apps.apple.com/us/app/zodiac-rush/id1589745063 )이 있어 교체.
- 후보 검증(2026-07-11 검색): Zodiac Rumble/Blitz/Stampede/Summoner 모두 스토어 비어 있음 확인. Zodiac Arena는 기존 앱 존재로 탈락, Clash/Brawl은 Supercell 상표 공세 이력으로 배제. 1차 선택은 럼블이었으나 "~ Rumble"이 대형 IP(Pokémon/Warcraft/Sonic Rumble, Rumble Stars)의 흔한 접미사라 최종 선택: **조디악 블리츠**(Blitz = 번개 — 로고의 ⚡와 뜻이 맞고, 3~5분 속전속결 정체성 계승).
- 한국어 "조디악 블리츠" 충돌 없음. 정식 상표 등록 여부는 출시 직전 KIPRIS/USPTO에서 재확인 권장.

## 등록 정보 초안 (Google Play 기준)

- **앱 이름 (30자)**: 조디악 블리츠: 12지신 대난투
- **짧은 설명 (80자)**: 12지신 동물들의 3분 스피드 MOBA! 스킬 콤보로 적진을 부수고 넥서스를 지켜라
- **자세한 설명 (초안)**:

  > ⚡ 조디악 블리츠 (ZODIAC BLITZ)
  >
  > 12지신 동물 영웅들이 펼치는 캐주얼 3D MOBA!
  > 쥐부터 돼지까지, 너의 수호 지신을 골라 전장을 누벼라.
  >
  > 🐯 이런 게임이에요
  > - 한 판 3~5분, 가볍게 즐기는 3:3 / 5:5 전투
  > - 전사·마법사·암살자 등 17종의 개성 있는 직업
  > - 점멸습격, 그림자처형, 시간 되감기… 직업마다 고유 스킬 3종
  > - 미니언·정글 괴물·용·바론까지, MOBA의 재미를 압축
  > - 승리할 때마다 새 직업 해금
  >
  > 🎮 조작
  > - 모바일: 드래그 조이스틱 + 터치 버튼 (버튼 크기 조절 가능)
  > - 완전 오프라인 — 인터넷 없이 어디서나
  >
  > 📊 개인정보를 일절 수집하지 않습니다.

- **카테고리**: 게임 > 액션 (또는 전략)
- **콘텐츠 등급 설문 가이드**: 만화적/판타지 폭력(캐릭터가 쓰러지면 파티클로 분해, 유혈 없음) → 예상 등급: 만 7세+ (IARC), 폭력성 외 항목(선정성·도박·약물·욕설) 전부 "없음", 사용자 간 상호작용 "없음"(오프라인), 위치 공유 "없음", 디지털 구매 "없음"
- **개인정보처리방침 URL**: https://github.com/asilism/party-rift/blob/main/PRIVACY.md
  (Play Console은 URL 필수 — 저장소가 비공개면 GitHub Pages 등 공개 호스팅으로 옮길 것)

## 제출물 체크리스트

### Google Play
- [x] 오픈소스 고지 (THIRD_PARTY_NOTICES.md — 앱 내 메뉴에서 열람 가능)
- [x] 개인정보처리방침 (PRIVACY.md — 공개 URL 필요)
- [x] 릴리즈 서명 설정 (`android/keystore.properties` — keystore.properties.example 참고)
- [ ] 서명 키 생성 (keytool, 사용자 작업)
- [ ] `npm run aab` → `android/app/build/outputs/bundle/release/app-release.aab` 업로드
- [ ] 스토어 그래픽: 아이콘 512×512(있음: assets/icon.png), 피처 그래픽 1024×500, 스크린샷 폰/태블릿 각 2장+ (Electron `--win-size` 캡처 활용 가능)
- [ ] 버전 관리: 업로드마다 android/app/build.gradle의 versionCode +1

### Steam (Electron)
- [x] 오픈소스 고지 + Electron/Chromium 라이선스 파일(빌드에 자동 포함 확인)
- [ ] Steamworks 파트너 등록(수수료 $100) + App ID 발급 (사용자 작업)
- [ ] Steamworks SDK 연동(도전과제·오버레이) — 로드맵상 다음 단계
- [ ] 스토어 페이지: 캡슐 이미지, 스크린샷 5장+, 트레일러(선택)

## 남은 리스크 메모

- 이름: iOS 진출 시 반드시 변형 필요. Play/Steam은 부제 붙이면 실질 문제 없음.
- 온라인 모드 개방 시 PRIVACY.md 갱신 필요(연결 정보 처리 명시).
