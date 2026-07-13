# 스토어 등록용 그래픽 에셋

Electron 캡처(1904×993, 화면비 1.92:1)로 제작 — Play Console 요건(각 변 320~3840px, 화면비 2:1 이하, PNG/JPEG 8MB 이하) 충족.

| 파일 | 용도 | 장면 |
|---|---|---|
| phone-01-title.png | 폰 스크린샷 #1 | 타이틀(워드마크 + TOUCH TO START) |
| phone-02-zodiac.png | 폰 스크린샷 #2 | 12지신 수호 지신 선택 |
| phone-03-wardrobe.png | 폰 스크린샷 #3 | 꾸미기(왕관+천사 날개+성검 풀셋, 무기 16칸) |
| phone-04-battle.png | 폰 스크린샷 #4 | 미드 라인 한타(데미지 숫자, 미니맵, 조작 UI) |
| phone-05-victory.png | 폰 스크린샷 #5 | 승리 배너 + 코인 보상 + 전적판 |
| feature-graphic-1024x500.png | 피처 그래픽 | 타이틀 크롭 |

- 태블릿 스크린샷: 같은 파일 재사용 가능(비율 요건 동일). 7"/10" 별도 제작이 필요하면 `scratchpad/store-shots.cjs`의 창 크기만 바꿔 재촬영.
- 아이콘 512×512: `assets/icon.png` 사용.
- 재촬영 절차: `npx vite build` → 캡처 스크립트 실행(코스메틱·코인은 localStorage 시드). 꾸미기 화면은 개발자 모드 문구가 찍히지 않게 ?devhat 없이 촬영(아이템은 보유 시드로 표시).
