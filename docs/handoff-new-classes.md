# 인수인계: 신규 캐릭터 4종 구현 (Opus용 상세 실행 계획)

> ✅ **완료 (2026-08-04, Opus)**: 4종 전부 구현·머지됨 —
> ①각인사 v150(PR#339) ②혈기사 v151(PR#340) ③강령술사 v152(PR#341) ④몽마 v153(PR#342).
> 모두 `RELEASED_CLASSES` 게이트로 **잠긴 채** 머지 — 오픈은 engine.js의
> `UNRELEASED_CLASSES` Set에서 id를 한 줄씩 빼면 된다.
> 신규 도구: `tools/pvp-sim.mjs`(3v3 직업 승률 측정).
> 아래 문서는 배선 지점·함정 참고용으로 계속 유효하다.

> 2026-08-04, Fable → Opus 인계 문서. 이 문서만 읽고 작업을 완주할 수 있도록
> 기획·배선 지점·재활용 코드·함정·검증 게이트를 전부 담았다.
> **기획 원본은 `docs/new-classes-plan.md`(확정판) — 킷 수치·컨셉은 그 문서가 정본.**

## 0. 목표와 범위

- 신규 직업 4종을 **순서대로, 캐릭터별 개별 PR**로 구현한다:
  **① 각인사 → ② 혈기사 → ③ 강령술사 → ④ 몽마**
- 출시 후 하나씩 오픈할 것이므로 **`RELEASED_CLASSES` 피처 플래그**를 먼저 만든다(§2).
  4종 모두 빌드에 포함하되 로스터/직업 선택 UI에는 플래그에 있는 것만 노출.
- 각 PR의 완료 기준(DoD): §7. 하나가 머지되기 전에 다음을 시작하지 않는다.

## 1. 프로젝트 관례 (반드시 준수)

- **PR 워크플로**: feat/브랜치 → 한국어 커밋 + `Co-Authored-By: Claude ... <noreply@anthropic.com>`(자기 모델명)
  → `gh pr create` → `gh pr merge --merge --delete-branch`. 커밋마다 `android/app/build.gradle`의
  versionCode +1 (현재 149 — 다음은 150).
- **빌드**: `npx vite build && npx cap sync android` →
  `(cd android && JAVA_HOME=/d/DEV/android-tools/jdk-21.0.11+10 ./gradlew assembleRelease -q)`
  → `git checkout -- android/app/capacitor.build.gradle android/capacitor.settings.gradle` (sync 부산물 복원).
- **⚠️ cwd 함정(2회 사고)**: 시뮬레이터는 반드시 서브셸로 — `(cd tools && node brawl-sim.mjs 8)`.
  `cd tools`를 빌드 명령과 같은 체인에 두면 cap sync·sed가 루트가 아닌 곳에서 돌아 versionCode 범프가 누락된다.
- **테스트**: `npm test` (node --test, vitest 아님). 현재 347개 전부 통과 상태 유지.
- **패치 방식**: 긴 수정은 파이썬 스크립트를 scratchpad에 Write로 저장 후 실행(셸 heredoc은 인용 충돌).
  스크립트의 rep() 앵커가 하나라도 실패하면 **파일 전체 미적용**(부분 적용 아님)이므로 안심하고 재실행.
- **i18n**: UI 문자열은 `t('한국어 원문')` — 한국어가 곧 키. 새 키 추가 시 en 번역은 `src/shared/i18n.js`.
- **모드명**: 유저 노출 문자열은 "난투전"(코드 식별자는 'brawl' 유지). "대난투" 금지(상표 리스크).

## 2. 공통 선행 작업 (첫 PR에 포함)

`RELEASED_CLASSES` 피처 플래그:
- engine.js에 `export const RELEASED_CLASSES = new Set([...기존 20종 id])` — 신규 4종은 넣지 않는다.
- 직업 선택 UI(SoloApp의 char 화면 직업 그리드)와 `buildSoloRoster`(src/solo/roster.js)의 봇 직업 풀에서
  RELEASED_CLASSES만 노출/사용. `CLASS_IDS` 자체는 4종을 포함(엔진·시뮬·테스트는 전체를 앎).
- 이렇게 하면 "빌드에 있지만 잠긴" 상태 — 오픈은 Set에 id 한 줄 추가가 전부.
- 개발 중 확인은 `?ult` 궁극기 시험장(전 직업 그리드)과 테스트/시뮬로 한다.

## 3. 캐릭터 추가 배선 지점 (전 캐릭터 공통 체크리스트)

`CLASSES`에서 파생되는 것(draft/server/netgame)은 자동. 손대야 하는 곳:

**src/games/rift/engine.js**
1. `CLASSES` 엔트리: name/icon/desc/stats(hp/hpLvl/atk/atkLvl/range/atkCd/speed) + skill/skill2/ult 메타(name/icon/cd/desc).
2. `CLASS_ROLE`, `ABILITY_SCALING`(RiftControls 툴팁 수식), AP면 `AP_CLASSES`+`SPELL_BASE`+`SPELL_LVL`.
   (혈기사는 **AD** — AP 테이블에 넣지 않는다.)
3. `SKILLS` / `SKILLS2` / `ULTS`에 함수 — **⚠️ 세 테이블에 같은 이름의 함수가 3벌 존재하게 된다.
   grep으로 수정할 땐 어느 테이블인지 반드시 확인(사슬잡이 사고 전례: ULTS 대신 SKILLS2를 패치했었다).**
   유효 대상 없으면 `return false`(쿨 환불).
4. 새 지속 상태(markStacks, charmT 등): 히어로 초기화 블록(~line 820대)에 필드 추가 **+ 감쇠(step)** **+ `makeView` 직렬화**
   (히어로 필드 매핑은 makeView 내 — r2d()로 반올림 관례). 사망/리스폰 리셋 블록에도 추가(예: victim.brawlHammerT=0 근처).
5. `BOT_BUILD` 엔트리 + `botCombatSkills`에 스킬/보조/궁 사용 조건 분기 —
   **⚠️ 이 분기를 빠뜨리면 봇이 궁을 영영 안 쓴다(수호기사·힐러가 그랬다 — 승률 0% 원인).**
6. 난투전 궁 과장: `castUlt`의 brawl 후처리 스위치(`if (h.cls === 'mage') {...} else if ...`)에 분기 추가.
   **⚠️ 이 체인의 마지막 분기 뒤는 `} else if`가 아니라 `}\n  }`(체인 종료)다 — 앵커 주의.**
   게이지·발동 연출(brawlUltSeq/At{cls,dir})은 공용이라 자동.
7. 궁 자체 피해는 게이지 재생산 금지 — 지연/광역 집행부를 `state._ultHit = true/false`로 감싼다.
   소환물 대리 타격은 `state._summonHit`(stepSummons 공용 블록은 이미 처리됨 — 신규 직접 damageHero만 주의).

**src/games/rift/netgame.js**: 이동 잠금 상태(매혹 charmT 등)가 있으면 `predictLocal`의 정지 조건에 추가.

**src/games/rift/scene.js**
8. 무기 3D: `buildWeapon` 분기(없으면 마법사 지팡이 폴백). 고급 검류는 "4각 단면 실린더 테이퍼 검신"
   문법 참조(champblade — 박스+원뿔은 '화살촉' 소리 듣는다).
9. 평타 연출: 근접(<9)이면 `ATK_TRAIL` 표에 스타일, 원거리(9+)면 `BOLT_STYLE` 표에 투사체 조형
   (미지정 시 개성 없는 팀색 구체). 투사체 숨기는 근접 연출이면 `MELEE_NO_BOLT`.
   ⚠️ buildClassBolt에서 코어 없는 조형은 u.core 접근 가드(렌더 루프 사망 전례).
10. 새 fx kind는 `FX_LOOK` 표에. 상태 표식(스택 점·매혹 하트 등)은 히어로 렌더 루프에
    frogMark/angelMark 패턴(lazy 생성 + visible 토글 + `1/obj.scale.x` 역보정) 복제.
    **⚠️ 히어로 obj.visible을 만지는 연출은 시야 판정(`obj.visible = isHeroVisible(...)`) '뒤'에**(스폰 깜빡임 사고 전례).
11. 이모지 스프라이트는 `emojiSprite()`(텍스처 공유 캐시 — 절대 직접 CanvasTexture 만들지 말 것, 렉 사고 전례).

**기타**
12. `src/solo/roster.js` 봇 풀(RELEASED 게이트), 꾸미기(모자/무기 호환은 자동 — 스킨은 공용).
13. 테스트: `engine.test.js`의 `duo(blueCls, redCls)` 헬퍼로 스킬 검증 + `brawl8(cls)` 헬퍼로 난투전 궁 검증.
14. `docs/brawl-ult-plan.md` §1 표에 신규 4종 행 추가(구현 시점에).

**재사용 가능한 전투 헬퍼**: `skillDmg(h,base,coef)`, `lineDamage`/`coneDamage`/`aoeDamage`/`damageInShape`,
`nearestFoeHero`, `pushFx`/`pushFxDir`, `applyKnockback(state,victim,fromX,fromZ,dist,wallStun)`,
`applyFear`, `spawnSummon`/`spawnClone`, `state.map.resolveTerrain(h, HERO_RADIUS, colliders(state))`.

## 4. 캐릭터별 구현 상세

### ① 각인사 (rune-scribe 제안 id: 'runescribe') — AP 원거리
- 상태: 피해자 측 `e.markStacks`(0~5)와 `e.markT`(6s 갱신), `e.markFull`(완인 여부는 stacks==5로 파생 가능 — 별도 플래그 불필요).
  평타 명중 시 +1(castAttack의 명중 처리 또는 damageHero attacker.cls 체크 — **투사체 명중 시점**에 걸어야 함:
  archer 볼트류는 projectiles 명중 처리부에서), 인장탄 +2.
- 완인: stacks 5면 받는 피해 +15% — damageHero의 피해 계산부(execute 증강 근처)에 곱연산 추가 + 시전자 핑(pushFeed 1회).
- 궁 파문: 시야 내(`isHeroVisible`) markStacks>0 전원 기폭 — 스택당 skillDmg 계수, 소모.
  도미노: 기폭으로 죽은 대상의 스택을 반경 ~6 적에게 복사(죽음 판정 후 hp<=0 체크).
- 뷰: 히어로/미니언에 markStacks 노출 → 씬: 머리 위 스택 점(1~4)·완인이면 붉은 문양 발화(emissive 또는 스프라이트).
- 난투전 궁: 기폭 대상에게 스택×2.5 넉백 + 완인은 brawlSmash 피니셔.
- 봇: 표적 stacks>=3이면 궁 고려(nearCount 가중), 아니면 인장탄/확산으로 스택.
- 테스트: 평타 스택 적립·6s 소멸 / 완인 +15% / 파문 스택 비례 피해 / 도미노 전파 / brawl 넉백.

### ② 혈기사 (제안 id: 'bloodknight') — AD 근접 브루저
- HP 코스트: `castSkill` 등 진입부에서 `h.hp = Math.max(1, h.hp - h.maxHp*비율)` — **죽지 않는다(최소 1)**.
  코스트는 시전 성공 시에만(return false 경로에선 차감 금지 — 순서 주의).
- 잃은 체력 비례: `1 + Math.min(0.6, (1 - h.hp/h.maxHp))` 배수 — 혈인참·혈우에 적용.
- 핏빛 사슬: `h.chainTargetId` + `chainT(3s)` — step에서 두 히어로 거리 > 7이면 서로 안쪽으로 당김
  (applyKnockback 소량 또는 위치 보간 + resolveTerrain), 틱 피해+흡혈. 대상 사망/은신 시 해제.
  netgame `predictLocal` 정지 조건 불필요(이동 자체는 가능, 거리만 제한).
- 궁 혈우: aoeDamage 반경 ~7, 피해 50% 흡혈(명중 수 비례 — damageInShape 콜백에서 합산).
- 난투전: 혈우 명중 전원 넉백 6 + 흡혈 초과분 회색 체력은 **선택 구현**(공수 크면 생략하고 넉백만).
- 봇: hp>70%면 사슬로 개전, 30% 이하면 혈우 역전. 코스트 스킬이라 봇 난사 방지(hp<15%면 스킬 금지).
- 테스트: 코스트 차감·최소 1 보장 / 잃은 체력 비례 배수 / 사슬 거리 제한·해제 / 혈우 흡혈.

### ③ 강령술사 (제안 id: 'necromancer') — 소환 컨트롤러
- 그림자 병사: `SUMMON_SPEC`에 'shade' 추가(약체 근접: hp~140+coef, dmg~22, life 10, 최대 3 —
  초과 소환 시 가장 오래된 것 소멸은 엔지니어 포탑(ENGI_MAX_TURRETS) 로직 참조).
- 궁 그림자 사역: `h.lastSlainHero = { cls, zodiacId, name }` — damageHero 킬 크레딧 처리부에서
  killer가 이 직업이고 victim이 영웅이면 갱신. 궁 시전 시:
  `spawnClone(state, h, dir, true, 2)` 변형 — **모습을 h가 아닌 lastSlainHero 스냅샷으로**
  (spawnClone이 h의 zodiacId/cls를 복사하므로 파라미터로 오버라이드 추가하거나 스폰 후 필드 교체).
  이름 `그림자 ${원본이름}`, 수명 20s, dmg = 원본 직업 평타 계수(atkOf 기반), 팀은 시전자.
  기록 없으면 shade 3기(불발 방지 — return false 하지 않는다).
- 씬: clone 렌더 경로가 본체와 동일 모습을 그리므로 자동 — 어두운 틴트(회흑 emissive)와
  이름표 "그림자 ○○"만 추가(clone 렌더 분기에서 s.shadowHero 플래그 체크).
- 난투전 궁: 그림자 영웅 평타가 매 타 넉백(combo hammer 문법 — attacker가 summon이라
  콤보 시스템 밖: stepSummons의 laser 문법처럼 summon 평타 후처리로 소량 넉백).
- 봇: 쿨마다 shade 유지, 영웅 킬 직후 궁.
- 테스트: shade 3기 상한 / lastSlainHero 갱신 / 궁이 스냅샷 모습·평타로 소환 / 기록 없으면 shade 3.

### ④ 몽마 (제안 id: 'dreameater') — 제어 서포터 (최후 순번 · 가장 신중히)
- 매혹: `e.charmT` + `e.charmBy` — applyFear의 부호 반전(도주 벡터 → 접근 벡터).
  step의 fear 이동 처리(FEAR_FLEE_SPD 근처)에 charm 분기: 시전자 방향으로 강제 보행, 행동 불가(canAct에 charmT 추가).
  netgame `predictLocal` 정지 조건에 charmT 추가(로컬 예측 튐 방지).
- 기본기 매혹의 입맞춤: 투사체(projectiles kind 'charm' — hook/bolt 문법) 명중 시 charmT 1.5.
- 궁 꿈의 영토: zones 신규 kind 'dream'(r 7, 3s) — **영역 안에 있는 동안만** 적의 평타 표적을
  아군(자기 팀)으로 강제. 구현: botAttack/자동 표적 선택부에서 `inDreamZone(e)`면 표적 후보를
  같은 팀으로 뒤집기 + 사람 플레이어는 공격 명령 시 같은 처리. **팀 판정은 절대 바꾸지 않는다**
  (킬 크레딧·소환물 소유 꼬임 방지) — 오사 킬의 크레딧은 몽마에게(damageHero attacker 대체가 아니라
  lastHitBy를 몽마로 기록하는 방식 검토).
- 씬: 매혹 = 머리 위 💗(frogMark 패턴) + 지배 영역 = 보랏빛 원형 존(존 렌더 문법).
- 난투전 궁: 영역 내 전원이 몽마 주위 원궤도로 끌림(1.5s — brawlFly 보간 문법 참조).
- 봇: 적 2+ 밀집에 궁, 근접 위협에 입맞춤. **오사 중 봇이 표적을 잃고 멍때리지 않는지** 확인.
- 테스트(전용 세트 필수): 매혹 강제 보행·행동 불가·해제 / 영역 안 오사·이탈 즉시 해제 /
  오사 킬 크레딧 / 소환물 소유 불변 / 콜로세움 지속 반감(ARENA 보정).

## 5. 검증 게이트 (각 PR마다)

1. `npm test` 전부 통과(기존 347 + 신규).
2. 3v3 밸런스: `(cd tools && node boss-sim.mjs ...)` 대신 **3v3 시뮬은 tools/summon-sim.mjs가 아니라
   메모리상 "봇 3v3 200판" 도구** — tools/ 안의 시뮬 파일들을 확인해 3v3용을 사용, 신규 직업 승률 45~55% 목표.
3. 난투전: `(cd tools && node brawl-sim.mjs 12)` — 완주 100%·중앙 3~5분·우승 분포 유지.
   (주의: 시뮬은 LCG 시드 고정 — 같은 판수면 같은 게임. A/B 비교에 유리, 표본 넓힐 땐 시드 오프셋 변경.)
4. 무한방어: `(cd tools && node defense-sim.mjs 6)` — 30웨+ 도달 유지, 극단 이상 없음.
5. E2E(electron): `env -u ELECTRON_RUN_AS_NODE npx electron <스크립트.cjs>` —
   `?ult` 시험장에서 신규 직업 궁 발동 스크린샷(진입: localStorage 프로필 세팅 → 직업 버튼 클릭 → `rtAction({type:'cast',slot:'ult'})`).
   솔로 전체 흐름 검증 시: 타이틀은 `.title-screen`에 PointerEvent, 잠긴 모드/직업은 "300 열기" 확인 버튼.
6. 커밋 전 versionCode +1, 빌드(§1 절차), 폰 연결 시 APK 설치 시도(대부분 미연결 — "폰 미연결" 출력이 정상).

## 6. 참고 문서·메모리

- 기획 정본: `docs/new-classes-plan.md` / 난투전 궁 표: `docs/brawl-ult-plan.md`
- 메모리(자동 로드): rift-add-character-checklist(배선), rift-novel-mechanics-ideas(메커닉 이력),
  rift-production-roadmap(전체 이력·함정 로그 — **v83~v149 함정들이 여기 다 있다. 작업 전 일독 강권**)
- 유저 소통: 한국어. 완료 보고는 "무엇이 어떻게 보이는지" 중심 + E2E 스크린샷 검증을 신뢰한다.
  유저가 "안 된다"고 재보고하면 가설 수정이 아니라 **실증(연속 캡처·상태 프로브)** 먼저.

## 7. 캐릭터별 DoD (Definition of Done)

- [ ] CLASSES~ULTS·봇·뷰·씬 배선 완료(§3 체크리스트 전 항목)
- [ ] 난투전 궁 과장 + brawl-ult-plan.md 표 갱신
- [ ] 신규 메커니즘 전용 테스트 4개+ (몽마는 오사/크레딧 세트 필수)
- [ ] 시뮬 3종 게이트 통과(§5)
- [ ] ?ult E2E 스크린샷으로 궁 연출 확인
- [ ] RELEASED_CLASSES에는 **넣지 않은 채** 머지(오픈은 유저 지시 시)
- [ ] versionCode 범프 + PR 머지 + 메모리(rift-production-roadmap) 갱신
