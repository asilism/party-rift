# Google Play Games 연동 — 구현 계획

작성: 2026-07-22. 상태: **계획 수립 완료, 미착수(백로그).** 나중에 이 문서에서 이어서 시작한다.
관련 조사: 세션 메모 `rift-cloud-save-investigation`.

## 배경 / 문제

지금 모든 진행 데이터는 WebView `localStorage`(`bgp.rift.*` 키 ~25개, 전부 [`src/shared/storage.js`](../src/shared/storage.js)에 집약)에만 있다.
앱을 지우면 로컬 사본이 사라진다. `AndroidManifest`의 `allowBackup="true"`로 안드로이드 자동 백업이
부분적으로 재설치 복원을 해주지만(계정·설정 의존, 실시간·기기간 동기화 아님) **보장은 아니다.**

→ 제대로 된 크로스 디바이스 클라우드 세이브 + 솔로 게임 리텐션 수단(업적·리더보드)을 Play Games로 붙인다.

## 목표 / 스코프

한 묶음으로 **로그인 + Saved Games(클라우드 세이브) + 업적 + 리더보드** 4가지를 연동한다.
근거: 어차피 로그인·네이티브 플러그인·Play Console 설정이라는 공유 인프라를 깔아야 하므로,
그 위에 업적·리더보드를 얹는 한계비용이 작다. save만 먼저 하고 나중에 붙이면 이중 작업이 된다.

## 비용 — 무료

- Play Games Services(세이브/업적/리더보드/로그인)는 사용자·용량·호출당 **과금 없음.** 스냅샷당 3MB 무료 저장.
- GCP 프로젝트는 **OAuth 자격증명·동의화면 전용**(컴퓨트/스토리지 아님). 생성 무료, 결제 계정 불필요.
  `billing` 문구는 GCP 콘솔에서 API 할당량을 조회/증설할 때만 등장 — 일반 세이브 사용엔 무관.
- 실질 비용은 Play 개발자 계정 1회 $25(이미 결제)뿐. 이후 반복 인프라 비용 0.
- 대조: Firebase/자체 서버는 실제 과금 → PGS가 서버리스 기조를 지키는 무료 경로.

## 데이터 인벤토리 → PGS 매핑

### Saved Games(스냅샷) — 클라우드에 통째로 올릴 대상
[`src/shared/storage.js`](../src/shared/storage.js)의 `bgp.rift.*` 전체를 JSON 한 덩어리로 직렬화.
집약돼 있어 export/import 헬퍼 한 쌍이면 된다. 주요 키:
- 경제/해금: `coins`, `coinunlocks`(직업·모드 해금)
- 진행: `achievements`, `missions`, `records`(직업 전적), `bossRecords.v2`, `defenseRecords`, `arenaRecords`
- 수집/장착: `hats`/`costumes`/`weapons`(owned+equip), `title`
- 설정/프로필: `profile`, `solo`, `gfx`, `btnscale`, `control`, `sound`, `hitfx`, `haptic` 등
- ⚠️ 아이템 배열 등은 문자열 배열 — 직렬화/역직렬화 시 얕은 복사 유지(스프레드로 부수지 말 것).

### 업적 — 이미 37개 존재 → Play Console에 1:1 등록
[`src/solo/achievements.js`](../src/solo/achievements.js)의 `ACHIEVEMENTS`(카테고리·시리즈 Ⅰ/Ⅱ/Ⅲ·칭호 포함).
- **인앱 업적은 유지**(코인 보상 경제). PGS 업적은 보상 없는 뱃지 = **미러링, 대체 아님.**
- 발화 지점: `st.done`에 새 업적이 들어가는 단일 지점 하나만 후킹 → `unlockAchievement(pgsId)`.
  `recordMatchForAchievements`와 `evaluateAchievements` 둘 다 `newly`를 반환하므로,
  그 반환값을 받는 곳(또는 `saveAchState` 직전)에서 일괄 unlock.
- 매핑 테이블 필요: `achId → pgsAchievementId`(Play Console가 발급하는 ID). 상수 하나로 관리.
- 대부분 unlock형으로 충분. 누적형(킬/승 시리즈)도 목표 달성 시점에 unlock 한 번이면 됨
  (PGS incremental 타입은 선택 — 진행바를 Play Games 앱에 노출하고 싶을 때만).

### 리더보드 — 기존 기록으로 즉시 구성(처음엔 3~4개만)
| 리더보드 | 소스 | 정렬 | 제출 지점 |
|---|---|---|---|
| 무한 방어 최고 파도 | `defenseRecords.bestWave` | 높을수록 | `recordDefenseRun` |
| 보스전 최단 클리어(초) | `bossRecords.v2` 클리어 타임 | **짧을수록** | `recordBossClear` |
| 콜로세움 우승 횟수 | `arenaRecords.wins` | 높을수록 | `recordArenaRun` |
| 누적 승수 | 직업 전적 합산 | 높을수록 | 경기 종료 |
- 각 저장 지점에서 `submitScore(lbId, value)` 한 줄.
- 보스 최단 클리어는 보스×티어별로 쪼개면 보드가 많아짐(3보스×3티어=9). 처음엔 통합 1개로 시작 권장.
- 주의: 제출은 온라인 필요(플러그인이 큐잉하거나 연결 시 제출). 클라 점수 위변조 가능 →
  **순위에 실제 보상 걸지 말 것.** 리더보드는 자랑/경쟁 용도로만.

## 플러그인 결정 — 파편화가 핵심 변수

하나로 4기능 다 되는 성숙한 Capacitor 플러그인이 없다. 게다가 둘 다 Capacitor 8(현재 프로젝트) 이전 것이라 어차피 손봐야 한다.

| 플러그인 | 로그인 | Save(스냅샷) | 업적 | 리더보드 | Cap 대상 |
|---|---|---|---|---|---|
| `scottcl88/capacitor-google-game-services` | ✅ | ✅ | ❌ | ❌ | v6 (v1.0.0, 2023-01) |
| `gammafp/capacitor-play-games-services` | ✅ | ❌ | ✅ | ✅ | 미명시, 정식 릴리스 없음 |

**경로 선택지:**
1. **gammafp 포크 + 스냅샷 save/load 추가** — 4개 중 3개를 이미 커버해 최소 작업 유력. Cap 8 대응 병행.
2. 소형 **커스텀 네이티브 플러그인 1개**로 4기능 전부 감싸기 — 의존성 리스크 최소, 통제력 최고.
3. 두 플러그인 동시 사용은 비권장(둘 다 PGS 로그인을 감싸 충돌 소지).

→ 착수 시 gammafp 코드 상태(Cap 8 빌드 가능성)를 먼저 평가하고 1 vs 2 결정.
   둘 다 Play Games SDK v2를 감싸므로 부족한 API(스냅샷 or 업적/리더보드) 추가는 정형 작업.

## Play Console / GCP 설정 체크리스트 (착수 시)

1. Play Console → Play Games Services → 새 게임 구성(앱 `com.asilism.zodiacblitz` 연결)
2. 연동된 GCP 프로젝트에서 OAuth 2.0 클라이언트 ID 생성 — **앱 서명키 SHA-1 등록**
   (릴리스 서명키 + Play 앱 서명 사용 시 Play가 재서명한 키의 SHA-1도 추가 필요)
3. OAuth 동의 화면 브랜딩(게임 이름·로고)
4. 업적 37개 등록 → 발급된 ID를 코드 매핑 테이블에 기입
5. 리더보드 3~4개 등록 → ID 매핑
6. 테스터 계정 추가(PGS는 게시 전 테스터만 로그인 가능) — 현재 비공개 테스트 트랙과 별개 목록
7. 자격 증명 게시(테스트용) 후 실기기 검증

## 구현 단계

### 1단계 — 로그인 + Saved Games + 업적
- 플러그인 확정(포크 or 커스텀) + Cap 8 빌드 통과
- 앱 시작 시 **조용한 자동 로그인** 시도, 실패해도 로컬 전용으로 정상 동작(플레이 차단 X)
- `storage.js`에 `exportAll()`/`importAll(json)` 헬퍼 추가(전 키 직렬화)
- 동기화 흐름:
  - 로그인 성공 → 클라우드 스냅샷 `loadGame` → 로컬과 비교 → 병합/적용
  - 진행 변경 후(경기 종료·구매·해금 등) 디바운스로 `saveGame` 업로드
- 업적: `st.done` 신규 달성 지점에서 `unlockAchievement` 일괄 호출 + 매핑 테이블
- 설정 화면에 "Play Games 로그인 / 로그아웃" 상태 표시(선택)

### 2단계 — 리더보드
- Play Console 보드 3~4개 등록 + ID 매핑
- `recordDefenseRun`/`recordBossClear`/`recordArenaRun`/경기 종료에 `submitScore` 추가
- 설정 또는 전적 화면에 "랭킹 보기"(`showLeaderboard`/`showAllLeaderboard`) 진입점

## 동기화 / 충돌 해결 설계

- **충돌 기준**: 스냅샷 메타에 `updatedAt`(epoch)와 요약치(총 코인·총 판수 등)를 넣어 비교.
  - 클라우드가 더 최신이면 클라우드 적용, 로컬이 최신이면 업로드.
  - 애매하면(둘 다 진행 존재) **파괴적 덮어쓰기 금지** — 값이 큰 쪽 우선(코인·해금·최고기록은 max 병합)
    또는 사용자에게 선택 UI. 최소한 "기존 진행이 사라지는" 사고는 막는다.
- **병합 규칙 후보**: 코인=max, 해금/소유 목록=합집합, 최고기록(파도·최단타임)=유리한 쪽,
  누적 카운터=max(안전). 설정값은 최신 우선.
- 저장 주기: 매 변경 즉시가 아니라 디바운스(예: 변경 후 몇 초 or 화면 이탈 시) — 쿼터·배터리 절약.

## 리스크 / 열린 질문

- 플러그인 Cap 8 호환성(포크 작업량) — 착수 첫 스텝에서 평가.
- 스냅샷 충돌 해결 UX — 자동 병합으로 갈지, 충돌 시 선택 모달을 줄지.
- 자동 백업(allowBackup)과 PGS 세이브 **이중화** — 둘 다 켜두면 재설치 시 백업 복원 후
  PGS가 다시 덮어쓸 수 있음. 로그인 시 PGS를 정본(source of truth)으로 삼는 규칙 정리 필요.
- iOS는 지금 없음 — 있게 되면 Game Center 별도(플러그인 다름). 현재는 Android 전용 전제.
- 미성년/로그인 거부 사용자 — 로그인 없이도 전 기능 로컬 플레이 가능해야 함(PGS는 부가).

## 참고 링크

- Saved Games: https://developer.android.com/games/pgs/android/saved-games
- GCP 프로젝트 설정/빌링: https://developer.android.com/games/pgs/console/cloud-platform
- PGS 셋업: https://developer.android.com/games/pgs/console/setup
- scottcl88 플러그인: https://github.com/scottcl88/capacitor-google-game-services
- gammafp 플러그인: https://github.com/gammafp/capacitor-play-games-services
