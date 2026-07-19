// 조디악 블리츠 순수 게임 로직 (호스트 권위) — 3:3 AOS.
//  - 이동(조이스틱) + 버튼 3개: 기본공격 / 직업 스킬 / 궁극기.
//  - 직업 6종(전사/궁수/마법사/힐러/암살자/탱커) — 한 팀에 같은 직업 금지.
//  - 레벨 최대 18, 병사·정글·용·이무기으로 성장, 수호석이 터지면 끝.
//  - 수풀 은신 + 전장의 안개: 시야 밖 적은 안 보인다 (봇도 같은 규칙).
//  - 호스트가 step()을 60Hz로 돌리고 makeView() 스냅샷을 전파한다.
import {
  NEXUS_POS, FOUNTAIN_POS, NEXUS_RADIUS, TOWER_RADIUS, FOUNTAIN_RADIUS, LANE_IDS, enemyOf, buildMap, ARENA_R,
} from './map.js'
import { getZodiac } from '../../shared/zodiac.js'
import { ITEM_SLOTS, SELL_REFUND, ITEMS, ITEMS_BY_ID, sumStats, buildQuote } from './items.js'

export { ITEM_SLOTS } from './items.js'

export const STEP = 1 / 60
export const COUNTDOWN_TIME = 3
export const MAX_LEVEL = 18
export const ULT_LEVEL = 5 // 궁극기가 열리는 레벨 (Lv5)
export const SKILL2_LEVEL = 3 // 보조 스킬이 열리는 레벨 (Lv3)
export const TEAM_SIZE = 3 // 기본(3:3) 팀 인원 — 하위호환용 별칭
// 모드별 팀 인원. 5:5는 탑/미드/봇 + 봇을 지원하는 힐러 + 정글러 구성.
export const TEAM_SIZES = { '3v3': 3, '5v5': 5, boss: 5, defense: 5, arena: 2 } // arena = 콜로세움(2v2 결투)
// ── 콜로세움(아레나) — 준비 30초(반코트 결계·상점) → 전투 3분 → 서든데스(무작위 조각 붕괴) ──
export const ARENA_SHOP_T = 30
export const ARENA_FIGHT_T = 60 // 전투 60초 후 서든데스 붕괴 시작
const ARENA_HOLE_R = 8 // 붕괴 조각 반경 (경기장 R34 기준)
const ARENA_HOLE_EVERY = 10 // 서든데스 붕괴 웨이브 간격(초)
const ARENA_WARN_T = 3 // 경고(장판) → 낙하까지
// 콜로세움 직업 보정 — 봇 2v2 4000판 승률 기반(전역 밸런스는 불변, 아레나에서만).
//  deal: 주는 피해 배율 / take: 받는 피해 배율. 승률 80% 전사부터 16% 힐러까지 밴드 압축용.
const ARENA_CLASS_MOD = {
  // 2026-07-18 재보정 v3: 실제 토너먼트 분포(라운드 1~5, 레벨 5~17, 골드 0~4000)로 측정.
  //  후반 라운드는 방어 스택(탱커·힐러)이, 초반은 버스트가 유리 — 플랫 배율로는 전체 승률을 맞춘다
  warrior: { deal: 0.6, take: 1.08 },
  gladiator: { deal: 0.78 },
  tank: { deal: 0.75, take: 1.25 },
  illusionist: { deal: 0.6, take: 1.12 },
  mage: { deal: 0.92 },
  warlock: { deal: 0.92 },
  cryomancer: { deal: 1.24 },
  fearmonger: { deal: 1.22 },
  windcaller: { deal: 1.3 },
  engineer: { deal: 1.26 },
  archer: { deal: 1.7 },
  guardian: { deal: 2.45, take: 0.78 },
  healer: { deal: 1.85, take: 0.65 },
  catcher: { deal: 0.93 },
  chronomancer: { deal: 0.9 },
  assassin: { deal: 1.22, take: 0.85 },
  terramancer: { deal: 0.93 },
  swordmaster: { deal: 0.82 },
  beastmaster: { deal: 1.02 },
}
const ARENA_ITEM_DEF_MULT = 0.5 // 아레나 방템 피해감소 효율 감쇠(구조 레버) — 배율 조정은 이다음
const ARENA_ORB_EVERY = 9 // 회복 열매 낙하 간격(초)
const ARENA_ORB_HEAL = 0.28 // 습득 시 최대 체력 대비 회복량
const ARENA_ORB_LIFE = 20 // 방치 시 소멸(초)
// 레이드형 모드(보스전·무한 방어) — 아군 5인이 협곡에서 붉은 파도를 상대한다는 공통 골격.
//  전용 봇 룰(수성 우선·원격 보급·짧은 부활)과 성장 보정을 함께 상속한다.
export const isRaidMode = (m) => m === 'boss' || m === 'defense'
export const GAME_MODES = ['3v3', '5v5']
// 봇 역할 배정 우선순위(인원이 모자라면 앞에서부터 채운다).
//  · support = 봇 레인에서 원거리 딜러를 지원(힐러 성향)
//  · jungle  = 정글 캠프/오브젝트를 돌다 교전에 합류
const BOT_ROLES = {
  '3v3': ['mid', 'top', 'bot'],
  '5v5': ['mid', 'jungle', 'bot', 'support', 'top'],
}
// 역할 → 행군할 레인 (jungle은 별도 로직, 기본값 mid)
const laneOfRole = (role) => (role === 'support' ? 'bot' : LANE_IDS.includes(role) ? role : 'mid')

// 직업이 선호하는 역할(앞에서부터). 같은 역할이 겹치거나 그 모드에 없으면 다음 후보로.
//  · 🔮마법사 미드 · 🛡️탱커 탑 · 🏹궁수 봇 · 💚힐러 봇(지원) · 🥷암살자·⚔️전사 정글(없으면 빈 레인)
const ROLE_PREF = {
  mage: ['mid', 'top', 'bot'],
  tank: ['top', 'bot', 'mid'],
  archer: ['bot', 'mid', 'top'],
  healer: ['support', 'bot', 'top', 'mid'],
  assassin: ['jungle', 'mid', 'bot', 'top'],
  warrior: ['jungle', 'top', 'mid', 'bot'],
  cryomancer: ['mid', 'top', 'bot'], // 컨트롤 메이지 — 미드
  gladiator: ['jungle', 'top', 'mid', 'bot'], // 브루저 — 정글/탑
  warlock: ['mid', 'bot', 'top'], // DoT 메이지 — 미드
  guardian: ['support', 'bot', 'top', 'mid'], // 보호막 서폿 — 봇 지원
  swordmaster: ['top', 'jungle', 'mid', 'bot'], // 듀얼리스트 — 탑/정글
  catcher: ['support', 'top', 'bot', 'mid'], // 이니시에이터 — 로밍/지원
  beastmaster: ['jungle', 'top', 'mid', 'bot'], // 소환사 — 정글
  engineer: ['mid', 'top', 'bot'], // 포탑 설치 — 미드/사이드
  snarer: ['jungle', 'bot', 'mid', 'top'], // 속박 정글러 — 정글/갱킹
  fearmonger: ['mid', 'bot', 'top'], // 공포 메이지 — 미드
  illusionist: ['jungle', 'mid', 'top', 'bot'], // 분신 암살자 — 정글
  terramancer: ['top', 'support', 'mid', 'bot'], // 지형 브루저 — 탑/지원
}
// 한 봇에게 그 모드의 역할 풀에서 직업 선호에 맞는 빈 역할을 고른다(겹치면 다음 후보 → 남은 자리).
function pickRole(cls, mode, taken) {
  const slots = BOT_ROLES[mode] || BOT_ROLES['3v3']
  const prefs = ROLE_PREF[cls] || slots
  return (
    prefs.find((r) => slots.includes(r) && !taken.includes(r)) ||
    slots.find((r) => !taken.includes(r)) ||
    'mid'
  )
}

// ── 직업 (한 팀에 같은 직업은 한 명만) ──
// 기본공격은 모두 자동 조준이지만 사거리/속도/딜이 다르고,
// 스킬과 궁극기는 직업마다 완전히 다르다.
export const CLASSES = {
  warrior: {
    name: '전사', icon: '⚔️', desc: '빠르게 파고들어 베는 근접 딜러 — 딜은 평균이지만 기동으로 승부한다',
    // 밸런스 패스 3: 시뮬 승률 76%로 독주 — "딜은 평균" 컨셉에 맞게 체력·이속·공속을 평균권으로
    hp: 580, hpLvl: 64, atk: 50, atkLvl: 6, range: 3.8, atkCd: 0.75, speed: 13.6, def: 0.85,
    skill: { name: '베며 돌진', icon: '💨', cd: 7, desc: '앞으로 돌진하며 길을 가르고 착지 지점을 후려쳐 1초 기절' },
    skill2: { name: '광폭화', icon: '💢', cd: 14, desc: '3초간 빨갛게 폭주 — 이동·공격속도 ↑, 상태이상 면역·즉시 해제. 이후 3초간 서서히 원래대로' },
    ult: { name: '회전베기', icon: '🌪️', cd: 60, desc: '2초간 팽이처럼 돌며(이동 가능) 주변 적을 계속 후린다 — 도는 동안 받는 피해 30% 감소(앞라인 탱킹)' },
  },
  archer: {
    name: '궁수', icon: '🏹', desc: '제일 긴 사거리·제일 약한 몸의 원거리 딜러 — 초반은 약해도 후반 공속으로 캐리한다',
    hp: 360, hpLvl: 38, atk: 34, atkLvl: 7, range: 12.5, atkCd: 0.65, speed: 12.8,
    skill: { name: '꿰뚫는 화살', icon: '🏹', cd: 8, desc: '앞으로 화살을 쏴 일직선의 적을 모두 관통' },
    skill2: { name: '사냥매', icon: '🦅', cd: 16, desc: '매를 맵 끝까지 날려 지나간 길의 안개를 걷고(정찰), 매에 발견된 적을 1.5초 둔화시킨다' },
    ult: { name: '빛의 화살', icon: '🌠', cd: 60, desc: '화면 끝까지 관통하는 넓은 빛줄기 — 직선상의 적 모두 피해' },
  },
  mage: {
    name: '마법사', icon: '🔮', desc: '폭발 마법의 광역 딜러',
    hp: 430, hpLvl: 46, atk: 42, atkLvl: 7, range: 10.5, atkCd: 0.9, speed: 12.5,
    skill: { name: '화염구', icon: '🔥', cd: 6, desc: '크게 터지는 불덩이 — 맞으면 1초 빙결(이동/공격 둔화)' },
    skill2: { name: '체인 라이트닝', icon: '⚡', cd: 12, desc: '가까운 적에게 번개 → 근처 적으로 최대 5회 연쇄(튕길수록 약해짐). 한 방은 가볍고, 뭉칠수록 아프다' },
    ult: { name: '운석', icon: '☄️', cd: 60, desc: '조준한 자리에 운석 3발이 차례로 낙하 — 아주 넓게 강타' },
  },
  healer: {
    name: '힐러', icon: '💚', desc: '아군을 살리는 서포터',
    hp: 470, hpLvl: 52, atk: 38, atkLvl: 6, range: 9.5, atkCd: 0.9, speed: 12.8,
    skill: { name: '치유', icon: '💞', cd: 8, desc: '제일 아픈 아군(나 포함)을 회복' },
    skill2: { name: '가속', icon: '🏃', cd: 11, desc: '주변 아군 챔피언을 잠시 빠르게 — 추격·후퇴를 돕는다' },
    ult: { name: '성역', icon: '✨', cd: 60, desc: '하늘에서 성광이 내려와 아군 전원(거리 무관) 회복 + 기절/빙결 해제' },
  },
  assassin: {
    name: '암살자', icon: '🥷', desc: '제일 빠른 발·제일 높은 공격력이지만 몸이 약한 기습 딜러 — 한 방이 제일 세다',
    hp: 430, hpLvl: 44, atk: 60, atkLvl: 8, range: 4.2, atkCd: 0.55, speed: 15, def: 0.9,
    skill: { name: '배후일섬', icon: '🌀', cd: 8, desc: '적 등 뒤로 순간이동해 벤다' },
    skill2: { name: '은신', icon: '🌫️', cd: 13, desc: '1.5초간 모습을 감춘다 — 적에겐 안 보이고 아군에겐 반투명' },
    ult: { name: '그림자처형', icon: '☠️', cd: 60, desc: '빈사 상태 적에게 2배 일격 — 이 처형으로 처치하면 처형 쿨 초기화' },
  },
  tank: {
    name: '탱커', icon: '🛡️', desc: '앞장서서 버티는 방패 — 느리지만 단단하다',
    hp: 800, hpLvl: 94, atk: 44, atkLvl: 6, range: 3.8, atkCd: 0.85, speed: 10.8, def: 0.8,
    skill: { name: '방패막기', icon: '🛡️', cd: 9, desc: '3초간 받는 피해 65% 감소 + 돌진 가속' },
    skill2: { name: '도발', icon: '📣', cd: 13, desc: '주변 적을 도발 — 2초간 나만 노려보며 평타치게 만든다' },
    ult: { name: '대지균열', icon: '💥', cd: 60, desc: '앞으로 땅을 길게 갈라 길목의 적을 길게 기절' },
  },
  cryomancer: {
    name: '한빙술사', icon: '❄️', desc: '얼리고 묶는 군중제어 마법사 — 폭발보다 통제',
    hp: 450, hpLvl: 48, atk: 40, atkLvl: 6, range: 10, atkCd: 0.95, speed: 12.3,
    skill: { name: '서리파동', icon: '🌨️', cd: 7, desc: '앞으로 냉기를 부채꼴로 뿜어 맞은 적을 빙결(이동·공격 둔화)' },
    skill2: { name: '서리고리', icon: '🧊', cd: 11, desc: '내 주변에 얼음가시가 솟아 가까운 적을 빙결시킨다(피일)' },
    ult: { name: '절대영도', icon: '🥶', cd: 60, desc: '넓은 범위를 얼려 적 전원을 길게 빙결 + 피해' },
  },
  gladiator: {
    name: '검투사', icon: '🪓', desc: '평타마다 흡혈하며 끈질기게 버티는 근접 딜탱(브루저) — 딜은 낮아도 안 죽는다',
    hp: 700, hpLvl: 80, atk: 44, atkLvl: 5, range: 3.9, atkCd: 0.72, speed: 13.4, def: 0.85,
    skill: { name: '휘둘러베기', icon: '🩸', cd: 7, desc: '주변을 넓게 베어 피해를 주고 입힌 피해의 일부를 흡혈' },
    skill2: { name: '도약강타', icon: '⤵️', cd: 13, desc: '적에게 도약해 착지 지점을 강타(교전 합류)' },
    ult: { name: '검투의 분노', icon: '😤', cd: 60, desc: '수 초간 흡혈·이동속도 ↑, 받는 군중제어 감소' },
  },
  warlock: {
    name: '주술사', icon: '☠️', desc: '갉아먹는 지속피해·저주의 원거리 zoner',
    hp: 420, hpLvl: 44, atk: 42, atkLvl: 6, range: 11, atkCd: 0.9, speed: 12.4,
    skill: { name: '저주살', icon: '🟣', cd: 6, desc: '가까운 적에게 강한 즉시 피해 + 3.5초 지속피해(중독·회복 감소)' },
    skill2: { name: '역병안개', icon: '🌫️', cd: 12, desc: '넓은 독안개를 잠깐 깔아 머무는 적을 계속 중독시킨다' },
    ult: { name: '파멸의 낙인', icon: '💀', cd: 60, desc: '넓은 범위 적 전원에 강한 중독 + 받는 피해 증가 낙인' },
  },
  guardian: {
    name: '수호기사', icon: '🔰', desc: '아군에 보호막을 둘러 지키는 인챈터 서포터',
    hp: 560, hpLvl: 60, atk: 44, atkLvl: 6, range: 8.5, atkCd: 0.9, speed: 12.6,
    skill: { name: '수호의 빛', icon: '🛡️', cd: 8, desc: '가장 다친 아군(나 포함)에게 피해를 흡수하는 보호막' },
    skill2: { name: '결속', icon: '🔗', cd: 11, desc: '근처 아군을 4초간 묶어, 그들이 받을 피해를 대신 받는다(50%+인원×10%, 최대 90% 감소)' },
    ult: { name: '불굴의 진형', icon: '✨', cd: 60, desc: '아군 전원에게 보호막 + 잠깐의 피해 감소' },
  },
  swordmaster: {
    name: '검성', icon: '🗡️', desc: '받아넘기고 베는 평타 듀얼리스트 — 한 방은 약해도 빠른 검이 지속 딜을 쌓는다',
    hp: 480, hpLvl: 50, atk: 38, atkLvl: 5, range: 5.5, atkCd: 0.5, speed: 14, def: 0.92,
    skill: { name: '발도 카운터', icon: '🪞', cd: 8, desc: '1.5초간 발도 자세 — 그 사이 받는 첫 피해를 막고 그 2배로 되받아친다(즉발기·평타도 반격)' },
    skill2: { name: '잔영 스텝', icon: '💨', cd: 6, desc: '바라보는 방향으로 짧게 순간이동해 위치를 바꾼다(리포지션)' },
    ult: { name: '무형검', icon: '🌀', cd: 50, desc: '10초간 사거리·공격속도가 크게 오르고, 평타마다 초승달 검기를 날려 직선의 적을 모두 벤다' },
  },
  catcher: {
    name: '사슬잡이', icon: '🪝', desc: '갈고리로 적을 끌어와 묶는 이니시에이터',
    hp: 560, hpLvl: 62, atk: 50, atkLvl: 7, range: 5, atkCd: 0.8, speed: 12.8, def: 0.9,
    skill: { name: '사슬갈고리', icon: '⛓️', cd: 9, desc: '직선으로 사슬을 던져 첫 적을 끌어오고 잠시 속박 + 피해' },
    skill2: { name: '옭아매기', icon: '🕸️', cd: 11, desc: '주변 적을 사슬로 묶어 잠시 이동 불가(피해)' },
    ult: { name: '단죄', icon: '🪓', cd: 60, desc: '주변 적을 강하게 내리쳐 큰 피해 + 속박 연장' },
  },
  beastmaster: {
    name: '야수조련사', icon: '🐺', desc: '늑대와 곰을 부려 함께 싸우는 소환사',
    hp: 540, hpLvl: 58, atk: 48, atkLvl: 7, range: 6, atkCd: 0.85, speed: 13, def: 0.92,
    skill: { name: '늑대 소환', icon: '🐺', cd: 12, desc: '늑대 두 마리를 불러내 주인을 따라다니며 적을 문다' },
    skill2: { name: '사냥 명령', icon: '📯', cd: 9, desc: '늑대/곰이 광폭화하며 가장 가까운 적에게 거리 무시하고 도약해 달려든다' },
    ult: { name: '곰 소환', icon: '🐻', cd: 60, desc: '거대한 곰을 불러내 앞장세운다 — 단단하고 강한 일격' },
  },
  engineer: {
    name: '엔지니어', icon: '🔧', desc: '미니포탑을 설치해 진영을 장악하는 기술자',
    hp: 500, hpLvl: 54, atk: 46, atkLvl: 7, range: 9, atkCd: 0.9, speed: 12.4,
    // cd는 "포탑 재고"가 1개 차오르는 시간 — 재고(최대 3)가 있으면 즉시 설치할 수 있어 길게 잡는다
    skill: { name: '미니포탑 설치', icon: '🔧', cd: 20, desc: '재고를 써서 자동 사격 포탑을 세운다(재고는 20초마다 +1·최대 3개, 동시 3기 유지 — 초과 설치 시 오래된 것 회수)' },
    skill2: { name: '과부하', icon: '⚙️', cd: 14, desc: '내 포탑들의 공격속도를 잠시 크게 올린다' },
    ult: { name: '거포 설치', icon: '💥', cd: 60, desc: '강력한 장거리 거포를 세운다 — 넓은 사거리·큰 피해' },
  },
  snarer: {
    name: '넝쿨사냥꾼', icon: '🌿', desc: '멀리서 옭아매고 아군에게 합류하는 속박 정글러',
    hp: 500, hpLvl: 56, atk: 48, atkLvl: 7, range: 9, atkCd: 0.85, speed: 13.2, def: 0.9,
    skill: { name: '올가미', icon: '🪢', cd: 8, desc: '직선 경로에서 넝쿨이 솟아 닿은 모든 적을 1.6초 속박 + 피해(관통)' },
    skill2: { name: '덩굴 합류', icon: '🍃', cd: 14, desc: '교전 중인(없으면 가장 가까운) 아군에게 순간이동해 갱에 합류' },
    ult: { name: '포획망', icon: '🕸️', cd: 60, desc: '겨눈 자리에 넓은 넝쿨 그물 — 범위 안 적 전원을 길게 속박 + 피해' },
  },
  windcaller: {
    name: '돌풍술사', icon: '🌬️', desc: '적을 밀쳐내고 날려버리는 바람 컨트롤러 — 벽에 처박으면 기절',
    hp: 470, hpLvl: 52, atk: 42, atkLvl: 6, range: 10, atkCd: 0.92, speed: 12.6,
    skill: { name: '돌풍', icon: '🌀', cd: 9, desc: '앞으로 긴 회오리를 일으켜 닿은 적을 1.5초 공중에 띄운다 + 피해(연계용)' },
    skill2: { name: '밀쳐내기', icon: '💨', cd: 11, desc: '주변 적을 사방으로 밀어낸다(피일/이탈) — 벽/타워에 처박히면 기절 + 약간의 피해' },
    ult: { name: '태풍', icon: '🌪️', cd: 60, desc: '겨눈 자리에 1초간 거대한 태풍 — 범위 안 적 전원을 바깥으로 크게 날리고 피해 + 둔화' },
  },
  chronomancer: {
    name: '시간여행자', icon: '⏳', desc: '시간을 되감아 살아남는 시간 암살자 — 4초 전 위치로 돌아가며 체력을 크게 회복한다',
    hp: 470, hpLvl: 50, atk: 44, atkLvl: 6, range: 8, atkCd: 0.85, speed: 13.2, def: 0.95,
    skill: { name: '시간 도약', icon: '⌛', cd: 8, desc: '보이는 적 뒤로 순간이동해 강하게 벤다(교전 진입)' },
    skill2: { name: '시간 지연', icon: '⏱️', cd: 11, desc: '겨눈 자리에 시간이 느려지는 장판 — 머무는 적의 이동·공격을 늦추고 갉아먹는다(추격·고립)' },
    ult: { name: '역행', icon: '⏪', cd: 60, desc: '4초 전 위치로 되돌아가며 체력을 최대치의 80%까지 회복 + 주변에 충격파 피해' },
  },
  fearmonger: {
    name: '공포술사', icon: '👻', desc: '공포로 적의 컨트롤을 빼앗는 심리전 메이지 — 갈팡질팡하는 사이를 노려라',
    hp: 460, hpLvl: 50, atk: 41, atkLvl: 6, range: 9.5, atkCd: 0.95, speed: 12.4,
    skill: { name: '공포의 시선', icon: '👁️', cd: 10, desc: '전방 부채꼴의 적에게 피해를 주고 1.5초 공포 — 통제를 잃고 아무 방향으로나 내달린다(둔화)' },
    skill2: { name: '망령걸음', icon: '🌫️', cd: 12, desc: '유령처럼 흐려져 잠깐 발이 빨라지고 어둠 장막(피해 흡수)을 두른다' },
    ult: { name: '단말마', icon: '💀', cd: 60, desc: '보이는 적에게 순간이동해 비명을 터뜨린다 — 주변 모든 적 1.6초 공포 + 어둠 도트(적진 이니시)' },
  },
  illusionist: {
    name: '환영무희', icon: '🎭', desc: '분신으로 적을 속이는 정보전 암살자 — 셋 중 진짜는 하나',
    hp: 450, hpLvl: 48, atk: 46, atkLvl: 6.5, range: 3.8, atkCd: 0.75, speed: 13.4,
    skill: { name: '환영 분신', icon: '🪞', cd: 10, desc: '분신이 앞길을 걷다 적을 발견하면 쫓아가 내리찍는다(반드시 명중) — 펑 사라지고, 나는 잠깐 은신' },
    skill2: { name: '자리바꿈', icon: '🔀', cd: 9, desc: '내 분신과 위치를 맞바꾼다 — 진입도 탈출도 자유자재' },
    ult: { name: '환영난무', icon: '✨', cd: 60, desc: '연막이 펑! 세 몸(본체+분신 둘)이 튀어나온다 — 분신은 봇처럼 싸운다(평타, 내 공격력의 80%)' },
  },
  terramancer: {
    name: '대지술사', icon: '🪨', desc: '돌벽을 세워 전장을 바꾸는 지형 술사 — 길을 막고, 가두고, 갈라놓는다',
    hp: 540, hpLvl: 60, atk: 43, atkLvl: 6, range: 8.5, atkCd: 1.0, speed: 12.0, def: 0.9,
    skill: { name: '돌팔매', icon: '🪃', cd: 9, desc: '바라보는 방향으로 큼직한 돌을 0.5초 간격 3연투 — 각도는 첫 발에 고정, 착탄 시 주변에 파편 스플래시 피해' },
    skill2: { name: '융기', icon: '⛰️', cd: 14, desc: '먼 전방에 돌벽을 솟게 해 3초간 길을 막는다 — 벽에 맞은 적은 밀쳐지며 1.2초 기절(돌팔매 연계)' },
    ult: { name: '바위감옥', icon: '🏔️', cd: 65, desc: '보이는 적 하나를 원형 돌벽으로 2.5초 가둔다 — 강제 1:1' },
  },
  // ── 보스전(5:1) 전용 보스 — boss:true는 선택 목록(CLASS_IDS)에서 제외되고 3배 덩치로 그려진다 ──
  boss_colossus: {
    boss: true, name: '파멸의 거인', icon: '👹',
    desc: '대지를 부수는 전사형 보스 — 강타와 돌진, 회전 격노',
    hp: 21000, hpLvl: 720, atk: 104, atkLvl: 8, range: 13.2, atkCd: 1.0, speed: 7.0, def: 0.48,
    skill: { name: '대지 강타', icon: '💥', cd: 9, desc: '주변 땅을 내리쳐 큰 피해 + 기절' },
    skill2: { name: '격돌 돌진', icon: '🌋', cd: 16, desc: '적에게 돌진해 들이받아 띄운다' },
    ult: { name: '회전 격노', icon: '🌪️', cd: 30, desc: '팽이처럼 돌며 주변을 계속 후린다' },
  },
  boss_archmage: {
    boss: true, name: '대마도사', icon: '🧙',
    desc: '운석과 번개의 마법사형 보스 — 넓게 태우고 얼린다',
    hp: 20000, hpLvl: 700, atk: 64, atkLvl: 6, range: 15.5, atkCd: 1.1, speed: 7.0, def: 0.62,
    skill: { name: '연쇄 뇌격', icon: '⚡', cd: 8, desc: '번개가 최대 5명을 타고 흐른다' },
    skill2: { name: '혹한 폭풍', icon: '❄️', cd: 14, desc: '주변을 얼려 빙결 + 피해' },
    ult: { name: '멸망의 운석', icon: '☄️', cd: 26, desc: '영웅들 머리 위로 운석을 떨어뜨린다' },
  },
  boss_shadow: {
    boss: true, name: '그림자 군주', icon: '👺',
    desc: '어둠을 가르는 암살자형 보스 — 습격과 공포',
    hp: 22000, hpLvl: 680, atk: 100, atkLvl: 8, range: 13.5, atkCd: 0.7, speed: 8.8, def: 0.52,
    skill: { name: '그림자 습격', icon: '🌀', cd: 9, desc: '가장 약한 적 뒤로 순간이동해 벤다' },
    skill2: { name: '공포의 포효', icon: '😱', cd: 16, desc: '주변 모두에게 공포 — 통제를 잃는다' },
    ult: { name: '어둠걸음', icon: '🌫️', cd: 26, desc: '어둠에 스며 모습을 감추고 빨라진다' },
  },
  boss_thorn: {
    boss: true, name: '가시군주', icon: '🌵',
    desc: '가시와 낙인의 자연형 보스 — 뭉치면 터지고, 무턱대고 때리면 찔린다',
    hp: 21500, hpLvl: 700, atk: 88, atkLvl: 7, range: 14.0, atkCd: 0.95, speed: 7.2, def: 0.55,
    skill: { name: '가시 투척', icon: '🌿', cd: 8, desc: '가시덩굴이 직선으로 뻗는다 — 옆으로 비켜라' },
    skill2: { name: '가시밭', icon: '🥀', cd: 14, desc: '발밑에 가시덤불 — 밟으면 아프고 느려진다' },
    ult: { name: '가시 낙인', icon: '💥', cd: 20, desc: '영웅들에게 낙인 — 곧 터진다, 흩어져라!' },
  },
}
export const BOSS_IDS = Object.keys(CLASSES).filter((c) => CLASSES[c].boss)
export const CLASS_IDS = Object.keys(CLASSES).filter((c) => !CLASSES[c].boss)

// 직업의 드래프트 역할 분류 — 봇이 팀 조합 밸런스를 맞춰 픽할 때 쓴다(전투 레인 배정과 별개).
//  mage(AP 딜) · marksman(AD 원거리) · fighter(AD 근접/브루저/탱) · support(서폿)
//  jungle(정글러): 갑자기 합류해 적을 속박·제압하며 아군을 지원 — 암살자(버스트 갱)·사슬잡이(끌기·속박)
export const CLASS_ROLE = {
  mage: 'mage', cryomancer: 'mage', warlock: 'mage', windcaller: 'mage', fearmonger: 'mage',
  archer: 'marksman', engineer: 'marksman',
  warrior: 'fighter', gladiator: 'fighter', swordmaster: 'fighter', tank: 'fighter', beastmaster: 'fighter', terramancer: 'fighter',
  healer: 'support', guardian: 'support',
  assassin: 'jungle', catcher: 'jungle', snarer: 'jungle', chronomancer: 'jungle', illusionist: 'jungle',
}
// 봇 팀이 채우고 싶어하는 역할 우선순위(앞에서부터 한 자리씩) — 균형 잡힌 조합.
//  3v3는 앞 3개(근접·마법·원거리)로 코어가 서고, 5v5는 서폿·정글까지 다섯 분야가 한 명씩.
export const DRAFT_ROLE_PRIORITY = ['fighter', 'mage', 'marksman', 'support', 'jungle']

// 스킬 데미지/회복/보호막 스케일링 메타데이터 — 툴팁이 "공식 + 현재 수치"를 보여 줄 때 쓴다.
//  (엔진 SKILLS/ULTS의 skillDmg/healAmt 호출 계수와 일치시켜 둔다)
//  dmg/dot/heal/shield/summon: [기본, 계수] · 계수는 직업 주력 스탯(AD/AP/공·주 평균)에 곱한다.
export const ABILITY_SCALING = {
  warrior: { skill: { dmg: [15, 0.4] }, ult: { dmg: [10, 0.15], note: '0.34초마다 타격 · 2초 · 받는 피해 -30%' } },
  archer: { skill: { dmg: [0, 1.2] }, ult: { dmg: [90, 1.5] } },
  mage: { skill: { dmg: [75, 1.1] }, skill2: { dmg: [28, 0.42], note: '점프마다 약화 · 최대 5타' }, ult: { dmg: [60, 0.9], note: '운석 3발' } },
  healer: { skill: { heal: [100, 1.2] }, ult: { heal: [220, 1.3] } },
  assassin: { skill: { dmg: [30, 0.95] }, ult: { dmg: [60, 1.7], note: '빈사(35%↓) 2배' } },
  tank: { ult: { dmg: [50, 1.4] } },
  cryomancer: { skill: { dmg: [38, 0.5], note: '빙결' }, skill2: { dmg: [26, 0.35], note: '빙결' }, ult: { dmg: [80, 0.8], note: '긴 빙결' } },
  gladiator: { skill: { dmg: [42, 0.85], note: '흡혈 30% · 평타도 15% 흡혈' }, skill2: { dmg: [25, 0.5] } },
  warlock: { skill: { dmg: [48, 0.55], dot: [24, 0.4], dotDur: 3.5 }, skill2: { dot: [12, 0.2], dotDur: 2.5, note: '장판 안에서 지속' }, ult: { dmg: [50, 0.5], dot: [16, 0.3], dotDur: 4.5, note: '받는 피해 +18%' } },
  guardian: { skill: { shield: [60, 1.0] }, ult: { shield: [48, 0.7] } },
  swordmaster: { skill: { dmg: [130, 1.5], note: '1.5초 자세 · 받은 피해 1회 무효 + 2배 반사(반사 상한)' }, ult: { note: '10초 · 사거리 +4 · 공속 +45% · 평타가 관통 검기가 된다' } },
  catcher: { skill: { dmg: [40, 0.7], note: '명중 시 1초 끌림+스턴' }, skill2: { dmg: [25, 0.4], note: '속박' }, ult: { dmg: [90, 1.0], note: '속박' } },
  beastmaster: { skill: { summon: [26, 0.12], count: 2 }, ult: { summon: [64, 0.3] } },
  engineer: { skill: { summon: [34, 0.15] }, ult: { summon: [72, 0.34] } },
  snarer: { skill: { dmg: [40, 0.6], note: '경로의 모든 적 1.6초 속박(관통)' }, ult: { dmg: [70, 0.8], note: '범위 속박' } },
  windcaller: { skill: { dmg: [44, 0.7], note: '1.5초 공중에 띄움' }, skill2: { dmg: [26, 0.4], note: '사방으로 밀침 · 벽에 박으면 기절' }, ult: { dmg: [70, 0.8], note: '바깥으로 날림 + 둔화' } },
  chronomancer: { skill: { dmg: [40, 0.9], note: '적 뒤로 순간이동' }, skill2: { dot: [10, 0.2], dotDur: 3, note: '장판 안 이동·공격 둔화' }, ult: { dmg: [60, 0.9], note: '도착 충격파 · 체력 80%까지 회복' } },
  fearmonger: { skill: { dmg: [30, 0.55], note: '1.5초 공포(통제 불능 질주 + 둔화)' }, skill2: { shield: [45, 0.7], note: '가속 + 어둠 장막' }, ult: { dmg: [40, 0.6], dot: [10, 0.18], dotDur: 2, note: '적에게 순간이동 · 주변 전체 1.6초 공포' } },
  illusionist: { skill: { dmg: [50, 0.9], note: '분신이 적을 쫓아가 내리찍음(확정 명중) + 0.9초 은신' }, skill2: { note: '분신과 자리바꿈' }, ult: { dmg: [40, 0.75], note: '연막 펑 — 3체 돌출, 전투 분신 2(평타 80%)' } },
  terramancer: { skill: { dmg: [30, 0.55], note: '0.5초 간격 3연투 · 각도는 첫 발에 고정' }, skill2: { dmg: [15, 0.25], note: '벽 명중 시 1.5초 기절 + 3초 길막' }, ult: { dmg: [35, 0.5], note: '원형 돌벽에 2.5초 가두기' } },
}

// 직업 주력 스탯 이름(툴팁 표기용): 마법 계열은 주문력, 하이브리드는 공·주 평균, 그 외는 공격력.
export function powerLabel(cls) {
  if (HYBRID_CLASSES.has(cls)) return '공·주 평균'
  return AP_CLASSES.has(cls) ? '주문력' : '공격력'
}

// ── 공용 수치 ──
const HERO_RADIUS = 1.3
const BOLT_SPEED = 38
const FIREBALL_RANGE = 24
const FIREBALL_SPEED = 30
const FIREBALL_AOE = 5
const DASH_DIST = 11 // 베며 돌진 거리(전천후 견제 억제 — 약간 짧게)
const DASH_AIM = 13 // 돌진으로 노릴 적 탐색 거리
const DASH_HALF = 2.6 // 돌진 경로 피해 폭(반)
const DASH_CONE = 5 // 착지 시 전방 베기 반경
const BLINK_RANGE = 18
const EXECUTE_RANGE = 9
const SHIELD_TIME = 3
const SHIELD_CUT = 0.35 // 방패막기 중 받는 피해 배율
const HEAL_RANGE = 14
const RAIN_RANGE = 26
const RAIN_AOE = 7
const STORM_RADIUS = 13
const WHIRL_RADIUS = 9
const VOLLEY_RANGE = 17 // 궁수 꿰뚫는 화살 사거리(앞으로 직선)
const VOLLEY_HALF = 1.8 // 화살 직선 폭(반)
const FISSURE_LEN = 18 // 탱커 대지균열 길이(앞으로 직선)
const FISSURE_HALF = 3.5 // 대지균열 폭(반)
const FISSURE_WAVES = 3 // 대지균열을 3파로 끊어 앞으로 뻗는다 (파파팍)
const FISSURE_WAVE_GAP = 0.12 // 파 사이 간격(초)
// 캐릭터 폭 기준(지름 2*HERO_RADIUS = 2.6)으로 "캐릭터 N마리 분량" 범위를 잡는다.
const CHAR_W = HERO_RADIUS * 2
// 마법사 운석(궁극기): 땅에 조준점이 찍히고 잠시 뒤 하늘에서 운석이 떨어진다.
const METEOR_DELAY = 0.5 // 조준 후 낙하까지 (초)
const METEOR_RADIUS = CHAR_W * 2 // 지름 캐릭터 4마리 분량 → 반경 = 캐릭터 2마리
const METEOR_RANGE = 22 // 조준 가능 거리(가까운 적 영웅을 노린다)
const METEOR_AIM = 14 // 노릴 적이 없을 때 바라보는 방향으로 이만큼 앞에 떨군다
// 마법사 화염구(기본 스킬) 빙결: 맞으면 잠시 이동/공격이 느려진다.
const FREEZE_TIME = 1 // 빙결 지속(초)
const FREEZE_MOVE = 0.5 // 빙결 중 이동 속도 배율
const FREEZE_ATK = 1.7 // 빙결 중 공격 쿨다운 배율(느린 평타)
// 궁수 빛의 화살(궁극기): 화면 끝까지 관통하는 넓은 빛줄기.
const LIGHTARROW_LEN = 240 // 사실상 맵 끝까지
const LIGHTARROW_HALF = CHAR_W * 1.5 // 너비 캐릭터 3마리 분량 → 반폭 = 1.5마리
const ARCHER_CHANNEL = 1 // 빛의 화살 시전 전 정신집중(초) — 그동안 제자리에 멈춘다
// 전사 회전베기(궁극기): 2초간 팽이처럼 돌며 반경 안을 계속 후린다(이동 가능).
//  정체성: 앞장서서 적진에 파고들어 주력 딜러를 무는 이니시에이터 — 폭딜이 아니라 "버티며 무는" 역할.
//  그래서 궁극기 동안엔 받는 피해를 크게 줄여(탱킹) 앞라인을 서게 한다.
const WHIRL_TIME = 2 // 회전 지속(초)
const WHIRL_TICK = 0.34 // 피해 판정 간격(초)
const WHIRL_DR = 0.3 // 회전베기 중 받는 피해 감소(방어 ↑) — 30% 경감(45%는 과했다 — 밸런스 패스 3)
// 마법사 운석(궁극기): 3발이 차례로 떨어진다.
const METEOR_COUNT = 3 // 낙하 발수
const METEOR_GAP = 0.55 // 발 사이 간격(초) — 또렷이 끊어 떨어지게 아주 살짝 넓힘(0.45→0.55)
const METEOR_SPREAD = 4.5 // 2·3번째 운석 낙하 지점 흩뿌림 반경

// ── 보조 스킬(Lv3) 공용 수치 ──
// 전사 광폭화: 잠깐 폭주 — 이동/공격 가속 + 상태이상 면역·해제, 이후 서서히 원래대로.
const BERSERK_FULL = 3 // 전력 폭주 지속(초)
const BERSERK_FADE = 3 // 이후 서서히 원래 속도로 돌아오는 시간(초)
const BERSERK_TIME = BERSERK_FULL + BERSERK_FADE
const BERSERK_SPD = 0.6 // 최대 이동속도 증가(+60%)
const BERSERK_ASPD = 0.4 // 최대 공격속도 증가(평타 쿨 -40%)
// 암살자 은신: 잠시 적에게 안 보인다(아군에겐 반투명).
const STEALTH_TIME = 1.5
// 힐러 가속: 주변 아군 챔피언을 잠시 빠르게.
const HASTE_TIME = 1.6
const HASTE_RADIUS = 18
const HASTE_SPD = 0.45 // 이동속도 +45%
// 탱커 도발: 주변 적이 잠시 탱커만 노려 평타치게 만든다.
const TAUNT_RADIUS = 9
const TAUNT_TIME = 3 // 도발 지속(초)
// 궁수 사냥매: 맵 끝까지 날아가며 지나간 자리의 안개를 잠시 걷는다(시야 흔적).
const HAWK_SPEED = 46
const HAWK_LEN = 200 // 사실상 맵 끝까지
const HAWK_REVEAL_R = 11 // 시야 흔적 반경
const HAWK_REVEAL_LIFE = 4 // 안개가 걷힌 채 남는 시간(초)
const HAWK_DROP = 6 // 이만큼 날아갈 때마다 시야 흔적을 남긴다
const HAWK_SLOW_R = 11 // 매에 발견돼 둔화되는 반경(시야 반경과 동일 — "매에 스친" 범위)
const HAWK_SLOW_T = 1.5 // 매에 발견된 적의 둔화(빙결로 재활용 — 이동 둔화) 지속(초)
// 마법사 체인 라이트닝: 가까운 적에게 번개 → 근처 적으로 연쇄(점프마다 감쇠).
const CHAIN_RANGE = 11 // 첫 표적 탐색 거리
const CHAIN_JUMP = 7 // 표적 사이 점프 거리
const CHAIN_HITS = 5 // 최대 적중 수(첫 표적 포함) — 한 방 대폭↓ 대신 넓게 튄다(밸런스 패스 2)
const CHAIN_FALLOFF = 0.75 // 점프할 때마다 피해 배율

// ── 한빙술사(P1): 빙결 전문 컨트롤 메이지 ──
const FROST_RANGE = 11 // 서리파동 부채꼴 사거리
const FROST_HALF_ANGLE = 0.62 // 부채꼴 반각(rad)
const FROST_FREEZE = 1.6 // 서리파동 빙결 지속(초)
const FROSTNOVA_RADIUS = 7 // 서리고리(자기 중심) 반경
const FROSTNOVA_FREEZE = 1.3
const ABSZERO_RADIUS = 13 // 절대영도 반경
const ABSZERO_FREEZE = 2.0 // 거의 정지 수준의 긴 빙결 (2.4는 과했다 — 밸런스 패스 1)
const ABSZERO_AIM = 14 // 노릴 적이 없을 때 앞쪽 거리
// ── 검투사(P1): 흡혈 브루저 ──
const GLAD_SLASH_RADIUS = 6 // 휘둘러베기 반경
const GLAD_LIFESTEAL = 0.3 // 영웅 피해의 흡혈 비율
// 흡혈 로그 감쇠: 회복량 = K·ln(1 + raw/K) — 잔펀치는 거의 그대로, 큰 폭딜 흡혈은 급격히 줄인다.
//  (raw 20→17, 70→38, 150→57, 300→79쯤) 단순 %흡혈이 후반에 사실상 무한 유지력이 되던 문제 완화.
//  검투사 스킬/평타 흡혈과 아이템 흡혈(흡혈낫·용살자의 대검) 모두에 적용된다.
const LIFESTEAL_LOG_K = 35
// 흡혈 회복량(로그 감쇠). 콜로세움은 ×0.1 — 회복 열매·포션이 유일한 회복 축이어야
// 하는 모드라, 물리 피흡 브루저가 무한 유지력으로 결투를 지배하는 것을 막는다.
const lifestealAmount = (raw, state) => {
  if (raw <= 0) return 0
  const base = LIFESTEAL_LOG_K * Math.log1p(raw / LIFESTEAL_LOG_K)
  return state?.mode === 'arena' ? base * 0.1 : base
}
const GLAD_BASIC_LIFESTEAL = 0.15 // 검투사 고유: 평타에 붙는 흡혈(딜은 낮아도 계속 흡혈해 버틴다)
const GLAD_LIFESTEAL_MINION = 0.1 // 병사/정글몹 피해의 흡혈 비율(과회복 방지)
const GLAD_LIFESTEAL_CAP = 0.3 // 한 번에 최대 (최대체력×이 비율)까지만 흡혈
const GLAD_LEAP_DIST = 12 // 도약 거리
const GLAD_LEAP_AIM = 15 // 도약으로 노릴 적 탐색 거리
const GLAD_LEAP_CONE = 4.5 // 착지 강타 반경
const RAGE_TIME = 6 // 검투의 분노 지속(초)
const RAGE_SPD = 0.35 // 분노 중 이동속도 +35%
const RAGE_REGEN = 0.03 // 분노 중 초당 최대체력 3% 회복
const RAGE_CC_CUT = 0.5 // 분노 중 받는 기절/빙결 시간 배율

// ── 주술사(P2): 지속피해(DoT)·저주 zoner ──
const CURSE_RANGE = 12 // 저주살 사거리
const HEAL_CUT = 0.4 // 중독 중 받는 회복 배율(안티힐)
const PLAGUE_RANGE = 14 // 역병안개 시전 거리(앞쪽/가까운 적)
const PLAGUE_RADIUS = 8.5 // 장판 반경(넓게)
const PLAGUE_LIFE = 2.5 // 장판 지속(초) — 넓은 대신 짧게
const PLAGUE_TICK = 0.5 // 장판 재적용 간격
const PLAGUE_POISON_T = 1.6 // 장판 안에서 갱신되는 중독 지속
const DOOM_RANGE = 22 // 파멸의 낙인 조준 거리
const DOOM_RADIUS = 12 // 낙인 반경
const DOOM_POISON_T = 4.5 // 낙인 중독 지속
const DOOM_VULN_T = 5 // 낙인 받는피해 증가 지속
const DOOM_VULN_AMP = 0.18 // 낙인 대상이 받는 피해 +18%
// ── 수호기사(P2): 아군 보호막 인챈터 ──
const GUARD_RANGE = 16 // 보호막을 줄 아군 탐색 거리
const GUARD_SHIELD_BASE = 60 // 수호의 빛 흡수량 기본
const GUARD_SHIELD_COEF = 1.0 // 주문력 계수 (AP 스케일) — 무아이템 기준 기존 곡선(120 + 26×Lv)과 동일
const GUARD_SHIELD_T = 4 // 보호막 지속(초)
const WARD_RADIUS = 14 // (불굴의 진형용) 받는 피해 감소 범위
const WARD_TIME = 3 // 받는 피해 감소 지속(초)
const WARD_CUT = 0.7 // 받는 피해 배율(30% 감소) — 궁극기 진형에서 쓴다
// 결속(P2 리메이크): 근처 아군을 4초간 묶어, 그들이 받을 피해를 수호기사가 대신 받는다(감소 후).
const BIND_RADIUS = 14 // 결속으로 묶을 아군 탐색 거리
const BIND_TIME = 4 // 결속 지속(초)
const BIND_BASE_CUT = 0.5 // 대신 받는 피해 기본 감소(50%)
const BIND_PER_ALLY = 0.1 // 결속된 아군 1명당 추가 감소(10%)
const BIND_MAX_CUT = 0.9 // 최대 감소(90%)
const BASTION_BARRIER_BASE = 48 // 불굴의 진형 흡수량 기본
const BASTION_BARRIER_COEF = 0.7 // 주문력 계수 (AP 스케일) — 무아이템 기준 기존 곡선(90 + 18×Lv)과 동일
const BASTION_WARD_T = 2.5 // 진형 결속 지속

// ── 검성(P3): 패링 듀얼리스트 ──
// 발도 카운터: 1초간 자세를 잡고(그동안 은빛 오라로 표시), 그 사이 받는 첫 피해를 무효화하고
//  그 2배를 공격자에게 되돌린다. 이 게임 기술 대부분이 즉발이라, 자세를 미리 잡아 두면
//  날아오는 즉발기·평타를 '받아쳐서' 반격할 수 있다. (반사 과다로 즉사시키지 않게 상한을 둔다)
const PARRY_WINDOW = 1.5 // 발도 자세 지속(초) — 이 안에 받는 첫 피해 1회 무효 + 반사
const PARRY_REFLECT = 2 // 무효화한 피해의 2배를 공격자에게 되돌린다
const PARRY_REFLECT_MAX_BASE = 130 // 반격 상한 기본(폭발기 통째 반사로 즉사 방지)
const PARRY_REFLECT_MAX_COEF = 1.5 // 반격 상한 공격력 계수
const STEP_DIST = 7 // 잔영 스텝 거리(리포지션)
const BLADE_TIME = 10 // 무형검 지속 — 궁극기 파워 스파이크를 길게(밸런스 패스 2)
const BLADE_RANGE = 4 // 무형검 중 사거리 +4
const BLADE_ASPD = 0.45 // 무형검 중 공격속도 +45%
// 무형검 검기: 발동 중 평타가 초승달 검기가 되어 직선의 적을 모두 벤다(관통) — 궁극기 파워 스파이크.
const SWORDWAVE_SPEED = 34 // 검기 비행 속도
const SWORDWAVE_RANGE = 13 // 검기 비행 거리 — 무형검 평타 사거리(9.5)보다 약간 길다
const SWORDWAVE_R = 2.0 // 검기 판정 반경(긴 날이 넓게 휩쓴다)
// ── 사슬잡이(P3): 끌어오기/속박 이니시에이터 ──
const HOOK_RANGE = 16 // 사슬갈고리 사거리(직선)
const HOOK_WINDUP = 0.25 // 발사 준비 모션(그동안 제자리, 기절당하면 불발)
const HOOK_SPEED = 34 // 갈고리 투사체 속도
const HOOK_HIT_R = HERO_RADIUS + 0.7 // 투사체 적중 반경
const HOOK_PULL_TIME = 1.0 // 끌려오는 시간 — 그동안 천천히 당겨지며 아무것도 못 함(스턴)
const ENSNARE_RADIUS = 7 // 옭아매기 반경
const ENSNARE_ROOT = 1.2 // 옭아매기 속박 시간
const GUILLOTINE_RADIUS = 7 // 단죄 반경
const GUILLOTINE_ROOT = 1.2 // 단죄 속박 연장
// ── 넝쿨사냥꾼(P6): 원거리 속박 정글러 — 멀리서 묶고, 아군에게 순간이동해 합류 ──
const NET_RANGE = 18 // 올가미 사거리(앞으로 직선) — 15의 1.2배(밸런스 패스 2)
const NET_HALF = HERO_RADIUS * 1.2 // 올가미 폭(반) — 1.2배 확대
const NET_WAVES = 5 // 땅에서 5단으로 끊어 앞으로 솟는다 (파 파 파 파 팍!)
const NET_WAVE_GAP = 0.08 // 단 사이 간격(초)
const NET_ROOT = 1.6 // 올가미 명중 속박 시간 — 1.3의 1.2배(밸런스 패스 2)
const VINE_TELE_RANGE = 30 // 덩굴 합류 순간이동 사거리(아군까지)
const SNARE_AIM = 11 // 포획망 조준 거리(앞)
const SNARE_RANGE = 13 // 포획망 표적 탐색 사거리
const SNARE_RADIUS = 7 // 포획망 반경
const SNARE_ROOT = 1.6 // 포획망 속박 시간

// ── 돌풍술사(P7): 적을 밀쳐내는 변위(넉백) 컨트롤러 — 기존 CC가 '고정/끌기'뿐인 로스터에 '밀어내기'를 더한다 ──
const KNOCK_DUR = 0.22 // 넉백 이동에 걸리는 시간(초) — 짧고 또렷하게 밀린다
const KNOCK_WALL_STUN = 0.9 // 벽/타워/수호석에 처박혔을 때 추가 기절(초)
const KNOCK_WALL_FRAC = 0.45 // 의도한 거리의 이만큼도 못 밀렸으면 "벽꽝"으로 판정
const GUST_RANGE = 19.5 // 돌풍 회오리가 앞으로 이동하는 거리(기존 13의 1.5배)
const GUST_TRAVEL_T = 1.0 // 회오리가 그 거리를 가로지르는 데 걸리는 시간(초) — 즉발이 아니라 굴러간다
const GUST_SPEED = GUST_RANGE / GUST_TRAVEL_T // 회오리 이동 속도
const GUST_TORNADO_R = CHAR_W * 1.2 // 회오리 적중 반경(닿으면 띄운다)
const GUST_AIRBORNE = 1.5 // 돌풍에 맞은 적이 공중에 뜨는 시간(초) — 띄워 두고 연계
const REPULSE_RADIUS = 7 // 밀쳐내기 반경(자기 중심)
const REPULSE_KB = 6 // 밀쳐내기 거리
const TYPHOON_RANGE = 16 // 태풍 조준 거리(가까운 적 탐색)
const TYPHOON_AIM = 12 // 노릴 적이 없을 때 앞쪽 거리
const TYPHOON_RADIUS = 9 // 태풍 반경
const TYPHOON_KB = 10 // 태풍이 바깥으로 날리는 거리
const TYPHOON_SLOW = 1.2 // 태풍에 휩쓸린 적의 둔화(빙결로 재활용) 지속(초)

// ── 시간술사(P8): 위치·체력을 과거로 되돌리는 시간 메커닉 ──
const TRAIL_DT = 0.2 // 위치/체력 표본을 남기는 간격(초)
const TRAIL_MAX = 28 // 표본 보관 개수(약 5.6초치) — 역행(4초)+여유
const TIMELEAP_RANGE = 18 // 시간 도약 사거리(보이는 적 탐색)
const REWIND_BACK = 4.0 // 역행: 이만큼 과거(초)의 위치로 되돌아간다
const REWIND_HEAL = 0.8 // 역행 도착 시 체력을 최대치의 이 비율까지 회복(현재가 더 높으면 유지)
const REWIND_RADIUS = 7 // 역행 도착 충격파 반경
// 시간 지연(보조 스킬): 겨눈 자리에 시간이 느려지는 장판 — 머무는 적의 이동/공격을 늦춘다(추격·고립).
const TIMEWARP_RANGE = 15 // 시간 지연 조준 거리(가까운 적 탐색)
const TIMEWARP_AIM = 9 // 노릴 적이 없을 때 앞쪽 거리
const TIMEWARP_RADIUS = 6 // 장판 반경
const TIMEWARP_LIFE = 3 // 장판 지속(초)
const TIMEWARP_TICK = 0.35 // 둔화 재적용 간격
const TIMEWARP_SLOW_T = 0.7 // 장판 안에서 갱신되는 둔화 지속(빙결로 재활용 — 이동·공격 느려짐)

// ── 소환물(P4 야수조련사 펫 / P5 엔지니어 포탑) 공용 시스템 ──
// kind: 'wolfpet'(늑대) | 'bear'(곰) | 'turret'(미니포탑) | 'cannon'(거포)
// dmg는 소환 시점에 주인의 주력 스탯(공·주 평균)×coef 만큼 더해진다(spawnSummon). 여러 번 때리므로 coef는 작게.
const SUMMON_SPEC = {
  wolfpet: { hp: 220, dmg: 26, coef: 0.12, range: 2.6, aggro: 16, speed: 9.5, mobile: true, cd: 0.9, life: 18 },
  bear: { hp: 760, dmg: 64, coef: 0.3, range: 3.2, aggro: 18, speed: 8.6, mobile: true, cd: 1.1, life: 16 },
  // 미니포탑: 기본 체력은 평타 두어 대 수준이지만 주력 스탯(hpCoef)에 비례해 단단해진다 — 후반에 평타 한 방에 안 터지게.
  //  주인(엔지니어)이 사거리 안에 없으면 잠시 뒤 휴면(zzz).
  // 미니포탑은 수명이 없다 — 부서지거나(4기째 설치로) 회수되기 전까지 자리를 지킨다
  turret: { hp: 110, hpCoef: 1.0, dmg: 34, coef: 0.15, range: 12, aggro: 12, speed: 0, mobile: false, cd: 1.0, life: Infinity },
  cannon: { hp: 560, hpCoef: 0.8, dmg: 72, coef: 0.34, range: 16, aggro: 16, speed: 0, mobile: false, cd: 1.3, life: 15 },
}
const BEAST_LEAP_DUR = 0.45 // 사냥 명령 시 야수가 적에게 달려드는(도약) 시간 — 거리 무시
const BEAST_WOLVES = 2 // 야수조련사 늑대 소환 마릿수
const ENGI_MAX_TURRETS = 3 // 엔지니어가 동시에 둘 수 있는 미니포탑 수(초과 시 가장 오래된 것 회수)
const ENGI_IDLE_GRACE = 3 // 주인이 죽거나 사거리 밖으로 나가도 이 시간(초) 뒤에야 포탑이 휴면(그 전엔 타이머 표시)
const OVERCHARGE_T = 4 // 과부하 지속(초)
const OVERCHARGE_ASPD = 0.5 // 과부하 중 포탑 공격속도 배율(쿨 -50%)

export const SIGHT_RANGE = 24 // 아군 유닛 주변 이만큼이 우리 시야
export const BUSH_REVEAL = 4 // 수풀 속 적도 이만큼 붙으면 보인다
const REVEAL_TIME = 1.5 // 공격하면 이만큼 모습이 드러난다
const ATK_SLOW_T = 0.3 // 공격 직후 발이 무거운 시간 (무빙샷 견제)
const ATK_SLOW = 0.55 // 그동안의 이동 속도 배율

const REGEN_DELAY = 5 // 전투 이탈 후 자연 회복까지 (초)
const REGEN_RATE = 0.015 // 초당 최대 HP 비율
const FOUNTAIN_HEAL = 0.12
const FOUNTAIN_DMG = 90 // 적 우물에 들어가면 따끔!
const XP_RANGE = 22 // 처치 경험치를 나눠 받는 거리
const XP_SHARE_BONUS = 0.2 // 여럿이 나눠 먹을 때 1명 늘 때마다 팀 합계에 붙는 보너스(1인당은 줄지만 합계는 조금↑)
const KILL_CREDIT_T = 7 // 마지막으로 때린 적 영웅이 이 시간 안에 죽어야 그의 킬 (지나면 병사/타워 처형)
const TOWER_AGGRO_TIME = 3 // 적 영웅을 때리면 타워가 이만큼 노린다
export const RECALL_TIME = 4 // 귀환 시전(채널링) 시간 — 방해 없이 버티면 우물로 복귀

// ── 병사 ──
const WAVE_PERIOD = 14 // 스폰 간격 — 한 무리가 라인 중앙에 닿을 무렵 다음 무리가 나온다
const FIRST_WAVE = 2
const MINION_SPEED = 6.5
const MINION_SIGHT = 11
// 타워 피해(TOWER_DMG_MINION=60) 기준: 원거리는 2대(≤120), 근접은 3대(120<hp≤180)에 죽는다
const MELEE = { hp: 175, dmg: 33.6, range: 2.4, cd: 1.1 }
const RANGED = { hp: 110, dmg: 29, range: 8, cd: 1.4 }
// 병사끼리는 피해를 크게 줄여(40%) 라인 교전이 천천히 진행되게 한다.
//  → 병사 vs 병사만 붙으면 잘 안 죽고 웨이브가 쌓이지만,
//    유저가 끼어들어 적 병사를 빠르게 정리하면 살아남은 우리 웨이브가 타워를 민다.
//  → 영웅/타워에게는 제값(부담은 되되 한 마리는 무시할 만하고, 여럿이면 위협).
const MINION_VS_MINION = 0.4
const MINION_HP_GROWTH = 5 // 분당 체력 증가 (타워 피격 설계가 오래 유지되게 완만히)
const MINION_XP = 28

// ── 골드 / 상점 ──
// 병사/정글몹/타워/적 영웅을 "처치(막타)"하면 골드를 얻어 우물 상점에서 아이템을 산다.
const START_GOLD = 300 // 시작 골드 (싼 아이템 하나는 바로 살 수 있게)
const GOLD_PASSIVE = 1.0 // 초당 자동 수입 (파밍이 안 풀려도 모이게 — 가벼운 성장 가속)
const GOLD_MINION_MELEE = 13 // 근접 병사 막타
const GOLD_MINION_RANGED = 11 // 원거리 병사 막타
const GOLD_WOLF_BASE = 36 // 늑대 골드 — 정글몹 보상 +50% (정글이 더 매력적이게)
const GOLD_DRAGON = 68 // 용 — 팀 전원 (+50%)
const GOLD_BARON = 98 // 이무기 — 팀 전원 (+50%)
const GOLD_TOWER = 48 // 타워 파괴 — 팀 전원
const GOLD_SUMMON = 3 // 소환물(포탑/펫/분신) 처치 — 잡은 영웅에게 소량 (경험치는 없음)
const GOLD_KILL = 200 // 적 영웅 처치 — 킬러(막타) 기본값
const GOLD_ASSIST = 80 // 어시스트 — 사망 직전 7초 내 피해를 준 적(킬러 제외) 또는 처치 관여자를 치유/보호한 아군
// 연속 데스(킬/어시 없이 죽기만 한) 캐릭터를 잡으면 킬골드가 줄어든다 — 안티 스노우볼.
// 그 캐릭이 킬/어시를 따면 deathStreak가 0으로 리셋된다.
const DEATHSTREAK_PENALTY = 60 // 연속 데스 1회마다 깎이는 킬골드
const KILL_BOUNTY_MIN = 100 // 아무리 많이 죽어도 보장되는 최소 킬골드
// 현상금(shutdown): 안 죽고 연속 킬(killStreak)을 쌓은 적을 잡으면 보너스 골드.
// killStreak 2부터 BOUNTY_STEP씩 붙고, 죽으면 killStreak가 0으로 리셋된다.
const BOUNTY_STEP = 75 // 연속 킬 1회 초과분마다 붙는 현상금
const BOUNTY_MAX = 300 // 현상금 상한 (기본 200 + 최대 300 = 최대 500골드)
// 연속 킬(killStreak)에 붙는 현상금 골드 — 사망 보상 계산과 HUD 표식이 공유한다.
export const bountyGold = (killStreak) => Math.min(BOUNTY_MAX, BOUNTY_STEP * Math.max(0, (killStreak || 0) - 1))
const MINION_DEFEND_RANGE = 14 // 이 거리 안 아군 영웅이 적 영웅에게 맞으면 가해자를 노린다
const MINION_DEFEND_LEASH = 16 // 가해자를 쫓다 시작점에서 이만큼 벗어나면 포기하고 레인 복귀
const MINION_DEFEND_HURT_T = 1.5 // 아군이 최근 이 시간 안에 맞았어야 "공격받는 중"으로 본다

// ── 타워/수호석 ──
const TOWER_HP = [0, 1800, 2200, 3000] // tier 1(외곽) / 2(내곽) / 3(수호석 최후의 포탑) — 건물이 쉽게 안 터지게 2배
export const TOWER_RANGE = 13
const TOWER_CD = 1.2
const TOWER_DMG_HERO = 180 // 영웅 기본 피해 — 같은 영웅을 연속으로 맞히면 점점 세진다
const TOWER_DMG_MINION = 60
// 타워 응징 가중: 같은 영웅을 연달아 맞힐 때마다 피해 배율이 오른다 (다이브 응징).
//  1발째 ×1 → 2발째 ×1.9 → 3발째 ×2.8 … (최대 ×4). 표적이 바뀌거나 한 발 쉬면 초기화.
const TOWER_RAMP = 0.9
const TOWER_RAMP_MAX = 4
const TOWER_XP = 90
const NEXUS_HP = 3400 // 수호석도 2배 — 쉽게 터지지 않게

// ── 정글 ──
// 용/이무기는 "분노(enrage)"를 쌓는다 — 교전이 길어질수록 피해/이동속도가 점점 오른다.
//  - 초반(저레벨) 혼자서는 분노가 쌓이기 전에 못 잡고 되레 당한다 → 셋이 모여 빨리 끝내야 한다.
//  - 12레벨쯤 딜이 붙으면 분노가 치명적이 되기 전에 혼자서도 용을 끝낼 수 있다(쉽지 않게).
//  - 이무기는 체력/분노가 훨씬 높아 18레벨이어도 혼자서는 분노에 먼저 쓰러진다 → 팀 오브젝트.
//  - 캠프를 벗어나(리시) 복귀하면 분노가 초기화된다.
const WOLF = { hp: 260, dmg: 18, range: 2.6, cd: 1.2, speed: 7, xp: 84, gold: GOLD_WOLF_BASE, respawn: 45, enrage: 0, rageSpd: 0 }
// 멧돼지: 빨리 달려들어 아프게 무는 유리몸 — 늑대보다 리스크·리턴이 크다
const BOAR = { hp: 200, dmg: 26, range: 2.4, cd: 1.0, speed: 9.5, xp: 92, gold: 40, respawn: 45, enrage: 0, rageSpd: 0 }
// 돌골렘: 느리고 단단한 경험치 덩어리 — 오래 걸리는 대신 보상이 크다
const GOLEM = { hp: 560, dmg: 15, range: 2.8, cd: 1.6, speed: 4, xp: 130, gold: 55, respawn: 60, enrage: 0, rageSpd: 0 }
// 소형 정글 캠프 몬스터(용/이무기 제외) — kind → 스탯
const CAMP_MOBS = { wolf: WOLF, boar: BOAR, golem: GOLEM }
// 용/이무기를 더 강력하게(체력↑·피해 약 2배). 용은 솔로 사냥이 Lv12쯤부터 가능하도록 튜닝, 이무기 > 용 유지.
const DRAGON = { hp: 2350, dmg: 56, range: 4, cd: 1.3, speed: 6, xp: 110, spawn: 60, respawn: 100, enrage: 0.5, rageSpd: 0.6 }
const BARON = { hp: 4500, dmg: 92, range: 5, cd: 1.5, speed: 5, xp: 150, spawn: 210, respawn: 120, enrage: 0.9, rageSpd: 0.6 }
const ENRAGE_MAX = 40 // 분노 누적 상한(초)
const CAMP_LEASH = 24 // 캠프에서 이만큼 멀어지면 포기하고 복귀(회복)
// 이무기 독 뿜기 — 공격이 명중한 자리에 독 웅덩이가 남아 그 안의 "모든" 영웅에게 도트 피해.
//  중립 위험 지대라 팀을 가리지 않는다 → 이무기 앞에서 자리싸움이 생긴다.
const VENOM_R = 4.2 // 웅덩이 반경
const VENOM_LIFE = 3.5 // 웅덩이 지속(초)
const VENOM_TICK = 0.5 // 도트 주기
const VENOM_DPS = 26 // 초당 피해
export const DRAGON_BUFF_T = 60 // 용 버프: 공격력 +25%
export const BARON_BUFF_T = 75 // 이무기 버프: 공격력 +40% + 빠른 회복

// 아이템 보너스 헬퍼 (h.bonus는 createGame/applyItems에서 채운다 — 없으면 0 취급)
const itemBonus = (h) => h.bonus || ZERO_BONUS
const ZERO_BONUS = sumStats([])

// 밸런스: 전투가 한 방에 끝나지 않게 영웅 체력을 전반적으로 10% 상향(기본·레벨·아이템 모두 포함).
//  (원래 1.0 ↔ 한때 1.2 사이의 중간값)
export const HP_SCALE = 1.1
const heroMaxHp = (h) => Math.round((CLASSES[h.cls].hp + CLASSES[h.cls].hpLvl * (h.lvl - 1) + itemBonus(h).hp) * HP_SCALE)
// 밸런스: 공격력 기반 딜러(근접·원거리)는 순간 딜링이 과해 마법사·물몸이 버티기 어려웠다.
//  직업 고유 공격력 곡선(기본 + 레벨 성장)을 20% 낮춘다 — 평타와 공격력 계수 스킬 모두에 함께 반영된다.
//  (아이템 공격력은 그대로 둬서 장비 투자 가치는 유지) 탱커·하이브리드(소환사)는 딜러가 아니라 제외.
const AD_DAMAGE_CLASSES = new Set(['warrior', 'archer', 'assassin', 'gladiator', 'swordmaster', 'catcher', 'snarer'])
const AD_CURVE = 0.8
const innateAtk = (h) => {
  const c = CLASSES[h.cls]
  const base = c.atk + c.atkLvl * (h.lvl - 1)
  return AD_DAMAGE_CLASSES.has(h.cls) ? base * AD_CURVE : base
}
const heroAtk = (h) => innateAtk(h) + itemBonus(h).atk
// 보스는 국면이 오를수록 몸이 커지고, 커진 만큼 팔도 길어진다(사거리 +15%/국면)
const heroRange = (h) =>
  (CLASSES[h.cls].range + itemBonus(h).range + (h.bladeT > 0 ? BLADE_RANGE : 0)) *
  (h.isBoss ? 1 + 0.15 * ((h.bossPhase || 1) - 1) : 1)
const heroSpeed = (h) => CLASSES[h.cls].speed + itemBonus(h).speed
// 레벨업 필요 경험치 — 전반적으로 상향(레벨링을 느리게).
//  Lv1→Lv2 = 250 ≈ 적 병사 1.5웨이브(병사 28xp × 9마리). 정글러는 늑대 3마리(84×3)면 2렙.
export const xpNeed = (lvl) => 250 + 98 * (lvl - 1) // 레벨업 ~10% 빠르게(증가폭 110→98) — 가벼운 가속
const respawnTime = (lvl) => 4 + 1.5 * lvl // 레벨이 높을수록 부활 대기 ↑ (Lv1 5.5초 → Lv18 31초)

const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z)
const emojiOf = (zodiacId) => getZodiac(zodiacId)?.emoji || CLASSES[zodiacId]?.icon || '🙂'

// 진영별 출발 위치 (수호석 뒤편 리스폰 존 안에 나란히 — 인원수에 맞춰 중앙 정렬)
function spawnPos(map, team, slot, teamSize) {
  const f = map.FOUNTAIN_POS[team]
  return { x: f.x, z: f.z + (slot - (teamSize - 1) / 2) * 3.2 }
}

// 시야 계산은 state(.map 보유)와 makeView 스냅샷(.nexusPos) 양쪽에서 호출된다.
const nexusOf = (snap) => (snap.map ? snap.map.NEXUS_POS : snap.nexusPos) || NEXUS_POS

// 영웅 상태 객체 팩토리 — createGame(개전 로스터)과 보스전 정예 소환(bossSummonAdds)이 공유한다.
// 필드를 여기 한 곳에서만 관리해야 중간 합류 영웅(그림자 영웅)이 필드 누락으로 터지지 않는다.
function makeHeroState(p, cls, pos, map, rng) {
  return {
    id: p.id,
    name: p.name,
    title: p.title || null, // 장착 칭호(로스터에서 현지화됨) — 이름표에 함께 그린다
    zodiacId: p.zodiacId,
    color: p.color,
    team: p.team,
    cls,
    isBot: !!p.isBot,
      role: null, // 봇 역할은 아래에서 직업 기준으로 배정 (사람은 null로 자유 이동)
      x: pos.x,
      z: pos.z,
      homeX: map.FOUNTAIN_POS[p.team].x, // 리스폰 존(회복 지대) 중심 — inFountain 판정용
      homeZ: map.FOUNTAIN_POS[p.team].z,
      mx: 0, // 이동 입력 (-1~1)
      mz: 0,
      dir: p.team === 'blue' ? 0 : Math.PI, // 바라보는 방향 (적 본진 쪽)
      lvl: 1,
      xp: 0,
      gold: START_GOLD,
      items: [], // 산 아이템 id (최대 ITEM_SLOTS칸)
      itemCd: {}, // 액티브 아이템 남은 쿨다운 (itemId → 초)
      // 상점 세션(우물/사망 중) 동안의 무료 취소용 — 진입 시점 스냅샷 + 그동안의 순지출
      shopStack: null, // 이번 세션의 구매/판매 기록 스택 — 되돌리기가 한 스텝씩 역순 취소. null이면 세션 아님
      shopChanged: false, // 이번 세션에 취소할 변경이 있나 (취소 버튼 활성화용)
      couldShop: false, // 직전 틱의 canShop (세션 시작/종료 감지)
      bonus: sumStats([]), // 아이템 합산 보너스 (heroMaxHp가 참조하므로 먼저)
      hp: 0, // 아래에서 직업 최대치로 채운다
      maxHp: 0,
      atkCd: 0,
      atkSeq: 0, // 공격할 때마다 +1 (렌더러의 휘두르기 모션 트리거)
      skillCd: 0,
      skill2Cd: 0, // 보조 스킬(Lv3) 쿨다운
      ultCd: 0,
      stunT: 0,
      berserkT: 0, // 전사 광폭화 남은 시간 — 이동/공격 가속 + 상태이상 면역
      rageT: 0, // 검투사 검투의 분노 — 이속↑·지속회복·받는 CC 감소
      poisonT: 0, // 주술사 중독(DoT) 남은 시간 — 매 틱 피해 + 회복 감소(안티힐)
      poisonDps: 0, // 중독 초당 피해
      poisonBy: null, // 중독을 건 적 영웅 id(킬 크레딧)
      barrierHp: 0, // 수호기사 보호막 흡수 풀
      barrierT: 0, // 보호막 남은 시간
      wardT: 0, // 받는 피해 감소 남은 시간(불굴의 진형)
      bindT: 0, // 수호기사 결속 — 대신 맞아주는 결속에 묶인 남은 시간
      bindBy: null, // 나를 결속한 수호기사 id(피해 리다이렉트 대상)
      bindAnchorT: 0, // (수호기사) 결속 진형을 유지 중인 시간 — 링크/구체 연출용
      vulnT: 0, // 주술사 낙인 — 받는 피해 증가 남은 시간
      parryT: 0, // 검성 발도 카운터 유효 시간(받는 첫 피해 무효 + 반격)
      rootT: 0, // 사슬잡이 속박(옭아매기/단죄) — 이동 불가(공격/시전은 가능)
      bladeT: 0, // 검성 무형검 — 사거리·공격속도 ↑
      hookWindT: 0, // 사슬잡이 발사 준비 남은 시간
      hookDir: 0, // 발사 방향(준비 시작 시 고정)
      pullT: 0, // 갈고리에 끌려오는 남은 시간(그동안 스턴)
      pullBy: null, // 나를 끌어당기는 사슬잡이 id
      stealthT: 0, // 암살자 은신 남은 시간 — 적에게 안 보인다
      fearT: 0, // 공포(공포술사) — 통제 불능: 랜덤 방향 질주, 행동 불가
      fearDir: 0, // 공포 질주 방향(라디안) — FEAR_TURN_T마다 재추첨
      fearTurnT: 0, // 다음 방향 재추첨까지 남은 시간
      slingN: 0, // 대지술사 돌팔매 — 남은 연투 수 (>0이면 시퀀스 진행 중)
      slingT: 0, // 다음 발사까지 남은 시간
      slingDir: 0, // 첫 발에 고정된 발사 각도
      slingDmg: 0, // 발당 피해(시전 시점 스냅샷)
      hasteT: 0, // 힐러 가속 남은 시간 — 이동 속도 ↑
      tauntT: 0, // 탱커 도발에 걸린 시간 — tauntBy만 평타치게 된다
      tauntBy: null, // 나를 도발한 탱커 id
      castT: 0, // 정신집중(궁수 빛의 화살) 남은 시간 — 그동안 제자리에 멈춘다
      castDir: 0, // 정신집중 후 발사 방향(시전 시점에 고정)
      resetUltCd: false, // 이번 궁으로 처치 → 궁 쿨 초기화 플래그 (암살자 그림자처형)
      freezeT: 0, // 빙결(마법사 화염구) 남은 시간 — 이동/공격이 느려진다
      whirlT: 0, // 회전베기(전사 궁극기) 남은 시간 — 팽이처럼 돌며 주변 피해
      whirlTickT: 0, // 회전베기 다음 피해 판정까지 남은 시간
      knockT: 0, // 돌풍술사 넉백에 밀려나는 남은 시간 — 그동안 입력 무시(변위에 끌려간다)
      knockVx: 0, // 넉백 속도(초당 이동)
      knockVz: 0,
      knockStun: 0, // 벽꽝 시 줄 기절(벽에 막히면 적용)
      airT: 0, // 돌풍에 띄워진(공중) 남은 시간 — stunT와 함께 걸리며 렌더러가 몸을 띄운다
      trail: [], // 시간술사: 과거 {x,z,hp} 표본 링버퍼(되감기용)
      trailT: 0, // 다음 표본까지 남은 시간
      shieldT: 0, // 탱커 방패막기 남은 시간
      slowT: 0, // 공격 직후 무거운 발 남은 시간
      recallT: 0, // 귀환 채널링 남은 시간 (>0이면 시전 중)
      respawnT: 0, // >0이면 사망 중
      bushI: -1, // 들어가 있는 수풀 (적에겐 안 보인다)
      revealT: 0, // 공격 직후 모습이 드러나는 시간
      aggroT: 0, // 적 영웅을 때린 직후 — 타워가 우선 조준
      lastHurt: -99,
      lastHitBy: null, // 마지막으로 나를 때린 적 영웅 (킬 크레딧)
      lastHitT: -99, // 그 적 영웅에게 맞은 시각 (KILL_CREDIT_T 안이어야 킬 인정)
      dragonT: 0, // 용 버프 남은 시간
      baronT: 0, // 이무기 버프 남은 시간
      kills: 0,
      deaths: 0,
      assists: 0,
      jungleKills: 0, // 소형 정글몹(늑대/멧돼지/골렘) 처치 수 — 일일 미션 집계용
      // 업적 집계용 카운터 — 막타 기준 귀속(용/이무기/병사), bestStreak은 한 목숨 최다 연속킬
      dragonKills: 0, baronKills: 0, soldierKills: 0, bestStreak: 0,
      deathStreak: 0, // 킬/어시 없이 연속으로 죽은 횟수 — 잡힐 때 킬골드를 깎는다(킬/어시 시 0)
      killStreak: 0, // 안 죽고 쌓은 연속 킬 — 잡히면 현상금이 붙는다(죽으면 0)
      damagedBy: {}, // 적영웅 id → 마지막으로 맞은 시각 (어시스트 판정, 사망 시 비움)
      supportedBy: {}, // 아군영웅 id → 마지막으로 치유/보호막을 받은 시각 (내가 킬을 따면 서포터도 어시스트)
      // 사람 플레이어 자동평타: 버튼을 안 눌러도 사거리 안 적 영웅에게 평타를 이어 준다
      // (봇은 매 틱 평타를 박는데 사람은 손가락 연타에 의존 → 평타 cadence가 불리하던 문제 보정)
      autoAttack: true,
      // 봇 상태
      botRetreat: false,
      botStrafe: rng() * Math.PI * 2,
      botSeekT: 0, // >0이면 타워 앞에서 "딴 일"(합류/정글/지원)을 잠시 유지
      botStuckT: 0, // 제자리에 박혀 못 움직인 누적 시간 (BOT_STUCK_T 넘으면 귀환)
      botRecall: false, // 끼임 구제용 귀환을 스스로 시전 중인지
      fallT: 0, // 콜로세움 낙하 연출 남은 시간(>0이면 추락 중 — 행동/이동 불가, 생존 판정 제외)
      botReact: -1, // 평타 반응 지연 타이머 (쿨이 돌아온 뒤 사람처럼 잠깐 뜸들이고 친다)
      botBigT: 0, // 이 시각까지 용/이무기 평타 허용 (커밋 없이 지나가다 어그로 끄는 사고 방지)
      botFocus: null, // 공성 집중 표적(타워/수호석) — botLaneMove가 정하고 다음 틱 평타가 쓴다
      turretStock: 1, // 엔지니어 포탑 설치 재고 — 1개 들고 시작, skillCd가 돌 때마다 1개 충전(최대 3, stepHero)
  }
}

// players: [{ id, name, zodiacId, color, team, cls, isBot? }]
// 같은 팀에 같은 직업이 오면(또는 직업 미지정이면) 남은 직업으로 바꿔준다.
// opts: rng 함수 또는 { mode, rng } 객체 (하위호환을 위해 둘 다 받는다).
export function createGame(players, opts = {}) {
  const o = typeof opts === 'function' ? { rng: opts } : opts
  const rng = o.rng || Math.random
  const mode = TEAM_SIZES[o.mode] ? o.mode : '3v3'
  const teamSize = TEAM_SIZES[mode]
  const map = buildMap(mode, o.arenaLayout)
  const slotCount = { blue: 0, red: 0 }
  const usedCls = { blue: new Set(), red: new Set() }
  const heroes = players.map((p) => {
    const slot = slotCount[p.team]++
    const pos = spawnPos(map, p.team, slot, teamSize)
    let cls = p.cls
    if (!CLASSES[cls] || usedCls[p.team].has(cls)) {
      cls = CLASS_IDS.find((c) => !usedCls[p.team].has(c)) || 'warrior'
    }
    usedCls[p.team].add(cls)
    return makeHeroState(p, cls, pos, map, rng)
  })
  for (const h of heroes) {
    h.isBoss = CLASSES[h.cls].boss === true
    // 보스는 레벨이 없다 — 대신 개전부터 고정 파워(BOSS_LEVEL 상당)로 계산해 스탯을 못박는다.
    //  이후 bossThink에서 레벨업하지 않으므로 이 값이 게임 내내 유지된다.
    if (h.isBoss) h.lvl = BOSS_LEVEL
    h.maxHp = heroMaxHp(h)
    // 난이도 티어: 보스 체력만 생성 시 1회 가중(공격은 damageHero에서, 템포는 쿨다운에서)
    if (h.isBoss) h.maxHp = Math.round(h.maxHp * (BOSS_TIERS[o.bossTier]?.hp || 1))
    // 콜로세움 이월: 라운드 사이 레벨·골드·아이템을 들고 온다(체력·쿨은 리셋)
    const carry = o.carry?.[h.id]
    if (carry) {
      h.lvl = Math.min(MAX_LEVEL, carry.lvl || h.lvl)
      h.gold = carry.gold ?? h.gold
      // 아이템은 id 문자열 배열 — 얕은 복사면 충분(스프레드로 문자열을 부수면 증발한다)
      if (Array.isArray(carry.items)) h.items = [...carry.items]
      h.bonus = sumStats(h.items) // 이월 아이템의 능력치 반영
      h.maxHp = heroMaxHp(h)
    }
    if (mode === 'arena') h.gold += 1000 // 콜로세움: 라운드 개시 지원금(이월 골드 위에 지급)
    h.hp = h.maxHp
  }
  // 봇 역할 배정(팀별): 직업이 선호하는 라인을 잡되, 겹치면 남은 자리를 채워 라인 공백을 막는다.
  //  → 마법사 미드 / 탱커 탑 / 궁수·힐러 봇 / 전사·암살자 정글(5:5)
  for (const team of ['blue', 'red']) {
    const taken = []
    for (const h of heroes) {
      if (!h.isBot || h.team !== team) continue
      h.role = pickRole(h.cls, mode, taken)
      taken.push(h.role)
    }
  }
  // 보스전: 아군 봇은 전원 정글러 — 라인 병사가 없으니 캠프를 돌며 성장하고,
  // 타워가 공격받거나 아군이 싸우면 합류한다(수비 콜/갱킹 로직이 그대로 동작).
  if (mode === 'arena') {
    for (const h of heroes) h.role = null // 콜로세움: 라인/정글 없음 — 결투뿐
  }
  if (isRaidMode(mode)) {
    for (const h of heroes) {
      if (h.isBoss) h.role = null
      else if (h.isBot) h.role = 'jungle'
    }
  }
  const monsters = [
    ...map.WOLF_CAMPS.map((c, i) => {
      const kind = CAMP_MOBS[c.kind] ? c.kind : 'wolf'
      const spec = CAMP_MOBS[kind]
      return {
        id: `${kind}${i}`, kind, camp: c, x: c.x, z: c.z,
        hp: spec.hp, maxHp: spec.hp, alive: true, respawnT: 0, aggro: null,
      }
    }),
    {
      id: 'dragon', kind: 'dragon', camp: map.DRAGON_PIT, x: map.DRAGON_PIT.x, z: map.DRAGON_PIT.z,
      hp: DRAGON.hp, maxHp: DRAGON.hp, alive: false, respawnT: mode === 'arena' ? 1e9 : DRAGON.spawn, aggro: null,
    },
    {
      id: 'baron', kind: 'baron', camp: map.BARON_PIT, x: map.BARON_PIT.x, z: map.BARON_PIT.z,
      hp: BARON.hp, maxHp: BARON.hp, alive: false, respawnT: mode === 'arena' ? 1e9 : BARON.spawn, aggro: null,
    },
  ]
  return {
    status: 'countdown', // 'countdown' | 'playing' | 'finished'
    mode,
    teamSize,
    botLevel: BOT_LEVELS[o.botLevel] ? o.botLevel : 'normal', // 봇 난이도(솔로 모드) — 온라인은 항상 normal
    bossTier: BOSS_TIERS[o.bossTier] ? o.bossTier : 'normal', // 보스전 난이도 티어(보통/어려움/악몽)
    arenaLayout: mode === 'arena' ? (o.arenaLayout || null) : null, // 콜로세움 내부 구조(렌더러 동기화용)
    arenaPhase: mode === 'arena' ? 'shop' : null, // 콜로세움: shop → fight → sudden
    arenaT: mode === 'arena' ? ARENA_SHOP_T : 0, // 현재 페이즈 남은 시간
    arenaWave: 0, // 서든데스 붕괴 웨이브 번호
    arenaPts: mode === 'arena' ? { blue: 10, red: 10, ...(o.arenaPts || {}) } : null, // 팀별 토너먼트 포인트(수호석 하트)
    arenaDeduct: mode === 'arena' ? (o.arenaDeduct ?? 3) : 0, // 이번 라운드 패배 시 차감량(하트 펑 연출용)
    healOrbs: [], // 콜로세움 회복 열매 {id,x,z,t} — 먹으면 체력 회복
    orbT: 6, // 다음 열매 낙하까지(전투 개시 후)
    holes: [], // 붕괴 구멍 {x,z,r} — 밟으면 추락
    holeWarns: [], // 붕괴 경고 {x,z,r,at} — at에 낙하
    wave: 0, // 무한 방어: 현재 파도 번호(기록 = 버틴 파도 수)
    defWaveT: DEFENSE_FIRST_WAVE, // 무한 방어: 다음 파도까지 남은 시간
    map,
    time: 0,
    countdown: COUNTDOWN_TIME,
    winner: null, // 'blue' | 'red' | null(무승부)
    heroes,
    minions: [],
    monsters,
    towers: map.TOWER_SPOTS.map((t) => ({
      ...t, hp: TOWER_HP[t.tier], maxHp: TOWER_HP[t.tier], alive: true, cd: 0,
    })),
    nexus: {
      blue: { hp: NEXUS_HP, maxHp: NEXUS_HP },
      red: { hp: NEXUS_HP, maxHp: NEXUS_HP },
    },
    projectiles: [], // {id, kind:'bolt'|'fireball'|'towerbolt', ...}
    hawks: [], // 궁수 사냥매 {id, team, owner, x, z, vx, vz, travel, max, dropAt}
    reveals: [], // 사냥매가 걷어 둔 시야 흔적 {team, x, z, r, t, life}
    zones: [], // 예고 후 발동하는 지면 범위 {id, kind:'meteor', x, z, r, t, delay, dmg, ...}
    tempWalls: [], // 대지술사 임시 돌벽 충돌 원 {id, x, z, alive, t, life} — colliders()가 타워와 함께 취급
    summons: [], // 소환물(야수조련사 펫/엔지니어 포탑) {id, kind, team, owner, x, z, hp, ...}
    fx: [], // 시각 효과 {id, kind, x, z, r, t, team}
    kills: { blue: 0, red: 0 },
    towersDown: { blue: 0, red: 0 }, // 그 팀이 "부순" 적 타워 수
    feed: [], // 킬/오브젝트 피드 {seq, t, msg}
    feedSeq: 0,
    waveT: FIRST_WAVE, // 다음 병사 웨이브까지
    // 오브젝트(용/이무기) 팀 커밋: 한번 "치기로" 결심하면 죽을 때까지 물고 늘어진다.
    //  { id, until } — 재계산으로 콜이 껐다 켜졌다 하며 우왕좌왕하는 것을 막는다.
    objCommit: { blue: null, red: null },
    nextId: 1,
    rng,
  }
}

export function setInput(state, id, { mx = 0, mz = 0 } = {}) {
  const h = state.heroes.find((p) => p.id === id)
  if (!h) return state
  h.mx = Math.max(-1, Math.min(1, Number(mx) || 0))
  h.mz = Math.max(-1, Math.min(1, Number(mz) || 0))
  return state
}

// 연결이 끊긴 참가자의 영웅은 봇이 이어받는다
export function makeBot(state, id) {
  const h = state.heroes.find((p) => p.id === id)
  if (!h || h.isBot) return null
  h.isBot = true
  h.mx = 0
  h.mz = 0
  // 직업 선호에 맞는 역할을 맡되, 이미 다른 봇이 가진 역할은 피한다
  const taken = state.heroes.filter((o) => o.isBot && o.team === h.team && o !== h).map((o) => o.role)
  h.role = pickRole(h.cls, state.mode, taken)
  h.botStrafe = state.rng() * Math.PI * 2
  h.botStuckT = 0
  h.botRecall = false
  h.botReact = -1
  h.botBigT = 0
  h.botFocus = null
  h.navPath = null // 경로탐색 캐시 (steerToward/navWaypoint)
  return h
}

function pushFeed(state, t, msg) {
  state.feed.push({ seq: ++state.feedSeq, t, msg })
  if (state.feed.length > 8) state.feed.shift()
}

function pushFx(state, kind, x, z, r, team = null, life = null) {
  state.fx.push({ id: state.nextId++, kind, x, z, r, t: 0, team, ...(life ? { life } : null) })
}

// 방향성(앞으로 뻗는) 이펙트 — dir 방향, 길이 r. 렌더러가 콘/직선 + 파티클로 그린다.
function pushFxDir(state, kind, x, z, r, dir, team = null) {
  state.fx.push({ id: state.nextId++, kind, x, z, r, t: 0, team, dir })
}

// 넉백(변위): (fromX,fromZ)에서 멀어지는 방향으로 victim을 dist만큼 KNOCK_DUR초 동안 민다.
//  벽/타워/수호석에 막히면(거의 안 밀리면) wallStun만큼 기절한다(벽꽝). stepHero에서 매 틱 처리.
//  검투의 분노(받는 CC 감소)는 밀려나는 거리·벽꽝 기절 양쪽에 적용한다.
function applyKnockback(state, victim, fromX, fromZ, dist, wallStun = 0) {
  if (victim.respawnT > 0) return
  let dx = victim.x - fromX
  let dz = victim.z - fromZ
  let d = Math.hypot(dx, dz)
  if (d < 1e-3) { dx = Math.cos(victim.dir); dz = Math.sin(victim.dir); d = 1 } // 겹쳐 있으면 바라보는 쪽으로
  const cc = victim.rageT > 0 ? RAGE_CC_CUT : 1
  const reach = dist * cc
  victim.knockVx = (dx / d) * (reach / KNOCK_DUR)
  victim.knockVz = (dz / d) * (reach / KNOCK_DUR)
  victim.knockT = KNOCK_DUR
  victim.knockStun = wallStun * cc
  // 밀려나면 정신집중/귀환/발사준비 같은 채널은 끊긴다(이동기 CC로 취급)
  victim.castT = 0
  victim.recallT = 0
  victim.hookWindT = 0
}

// 시간술사: secs초 과거의 표본 {x,z,hp}를 돌려준다. 기록이 모자라면 가장 오래된 표본.
function trailSampleBack(h, secs) {
  if (!h.trail || h.trail.length === 0) return { x: h.x, z: h.z, hp: h.hp }
  const back = Math.round(secs / TRAIL_DT)
  const i = Math.max(0, h.trail.length - 1 - back)
  return h.trail[i]
}

const canAct = (h) => h.respawnT <= 0 && h.stunT <= 0 && h.fearT <= 0 && !(h.fallT > 0) // 공포 중엔 공격/시전 불가(도망만), 낙하 중엔 아무것도 못 한다

// ── 신규 직업 상수 ──
// 공포술사: 공포 = 통제 불능(새 CC). 도망이 아니라 컨트롤을 잃고 아무 방향으로나 갈팡질팡 내달린다.
//  넉백(밀침)·도발(끌림)과 구분되는 심리 CC — 어디로 튈지 몰라 시전자도 등 뒤를 장담 못 한다.
const FEAR_RANGE = 10 // 공포의 시선 부채꼴 길이
const FEAR_HALF_ANG = 0.55 // 부채꼴 절반 각(rad)
const FEAR_T = 1.5 // 스킬 공포 지속 — 방향이 두어 번 바뀌는 갈팡질팡이 보일 만큼
const SPECTRE_T = 2.2 // 망령걸음(가속+어둠 장막) 지속
const SHRIEK_RADIUS = 9 // 단말마 반경
const SHRIEK_FEAR_T = 1.6
const SHRIEK_TELE_RANGE = 16 // 단말마 순간이동 사거리(보이는 적 탐색) — 적진으로 파고드는 이니시
const FEAR_FLEE_SPD = 0.7 // 질주 속도 배율(본인 이속 기준) — 약한 슬로우
const FEAR_TURN_T = 0.4 // 이 간격마다 질주 방향을 무작위로 다시 뽑는다
// 환영무희: 분신(미끼/전투형) + 자리바꿈
const CLONE_LIFE = 6 // 분신 수명(초)
const CLONE_HP_COEF = 1.6 // 분신 체력 = 주력 스탯 × 계수 (잘 속을 만큼은 단단하게)
const CLONE_STEALTH_T = 0.9 // 분신 소환 시 본체 은신
const DANCE_STEALTH_T = 1.4 // 환영난무 은신
const CLONE_ATK_COEF = 0.8 // 전투형 분신(궁극기) 평타 = 본체 공격력의 80%
const CLONE_AGGRO = 14 // 전투형 분신의 적 인지 범위
// 미끼 분신의 내리찍기: 직진하다 "보이는" 적 영웅을 발견하면 쫓아가 강하게 내리찍고 펑 사라진다.
//  내리찍기가 시작되면 표적을 끝까지 따라붙어(도약) 반드시 명중한다 — 초반 유일한 딜 수단.
export const CLONE_SLAM_WINDUP = 0.35 // 내리찍기 모션 시간(렌더러와 공유)
const CLONE_SEEK_RANGE = 10 // 이 반경 안에 보이는 적 영웅이 오면 직진을 멈추고 쫓아간다
const CLONE_SLAM_TRIGGER = 3 // 이 거리 안에 적 영웅이 오면 내리찍기 시작
const CLONE_SLAM_RADIUS = 3.4 // 내리찍기 휩쓸림(주변 적) 피해 반경
const DANCE_BURST_DIST = 3 // 환영난무: 연막에서 세 몸(본체+분신2)이 튀어나가는 거리
// 대지술사: 임시 돌벽(동적 지형)
const QUAKE_WALL_LIFE = 3 // 융기 벽 지속(초)
const QUAKE_WALL_AHEAD = 9 // 벽이 서는 전방 거리 — 평타 사거리(8.5) 언저리라 도주로 차단에 쓸 만하다
const QUAKE_WALL_SPAN = 3.3 // 벽 충돌 원 간격(원 반경 TOWER_RADIUS와 겹치게)
const SLING_RANGE = 12 // 돌팔매 조준 보조(가장 가까운 적) 탐색 반경
const SLING_COUNT = 3 // 3연투
const SLING_INTERVAL = 0.5 // 던지는 간격(초)
const ROCK_SPEED = 26 // 돌덩이 비행 속도
const ROCK_RANGE = 13 // 돌덩이 최대 비행 거리
const ROCK_HIT_R = 2.0 // 직격 판정 반경(영웅 기준 — 병사는 -0.2, 정글몹은 +0.6)
const ROCK_SPLASH_R = 3.4 // 착탄 파편 스플래시 반경 — 돌 크기에 비례
const ROCK_SPLASH_FRAC = 0.6 // 스플래시 피해 = 직격 피해의 60%
const QUAKE_STUN = 1.2 // 융기 벽에 맞은 적의 기절(돌팔매 연계 셋업)
const CAGE_RANGE = 14 // 바위감옥 시전 사거리
const CAGE_RADIUS = 5.2 // 감옥 반지름
const CAGE_LIFE = 2.5 // 감옥 지속

// 공포 부여 — 통제를 잃고 아무 방향으로나 내달린다(첫 방향부터 무작위).
//  검투의 분노(CC 감소) 존중, 귀환 채널링도 끊는다. rng는 시드 고정(state.rng) — 넷플레이 결정성 유지.
function applyFear(state, e, t) {
  const cc = e.rageT > 0 ? RAGE_CC_CUT : 1
  e.fearT = Math.max(e.fearT, t * cc)
  e.fearDir = state.rng() * Math.PI * 2
  e.fearTurnT = FEAR_TURN_T
  cancelRecall(e)
}

// 이동 충돌체 = 타워 + 대지술사의 임시 돌벽 (벽 원은 alive:true라 타워와 같은 규칙으로 밀어낸다)
const colliders = (state) =>
  state.tempWalls && state.tempWalls.length ? state.towers.concat(state.tempWalls) : state.towers

// 임시 돌벽 선분 생성: 중심에서 수직 방향으로 충돌 원들을 깐다
function raiseWallLine(state, cx, cz, alongDir, count) {
  const nx = Math.cos(alongDir)
  const nz = Math.sin(alongDir)
  for (let i = 0; i < count; i++) {
    const off = (i - (count - 1) / 2) * QUAKE_WALL_SPAN
    state.tempWalls.push({
      id: state.nextId++, x: cx + nx * off, z: cz + nz * off, alive: true, t: 0, life: QUAKE_WALL_LIFE,
    })
  }
}
// 광폭화 세기: 첫 BERSERK_FULL초는 전력(1), 그 뒤 BERSERK_FADE초 동안 0으로 잦아든다
const berserkStrength = (h) =>
  h.berserkT <= 0 ? 0 : h.berserkT > BERSERK_FADE ? 1 : h.berserkT / BERSERK_FADE

// 버프 포함 피해 배율 / 공격력
const dmgMult = (h) => (h.baronT > 0 ? 1.4 : h.dragonT > 0 ? 1.25 : 1)
const atkOf = (h) => heroAtk(h) * dmgMult(h)
// 직업 계열: 마법(AP, 주문력 계수) vs 물리(AD, 공격력 계수).
//  · 마법 계열(마법사·힐러)은 레벨로 성장하는 기본 주문력 + 아이템 주문력을 쓴다.
//  · 그 외(전사·궁수·암살자·탱커)는 공격력(heroAtk)을 그대로 주력 스탯으로 쓴다.
//  수호기사도 AP 인챈터로 편입 — 보호막이 주문력에 비례한다.
const AP_CLASSES = new Set(['mage', 'healer', 'cryomancer', 'warlock', 'guardian', 'windcaller', 'chronomancer', 'fearmonger', 'terramancer'])
//  하이브리드: 소환수 피해를 공격력·주문력 절반씩으로 키운다(AD/AP 아이템 어느 쪽이든 도움).
const HYBRID_CLASSES = new Set(['beastmaster', 'engineer'])
const SPELL_BASE = { mage: 45, healer: 32, cryomancer: 42, warlock: 40, guardian: 60, beastmaster: 48, engineer: 46, windcaller: 42, chronomancer: 44, fearmonger: 42, terramancer: 40 }
const SPELL_LVL = { mage: 11, healer: 7, cryomancer: 10, warlock: 9, guardian: 26, beastmaster: 7, engineer: 7, windcaller: 10, chronomancer: 10, fearmonger: 10, terramancer: 9 }
const spellPower = (h) =>
  (SPELL_BASE[h.cls] || 0) + (SPELL_LVL[h.cls] || 0) * (h.lvl - 1) + itemBonus(h).power
// 캐릭터 주력 스탯 — 스킬 계수가 곱해지는 값
//  · 하이브리드(야수조련사·엔지니어)는 공격력·주문력의 평균 → 소환수가 두 스탯 모두에 비례한다.
const powerStat = (h) =>
  HYBRID_CLASSES.has(h.cls) ? 0.5 * (heroAtk(h) + spellPower(h))
    : AP_CLASSES.has(h.cls) ? spellPower(h)
      : heroAtk(h)
// 스킬 피해 = 기본값 + 계수 × 주력 스탯(공격력/주문력), 버프 배율 포함.
//  계수가 클수록 그 직업의 주력 스탯(공격 아이템/주문 아이템)에 더 크게 비례한다.
const skillDmg = (h, base, coef) => (base + coef * powerStat(h)) * dmgMult(h)
// 회복량 = 기본값 + 계수 × 주문력 (피해 배율은 적용 안 함)
const healAmt = (h, base, coef) => base + coef * spellPower(h)

// ── 시야 (전장의 안개 + 수풀 은신) ──
// state와 makeView() 스냅샷 양쪽에서 같은 필드를 쓰므로 둘 다 받을 수 있다.
// team의 시야: 아군 영웅/병사/타워/수호석 주변 SIGHT_RANGE.
// 수풀 속 영웅은 시야 안이어도, 같은 수풀에 들어가거나 바짝 붙어야 보인다.
export function isHeroVisible(snap, h, team) {
  if (!team || h.team === team) return true
  if (h.respawnT > 0) return true // 시체/부활은 숨길 필요 없음 (렌더러가 숨김)
  if (h.stealthT > 0 && h.revealT <= 0) return false // 은신: 공격(revealT) 전엔 적에게 안 보인다
  if (h.bushI >= 0 && h.revealT <= 0) {
    const br2 = BUSH_REVEAL * BUSH_REVEAL
    return snap.heroes.some(
      (a) => a.team === team && a.respawnT <= 0 && (a.bushI === h.bushI || dist2(a, h) <= br2)
    )
  }
  if (h.revealT > 0) return true
  return inSight(snap, h, team)
}

// 병사 등 일반 유닛: 수풀 규칙 없이 시야 거리만 본다
export function isUnitVisible(snap, ent, team) {
  if (!team || ent.team === team) return true
  return inSight(snap, ent, team)
}

function inSight(snap, ent, team) {
  const r2 = SIGHT_RANGE * SIGHT_RANGE
  for (const a of snap.heroes) {
    if (a.team === team && a.respawnT <= 0 && dist2(a, ent) <= r2) return true
  }
  for (const m of snap.minions) {
    if (m.team === team && dist2(m, ent) <= r2) return true
  }
  for (const t of snap.towers) {
    if (t.team === team && t.alive && dist2(t, ent) <= r2) return true
  }
  if (dist2(nexusOf(snap)[team], ent) <= r2) return true
  // 사냥매가 걷어 둔 안개(시야 흔적) 안이면 보인다
  if (snap.reveals) {
    for (const rv of snap.reveals) {
      if (rv.team === team && (ent.x - rv.x) ** 2 + (ent.z - rv.z) ** 2 <= rv.r * rv.r) return true
    }
  }
  return false
}

// 이 타워를 지금 공격할 수 있나 (외곽 → 내곽 → 최후의 포탑 → 수호석 순서).
//  · tier1(외곽): 항상 가능
//  · tier2(내곽): 같은 라인 외곽이 부서져야
//  · tier3(최후의 포탑): 내곽(tier2) 중 하나라도 부서져야
export function towerVulnerable(state, tower) {
  if (tower.tier === 1) return true
  if (tower.tier === 3) {
    return state.towers.some((t) => t.team === tower.team && t.tier === 2 && !t.alive)
  }
  const outer = state.towers.find((t) => t.team === tower.team && t.lane === tower.lane && t.tier === 1)
  return !outer?.alive
}
// 수호석은 최후의 포탑(tier3)이 부서져야 공격할 수 있다.
export function nexusVulnerable(state, team) {
  if (state.mode === 'boss' && team === 'red') return false // 보스전: 보스를 잡아야 이긴다
  const fin = state.towers.find((t) => t.team === team && t.tier === 3)
  if (fin) return !fin.alive
  return state.towers.some((t) => t.team === team && t.tier === 2 && !t.alive)
}

// ── 공격 대상 찾기 (보이는 적 영웅 우선, 다음 가까운 유닛) ──
function nearestFoeHero(state, h, range) {
  const r2 = range * range
  let best = null
  let bd = r2
  for (const e of state.heroes) {
    if (e.team === h.team || e.respawnT > 0) continue
    if (!isHeroVisible(state, e, h.team)) continue // 수풀 매복은 자동 조준에 안 잡힌다
    const d = dist2(h, e)
    if (d < bd) {
      bd = d
      best = e
    }
  }
  return best
}

// 보이는 적 "영웅 또는 분신" — 환영무희 분신은 겉모습이 본체와 똑같으므로 평타 자동조준·
// 봇 교전 판단에서 영웅과 같은 우선순위로 잡혀야 진짜 미끼가 된다. (스킬 자동조준은
// 내부 필드가 다른 분신에 damageHero를 태울 수 없어 기존 nearestFoeHero를 그대로 쓴다)
function nearestFoeHeroLike(state, h, range) {
  const r2 = range * range
  let best = null
  let bd = r2
  let clone = false
  for (const e of state.heroes) {
    if (e.team === h.team || e.respawnT > 0) continue
    if (!isHeroVisible(state, e, h.team)) continue
    const d = dist2(h, e)
    if (d < bd) {
      bd = d
      best = e
      clone = false
    }
  }
  for (const s of state.summons) {
    if (s.kind !== 'clone' || s.team === h.team) continue
    if (!isHeroVisible(state, s, h.team)) continue // 분신도 안개/시야 규칙을 따른다
    const d = dist2(h, s)
    if (d < bd) {
      bd = d
      best = s
      clone = true
    }
  }
  return best ? { e: best, clone } : null
}

// 야수가 달려들 표적 — 인지(aggro) 범위 안에서 가장 가까운 적 영웅 > 적 병사 > 정글몹.
//  범위 안이면 거리를 무시하고(아무리 멀어도 범위 안이면) 바로 도약한다. {target, tk} 또는 null.
function nearestLeapTarget(state, s, range) {
  const r2 = range * range
  let best = null
  let bd = r2
  for (const e of state.heroes) {
    if (e.team === s.team || e.respawnT > 0) continue
    const d = dist2(s, e)
    if (d < bd) { bd = d; best = e }
  }
  if (best) return { target: best, tk: 'hero' }
  bd = r2
  for (const m of state.minions) {
    if (m.team === s.team) continue
    const d = dist2(s, m)
    if (d < bd) { bd = d; best = m }
  }
  if (best) return { target: best, tk: 'minion' }
  bd = r2
  for (const m of state.monsters) {
    if (!m.alive) continue
    const d = dist2(s, m)
    if (d < bd) { bd = d; best = m }
  }
  return best ? { target: best, tk: 'monster' } : null
}

// 도약 중 표적을 id/종류로 다시 찾는다(도망가도 추적) — 사라졌으면 null.
function findLeapEntity(state, s) {
  if (s.leapTk === 'hero') return state.heroes.find((e) => e.id === s.leapTargetId && e.team !== s.team && e.respawnT <= 0) || null
  if (s.leapTk === 'minion') return state.minions.find((e) => e.id === s.leapTargetId && e.team !== s.team) || null
  if (s.leapTk === 'monster') return state.monsters.find((e) => e.id === s.leapTargetId && e.alive) || null
  return null
}

function findAttackTarget(state, h, range) {
  // 영웅과 "분신"은 같은 우선순위 — 분신이 더 가까우면 평타가 분신에게 간다(미끼 성립)
  const hero = nearestFoeHeroLike(state, h, range)
  if (hero) return hero.clone ? { tk: 'summon', id: hero.e.id } : { tk: 'hero', id: hero.e.id }
  // 구조물(타워/수호석)은 몸통 반경이 커서 중심까지 못 붙는다.
  //  → 충돌체 표면까지의 거리(중심거리−반경)로 사거리를 재야 근접도 때릴 수 있다.
  //    (안 그러면 수호석 반경 4.5 + 영웅 반경 1.3 = 5.8까지밖에 못 붙는데
  //     근접 사거리는 3.8~4.2라 영영 닿지 못한다.)
  let best = null
  let bd = range // 가장 가까운 표적까지의 "표면" 거리
  for (const m of state.minions) {
    if (m.team === h.team) continue
    const d = dist(h, m)
    if (d < bd) {
      bd = d
      best = { tk: 'minion', id: m.id }
    }
  }
  for (const m of state.monsters) {
    if (!m.alive) continue
    // 봇은 용/이무기를 "잡기로 결심한 동안"(botBigT — stepBots 커밋 분기가 갱신)에만 노린다.
    // 지나가다 평타로 어그로를 끌어 홀로 두들겨 맞던 자멸 사고 방지 (늑대는 자유롭게 사냥)
    if (h.isBot && !CAMP_MOBS[m.kind] && !((h.botBigT || 0) > state.time)) continue
    const d = dist(h, m)
    if (d < bd) {
      bd = d
      best = { tk: 'monster', id: m.id }
    }
  }
  for (const s of state.summons) {
    if (s.team === h.team) continue
    const d = dist(h, s)
    if (d < bd) {
      bd = d
      best = { tk: 'summon', id: s.id }
    }
  }
  for (const t of state.towers) {
    if (!t.alive || t.team === h.team || !towerVulnerable(state, t)) continue
    const d = dist(h, t) - TOWER_RADIUS
    if (d < bd) {
      bd = d
      best = { tk: 'tower', id: t.id }
    }
  }
  const en = enemyOf(h.team)
  if (nexusVulnerable(state, en) && state.nexus[en].hp > 0) {
    const d = dist(h, state.map.NEXUS_POS[en]) - NEXUS_RADIUS
    if (d < bd) best = { tk: 'nexus', id: en }
  }
  return best
}

function targetEntity(state, ref) {
  if (!ref) return null
  if (ref.tk === 'hero') {
    const e = state.heroes.find((h) => h.id === ref.id)
    return e && e.respawnT <= 0 ? e : null
  }
  if (ref.tk === 'minion') return state.minions.find((m) => m.id === ref.id) || null
  if (ref.tk === 'monster') {
    const m = state.monsters.find((o) => o.id === ref.id)
    return m?.alive ? m : null
  }
  if (ref.tk === 'tower') {
    const t = state.towers.find((o) => o.id === ref.id)
    return t?.alive ? t : null
  }
  if (ref.tk === 'summon') return state.summons.find((s) => s.id === ref.id) || null
  if (ref.tk === 'nexus') {
    return state.nexus[ref.id].hp > 0 ? { ...state.map.NEXUS_POS[ref.id], team: ref.id } : null
  }
  return null
}

function getHero(state, id) {
  return state.heroes.find((p) => p.id === id)
}

// 귀환 채널링을 끊는다 (이동·피격·기절·다른 행동에 방해받으면)
function cancelRecall(h) {
  h.recallT = 0
}

// ── 귀환: 쿨다운 없이 RECALL_TIME초 집중하면 우물로 복귀. 다시 누르면 취소. ──
export function castRecall(state, id) {
  if (state.status !== 'playing') return state
  const h = getHero(state, id)
  if (!h) return state
  if (h.recallT > 0) {
    h.recallT = 0 // 시전 중 다시 누르면 취소
    return state
  }
  if (!canAct(h)) return state
  h.recallT = RECALL_TIME
  pushFx(state, 'recall', h.x, h.z, 3, h.team)
  return state
}

// ── 골드 / 상점 ──
// 자기 리스폰 존(회복 지대) 안인가? — 수호석 뒤편에 분리돼 있다.
export function inFountain(h) {
  // 회복 지대 중심은 영웅에 새겨 둔 home 좌표 (맵 크기와 무관하게 동작)
  const cx = h.homeX ?? FOUNTAIN_POS[h.team].x
  const cz = h.homeZ ?? FOUNTAIN_POS[h.team].z
  return (h.x - cx) ** 2 + (h.z - cz) ** 2 <= FOUNTAIN_RADIUS * FOUNTAIN_RADIUS
}
// 상점을 열 수 있나 — 우물 안이거나, 죽어 있는(부활 대기) 동안에도 가능.
export function canShop(h) {
  return h.respawnT > 0 || inFountain(h)
}

// 골드 지급 + 획득 표시(fx). 병사 막타 등 "내가 얻은 골드"만 본인에게 떠오른다.
//  죽어 있어도 받는다 — 내가 먼저 죽었어도 7초 안의 킬/어시스트, 도트·펫·포탑 막타,
//  용/이무기/타워 같은 팀 보상은 정당하게 지급되어야 한다(킬 스코어와 함께).
function awardGold(state, h, amount, x, z) {
  h.gold += amount
  state.fx.push({
    id: state.nextId++, kind: 'gold', x: x ?? h.x, z: z ?? h.z,
    r: 0, t: 0, team: h.team, owner: h.id, n: Math.round(amount),
  })
}

// 팀 전원에게 골드 (용/이무기/타워 같은 오브젝트) — 경험치(giveXp)와 마찬가지로 살아 있는 팀원만 받는다.
//  (개인 기여로 얻는 킬/어시/막타 골드는 죽어 있어도 awardGold로 지급되지만, 팀 보상은 생존자에게만)
function teamGold(state, team, amount) {
  for (const h of state.heroes) if (h.team === team && h.respawnT <= 0) awardGold(state, h, amount)
}

// 아이템 효과를 다시 계산해 영웅 능력치에 반영 (구매/판매 시).
// 최대 체력이 늘면 그만큼 즉시 회복(우물/부활 대기 중이라 자연스럽다).
function applyItems(h) {
  const before = h.maxHp
  h.bonus = sumStats(h.items)
  h.maxHp = heroMaxHp(h)
  const gain = h.maxHp - before
  if (gain > 0 && h.respawnT <= 0) h.hp += gain // 살아 있으면 늘어난 만큼 즉시 회복
  h.hp = Math.min(h.maxHp, h.hp)
}

// 아이템 구매: (우물 안 또는 사망 중) + 빈 칸 + 골드 충분해야 한다 (호스트 권위로 검증).
export function buyItem(state, id, itemId) {
  if (state.status !== 'playing') return state
  if (state.mode === 'arena' && state.arenaPhase !== 'shop') return state // 콜로세움: 준비 30초에만 구매
  const h = getHero(state, id)
  // 보스전 아군 봇은 원격 구매 허용 — 방어전이 끊이지 않아 우물에 돌아갈 틈이 없다
  const remoteOk = isRaidMode(state.mode) && h?.isBot && h.team === 'blue'
  if (!h || (!canShop(h) && !remoteOk)) return state
  const item = ITEMS_BY_ID[itemId]
  if (!item) return state
  // 조합: 인벤토리의 직접 재료(from)를 소모하고 그 가격만큼 깎아 산다 → 슬롯도 함께 비워진다
  const quote = buildQuote(h.items, itemId)
  if (h.items.length - quote.consumes.length >= ITEM_SLOTS) return state
  if (h.gold < quote.price) return state
  const consumed = quote.consumes.map((i) => h.items[i]) // 조합에 흡수된 재료 — 되돌리면 복원
  for (const idx of [...quote.consumes].sort((a, b) => b - a)) h.items.splice(idx, 1)
  h.gold -= quote.price
  h.items.push(itemId)
  if (h.shopStack) h.shopStack.push({ t: 'buy', itemId, price: quote.price, consumed })
  h.shopChanged = !!h.shopStack?.length
  applyItems(h)
  return state
}

// ── 액티브 아이템 사용: 물병(자힐)은 행동 가능할 때, 정화의 종은 CC 중에도 쓸 수 있다 ──
export function useItem(state, id, slot) {
  if (state.status !== 'playing') return state
  const h = getHero(state, id)
  if (!h || h.respawnT > 0) return state
  const itemId = h.items[slot]
  const item = ITEMS_BY_ID[itemId]
  if (!item?.active || (h.itemCd[itemId] || 0) > 0) return state
  if (item.active.kind === 'heal') {
    if (!canAct(h) || h.hp >= h.maxHp) return state // 기절 중엔 못 마시고, 만피면 아깝게 안 쓴다
    h.hp = Math.min(h.maxHp, h.hp + h.maxHp * 0.25)
    pushFx(state, 'heal', h.x, h.z, 3, h.team)
  } else if (item.active.kind === 'cleanse') {
    const hadCC = h.stunT > 0 || h.freezeT > 0 || h.rootT > 0 || h.tauntT > 0 || h.slowT > 0 || h.poisonT > 0 || h.fearT > 0
    if (!hadCC) return state // 해제할 게 없으면 아깝게 안 쓴다
    h.stunT = 0
    h.freezeT = 0
    h.rootT = 0
    h.slowT = 0
    h.poisonT = 0
    h.fearT = 0
    if (h.tauntT > 0) {
      h.tauntT = 0
      h.tauntBy = null
    }
    pushFx(state, 'shield', h.x, h.z, 3, h.team)
  } else {
    return state
  }
  h.itemCd[itemId] = item.active.cd
  return state
}

// 아이템 판매: 우물 안/사망 중에만, 가격의 일부를 돌려받는다.
export function sellItem(state, id, slot) {
  if (state.status !== 'playing') return state
  const h = getHero(state, id)
  if (!h || !canShop(h)) return state
  const itemId = h.items[slot]
  const item = ITEMS_BY_ID[itemId]
  if (!item) return state
  h.items.splice(slot, 1)
  const refund = Math.floor(item.cost * SELL_REFUND)
  h.gold += refund
  if (h.shopStack) h.shopStack.push({ t: 'sell', itemId, slot, refund })
  h.shopChanged = !!h.shopStack?.length
  applyItems(h)
  return state
}

// 상점 되돌리기: 이번 세션(우물/사망)의 마지막 구매/판매 "한 건"만 역순으로 취소(무료).
//  누를 때마다 스택에서 한 스텝씩 되감는다 — LIFO 역재생이라 골드 경로가 정확히 복원된다.
//  세션을 벗어나면(스택이 사라지면) 그 이전 변경은 더 이상 취소할 수 없다.
export function resetShop(state, id) {
  if (state.status !== 'playing') return state
  const h = getHero(state, id)
  if (!h || !canShop(h) || !h.shopStack?.length) return state
  const op = h.shopStack.pop()
  if (op.t === 'buy') {
    const idx = h.items.lastIndexOf(op.itemId)
    if (idx >= 0) h.items.splice(idx, 1)
    h.items.push(...op.consumed) // 조합에 흡수됐던 재료 복원
    h.gold += op.price
  } else {
    h.items.splice(Math.min(op.slot, h.items.length), 0, op.itemId) // 팔았던 자리에 복원
    h.gold -= op.refund
  }
  h.shopChanged = h.shopStack.length > 0
  applyItems(h)
  return state
}

// ── 기본공격: 사거리 안 가장 가까운 적에게 자동 조준 ──
//  forceRef(봇 공성용 집중 표적): 사거리 안이고 칠 수 있으면 자동 표적보다 우선한다 —
//  병사 방패 뒤에서 평타가 곁의 병사으로 새지 않고 타워/수호석에 꽂히게.
export function castAttack(state, id, forceRef = null) {
  if (state.status !== 'playing') return state
  const h = getHero(state, id)
  if (!h || !canAct(h) || h.atkCd > 0 || h.castT > 0) return state
  let ref = findAttackTarget(state, h, heroRange(h))
  if (forceRef) {
    const t = targetEntity(state, forceRef)
    const vuln =
      forceRef.tk === 'tower' ? t && towerVulnerable(state, t)
      : forceRef.tk === 'nexus' ? nexusVulnerable(state, forceRef.id)
      : !!t
    const surf = forceRef.tk === 'tower' ? TOWER_RADIUS : forceRef.tk === 'nexus' ? NEXUS_RADIUS : 0
    if (t && vuln && dist(h, t) - surf <= heroRange(h)) ref = forceRef
  }
  // 도발: 사거리 안이면 무조건 나를 도발한 탱커만 평타친다
  if (h.tauntT > 0) {
    const tk = state.heroes.find((o) => o.id === h.tauntBy && o.team !== h.team && o.respawnT <= 0)
    if (tk && dist(h, tk) <= heroRange(h)) ref = { tk: 'hero', id: tk.id }
  }
  if (!ref) return state
  const tgt = targetEntity(state, ref)
  cancelRecall(h) // 공격하면 집중이 풀린다
  h.atkCd = CLASSES[h.cls].atkCd * (1 - itemBonus(h).atkSpeed)
  if (h.berserkT > 0) h.atkCd *= 1 - BERSERK_ASPD * berserkStrength(h) // 광폭화: 공격속도 ↑
  if (h.freezeT > 0) h.atkCd *= FREEZE_ATK // 빙결 중엔 평타도 굼뜨다
  if (h.bladeT > 0) h.atkCd *= 1 - BLADE_ASPD // 검성 무형검: 공격속도 ↑
  h.atkSeq++
  h.dir = Math.atan2(tgt.z - h.z, tgt.x - h.x)
  h.revealT = Math.max(h.revealT, REVEAL_TIME)
  h.slowT = Math.max(h.slowT, ATK_SLOW_T) // 쏘는 동안엔 발이 무겁다
  // 검성 무형검: 평타가 초승달 검기가 되어 직선의 적을 모두 벤다 (건물이 목표면 그대로 평타)
  if (h.cls === 'swordmaster' && h.bladeT > 0 && ref.tk !== 'tower' && ref.tk !== 'nexus') {
    state.projectiles.push({
      id: state.nextId++, kind: 'swordwave', team: h.team, owner: h.id,
      x: h.x, z: h.z, dir: h.dir, vx: Math.cos(h.dir) * SWORDWAVE_SPEED, vz: Math.sin(h.dir) * SWORDWAVE_SPEED,
      dmg: atkOf(h), travel: 0, hit: new Set(),
    })
    return state
  }
  state.projectiles.push({
    id: state.nextId++, kind: 'bolt', team: h.team, owner: h.id,
    x: h.x, z: h.z, target: ref, dmg: atkOf(h), speed: BOLT_SPEED,
  })
  return state
}

// ── 직업 스킬 ──
export function castSkill(state, id) {
  if (state.status !== 'playing') return state
  const h = getHero(state, id)
  if (!h || !canAct(h) || h.castT > 0) return state
  // 엔지니어 포탑: 쿨다운제가 아니라 재고제 — 재고가 있으면 쿨다운 중에도 즉시 설치한다.
  //  (skillCd는 "다음 재고가 차오르는" 시간 — stepHero가 다 돌면 재고를 1개 채우고 타이머를 다시 돌린다)
  if (h.cls === 'engineer') {
    if ((h.turretStock || 0) <= 0) return state
    SKILLS.engineer(state, h)
    cancelRecall(h)
    h.turretStock--
    h.revealT = Math.max(h.revealT, REVEAL_TIME)
    return state
  }
  if (h.skillCd > 0) return state
  const ok = SKILLS[h.cls](state, h)
  if (ok === false) return state // 대상이 없으면 쿨다운을 안 쓴다
  cancelRecall(h) // 스킬을 쓰면 집중이 풀린다
  h.skillCd = CLASSES[h.cls].skill.cd * (1 - itemBonus(h).cdr)
  h.revealT = Math.max(h.revealT, REVEAL_TIME)
  return state
}

const SKILLS = {
  // 전사 베며 돌진: 가까운 적 쪽으로 돌격하며 경로의 적을 베고(약하게),
  //  착지 지점 전방을 크게 후려 강타 + 짧은 기절
  warrior(state, h) {
    const foe = nearestFoeHero(state, h, DASH_AIM)
    const dir = foe ? Math.atan2(foe.z - h.z, foe.x - h.x) : h.dir
    const d = foe ? Math.min(DASH_DIST, Math.max(0, dist(h, foe) - 1.5)) : DASH_DIST
    const sx = h.x
    const sz = h.z
    h.dir = dir
    h.x += Math.cos(dir) * d
    h.z += Math.sin(dir) * d
    state.map.resolveTerrain(h, HERO_RADIUS, colliders(state))
    const dmg = skillDmg(h, 15, 0.4) // 공격력 계수 (전사) — 폭딜 억제(절반)
    lineDamage(state, h, sx, sz, dir, d + DASH_CONE, DASH_HALF, dmg * 0.6, 0) // 지나간 길의 적
    coneDamage(state, h, h.x, h.z, dir, DASH_CONE, 1.0, dmg, 1) // 착지 전방 강타 + 1초 기절
    pushFxDir(state, 'dash', sx, sz, d + DASH_CONE, dir, h.team)
  },
  // 궁수 꿰뚫는 화살: 자동 조준 방향으로 직선 화살 — 일직선의 적을 모두 관통
  archer(state, h) {
    let dir = h.dir
    const ref = findAttackTarget(state, h, VOLLEY_RANGE)
    if (ref) {
      const t = targetEntity(state, ref)
      dir = Math.atan2(t.z - h.z, t.x - h.x)
    } else {
      const foe = nearestFoeHero(state, h, VOLLEY_RANGE)
      if (!foe) return false // 겨눌 적이 없으면 쿨다운을 안 쓴다
      dir = Math.atan2(foe.z - h.z, foe.x - h.x)
    }
    h.dir = dir
    lineDamage(state, h, h.x, h.z, dir, VOLLEY_RANGE, VOLLEY_HALF, skillDmg(h, 0, 1.2), 0) // 공격력 계수 (궁수)
    // 시각: 앞으로 빠르게 날아가 사라지는 화살 3발(살짝 어긋나게)
    for (const off of [-0.55, 0, 0.55]) {
      state.projectiles.push({
        id: state.nextId++, kind: 'pierce', team: h.team, owner: h.id,
        x: h.x - Math.sin(dir) * off, z: h.z + Math.cos(dir) * off,
        vx: Math.cos(dir) * 46, vz: Math.sin(dir) * 46, travel: 0, max: VOLLEY_RANGE,
      })
    }
    pushFxDir(state, 'volley', h.x, h.z, VOLLEY_RANGE, dir, h.team)
  },
  // 마법사 화염구: 직선으로 날아가 크게 폭발 (적 영웅 자동 조준).
  //  순수 폭발 누커 — CC(빙결)는 없는 대신 폭발 피해가 크다. (빙결 정체성은 한빙술사 전용)
  mage(state, h) {
    let dir = h.dir
    const foe = nearestFoeHero(state, h, FIREBALL_RANGE)
    if (foe) dir = Math.atan2(foe.z - h.z, foe.x - h.x)
    h.dir = dir
    state.projectiles.push({
      id: state.nextId++, kind: 'fireball', team: h.team, owner: h.id,
      x: h.x, z: h.z, vx: Math.cos(dir) * FIREBALL_SPEED, vz: Math.sin(dir) * FIREBALL_SPEED,
      dmg: skillDmg(h, 75, 1.1), // 주문력 계수 (마법사) — 기본치가 로스터 대비 과했다(96→75, 밸런스 패스 1)
      travel: 0,
    })
  },
  // 힐러 치유: 가까운 아군 중 제일 아픈 친구(나 포함)를 회복
  healer(state, h) {
    let best = null
    let worst = -30 // 이만큼은 아파야 낭비가 아니다
    for (const a of state.heroes) {
      if (a.team !== h.team || a.respawnT > 0 || dist(h, a) > HEAL_RANGE) continue
      const missing = a.maxHp - a.hp
      if (missing > -worst && (!best || missing > best.maxHp - best.hp)) best = a
    }
    if (!best) return false
    healHero(best, healAmt(h, 100, 1.2)) // 주문력 계수 (힐러) — 안티힐 적용
    if (best !== h) best.supportedBy[h.id] = state.time // 서포트 어시스트 기록
    pushFx(state, 'heal', best.x, best.z, 3.5, h.team)
  },
  // 암살자 배후일섬: 보이는 적 영웅 등 뒤로 순간이동 + 일격
  assassin(state, h) {
    const foe = nearestFoeHero(state, h, BLINK_RANGE)
    if (!foe) return false
    const d = dist(h, foe) || 1
    h.x = foe.x + ((foe.x - h.x) / d) * 1.8 // 등 뒤로
    h.z = foe.z + ((foe.z - h.z) / d) * 1.8
    state.map.resolveTerrain(h, HERO_RADIUS, colliders(state))
    h.dir = Math.atan2(foe.z - h.z, foe.x - h.x)
    damageHero(state, foe, skillDmg(h, 30, 0.95), h) // 공격력 계수 (암살자)
    pushFx(state, 'blink', h.x, h.z, 3, h.team)
  },
  // 탱커 방패막기: 잠시 받는 피해 크게 감소
  tank(state, h) {
    h.shieldT = SHIELD_TIME
    pushFx(state, 'shield', h.x, h.z, 3, h.team)
  },
  // 한빙술사 서리파동: 앞으로 냉기를 부채꼴로 뿜어 맞은 적을 빙결(피해는 약하게)
  cryomancer(state, h) {
    let dir = h.dir
    const foe = nearestFoeHero(state, h, FROST_RANGE)
    if (foe) dir = Math.atan2(foe.z - h.z, foe.x - h.x)
    h.dir = dir
    const r2 = FROST_RANGE * FROST_RANGE
    let hitAny = false
    damageInShape(state, h, (e) => {
      const rx = e.x - h.x, rz = e.z - h.z
      const d2 = rx * rx + rz * rz
      if (d2 > r2) return false
      let inside = d2 < 1
      if (!inside) {
        let dd = Math.atan2(rz, rx) - dir
        while (dd > Math.PI) dd -= 2 * Math.PI
        while (dd < -Math.PI) dd += 2 * Math.PI
        inside = Math.abs(dd) <= FROST_HALF_ANGLE
      }
      if (inside) hitAny = true
      return inside
    }, skillDmg(h, 38, 0.5), 0, FROST_FREEZE) // 주문력 계수 (한빙술사)
    pushFxDir(state, 'frost', h.x, h.z, FROST_RANGE, dir, h.team)
    if (!hitAny) return false // 맞춘 적이 없으면 쿨다운을 안 쓴다
  },
  // 검투사 휘둘러베기: 주변을 넓게 베고 입힌 피해의 일부를 흡혈(영웅에게 크게, 잡몹엔 작게)
  gladiator(state, h) {
    const r2 = GLAD_SLASH_RADIUS * GLAD_SLASH_RADIUS
    const base = skillDmg(h, 42, 0.85) // 공격력 계수 (검투사)
    let heal = 0
    for (const e of state.heroes) {
      if (e.team === h.team || e.respawnT > 0) continue
      if ((e.x - h.x) ** 2 + (e.z - h.z) ** 2 > r2) continue
      damageHero(state, e, base, h)
      heal += base * GLAD_LIFESTEAL
    }
    for (const m of [...state.minions]) {
      if (m.team === h.team || (m.x - h.x) ** 2 + (m.z - h.z) ** 2 > r2) continue
      damageMinion(state, m, base, h)
      heal += base * GLAD_LIFESTEAL_MINION
    }
    for (const m of state.monsters) {
      if (!m.alive || (m.x - h.x) ** 2 + (m.z - h.z) ** 2 > r2) continue
      damageMonster(state, m, base, h)
      heal += base * GLAD_LIFESTEAL_MINION
    }
    if (heal > 0) healHero(h, Math.min(lifestealAmount(heal, state), h.maxHp * GLAD_LIFESTEAL_CAP)) // 흡혈(로그 감쇠 + 안티힐 적용)
    pushFx(state, 'whirl', h.x, h.z, GLAD_SLASH_RADIUS, h.team)
  },
  // 주술사 저주살: 가까운 적에게 즉시 약한 피해 + 지속피해(중독) 부여 (회복 감소 동반)
  warlock(state, h) {
    const foe = nearestFoeHero(state, h, CURSE_RANGE)
    if (!foe) return false
    h.dir = Math.atan2(foe.z - h.z, foe.x - h.x)
    damageHero(state, foe, skillDmg(h, 48, 0.55), h) // 주문력 계수 (주술사) — 즉시 피해(체감되게 상향)
    applyPoison(foe, h, skillDmg(h, 24, 0.4), 3.5) // 3.5초 강한 중독
    pushFxDir(state, 'curse', h.x, h.z, dist(h, foe), h.dir, h.team)
  },
  // 수호기사 수호의 빛: 가장 다친 아군(나 포함)에게 피해를 흡수하는 보호막
  guardian(state, h) {
    let best = null
    let worst = -1
    for (const a of state.heroes) {
      if (a.team !== h.team || a.respawnT > 0 || dist(h, a) > GUARD_RANGE) continue
      const missing = a.maxHp - a.hp
      if (missing > worst) { worst = missing; best = a }
    }
    if (!best) best = h
    best.barrierHp = Math.max(best.barrierHp, GUARD_SHIELD_BASE + GUARD_SHIELD_COEF * spellPower(h))
    best.barrierT = GUARD_SHIELD_T
    if (best !== h) best.supportedBy[h.id] = state.time // 서포트 어시스트 기록
    pushFx(state, 'shield', best.x, best.z, 3, h.team)
  },
  // 검성 발도 카운터: 잠깐 자세를 잡아 다음 피해 1회를 막고 강하게 반격(damageHero에서 발동)
  swordmaster(state, h) {
    h.parryT = PARRY_WINDOW
    pushFx(state, 'shield', h.x, h.z, 2.5, h.team)
  },
  // 사슬잡이 사슬갈고리: 짧은 발사 준비 후 직진하는 갈고리 투사체를 던진다.
  //  투사체가 적에 닿으면(stepProjectiles에서) 1초간 천천히 끌려오며 스턴.
  catcher(state, h) {
    const aim = nearestFoeHero(state, h, HOOK_RANGE)
    if (aim) h.dir = Math.atan2(aim.z - h.z, aim.x - h.x)
    h.hookWindT = HOOK_WINDUP // 발사 준비 모션 시작 → stepHero에서 끝나면 발사
    h.hookDir = h.dir
    pushFx(state, 'focus', h.x, h.z, 2.2, h.team) // 발 밑에 모이는 준비 이펙트
  },
  // 야수조련사 늑대 소환: 주인 주위에 늑대 두 마리(따라다니며 적을 문다)
  beastmaster(state, h) {
    for (let i = 0; i < BEAST_WOLVES; i++) {
      const a = h.dir + (i === 0 ? 0.6 : -0.6)
      spawnSummon(state, h, 'wolfpet', h.x + Math.cos(a) * 2.5, h.z + Math.sin(a) * 2.5)
    }
    pushFx(state, 'summon', h.x, h.z, 3, h.team)
  },
  // 엔지니어 미니포탑 설치: 발밑에 자동 사격 포탑(최대치 초과 시 가장 오래된 것 회수)
  engineer(state, h) {
    const turrets = state.summons.filter((s) => s.owner === h.id && s.kind === 'turret')
    if (turrets.length >= ENGI_MAX_TURRETS) {
      const oldest = turrets[0]
      state.summons = state.summons.filter((s) => s !== oldest)
    }
    spawnSummon(state, h, 'turret', h.x + Math.cos(h.dir) * 2, h.z + Math.sin(h.dir) * 2)
    pushFx(state, 'deploy', h.x, h.z, 2.5, h.team)
  },
  // 넝쿨사냥꾼 올가미: 발밑에서부터 앞으로 5단(파 파 파 파 팍)으로 솟아오르는 넝쿨 — 닿은 적을 속박 + 피해.
  //  투사체가 아니라 지면 존(stepZones에서 단마다 터진다). 폭은 좁게(캐릭터 1개분량).
  snarer(state, h) {
    const aim = nearestFoeHero(state, h, NET_RANGE)
    const dir = aim ? Math.atan2(aim.z - h.z, aim.x - h.x) : h.dir
    h.dir = dir
    const seg = NET_RANGE / NET_WAVES
    const dmg = skillDmg(h, 40, 0.6) // 공격력 계수
    for (let i = 0; i < NET_WAVES; i++) {
      state.zones.push({
        id: state.nextId++, kind: 'vine', team: h.team, owner: h.id,
        x: h.x + Math.cos(dir) * seg * i, z: h.z + Math.sin(dir) * seg * i,
        dir, len: seg, half: NET_HALF, dmg, root: NET_ROOT,
        r: seg, t: 0, delay: i * NET_WAVE_GAP,
      })
    }
    h.revealT = Math.max(h.revealT, REVEAL_TIME)
  },
  // 돌풍술사 돌풍: 시전자에게서 회오리 하나가 앞으로 1초에 걸쳐 굴러간다 — 닿은 적을 1.5초 공중에 띄운다 + 피해.
  //  (넉백/벽꽝은 밀쳐내기·태풍 담당) — 띄우기는 제자리 고정이라 아군 연계가 쉽다. 발사형 스킬샷(자동 조준).
  windcaller(state, h) {
    let dir = h.dir
    const foe = nearestFoeHero(state, h, GUST_RANGE)
    if (foe) dir = Math.atan2(foe.z - h.z, foe.x - h.x)
    h.dir = dir
    state.projectiles.push({
      id: state.nextId++, kind: 'tornado', team: h.team, owner: h.id,
      x: h.x, z: h.z, vx: Math.cos(dir) * GUST_SPEED, vz: Math.sin(dir) * GUST_SPEED,
      travel: 0, max: GUST_RANGE, r: GUST_TORNADO_R, dmg: skillDmg(h, 44, 0.7), // 주문력 계수
      hit: new Set(), // 같은 적을 두 번 띄우지 않게 (회오리가 통과하며 한 번씩)
    })
  },
  // 시간술사 시간 도약: 보이는 적 영웅 뒤로 순간이동해 강하게 벤다(교전 진입).
  chronomancer(state, h) {
    let foe = null
    let bd = TIMELEAP_RANGE * TIMELEAP_RANGE
    for (const e of state.heroes) {
      if (e.team === h.team || e.respawnT > 0 || !isHeroVisible(state, e, h.team)) continue
      const d = dist2(h, e)
      if (d < bd) { bd = d; foe = e }
    }
    if (!foe) return false
    const d = dist(h, foe) || 1
    h.x = foe.x + ((foe.x - h.x) / d) * 1.8 // 등 뒤로
    h.z = foe.z + ((foe.z - h.z) / d) * 1.8
    state.map.resolveTerrain(h, HERO_RADIUS, colliders(state))
    h.dir = Math.atan2(foe.z - h.z, foe.x - h.x)
    damageHero(state, foe, skillDmg(h, 40, 0.9), h) // 주문력 계수
    pushFx(state, 'timeleap', h.x, h.z, 3, h.team)
  },
  // 공포술사 공포의 시선: 전방 부채꼴의 적에게 피해 + 공포(통제 불능 — 랜덤 방향 질주)
  fearmonger(state, h) {
    const foe = nearestFoeHero(state, h, FEAR_RANGE)
    if (!foe) return false
    const dir = Math.atan2(foe.z - h.z, foe.x - h.x)
    h.dir = dir
    let hitAny = false
    for (const e of state.heroes) {
      if (e.team === h.team || e.respawnT > 0) continue
      if (dist(h, e) > FEAR_RANGE) continue
      let da = Math.atan2(e.z - h.z, e.x - h.x) - dir
      while (da > Math.PI) da -= 2 * Math.PI
      while (da < -Math.PI) da += 2 * Math.PI
      if (Math.abs(da) > FEAR_HALF_ANG) continue
      damageHero(state, e, skillDmg(h, 30, 0.55), h) // 주문력 계수
      applyFear(state, e, FEAR_T)
      hitAny = true
    }
    if (!hitAny) return false
    pushFxDir(state, 'dread', h.x, h.z, FEAR_RANGE, dir, h.team)
  },
  // 환영무희 환영 분신: 내 앞길을 대신 걷는 분신 + 본인 잠깐 은신
  illusionist(state, h) {
    spawnClone(state, h)
    h.stealthT = Math.max(h.stealthT, CLONE_STEALTH_T)
    pushFx(state, 'stealth', h.x, h.z, 2.5, h.team)
  },
  // 대지술사 돌팔매: 바라보는 방향으로 돌을 0.5초 간격 3연투 — 각도는 첫 발에 고정.
  //  실제 발사는 stepHero의 slingN 시퀀스가 처리한다(이동하며 던질 수 있지만 각도는 안 바뀐다).
  terramancer(state, h) {
    const foe = nearestFoeHero(state, h, SLING_RANGE)
    if (foe) h.dir = Math.atan2(foe.z - h.z, foe.x - h.x) // 조준 보조 — 이 순간의 각도로 3발 고정
    h.slingDir = h.dir
    h.slingN = SLING_COUNT
    h.slingT = 0 // 첫 발은 즉시
    h.slingDmg = Math.round(skillDmg(h, 30, 0.55)) // 발당 피해 — 시전 시점 스냅샷(주문력 계수)
  },
}

// ── 궁극기 (레벨 3부터) ──
export function castUlt(state, id) {
  if (state.status !== 'playing') return state
  const h = getHero(state, id)
  if (!h || !canAct(h) || h.ultCd > 0 || h.lvl < ULT_LEVEL || h.castT > 0) return state
  const ok = ULTS[h.cls](state, h)
  if (ok === false) return state
  cancelRecall(h) // 궁극기를 쓰면 집중이 풀린다
  h.ultCd = CLASSES[h.cls].ult.cd * (1 - itemBonus(h).cdr)
  if (h.resetUltCd) { h.ultCd = 0; h.resetUltCd = false } // 그림자처형 처치 → 처형 쿨 초기화
  h.revealT = Math.max(h.revealT, REVEAL_TIME)
  return state
}

const ULTS = {
  // 회전베기: 2초간 팽이처럼 돌며(이동 가능) 반경 안 모든 적을 반복해서 후린다.
  //  실제 피해/회전 시각은 stepHero의 회전 처리에서 매 틱(WHIRL_TICK 간격) 일어난다.
  warrior(state, h) {
    h.whirlT = WHIRL_TIME
    h.whirlTickT = 0 // 시전 즉시 첫 타가 나가게
  },
  // 빛의 화살: 1초 정신집중(제자리) 후, 겨눈 방향으로 화면 끝까지 관통하는 넓은 빛줄기.
  //  여기선 조준만 하고 집중에 들어간다 — 실제 발사는 stepHero에서 집중이 끝날 때 fireLightArrow로.
  archer(state, h) {
    let dir = h.dir
    const foe = nearestFoeHero(state, h, LIGHTARROW_LEN)
    const ref = foe ? null : findAttackTarget(state, h, LIGHTARROW_LEN)
    if (foe) dir = Math.atan2(foe.z - h.z, foe.x - h.x)
    else if (ref) {
      const t = targetEntity(state, ref)
      if (t) dir = Math.atan2(t.z - h.z, t.x - h.x)
    }
    h.dir = dir
    h.castDir = dir // 발사 방향을 시전 시점에 고정
    h.castT = ARCHER_CHANNEL
    pushFx(state, 'focus', h.x, h.z, 2.5, h.team) // 발밑에 집중 고리
  },
  // 운석: 가까운 적 영웅(없으면 바라보는 앞) 자리에 조준점 → 0.5초 뒤부터 운석 3발이 차례로 낙하.
  //  첫 발은 조준 지점, 2·3번째는 살짝 흩뿌려 넓게 덮는다 (도망쳐도 따라붙게).
  mage(state, h) {
    const foe = nearestFoeHero(state, h, METEOR_RANGE)
    const tx = foe ? foe.x : h.x + Math.cos(h.dir) * METEOR_AIM
    const tz = foe ? foe.z : h.z + Math.sin(h.dir) * METEOR_AIM
    const W = state.map.WORLD
    const dmg = skillDmg(h, 60, 0.9) // 주문력 계수 (마법사) — 발당 피해(3발 합산 기준)
    for (let i = 0; i < METEOR_COUNT; i++) {
      const ox = i === 0 ? 0 : (state.rng() - 0.5) * 2 * METEOR_SPREAD
      const oz = i === 0 ? 0 : (state.rng() - 0.5) * 2 * METEOR_SPREAD
      state.zones.push({
        id: state.nextId++, kind: 'meteor', team: h.team, owner: h.id,
        x: Math.max(W.minX, Math.min(W.maxX, tx + ox)),
        z: Math.max(W.minZ, Math.min(W.maxZ, tz + oz)),
        r: METEOR_RADIUS, t: 0, delay: METEOR_DELAY + i * METEOR_GAP, dmg,
      })
    }
  },
  // 성역: 하늘에서 성스러운 빛이 내려와 아군 전원(거리 무관)을 크게 회복 + 기절/빙결 해제
  healer(state, h) {
    const heal = healAmt(h, 220, 1.3) // 주문력 계수 (힐러)
    for (const a of state.heroes) {
      if (a.team !== h.team || a.respawnT > 0) continue
      healHero(a, heal) // 안티힐 적용
      if (a !== h) a.supportedBy[h.id] = state.time // 서포트 어시스트 기록
      a.stunT = 0
      a.freezeT = 0
      pushFx(state, 'holylight', a.x, a.z, 4, h.team) // 각자 머리 위로 내리쬐는 성광
    }
  },
  // 그림자처형: 가까운 적 영웅 일격 — 빈사(35% 미만)면 2배, 이 처형으로 처치하면 처형 쿨 초기화
  assassin(state, h) {
    const foe = nearestFoeHero(state, h, EXECUTE_RANGE)
    if (!foe) return false
    let dmg = skillDmg(h, 60, 1.7) // 공격력 계수 (암살자)
    if (foe.hp < foe.maxHp * 0.35) dmg *= 2
    pushFx(state, 'shadowexec', foe.x, foe.z, 3, h.team, 1.0) // 붉은 참격 + 해골 팍!
    damageHero(state, foe, dmg, h)
    if (foe.respawnT > 0) h.resetUltCd = true // 처형 성공 → 처형 쿨 초기화 (castUlt에서 적용)
  },
  // 대지균열: 앞으로 땅을 3파(파파팍)로 끊어 갈라 나가며, 닿는 적을 길게 기절.
  //  각 파는 앞쪽 구간을 차례로 덮어 균열이 적진을 향해 달려간다(한 적은 한 파에 맞는다).
  tank(state, h) {
    const foe = nearestFoeHero(state, h, FISSURE_LEN)
    const dir = foe ? Math.atan2(foe.z - h.z, foe.x - h.x) : h.dir
    h.dir = dir
    const seg = FISSURE_LEN / FISSURE_WAVES
    const dmg = skillDmg(h, 50, 1.4) // 공격력 계수 (탱커)
    for (let i = 0; i < FISSURE_WAVES; i++) {
      state.zones.push({
        id: state.nextId++, kind: 'fissure', team: h.team, owner: h.id,
        x: h.x + Math.cos(dir) * seg * i, z: h.z + Math.sin(dir) * seg * i,
        dir, len: seg, half: FISSURE_HALF, dmg, stun: 1.6,
        r: seg, t: 0, delay: i * FISSURE_WAVE_GAP,
      })
    }
  },
  // 한빙술사 절대영도: 가까운 적(없으면 앞)을 중심으로 넓게 얼려 적 전원을 길게 빙결 + 피해
  cryomancer(state, h) {
    const foe = nearestFoeHero(state, h, METEOR_RANGE)
    const tx = foe ? foe.x : h.x + Math.cos(h.dir) * ABSZERO_AIM
    const tz = foe ? foe.z : h.z + Math.sin(h.dir) * ABSZERO_AIM
    aoeDamage(state, h, tx, tz, ABSZERO_RADIUS, skillDmg(h, 80, 0.8), 0, ABSZERO_FREEZE) // 주문력 계수
    pushFx(state, 'abszero', tx, tz, ABSZERO_RADIUS, h.team)
  },
  // 검투사 검투의 분노: 수 초간 흡혈(휘둘러베기 강화 유지) + 이속 ↑ + 받는 CC 감소 + 지속 회복
  gladiator(state, h) {
    h.rageT = RAGE_TIME
    pushFx(state, 'berserk', h.x, h.z, 3.5, h.team)
  },
  // 주술사 파멸의 낙인: 넓은 범위 적 전원에 강한 중독 + 받는 피해 증가(낙인)
  warlock(state, h) {
    const foe = nearestFoeHero(state, h, DOOM_RANGE)
    const tx = foe ? foe.x : h.x + Math.cos(h.dir) * 14
    const tz = foe ? foe.z : h.z + Math.sin(h.dir) * 14
    const r2 = DOOM_RADIUS * DOOM_RADIUS
    let hitAny = false
    for (const e of state.heroes) {
      if (e.team === h.team || e.respawnT > 0) continue
      if ((e.x - tx) ** 2 + (e.z - tz) ** 2 > r2) continue
      damageHero(state, e, skillDmg(h, 50, 0.5), h)
      applyPoison(e, h, skillDmg(h, 16, 0.3), DOOM_POISON_T)
      e.vulnT = Math.max(e.vulnT, DOOM_VULN_T)
      hitAny = true
    }
    pushFx(state, 'doom', tx, tz, DOOM_RADIUS, h.team)
    if (!hitAny) return false
  },
  // 수호기사 불굴의 진형: 아군 전원에게 보호막 + 잠깐의 받는 피해 감소
  guardian(state, h) {
    const amt = BASTION_BARRIER_BASE + BASTION_BARRIER_COEF * spellPower(h)
    for (const a of state.heroes) {
      if (a.team !== h.team || a.respawnT > 0) continue
      a.barrierHp = Math.max(a.barrierHp, amt)
      a.barrierT = GUARD_SHIELD_T
      a.wardT = Math.max(a.wardT, BASTION_WARD_T)
      if (a !== h) a.supportedBy[h.id] = state.time // 서포트 어시스트 기록
      pushFx(state, 'holylight', a.x, a.z, 3.5, h.team)
    }
  },
  // 검성 무형검: 수 초간 사거리·공격속도가 크게 올라 평타로 몰아친다(heroRange/castAttack에 반영)
  swordmaster(state, h) {
    h.bladeT = BLADE_TIME
    pushFx(state, 'berserk', h.x, h.z, 3, h.team)
  },
  // 사슬잡이 단죄: 주변 적을 강하게 내리쳐 큰 피해 + 속박 연장
  catcher(state, h) {
    const r2 = GUILLOTINE_RADIUS * GUILLOTINE_RADIUS
    let hitAny = false
    for (const e of state.heroes) {
      if (e.team === h.team || e.respawnT > 0 || dist2(h, e) > r2) continue
      damageHero(state, e, skillDmg(h, 90, 1.0), h)
      e.rootT = Math.max(e.rootT, GUILLOTINE_ROOT)
      hitAny = true
    }
    pushFx(state, 'meteorhit', h.x, h.z, GUILLOTINE_RADIUS, h.team)
    if (!hitAny) return false
  },
  // 야수조련사 곰 소환: 거대한 곰 한 마리(단단하고 강한 일격)
  beastmaster(state, h) {
    spawnSummon(state, h, 'bear', h.x + Math.cos(h.dir) * 3, h.z + Math.sin(h.dir) * 3)
    pushFx(state, 'summon', h.x, h.z, 4, h.team)
  },
  // 엔지니어 거포 설치: 강력한 장거리 거포
  engineer(state, h) {
    spawnSummon(state, h, 'cannon', h.x + Math.cos(h.dir) * 2.5, h.z + Math.sin(h.dir) * 2.5)
    pushFx(state, 'meteorhit', h.x, h.z, 4, h.team)
  },
  // 넝쿨사냥꾼 포획망: 가까운 적(없으면 앞)을 중심으로 넓은 넝쿨 그물 — 범위 안 적 전원 길게 속박 + 피해
  snarer(state, h) {
    const foe = nearestFoeHero(state, h, SNARE_RANGE)
    const tx = foe ? foe.x : h.x + Math.cos(h.dir) * SNARE_AIM
    const tz = foe ? foe.z : h.z + Math.sin(h.dir) * SNARE_AIM
    const r2 = SNARE_RADIUS * SNARE_RADIUS
    let hitAny = false
    for (const e of state.heroes) {
      if (e.team === h.team || e.respawnT > 0 || (e.x - tx) ** 2 + (e.z - tz) ** 2 > r2) continue
      damageHero(state, e, skillDmg(h, 70, 0.8), h) // 공격력 계수
      const cc = e.rageT > 0 ? RAGE_CC_CUT : 1 // 검투의 분노: 받는 CC 감소
      e.rootT = Math.max(e.rootT, SNARE_ROOT * cc)
      hitAny = true
    }
    pushFx(state, 'snare', tx, tz, SNARE_RADIUS, h.team)
    if (!hitAny) return false
  },
  // 돌풍술사 태풍: 겨눈 자리에 거대한 태풍 — 범위 안 적 전원을 중심에서 바깥으로 크게 날리고 피해 + 둔화.
  windcaller(state, h) {
    const foe = nearestFoeHero(state, h, TYPHOON_RANGE)
    const tx = foe ? foe.x : h.x + Math.cos(h.dir) * TYPHOON_AIM
    const tz = foe ? foe.z : h.z + Math.sin(h.dir) * TYPHOON_AIM
    const r2 = TYPHOON_RADIUS * TYPHOON_RADIUS
    let hitAny = false
    for (const e of state.heroes) {
      if (e.team === h.team || e.respawnT > 0 || (e.x - tx) ** 2 + (e.z - tz) ** 2 > r2) continue
      damageHero(state, e, skillDmg(h, 70, 0.8), h) // 주문력 계수
      e.freezeT = Math.max(e.freezeT, TYPHOON_SLOW) // 휩쓸린 뒤 잠깐 둔화
      applyKnockback(state, e, tx, tz, TYPHOON_KB, KNOCK_WALL_STUN) // 태풍 중심에서 바깥으로 날림
      hitAny = true
    }
    pushFx(state, 'typhoon', tx, tz, TYPHOON_RADIUS, h.team)
    pushFx(state, 'tornado', tx, tz, TYPHOON_RADIUS, h.team, 1.0) // 맵에 1초간 거대한 회오리가 선다
    if (!hitAny) return false
  },
  // 시간술사 역행: 4초 전 위치로 되돌아가며 도착 지점 주변에 충격파 피해.
  //  체력은 최대치의 80%까지 회복(현재가 더 높으면 유지) — 과거 표본 복원은 "이미 4초 전에도 빈사"면
  //  헛발이 되는 문제가 있어 고정 비율 회복으로 바꿨다(밸런스 패스 1).
  chronomancer(state, h) {
    const past = trailSampleBack(h, REWIND_BACK)
    const sx = h.x, sz = h.z
    h.x = past.x
    h.z = past.z
    state.map.resolveTerrain(h, HERO_RADIUS, colliders(state))
    h.hp = Math.max(h.hp, Math.round(h.maxHp * REWIND_HEAL))
    aoeDamage(state, h, h.x, h.z, REWIND_RADIUS, skillDmg(h, 60, 0.9), 0) // 도착 충격파
    pushFx(state, 'rewind', sx, sz, 3, h.team)
    pushFx(state, 'rewind', h.x, h.z, REWIND_RADIUS, h.team)
    h.revealT = Math.max(h.revealT, REVEAL_TIME)
  },
  // 공포술사 단말마(리메이크): 보이는 적에게 순간이동해 비명을 터뜨린다 — 주변 모든 적 공포 + 도트.
  //  멀리서 공포를 걸면 적이 흩어져 아군 딜로스가 되던 안티시너지를, "적진 한복판에서
  //  기어나가는 적을 팀이 붙잡는" 이니시로 뒤집는다.
  fearmonger(state, h) {
    let foe = null
    let bd = SHRIEK_TELE_RANGE * SHRIEK_TELE_RANGE
    for (const e of state.heroes) {
      if (e.team === h.team || e.respawnT > 0 || !isHeroVisible(state, e, h.team)) continue
      const d = dist2(h, e)
      if (d < bd) { bd = d; foe = e }
    }
    if (!foe) return false // 노릴 적이 없으면 쿨 환불
    const sx = h.x, sz = h.z
    h.x = foe.x
    h.z = foe.z
    state.map.resolveTerrain(h, HERO_RADIUS, colliders(state))
    h.bushI = state.map.bushIndexAt(h.x, h.z)
    pushFx(state, 'blink', sx, sz, 3, h.team)
    const r2 = SHRIEK_RADIUS * SHRIEK_RADIUS
    for (const e of state.heroes) {
      if (e.team === h.team || e.respawnT > 0 || dist2(h, e) > r2) continue
      damageHero(state, e, skillDmg(h, 40, 0.6), h) // 주문력 계수
      applyFear(state, e, SHRIEK_FEAR_T)
      applyPoison(e, h, skillDmg(h, 10, 0.18), 2) // 정신없이 내닫는 동안 어둠 도트
    }
    pushFx(state, 'shriek', h.x, h.z, SHRIEK_RADIUS, h.team)
    h.revealT = Math.max(h.revealT, REVEAL_TIME)
  },
  // 환영무희 환영난무: 연막이 펑! 터지며 세 몸(본체+전투형 분신 둘)이 사방으로 튀어나온다.
  //  분신은 봇처럼 추격·평타(본체 공격력 80%), 본체는 은신 + 주변 참격.
  illusionist(state, h) {
    const sx = h.x
    const sz = h.z
    aoeDamage(state, h, sx, sz, 6, skillDmg(h, 40, 0.75), 0) // 공격력 계수
    pushFx(state, 'poof', sx, sz, 4.5, h.team) // 연막 펑!
    spawnClone(state, h, h.dir - 0.9, true, DANCE_BURST_DIST)
    spawnClone(state, h, h.dir + 0.9, true, DANCE_BURST_DIST)
    // 본체도 정면으로 튀어나온다 — 셋이 동시에 연막을 찢고 나오는 그림
    h.x = sx + Math.cos(h.dir) * DANCE_BURST_DIST
    h.z = sz + Math.sin(h.dir) * DANCE_BURST_DIST
    state.map.resolveTerrain(h, HERO_RADIUS, colliders(state))
    h.bushI = state.map.bushIndexAt(h.x, h.z)
    h.stealthT = Math.max(h.stealthT, DANCE_STEALTH_T)
  },
  // 대지술사 바위감옥: 보이는 가장 가까운 적 하나를 원형 돌벽으로 가둔다 (강제 1:1)
  terramancer(state, h) {
    let foe = null
    let bd = CAGE_RANGE * CAGE_RANGE
    for (const e of state.heroes) {
      if (e.team === h.team || e.respawnT > 0 || !isHeroVisible(state, e, h.team)) continue
      const d = dist2(h, e)
      if (d < bd) { bd = d; foe = e }
    }
    if (!foe) return false
    const n = 8
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2
      state.tempWalls.push({
        id: state.nextId++, x: foe.x + Math.cos(a) * CAGE_RADIUS, z: foe.z + Math.sin(a) * CAGE_RADIUS,
        alive: true, t: 0, life: CAGE_LIFE,
      })
    }
    damageHero(state, foe, skillDmg(h, 35, 0.5), h)
    pushFx(state, 'cage', foe.x, foe.z, CAGE_RADIUS, h.team)
  },
}

// 사슬갈고리 발사: 발사 준비(hookWindT)가 끝났을 때 호출 — 고정 방향(hookDir)으로 직진 투사체.
function fireHook(state, h) {
  const dir = h.hookDir
  h.dir = dir
  state.projectiles.push({
    id: state.nextId++, kind: 'hook', team: h.team, owner: h.id,
    x: h.x, z: h.z, vx: Math.cos(dir) * HOOK_SPEED, vz: Math.sin(dir) * HOOK_SPEED,
    travel: 0, max: HOOK_RANGE,
  })
  pushFxDir(state, 'dash', h.x, h.z, 4, dir, h.team)
  h.revealT = Math.max(h.revealT, REVEAL_TIME)
}

// 빛의 화살 발사: 정신집중이 끝났을 때 호출 — 고정해 둔 방향(castDir)으로 관통 빛줄기.
function fireLightArrow(state, h) {
  const dir = h.castDir
  h.dir = dir
  lineDamage(state, h, h.x, h.z, dir, LIGHTARROW_LEN, LIGHTARROW_HALF, skillDmg(h, 90, 1.5), 0) // 공격력 계수 (궁수)
  pushFxDir(state, 'lightarrow', h.x, h.z, LIGHTARROW_LEN, dir, h.team)
  for (const off of [-LIGHTARROW_HALF * 0.7, 0, LIGHTARROW_HALF * 0.7]) {
    state.projectiles.push({
      id: state.nextId++, kind: 'lightarrow', team: h.team, owner: h.id,
      x: h.x - Math.sin(dir) * off, z: h.z + Math.cos(dir) * off,
      vx: Math.cos(dir) * 90, vz: Math.sin(dir) * 90, travel: 0, max: LIGHTARROW_LEN,
    })
  }
  h.revealT = Math.max(h.revealT, REVEAL_TIME)
}

// ── 보조 스킬 (레벨 3부터) — 마법사를 뺀 5직업이 직업색에 맞는 한 가지씩 ──
export function castSkill2(state, id) {
  if (state.status !== 'playing') return state
  const h = getHero(state, id)
  if (!h || h.respawnT > 0 || h.skill2Cd > 0 || h.lvl < SKILL2_LEVEL || h.castT > 0) return state
  // 광폭화는 상태이상을 떨쳐내는 용도라 기절/빙결/공포 중에도 쓸 수 있다(자가 해제).
  // 그 밖의 보조 스킬은 행동 가능할 때만.
  if ((h.stunT > 0 || h.fearT > 0) && h.cls !== 'warrior') return state
  const fn = SKILLS2[h.cls]
  if (!fn) return state // 마법사 등 보조 스킬이 없는 직업
  const ok = fn(state, h)
  if (ok === false) return state // 효과 대상이 없으면 쿨다운을 안 쓴다
  cancelRecall(h)
  h.skill2Cd = CLASSES[h.cls].skill2.cd * (1 - itemBonus(h).cdr)
  return state
}

const SKILLS2 = {
  // 광폭화: 즉시 폭주 — 상태이상 해제 + 풀 폭주(BERSERK_FULL) 동안만 상태이상 면역(stepHero에서 유지),
  //  이동/공격 가속은 BERSERK_TIME 내내(페이드 구간은 서서히 감소)
  warrior(state, h) {
    h.berserkT = BERSERK_TIME
    h.stunT = 0
    h.freezeT = 0
    h.fearT = 0 // 공포도 떨쳐낸다
    h.revealT = Math.max(h.revealT, REVEAL_TIME)
    pushFx(state, 'berserk', h.x, h.z, 3.5, h.team)
  },
  // 사냥매: 바라보는 방향으로 매를 날린다 — 지나간 길에 시야 흔적(reveals)을 떨궈 안개를 잠시 걷는다
  archer(state, h) {
    const dir = h.dir
    state.hawks.push({
      id: state.nextId++, team: h.team, owner: h.id,
      x: h.x, z: h.z, vx: Math.cos(dir) * HAWK_SPEED, vz: Math.sin(dir) * HAWK_SPEED,
      travel: 0, max: HAWK_LEN, dropAt: 0,
    })
    h.revealT = Math.max(h.revealT, REVEAL_TIME)
    pushFx(state, 'hawk', h.x, h.z, 2.5, h.team)
  },
  // 도발: 주변 적 영웅이 2초간 나(탱커)만 노려 평타치게 만든다
  tank(state, h) {
    const r2 = TAUNT_RADIUS * TAUNT_RADIUS
    for (const e of state.heroes) {
      if (e.team === h.team || e.respawnT > 0) continue
      if (dist2(h, e) > r2) continue
      e.tauntT = TAUNT_TIME
      e.tauntBy = h.id
    }
    h.revealT = Math.max(h.revealT, REVEAL_TIME)
    pushFx(state, 'taunt', h.x, h.z, TAUNT_RADIUS, h.team) // 1초간 퍼지는 동심원
  },
  // 가속: 주변 아군 챔피언(나 포함)을 잠시 빠르게
  healer(state, h) {
    let n = 0
    const r2 = HASTE_RADIUS * HASTE_RADIUS
    for (const a of state.heroes) {
      if (a.team !== h.team || a.respawnT > 0 || dist2(h, a) > r2) continue
      a.hasteT = Math.max(a.hasteT, HASTE_TIME)
      pushFx(state, 'haste', a.x, a.z, 2.5, h.team)
      n++
    }
    if (n === 0) return false
  },
  // 은신: 1.5초간 모습을 감춘다(적에겐 안 보이고 아군에겐 반투명). 평타/스킬을 쓰면 드러난다.
  assassin(state, h) {
    h.stealthT = STEALTH_TIME
    h.revealT = 0 // 직전 행동으로 드러난 상태를 지우고 즉시 은신
    pushFx(state, 'stealth', h.x, h.z, 3, h.team)
  },
  // 체인 라이트닝: 가까운 적에게 번개 → 매번 가장 가까운 다른 적으로 점프(최대 CHAIN_HITS회).
  //  같은 표적은 두 번 안 맞고, 점프마다 피해가 줄어든다. 보이는 적만 노린다.
  mage(state, h) {
    const hit = { hero: new Set(), minion: new Set(), monster: new Set() }
    // 한 점(from)에서 가장 가까운 '아직 안 맞은' 적 유닛을 찾는다
    const nearestFoeUnit = (from, range) => {
      let best = null
      let bd = range * range
      for (const e of state.heroes) {
        if (e.team === h.team || e.respawnT > 0 || hit.hero.has(e.id)) continue
        if (!isHeroVisible(state, e, h.team)) continue
        const d = dist2(from, e)
        if (d < bd) { bd = d; best = { e, kind: 'hero' } }
      }
      for (const m of state.minions) {
        if (m.team === h.team || hit.minion.has(m.id)) continue
        const d = dist2(from, m)
        if (d < bd) { bd = d; best = { e: m, kind: 'minion' } }
      }
      for (const m of state.monsters) {
        if (!m.alive || hit.monster.has(m.id)) continue
        const d = dist2(from, m)
        if (d < bd) { bd = d; best = { e: m, kind: 'monster' } }
      }
      return best
    }
    let from = { x: h.x, z: h.z }
    let dmg = skillDmg(h, 28, 0.42) // 주문력 계수 (마법사) — 단일 피해 대폭↓, 대신 5연쇄
    let chained = false
    for (let i = 0; i < CHAIN_HITS; i++) {
      const found = nearestFoeUnit(from, i === 0 ? CHAIN_RANGE : CHAIN_JUMP)
      if (!found) break
      const { e, kind } = found
      if (i === 0) h.dir = Math.atan2(e.z - h.z, e.x - h.x)
      // 직전 지점 → 표적으로 번개 줄기(지그재그 누적)
      pushFxDir(state, 'chain', from.x, from.z, dist(from, e), Math.atan2(e.z - from.z, e.x - from.x), h.team)
      if (kind === 'hero') { hit.hero.add(e.id); damageHero(state, e, dmg, h) }
      else if (kind === 'minion') { hit.minion.add(e.id); damageMinion(state, e, dmg, h) }
      else { hit.monster.add(e.id); damageMonster(state, e, dmg, h) }
      from = { x: e.x, z: e.z }
      dmg *= CHAIN_FALLOFF
      chained = true
    }
    if (!chained) return false // 맞출 적이 없으면 쿨다운을 안 쓴다
  },
  // 한빙술사 서리고리: 내 주변에 얼음가시 — 가까운 적을 빙결시켜 떼어낸다(피일/탈출)
  cryomancer(state, h) {
    aoeDamage(state, h, h.x, h.z, FROSTNOVA_RADIUS, skillDmg(h, 26, 0.35), 0, FROSTNOVA_FREEZE)
    pushFx(state, 'frostnova', h.x, h.z, FROSTNOVA_RADIUS, h.team)
  },
  // 검투사 도약강타: 가까운 적에게 도약해 착지 전방을 강타(교전 합류/갭클로즈, CC 없음)
  gladiator(state, h) {
    const foe = nearestFoeHero(state, h, GLAD_LEAP_AIM)
    const dir = foe ? Math.atan2(foe.z - h.z, foe.x - h.x) : h.dir
    const d = foe ? Math.min(GLAD_LEAP_DIST, Math.max(0, dist(h, foe) - 1.5)) : GLAD_LEAP_DIST
    const sx = h.x, sz = h.z
    h.dir = dir
    h.x += Math.cos(dir) * d
    h.z += Math.sin(dir) * d
    state.map.resolveTerrain(h, HERO_RADIUS, colliders(state))
    coneDamage(state, h, h.x, h.z, dir, GLAD_LEAP_CONE, 1.0, skillDmg(h, 25, 0.5), 0)
    pushFxDir(state, 'dash', sx, sz, d + GLAD_LEAP_CONE, dir, h.team)
  },
  // 주술사 역병안개: 지정 지역에 독안개 장판 — 머무는 적을 PLAGUE_LIFE초 동안 계속 중독시킨다
  warlock(state, h) {
    const foe = nearestFoeHero(state, h, PLAGUE_RANGE)
    const tx = foe ? foe.x : h.x + Math.cos(h.dir) * 8
    const tz = foe ? foe.z : h.z + Math.sin(h.dir) * 8
    state.zones.push({
      id: state.nextId++, kind: 'plague', team: h.team, owner: h.id,
      x: tx, z: tz, r: PLAGUE_RADIUS, t: 0, delay: 0, life: PLAGUE_LIFE, tickT: 0,
      poisonDps: skillDmg(h, 12, 0.2),
    })
    pushFx(state, 'plague', tx, tz, PLAGUE_RADIUS, h.team)
  },
  // 수호기사 결속: 근처 아군을 4초간 묶는다. 묶인 아군이 받을 피해를 수호기사가 대신 받는다(damageHero에서 리다이렉트).
  guardian(state, h) {
    const r2 = BIND_RADIUS * BIND_RADIUS
    let count = 0
    for (const a of state.heroes) {
      if (a === h || a.team !== h.team || a.respawnT > 0 || dist2(h, a) > r2) continue
      a.bindT = BIND_TIME
      a.bindBy = h.id
      a.supportedBy[h.id] = state.time // 서포트 어시스트 기록(결속도 보호)
      count++
      pushFx(state, 'shield', a.x, a.z, 2, h.team)
    }
    h.bindAnchorT = count > 0 ? BIND_TIME : 0
    if (count > 0) pushFx(state, 'holylight', h.x, h.z, 2.5, h.team)
  },
  // 검성 잔영 스텝: 바라보는 방향으로 짧게 순간이동(리포지션, 피해 없음)
  swordmaster(state, h) {
    const dir = h.dir
    const sx = h.x, sz = h.z
    h.x += Math.cos(dir) * STEP_DIST
    h.z += Math.sin(dir) * STEP_DIST
    state.map.resolveTerrain(h, HERO_RADIUS, colliders(state))
    pushFxDir(state, 'dash', sx, sz, STEP_DIST, dir, h.team)
  },
  // 사슬잡이 옭아매기: 주변 적을 사슬로 묶어 잠시 이동 불가 + 피해
  catcher(state, h) {
    const r2 = ENSNARE_RADIUS * ENSNARE_RADIUS
    let hitAny = false
    for (const e of state.heroes) {
      if (e.team === h.team || e.respawnT > 0 || dist2(h, e) > r2) continue
      e.rootT = Math.max(e.rootT, ENSNARE_ROOT)
      damageHero(state, e, skillDmg(h, 25, 0.4), h)
      hitAny = true
    }
    pushFx(state, 'taunt', h.x, h.z, ENSNARE_RADIUS, h.team)
    if (!hitAny) return false
  },
  // 야수조련사 사냥 명령: 내 펫을 광폭화(공속↑) + 수명 약간 연장 + 가장 가까운 적에게 달려들게(거리 무시·도약)
  beastmaster(state, h) {
    let n = 0
    for (const s of state.summons) {
      if (s.owner !== h.id) continue
      s.chargeT = OVERCHARGE_T
      s.life += 2
      // 인지(aggro) 범위 안에 적이 있으면 거리를 무시하고 그 적에게 즉시 도약(점프 모션)
      const found = nearestLeapTarget(state, s, s.aggro)
      if (found) {
        const t = found.target
        s.dir = Math.atan2(t.z - s.z, t.x - s.x)
        s.leapFrom = { x: s.x, z: s.z }
        s.leapTo = { x: t.x, z: t.z } // 표적 위치로 착지(매 틱 추적해 갱신)
        s.leapTargetId = t.id
        s.leapTk = found.tk
        s.leapT = BEAST_LEAP_DUR
        s.leapDur = BEAST_LEAP_DUR
        pushFx(state, 'haste', s.x, s.z, 2, s.team) // 도약 시작 자리에 잔상
      }
      n++
    }
    pushFx(state, 'haste', h.x, h.z, 3, h.team)
    if (n === 0) return false // 부릴 펫이 없으면 쿨다운을 안 쓴다
  },
  // 엔지니어 과부하: 내 포탑들의 공격속도를 잠시 크게 올린다
  engineer(state, h) {
    let n = 0
    for (const s of state.summons) {
      if (s.owner !== h.id) continue
      s.chargeT = OVERCHARGE_T
      n++
    }
    pushFx(state, 'haste', h.x, h.z, 3, h.team)
    if (n === 0) return false
  },
  // 넝쿨사냥꾼 덩굴 합류: 교전 중인 아군(곁에 적이 있는 아군)에게, 없으면 가장 가까운 아군에게 순간이동.
  snarer(state, h) {
    let best = null
    let score = Infinity
    for (const a of state.heroes) {
      if (a.team !== h.team || a === h || a.respawnT > 0) continue
      if (dist2(h, a) > VINE_TELE_RANGE * VINE_TELE_RANGE) continue
      // 곁에 적이 가까운 아군일수록 우선(교전 합류). 적이 아예 없으면 거리순으로 폴백.
      let foeD = Infinity
      for (const e of state.heroes) {
        if (e.team === h.team || e.respawnT > 0) continue
        foeD = Math.min(foeD, dist2(a, e))
      }
      const s = foeD === Infinity ? dist2(h, a) + 1e6 : foeD
      if (s < score) { score = s; best = a }
    }
    if (!best) return false // 합류할 아군이 없으면 쿨다운을 안 쓴다
    const sx = h.x, sz = h.z
    h.x = best.x + Math.cos(h.dir) * 0.6 // 살짝 옆으로 떨궈 겹침 방지
    h.z = best.z + Math.sin(h.dir) * 0.6
    state.map.resolveTerrain(h, HERO_RADIUS, colliders(state))
    pushFx(state, 'blink', sx, sz, 2.5, h.team)
    pushFx(state, 'blink', h.x, h.z, 2.5, h.team)
    h.revealT = Math.max(h.revealT, REVEAL_TIME)
  },
  // 돌풍술사 밀쳐내기: 주변 적을 자기 중심에서 사방으로 밀어낸다(피일/이탈) + 약간의 피해.
  windcaller(state, h) {
    const r2 = REPULSE_RADIUS * REPULSE_RADIUS
    let hitAny = false
    for (const e of state.heroes) {
      if (e.team === h.team || e.respawnT > 0 || dist2(h, e) > r2) continue
      damageHero(state, e, skillDmg(h, 26, 0.4), h) // 주문력 계수
      applyKnockback(state, e, h.x, h.z, REPULSE_KB, KNOCK_WALL_STUN)
      hitAny = true
    }
    pushFx(state, 'repulse', h.x, h.z, REPULSE_RADIUS, h.team)
    if (!hitAny) return false
  },
  // 시간술사 시간 지연: 겨눈 자리에 시간이 느려지는 장판 — 머무는 적의 이동·공격을 늦추고(빙결) 갉아먹는다.
  //  도약(진입)·역행(이탈)과 역할이 또렷이 다른 '고립·추격' 도구.
  chronomancer(state, h) {
    const foe = nearestFoeHero(state, h, TIMEWARP_RANGE)
    const tx = foe ? foe.x : h.x + Math.cos(h.dir) * TIMEWARP_AIM
    const tz = foe ? foe.z : h.z + Math.sin(h.dir) * TIMEWARP_AIM
    state.zones.push({
      id: state.nextId++, kind: 'timewarp', team: h.team, owner: h.id,
      x: tx, z: tz, r: TIMEWARP_RADIUS, t: 0, delay: 0, life: TIMEWARP_LIFE, tickT: 0,
      slowDps: skillDmg(h, 10, 0.2),
    })
    pushFx(state, 'timewarp', tx, tz, TIMEWARP_RADIUS, h.team)
  },
  // 공포술사 망령걸음: 유령처럼 흐려짐 — 가속 + 어둠 장막(피해 흡수)
  fearmonger(state, h) {
    h.hasteT = Math.max(h.hasteT, SPECTRE_T)
    h.barrierHp = Math.max(h.barrierHp, skillDmg(h, 45, 0.7)) // 주문력 계수 장막
    h.barrierT = Math.max(h.barrierT, SPECTRE_T)
    pushFx(state, 'stealth', h.x, h.z, 3, h.team)
  },
  // 환영무희 자리바꿈: 내 분신(가장 최근)과 위치를 맞바꾼다 — 분신이 없으면 쿨 환불
  illusionist(state, h) {
    const clones = state.summons.filter((s) => s.kind === 'clone' && s.owner === h.id)
    const c = clones[clones.length - 1]
    if (!c) return false
    const hx = h.x
    const hz = h.z
    h.x = c.x
    h.z = c.z
    c.x = hx
    c.z = hz
    c.decoyTx = c.x + Math.cos(c.dir) * 40 // 분신은 새 자리에서 가던 방향으로 계속 걷는다
    c.decoyTz = c.z + Math.sin(c.dir) * 40
    state.map.resolveTerrain(h, HERO_RADIUS, colliders(state))
    h.bushI = state.map.bushIndexAt(h.x, h.z)
    pushFx(state, 'blink', hx, hz, 2.5, h.team)
    pushFx(state, 'blink', h.x, h.z, 2.5, h.team)
  },
  // 대지술사 융기: 전방에 가로 돌벽(충돌 원 4개) — 3초간 길을 막는다.
  //  벽이 솟는 자리에 있던 적은 밀쳐지며(충돌이 처리) 미미한 피해 + 1.5초 기절 → 돌팔매 연계.
  terramancer(state, h) {
    const cx = h.x + Math.cos(h.dir) * QUAKE_WALL_AHEAD
    const cz = h.z + Math.sin(h.dir) * QUAKE_WALL_AHEAD
    const along = h.dir + Math.PI / 2
    const before = state.tempWalls.length
    raiseWallLine(state, cx, cz, along, 4)
    // 벽 원에 깔린 적: 피해(미미) + 기절 — 방금 세운 원들만 검사
    const hitR = TOWER_RADIUS + HERO_RADIUS + 0.4
    const dmg = skillDmg(h, 15, 0.25) // 주문력 계수(낮음 — 셋업기)
    for (const e of state.heroes) {
      if (e.team === h.team || e.respawnT > 0) continue
      let struck = false
      for (let i = before; i < state.tempWalls.length && !struck; i++) {
        const w = state.tempWalls[i]
        if ((e.x - w.x) ** 2 + (e.z - w.z) ** 2 <= hitR * hitR) struck = true
      }
      if (!struck) continue
      const cc = e.rageT > 0 ? RAGE_CC_CUT : 1
      e.stunT = Math.max(e.stunT, QUAKE_STUN * cc)
      damageHero(state, e, dmg, h)
    }
    const half = QUAKE_WALL_SPAN * 1.5 + 1.2
    pushFxDir(state, 'quake', cx - Math.cos(along) * half, cz - Math.sin(along) * half, half * 2, along, h.team)
  },
}

// 술식 공통: 판정 함수 pred(e)에 걸리는 모든 적(영웅/병사/정글몹)에게 피해(+기절/빙결/속박)
function damageInShape(state, attacker, pred, dmg, stun, freeze = 0, root = 0) {
  for (const e of state.heroes) {
    if (e.team === attacker.team || e.respawnT > 0 || !pred(e)) continue
    const cc = e.rageT > 0 ? RAGE_CC_CUT : 1 // 검투의 분노: 받는 CC 시간 감소
    if (stun > 0) e.stunT = Math.max(e.stunT, stun * cc)
    if (freeze > 0) e.freezeT = Math.max(e.freezeT, freeze * cc)
    if (root > 0) e.rootT = Math.max(e.rootT, root * cc)
    damageHero(state, e, dmg, attacker)
  }
  for (const m of [...state.minions]) {
    if (m.team !== attacker.team && pred(m)) damageMinion(state, m, dmg, attacker)
  }
  for (const m of state.monsters) {
    if (m.alive && pred(m)) damageMonster(state, m, dmg, attacker)
  }
  for (const s of state.summons) {
    if (s.team !== attacker.team && pred(s)) damageSummon(state, s, dmg, attacker)
  }
}

// (x,z) 주변 동심원 범위 피해
function aoeDamage(state, attacker, x, z, radius, dmg, stun, freeze = 0) {
  const r2 = radius * radius
  damageInShape(state, attacker, (e) => (e.x - x) ** 2 + (e.z - z) ** 2 <= r2, dmg, stun, freeze)
}

// 전방 직선(직사각형) 범위 피해 — (x,z)에서 dir 방향으로 length, 좌우 half폭 (root>0이면 속박)
function lineDamage(state, attacker, x, z, dir, length, half, dmg, stun, root = 0) {
  const ux = Math.cos(dir)
  const uz = Math.sin(dir)
  damageInShape(state, attacker, (e) => {
    const rx = e.x - x
    const rz = e.z - z
    const along = rx * ux + rz * uz // 진행 방향 거리
    if (along < -0.5 || along > length) return false
    return Math.abs(-uz * rx + ux * rz) <= half // 경로에서 옆으로 벗어난 거리
  }, dmg, stun, 0, root)
}

// 전방 부채꼴(콘) 범위 피해 — (x,z)에서 dir 방향, 반경 range, 반각 halfAngle(rad)
function coneDamage(state, attacker, x, z, dir, range, halfAngle, dmg, stun) {
  const r2 = range * range
  damageInShape(state, attacker, (e) => {
    const rx = e.x - x
    const rz = e.z - z
    const d2 = rx * rx + rz * rz
    if (d2 > r2) return false
    if (d2 < 1) return true // 바로 앞(겹친) 적은 무조건
    let dd = Math.atan2(rz, rx) - dir
    while (dd > Math.PI) dd -= 2 * Math.PI
    while (dd < -Math.PI) dd += 2 * Math.PI
    return Math.abs(dd) <= halfAngle
  }, dmg, stun)
}

// 중독(DoT) 부여 — 더 약한 도트가 강한 걸 덮어쓰지 않게, 피해량은 큰 값을 유지하고 시간만 갱신.
function applyPoison(victim, attacker, dps, dur) {
  if (victim.poisonT <= 0 || dps >= victim.poisonDps) victim.poisonDps = dps
  victim.poisonT = Math.max(victim.poisonT, dur)
  if (attacker?.id) victim.poisonBy = attacker.id
}

// 회복 적용 — 중독(안티힐) 중이면 회복량이 줄어든다.
function healHero(h, amount) {
  if (amount <= 0 || h.respawnT > 0) return
  if (h.poisonT > 0) amount *= HEAL_CUT
  h.hp = Math.min(h.maxHp, h.hp + amount)
}

// ── 피해 처리 ──
//  redirected=true 는 결속 리다이렉트로 수호기사가 대신 맞는 호출(무한 연쇄 방지 플래그).
function damageHero(state, victim, amount, attacker, redirected = false) {
  if (victim.respawnT > 0 || state.status !== 'playing') return
  if (state.mode === 'arena' && state.arenaPhase === 'shop' && attacker) return // 준비 결계: 전투 불가
  if (victim.isBoss && bossInvuln(state, victim)) return // 무적(각성 휴지기 보호막 / 기상 전 수면)
  // 봇 난이도: 봇 영웅이 주는 피해(평타·스킬 공통)를 난이도 배율로. 리다이렉트(결속 대납)엔
  // 원 피해에서 이미 적용됐으므로 다시 곱하지 않는다.
  if (!redirected && attacker?.isBot) amount *= BOT_LEVELS[state.botLevel]?.dmg ?? 1
  if (attacker?.bossEnraged) amount *= 1.5 // 보스 광폭화
  if (attacker?.isBoss && attacker.bossPhase > 1) amount *= BOSS_PHASE_DMG[attacker.bossPhase - 1] // 페이즈 분노
  if (!redirected && attacker?.isBoss) amount *= bossTierOf(state).atk // 난이도 티어(평타·스킬·장판 공통)
  // 콜로세움 직업 보정(주는/받는 피해)
  if (state.mode === 'arena' && !redirected) {
    if (attacker) amount *= ARENA_CLASS_MOD[attacker.cls]?.deal ?? 1
    amount *= ARENA_CLASS_MOD[victim.cls]?.take ?? 1
  }
  // 가시갑옷: 반사창 동안 보스를 때리면 35%를 되받는다(반사 피해는 다시 반사되지 않는다)
  if (victim.isBoss && victim.thornArmorT > 0 && attacker && !redirected && attacker.hp > 0 && !attacker.isBoss) {
    damageHero(state, attacker, amount * 0.35, victim, true)
  }
  // 수호기사 결속: 묶인 아군이 받을 피해를 수호기사가 "대신" 받는다(50%+10%×인원, 최대 90% 감소).
  //  아군 자신은 피해를 전혀 받지 않는다. 리다이렉트된 피해엔 수호기사의 방어/보호막이 다시 적용된다.
  if (!redirected && amount > 0 && victim.bindT > 0) {
    const g = state.heroes.find((o) => o.id === victim.bindBy && o.team === victim.team && o.respawnT <= 0)
    if (g && g !== victim) {
      let n = 0
      for (const a of state.heroes) if (a.bindBy === victim.bindBy && a.bindT > 0 && a.respawnT <= 0) n++
      const cut = Math.min(BIND_MAX_CUT, BIND_BASE_CUT + BIND_PER_ALLY * n)
      damageHero(state, g, amount * (1 - cut), attacker, true)
      pushFx(state, 'shield', victim.x, victim.z, 1.6, victim.team) // 아군을 스치고 지나가는 결속의 빛
      return
    }
  }
  // 검성 발도 카운터: 자세를 잡은 동안 받는 첫 피해를 무효화하고 그 2배를 되돌린다(상한 있음)
  if (victim.parryT > 0 && amount > 0) {
    victim.parryT = 0
    pushFx(state, 'shield', victim.x, victim.z, 2.5, victim.team)
    if (attacker?.id && attacker.team !== victim.team && attacker.respawnT <= 0) {
      const reflect = Math.min(amount * PARRY_REFLECT, skillDmg(victim, PARRY_REFLECT_MAX_BASE, PARRY_REFLECT_MAX_COEF))
      damageHero(state, attacker, reflect, victim)
      pushFx(state, 'execute', attacker.x, attacker.z, 2, victim.team) // 반격이 꽂히는 붉은 섬광
    }
    return
  }
  amount *= CLASSES[victim.cls].def ?? 1 // 근접 직업은 기본 방어력이 높다
  // 보스: 붙어 있는 적이 많을수록 받는 피해 감쇠(1명 초과부터 13%씩) — 5인 스택 순삭 방지.
  // 흩어져 역할을 나누면(어그로/딜/견제) 오히려 효율이 오르는 레이드 리듬.
  if (victim.isBoss && attacker?.team && attacker.team !== victim.team) {
    let n = 0
    for (const e of state.heroes) {
      if (e.team !== victim.team && !e.isBoss && e.respawnT <= 0 && dist2(e, victim) < 196) n++
    }
    amount *= 1 / (1 + 0.2 * Math.max(0, n - 1))
  }
  // 방어 아이템: 받는 피해 감소 — 콜로세움은 효율 일괄 감쇠(흡혈 ×0.1과 짝):
  //  방어 스택이 온존하면 후반 라운드 탱커·힐러가 벽이 된다(직업 배율로는 못 잡는 구조 편차)
  const itemDef = itemBonus(victim).def * (state.mode === 'arena' ? ARENA_ITEM_DEF_MULT : 1)
  amount *= 1 - itemDef
  if (victim.shieldT > 0) amount *= SHIELD_CUT // 방패막기!
  if (victim.whirlT > 0) amount *= 1 - WHIRL_DR // 전사 회전베기 중 방어 ↑(앞라인 탱킹)
  if (victim.wardT > 0) amount *= WARD_CUT // 수호기사 결속(아군 피해 감소)
  if (victim.vulnT > 0) amount *= 1 + DOOM_VULN_AMP // 주술사 낙인(받는 피해 증가)
  if (victim.barrierHp > 0) { // 수호기사 보호막: 흡수 풀에서 먼저 깎인다
    const absorb = Math.min(victim.barrierHp, amount)
    victim.barrierHp -= absorb
    amount -= absorb
  }
  victim.hp -= amount
  victim.lastHurt = state.time
  if (victim.recallT > 0) victim.recallT = 0 // 피해를 받으면 귀환이 끊긴다
  if (attacker?.id) {
    victim.lastHitBy = attacker.id
    victim.lastHitT = state.time // 킬 크레딧 시한 판정용 (병사/타워/우물은 attacker가 없어 안 바뀐다)
    if (attacker.team && attacker.team !== victim.team) victim.damagedBy[attacker.id] = state.time // 어시스트 판정용
    attacker.aggroT = TOWER_AGGRO_TIME // 타워 앞에서 깐족이면 타워가 노린다
    victim.revealT = Math.max(victim.revealT, 0.8) // 맞으면 잠깐 드러난다
  }
  if (victim.hp > 0) return
  // 사망!
  victim.hp = 0
  victim.deaths++
  victim.deathStreak++ // 킬/어시를 따면 0으로 리셋(아래 killer/assist 처리에서)
  // 죽기 직전까지 쌓은 연속 킬에 비례한 현상금(killStreak 2부터). 죽었으니 killStreak는 0으로.
  const bountyBonus = bountyGold(victim.killStreak)
  victim.killStreak = 0
  // 보스전 부활: 짧게(상한 18초) — 죽음이 리셋이 아니라 잠깐의 공백이어야 레이드가 굴러간다.
  // 그림자 영웅(정예 소환수)은 부활하지 않는다.
  victim.respawnT = victim.isBossAdd ? 1e9
    : state.mode === 'arena' ? 1e9 // 콜로세움: 한 번 죽으면 이 라운드는 끝
    : isRaidMode(state.mode) && !victim.isBoss ? Math.min(respawnTime(victim.lvl), 18)
    : respawnTime(victim.lvl)
  victim.stunT = 0
  victim.freezeT = 0
  victim.whirlT = 0
  victim.shieldT = 0
  victim.berserkT = 0
  victim.rageT = 0
  victim.stealthT = 0
  victim.hasteT = 0
  victim.tauntT = 0
  victim.tauntBy = null
  victim.castT = 0
  victim.dragonT = 0
  victim.baronT = 0
  victim.poisonT = 0
  victim.barrierHp = 0
  victim.barrierT = 0
  victim.wardT = 0
  // 결속 해제: 내가 묶여 있었으면 풀고, 내가 결속을 건 수호기사였으면 묶인 아군을 모두 풀어 준다
  victim.bindT = 0
  victim.bindBy = null
  if (victim.bindAnchorT > 0) {
    victim.bindAnchorT = 0
    for (const a of state.heroes) if (a.bindBy === victim.id) { a.bindT = 0; a.bindBy = null }
  }
  victim.vulnT = 0
  victim.parryT = 0
  victim.rootT = 0
  victim.bladeT = 0
  victim.hookWindT = 0
  victim.pullT = 0
  victim.fearT = 0
  victim.slingN = 0 // 죽으면 남은 연투도 끊긴다
  // 영웅은 공중 분해 버스트 대신, 렌더러가 시체를 바닥에 쌓이는 파티클로 표현한다(부활까지 유지).
  // 킬 크레딧: 마지막으로 때린 적 영웅이 최근(KILL_CREDIT_T 초)일 때만. 오래됐으면
  //  병사/타워에 의한 처형으로 보고 개인 크레딧/킬 보상 없이 처리한다.
  const recent = state.time - victim.lastHitT <= KILL_CREDIT_T
  const killer = recent
    ? state.heroes.find((h) => h.id === victim.lastHitBy && h.team !== victim.team)
    : null
  // 어시스트: 사망 직전 KILL_CREDIT_T 초 안에 피해를 준 적 영웅(막타=killer 제외).
  const damagers = state.heroes.filter((h) => (
    h !== killer && h.team !== victim.team &&
    state.time - (victim.damagedBy[h.id] ?? -99) <= KILL_CREDIT_T
  ))
  // 지원 어시스트: 처치 관여자(킬러·가해 어시스터)를 최근에 치유/보호막/결속으로 도운 같은 팀 영웅.
  //  서포터가 킬 골드 경제에서 소외되지 않게 힐링 기여도 어시스트로 인정한다.
  const involved = killer ? [killer, ...damagers] : damagers
  const supporters = state.heroes.filter((s) => (
    s !== killer && s.team !== victim.team && !damagers.includes(s) &&
    involved.some((i) => state.time - (i.supportedBy[s.id] ?? -99) <= KILL_CREDIT_T)
  ))
  const assisters = [...damagers, ...supporters]
  if (killer) {
    killer.kills++
    killer.deathStreak = 0 // 킬을 따면 연속 데스 디버프 해제
    killer.killStreak++ // 안 죽고 이어가면 다음에 잡힐 때 현상금이 붙는다
    if ((killer.bestStreak || 0) < killer.killStreak) killer.bestStreak = killer.killStreak // 업적: 한 목숨 최다 연속킬
    state.kills[killer.team]++
    awardXp(state, killer.team, victim, 90 + 15 * victim.lvl, killer)
    // 기본값 + 현상금(연속 킬) − 감소(연속 데스). 최저 KILL_BOUNTY_MIN 보장.
    const penalty = DEATHSTREAK_PENALTY * Math.max(0, victim.deathStreak - 1)
    const reward = Math.max(KILL_BOUNTY_MIN, GOLD_KILL + bountyBonus - penalty)
    awardGold(state, killer, reward, victim.x, victim.z)
    const bountyTag = bountyBonus > 0 ? ` 💰현상금 +${bountyBonus}!` : ''
    const assistTag = assisters.length ? ` (도움: ${assisters.map((a) => emojiOf(a.zodiacId)).join('')})` : ''
    pushFeed(state, 'kill', `${emojiOf(killer.zodiacId)} ${killer.name} ⚔️ ${emojiOf(victim.zodiacId)} ${victim.name} 처치!${bountyTag}${assistTag}`)
  } else {
    state.kills[enemyOf(victim.team)]++
    pushFeed(state, 'kill', `${emojiOf(victim.zodiacId)} ${victim.name} 쓰러짐!`)
  }
  // 어시스트 보상: 골드 + 연속 데스 디버프 해제
  for (const a of assisters) {
    a.assists++
    a.deathStreak = 0
    awardGold(state, a, GOLD_ASSIST, victim.x, victim.z)
  }
  victim.damagedBy = {} // 사망 처리 끝 — 피해 이력 비움(부활 후 새로 쌓는다)
}

function damageMinion(state, m, amount, attacker) {
  m.hp -= amount
  if (m.hp > 0) return
  state.minions = state.minions.filter((o) => o !== m)
  pushFx(state, 'death', m.x, m.z, 2, m.team) // 그 자리에서 파티클로 분해
  if (attacker?.team) awardXp(state, attacker.team, m, MINION_XP, attacker)
  // 막타 골드는 영웅에게만 (병사/타워가 잡으면 없음 — 막타 챙기는 재미)
  if (attacker?.items) awardGold(state, attacker, m.ranged ? GOLD_MINION_RANGED : GOLD_MINION_MELEE, m.x, m.z)
  if (attacker?.soldierKills != null) attacker.soldierKills++ // 업적: 병사 막타 수
}

function damageMonster(state, m, amount, attacker) {
  if (!m.alive) return
  m.hp -= amount
  m.lastHurt = state.time
  if (attacker?.id) m.aggro = attacker.id
  if (m.hp > 0) return
  m.alive = false
  m.aggro = null
  // 그 자리에서 파티클로 분해 — 정글몹은 처치한 팀 색으로 (큰 오브젝트는 더 크게)
  pushFx(state, 'death', m.x, m.z, CAMP_MOBS[m.kind] ? 2.5 : 4.5, attacker?.team || null)
  const spec = CAMP_MOBS[m.kind] || (m.kind === 'dragon' ? DRAGON : BARON)
  m.respawnT = spec.respawn
  if (!attacker?.team) return
  if (CAMP_MOBS[m.kind]) {
    awardXp(state, attacker.team, m, spec.xp, attacker)
    if (attacker?.items) awardGold(state, attacker, spec.gold, m.x, m.z)
    if (attacker.jungleKills != null) attacker.jungleKills++
  } else {
    // 용/이무기: 팀 전체 경험치 + 버프 + 골드 (막타 영웅에겐 업적 카운트)
    if (m.kind === 'dragon') { if (attacker.dragonKills != null) attacker.dragonKills++ }
    else if (attacker.baronKills != null) attacker.baronKills++
    teamGold(state, attacker.team, m.kind === 'dragon' ? GOLD_DRAGON : GOLD_BARON)
    for (const h of state.heroes) {
      if (h.team !== attacker.team) continue
      giveXp(state, h, spec.xp)
      if (h.respawnT > 0) continue
      if (m.kind === 'dragon') h.dragonT = DRAGON_BUFF_T
      else h.baronT = BARON_BUFF_T
    }
    pushFeed(
      state,
      m.kind,
      m.kind === 'dragon'
        ? `🐉 ${attacker.team === 'blue' ? '파랑팀' : '빨강팀'}이 용을 잡았다! 공격력 UP!`
        : `👹 ${attacker.team === 'blue' ? '파랑팀' : '빨강팀'}이 이무기를 잡았다! 강해졌다!!`
    )
  }
}

function damageTower(state, t, amount, attacker) {
  // 보스전 역할 분리: 건물 철거는 병사의 일 — 보스와 그림자 영웅은 건물에 관심이 없다(0.1/0.05배).
  // 병사 파도는 쌓이면 건물이 실제로 무너진다(진군 전 0.3 / 진군 후 0.75배) —
  // 파도를 치우는 것이 곧 수성이고, 그동안 보스는 영웅을 사냥하러 온다.
  if (attacker?.isBoss) amount *= 0.1
  if (attacker?.isBossAdd) amount *= 0.05
  else if (state.mode === 'defense' && attacker?.team === 'red') {
    amount *= 0.6 // 방어전: 파도가 유일한 압박 — 쌓이면 방어선이 실제로 무너진다
  } else if (state.mode === 'boss' && attacker && !attacker.isBoss && attacker.team === 'red') {
    amount *= state.time < BOSS_MARCH_AT ? 0.3 : 0.7
  }
  if (!t.alive || !towerVulnerable(state, t)) return
  t.lastHurt = state.time // 공성당하는 중 — 봇 수비 콜 판정용
  t.hp -= amount
  if (t.hp > 0) return
  t.hp = 0
  t.alive = false
  pushFx(state, 'towerfall', t.x, t.z, TOWER_RADIUS + 3, t.team, 1.7) // 무너지는 포탑 — 돌무더기가 와르르
  const team = attacker?.team || enemyOf(t.team)
  state.towersDown[team]++
  for (const h of state.heroes) if (h.team === team) giveXp(state, h, TOWER_XP)
  teamGold(state, team, GOLD_TOWER)
  const side = t.team === 'blue' ? '파랑' : '빨강'
  if (t.tier === 3) {
    pushFeed(state, 'tower', `💥 ${side} 최후의 포탑 파괴! 수호석이 열렸다!`)
  } else {
    const laneName = { top: '윗길', mid: '가운데길', bot: '아랫길' }[t.lane]
    pushFeed(state, 'tower', `💥 ${side} ${laneName} ${t.tier === 1 ? '외곽' : '내곽'} 타워 파괴!`)
  }
}

function damageNexus(state, team, amount, attacker) {
  if (!nexusVulnerable(state, team)) return
  if (attacker?.isBoss) amount *= 0.1 // 보스전 역할 분리: 건물 철거는 병사의 일
  if (attacker?.isBossAdd) amount *= 0.05 // 그림자 영웅은 처형자 — 건물에 관심이 없다
  else if (state.mode === 'defense' && attacker?.team === 'red') {
    amount *= 0.6 // 방어전: 파도가 유일한 압박 — 쌓이면 방어선이 실제로 무너진다
  } else if (state.mode === 'boss' && attacker && !attacker.isBoss && attacker.team === 'red') {
    amount *= state.time < BOSS_MARCH_AT ? 0.3 : 0.7
  }
  const nx = state.nexus[team]
  if (nx.hp <= 0) return
  nx.lastHurt = state.time // 공격받는 중 — HUD 경고용
  nx.hp -= amount
  if (nx.hp > 0) return
  nx.hp = 0
  const np = state.map.NEXUS_POS[team]
  pushFx(state, 'nexusfall', np.x, np.z, NEXUS_RADIUS + 4, team, 2.0) // 폭발하는 수호석 — 펑! 파편이 터져나간다
  finish(state, attacker?.team || enemyOf(team))
}

function finish(state, winner) {
  state.status = 'finished'
  state.winner = winner
  // 승리 문구는 종료 후 뜨는 승리 모달(글자 단위 연출)에서만 보여 준다 —
  //  여기서 피드 토스트로 또 띄우면 "파랑팀 승리"가 중복 표시된다.
}

// 종류 불문 피해 적용 (투사체 도착 등)
function applyDamage(state, ref, amount, attacker) {
  const e = targetEntity(state, ref)
  if (!e) return
  if (ref.tk === 'hero') damageHero(state, e, amount, attacker)
  else if (ref.tk === 'minion') damageMinion(state, e, amount, attacker)
  else if (ref.tk === 'monster') damageMonster(state, e, amount, attacker)
  else if (ref.tk === 'tower') damageTower(state, e, amount, attacker)
  else if (ref.tk === 'nexus') damageNexus(state, ref.id, amount, attacker)
  else if (ref.tk === 'summon') damageSummon(state, e, amount, attacker)
}

// 처치 경험치는 근처의 같은 팀 영웅이 "나눠" 갖는다(킬러는 어디 있든 포함).
//  → 둘이 함께 먹으면 1인당 경험치가 줄어 몰려다니기만 해도 레벨이 앞서가던 문제를 막는다.
//  단 팀 합계는 인원수에 비례해 살짝 늘려(XP_SHARE_BONUS) 협력 자체에는 약간의 이득을 둔다.
function awardXp(state, team, at, amount, killer) {
  const r2 = XP_RANGE * XP_RANGE
  const recipients = []
  for (const h of state.heroes) {
    if (h.team !== team || h.respawnT > 0) continue // 죽은 아군은 못 받고 분배에도 안 낀다
    if (h === killer || dist2(h, at) <= r2) recipients.push(h)
  }
  if (!recipients.length) return
  const n = recipients.length
  const share = (amount * (1 + XP_SHARE_BONUS * (n - 1))) / n // n=1: 그대로 / n=2: 0.6배씩 / n=3: 0.47배씩
  for (const h of recipients) giveXp(state, h, share)
}

function giveXp(state, h, amount) {
  if (h.respawnT > 0) return // 죽어 있는 동안엔 경험치를 받지 못한다
  // 보스는 레벨 개념이 없다 — 경험치를 받지 않는다. (예전엔 처치 XP로 레벨업하며
  //  레벨업 보너스 15%를 회복해, 영웅을 잡을 때마다 체력이 훅 차오르는 것처럼 보였다.)
  if (h.isBoss) return
  if (h.lvl >= MAX_LEVEL) return
  if (isRaidMode(state.mode) && h.team === 'blue' && !h.isBoss) amount *= 2.0 // 레이드: 파밍원이 적어 성장 가속
  h.xp += amount
  let up = false
  while (h.lvl < MAX_LEVEL && h.xp >= xpNeed(h.lvl)) {
    h.xp -= xpNeed(h.lvl)
    h.lvl++
    up = true
    const grow = CLASSES[h.cls].hpLvl
    h.maxHp = heroMaxHp(h)
    h.hp = Math.min(h.maxHp, h.hp + grow + h.maxHp * 0.15) // 레벨업 보너스 회복
  }
  if (up && h.respawnT <= 0) pushFx(state, 'level', h.x, h.z, 4, h.team)
  if (h.lvl >= MAX_LEVEL) h.xp = 0
}

// ── 물리 1틱 ──
export function step(state, dt) {
  state.time += dt
  if (state.status === 'countdown') {
    state.countdown = Math.max(0, COUNTDOWN_TIME - state.time)
    if (state.time >= COUNTDOWN_TIME) {
      state.status = 'playing'
      state.countdown = 0
    }
    return state
  }
  if (state.status === 'finished') return state

  stepWaves(state, dt)
  stepArena(state, dt)
  stepBots(state, dt)
  for (const h of state.heroes) stepHero(state, h, dt)
  stepAutoAttack(state) // 사람 영웅: 갱신된 위치/수풀/쿨다운 기준으로 사거리 안 적 영웅에게 평타 이어치기
  stepMinions(state, dt)
  stepMonsters(state, dt)
  stepTowers(state, dt)
  stepProjectiles(state, dt)
  stepHawks(state, dt)
  stepZones(state, dt)
  stepSummons(state, dt)
  // 대지술사 임시 돌벽: 수명이 다하면 가라앉는다
  if (state.tempWalls.length) {
    state.tempWalls = state.tempWalls.filter((w) => (w.t += dt) < w.life)
  }
  state.fx = state.fx.filter((n) => (n.t += dt) < (n.life || 0.8))
  // 보스전: 보스가 쓰러지면 그 즉시 파랑팀 승리 (부활 없음)
  if (state.mode === 'boss' && state.status === 'playing') {
    const boss = state.heroes.find((b) => b.isBoss)
    if (!boss || boss.respawnT > 0 || boss.hp <= 0) {
      pushFeed(state, 'obj', '👑 보스 격파! 전설의 사냥이 끝났다!')
      if (boss) {
        // 토벌 피날레 — 쓰러진 자리에서 다단 폭발(클라 endFlash 파동과 겹쳐 붕괴감을 만든다)
        pushFx(state, 'meteorhit', boss.x, boss.z, 14, 'blue', 1.3)
        pushFx(state, 'berserk', boss.x, boss.z, 10, 'red', 1.1)
        pushFx(state, 'rocksplash', boss.x, boss.z, 9, 'red')
      }
      finish(state, 'blue')
    }
  }
  // 시간제한 없음 — 승부는 오직 수호석 파괴(보스전은 보스 처치)로만 갈린다
  return state
}

// ── 무한 방어 웨이브 — 붉은 관문에서 파도가 밀려온다. 갈수록 많고 단단해지며,
//  5의 배수엔 그림자 정예가 합류(10웨이브마다 1명씩 증가), 10의 배수 뒤엔 10초 숨돌리기.
//  승리는 없다 — 몇 번째 파도까지 버티는가가 기록이다.
export const DEFENSE_FIRST_WAVE = 8 // 카운트다운 후 첫 파도까지(초)
function stepDefenseWaves(state, dt) {
  if (state.mode !== 'defense' || state.status !== 'playing') return
  state.defWaveT -= dt
  if (state.defWaveT > 0) return
  state.wave = (state.wave || 0) + 1
  const w = state.wave
  // 간격 22s → 10s로 점감 + 10의 배수 뒤엔 10초 휴식(분수 정비 타임)
  state.defWaveT = Math.max(10, 22 - w * 0.6) + (w % 10 === 0 ? 10 : 0)
  const nx = state.map.NEXUS_POS.red
  const gate = { team: 'red', x: nx.x - 6, z: nx.z }
  // 물량 상한: 살아있는 붉은 병사 45 초과분은 안 뽑는다(모바일 성능·프레임 보호)
  const alive = state.minions.filter((m) => m.team === 'red').length
  const count = Math.max(0, Math.min(Math.min(16, 6 + Math.ceil(w * 0.7)), 45 - alive))
  if (count > 0) bossSummon(state, gate, { count, hpMul: 1 + 0.12 * w })
  if (w % 5 === 0) {
    // 그림자 정예 합류 — 5파도마다 1명씩 증가(부활 없음 — 잡으면 성장 연료), 진짜 시계는 이쪽
    const pool = ['warrior', 'mage', 'assassin', 'tank', 'archer', 'gladiator', 'cryomancer', 'warlock']
    const blues = state.heroes.filter((e) => e.team === 'blue')
    const avg = Math.round(blues.reduce((sum, e) => sum + e.lvl, 0) / Math.max(1, blues.length))
    const n = 1 + Math.floor(w / 4)
    for (let i = 0; i < n; i++) {
      const cls = pool[Math.floor(state.rng() * pool.length)]
      spawnShadowAdd(state, { cls, lvl: Math.max(1, avg - 1) }, gate.x + (state.rng() - 0.5) * 6, gate.z + (state.rng() - 0.5) * 6)
    }
    pushFeed(state, 'obj', `⚔️ ${w}번째 파도 — 그림자 정예 ${n}기가 함께 몰려온다!`)
  } else if (w === 1) {
    pushFeed(state, 'obj', '🌊 첫 파도가 밀려온다 — 수호석을 지켜라!')
  } else if (w % 10 === 1 && w > 1) {
    pushFeed(state, 'obj', `🌊 ${w}번째 파도 — 파도가 더 거세진다!`)
  }
}

// 병사 웨이브: 세 레인마다 근접 3 + 원거리 3
// ── 콜로세움 진행 — 페이즈 머신 + 무작위 조각 붕괴 + 낙사/전멸 판정 ──
function arenaAliveCount(state, team) {
  return state.heroes.filter((h) => h.team === team && h.respawnT <= 0 && h.hp > 0 && !(h.fallT > 0)).length
}

// 낙하 시작 — 0.8초간 구멍 중심으로 빨려 들어가며 추락(연출), 끝나면 사망 확정.
//  보호막 무시(추락엔 방패가 없다). 낙하 중엔 행동·이동 불가 + 생존 판정에서 제외.
const ARENA_FALL_T = 1.5 // 낙하 장면을 충분히 보여준다 — 이게 끝나야 결과 연출로 넘어간다
function arenaFall(state, h, hole = null) {
  if (h.fallT > 0) return
  h.barrierHp = 0
  h.barrierT = 0
  h.shieldT = 0
  h.fallT = ARENA_FALL_T
  h.fallX = hole ? hole.x : h.x
  h.fallZ = hole ? hole.z : h.z
  h.mx = 0
  h.mz = 0
  pushFx(state, 'death', h.x, h.z, 4, h.team)
}

// 붕괴 조각 자리 뽑기 — 거부 샘플링: 기존 구멍·경고와 겹치지 않게, 공간이 부족해지면 허용 오차 완화
function arenaPickHole(state) {
  const R = 36 // 경기장 반경(40)보다 살짝 안쪽 — 테두리 물기 허용
  const taken = [...state.holes, ...state.holeWarns]
  for (const relax of [0.8, 0.5, 0]) {
    for (let tries = 0; tries < 20; tries++) {
      const a = state.rng() * Math.PI * 2
      const rr = Math.sqrt(state.rng()) * R
      const x = Math.cos(a) * rr
      const z = Math.sin(a) * rr
      if (taken.every((o) => Math.hypot(x - o.x, z - o.z) >= (ARENA_HOLE_R + o.r) * relax)) return { x, z }
    }
  }
  return null // 자리가 완전히 소진 — 이번 조각은 생략
}

function stepArena(state, dt) {
  if (state.mode !== 'arena' || state.status !== 'playing') return
  state.arenaT -= dt
  if (state.arenaPhase === 'shop') {
    if (!state.arenaIntroSaid) {
      state.arenaIntroSaid = true
      pushFeed(state, 'obj', `⏳ ${Math.round(ARENA_SHOP_T)}초 뒤 전투가 시작됩니다 — 상점에서 전투를 준비하세요!`)
    }
    // 준비 결계: 스타팅 원(우물 반경) 밖으로 못 나간다 — 원 안에서만 몸 풀기
    for (const h of state.heroes) {
      const fp = state.map.FOUNTAIN_POS[h.team]
      const dx = h.x - fp.x
      const dz = h.z - fp.z
      const d = Math.hypot(dx, dz)
      const lim = FOUNTAIN_RADIUS - 0.6
      if (d > lim) {
        h.x = fp.x + (dx / d) * lim
        h.z = fp.z + (dz / d) * lim
      }
    }
    if (state.arenaT <= 0) {
      state.arenaPhase = 'fight'
      state.arenaT = ARENA_FIGHT_T
      // 전투 개시: 쿨다운 전체 초기화(준비 중 헛시전 방지)
      for (const h of state.heroes) { h.atkCd = 0; h.skillCd = 0; h.skill2Cd = 0; h.ultCd = 0 }
      pushFeed(state, 'obj', '⚔️ 전투 개시!')
    }
    return
  }
  if (state.arenaPhase === 'fight' && state.arenaT <= 0) {
    state.arenaPhase = 'sudden'
    state.arenaT = 0.01 // 즉시 첫 붕괴 웨이브
    pushFeed(state, 'obj', '⚠️ 경기장이 무너지기 시작한다 — 발밑을 조심하라!')
  }
  // ── 회복 열매: 하늘에서 떨어져 바닥에 남는다 — 전투의 리듬을 만드는 자원 싸움 ──
  if (state.arenaPhase !== 'shop') {
    state.orbT -= dt
    if (state.orbT <= 0 && state.healOrbs.length < 2) {
      state.orbT = ARENA_ORB_EVERY
      // 구멍·경고·기존 열매를 피해 안쪽(R×0.85)에 떨어뜨린다
      const taken = [...state.holes, ...state.holeWarns, ...state.healOrbs.map((o) => ({ ...o, r: 4 }))]
      for (let tries = 0; tries < 24; tries++) {
        const a = state.rng() * Math.PI * 2
        const rr = Math.sqrt(state.rng()) * 27
        const x = Math.cos(a) * rr
        const z = Math.sin(a) * rr
        if (!taken.every((o) => Math.hypot(x - o.x, z - o.z) >= (o.r || 4) + 4)) continue
        state.healOrbs.push({ id: state.nextId++, x, z, t: 0 })
        pushFx(state, 'descend', x, z, 2.2, null, 1.0) // 하늘 광선 — 열매 강림
        break
      }
    }
    for (let i = state.healOrbs.length - 1; i >= 0; i--) {
      const o = state.healOrbs[i]
      o.t += dt
      if (o.t > ARENA_ORB_LIFE) { state.healOrbs.splice(i, 1); continue }
      // 습득: 살아 있는 영웅이 밟으면 회복 — 먼저 밟는 쪽이 임자
      for (const h of state.heroes) {
        if (h.respawnT > 0 || h.hp <= 0) continue
        if (Math.hypot(h.x - o.x, h.z - o.z) > 2.2) continue
        h.hp = Math.min(h.maxHp, h.hp + h.maxHp * ARENA_ORB_HEAL)
        pushFx(state, 'heal', h.x, h.z, 3, h.team, 1.0)
        state.healOrbs.splice(i, 1)
        break
      }
    }
  }
  if (state.arenaPhase === 'sudden' && state.arenaT <= 0) {
    state.arenaT = ARENA_HOLE_EVERY
    state.arenaWave++
    // 웨이브당 조각 수: 1,1,2,2,3,3… (상한 3) — 갈수록 좁아진다
    const chunks = Math.min(1 + Math.floor((state.arenaWave - 1) / 2), 3)
    for (let i = 0; i < chunks; i++) {
      const p = arenaPickHole(state)
      if (p) state.holeWarns.push({ id: state.nextId++, x: p.x, z: p.z, r: ARENA_HOLE_R, at: state.time + ARENA_WARN_T })
    }
  }
  // 경고 만료 → 구멍 확정 + 그 위의 영웅 추락 (동시 전멸은 아래 전멸 판정에서 체력→골드→랜덤)
  if (state.holeWarns.length) {
    const due = state.holeWarns.filter((w) => state.time >= w.at)
    if (due.length) {
      state.holeWarns = state.holeWarns.filter((w) => state.time < w.at)
      const prefall = { blue: { hp: 0, gold: 0 }, red: { hp: 0, gold: 0 } }
      const fallen = []
      for (const w of due) {
        state.holes.push({ id: w.id, x: w.x, z: w.z, r: w.r })
        pushFx(state, 'descend', w.x, w.z, w.r, null, 1.5) // 하늘 광선 — 바닥이 뜯겨 나간다
        // 붕괴 반경의 지형은 진짜로 사라진다 — 성벽·수풀·바위의 충돌/은신/경로까지 함께
        {
          const mp = state.map
          const segNear = (l) => {
            const dx = l.x2 - l.x1
            const dz = l.z2 - l.z1
            const len2 = dx * dx + dz * dz || 1e-9
            let t = ((w.x - l.x1) * dx + (w.z - l.z1) * dz) / len2
            t = t < 0 ? 0 : t > 1 ? 1 : t
            return Math.hypot(l.x1 + dx * t - w.x, l.z1 + dz * t - w.z)
          }
          mp.WALLS = mp.WALLS.filter((c) => Math.hypot(c.x - w.x, c.z - w.z) > w.r + c.r * 0.5)
          mp.WALL_LINES = mp.WALL_LINES.filter((l) => segNear(l) > w.r * 0.85)
          mp.BUSHES = mp.BUSHES.filter((b) => Math.hypot(b.x - w.x, b.z - w.z) > w.r + b.r * 0.4)
          mp.ROCKS = mp.ROCKS.filter((c) => Math.hypot(c.x - w.x, c.z - w.z) > w.r)
          mp._nav = null // 내비 격자·정적 원 캐시 무효화 — 다음 findPath 때 뚫린 지형으로 재베이크
          mp._navCircles = null
        }
        for (const h of state.heroes) {
          if (h.respawnT > 0 || h.hp <= 0 || h.fallT > 0 || fallen.some(([f]) => f === h)) continue
          if (Math.hypot(h.x - w.x, h.z - w.z) < w.r * 0.75) {
            fallen.push([h, w])
            prefall[h.team].hp += h.hp
            prefall[h.team].gold += h.gold
          }
        }
      }
      for (const [f, w] of fallen) arenaFall(state, f, w)
      // 동시 전멸 타이브레이크: 낙하 직전 체력 → 골드 → 랜덤
      if (arenaAliveCount(state, 'blue') === 0 && arenaAliveCount(state, 'red') === 0) {
        state.winner = prefall.blue.hp !== prefall.red.hp
          ? (prefall.blue.hp > prefall.red.hp ? 'blue' : 'red')
          : prefall.blue.gold !== prefall.red.gold
            ? (prefall.blue.gold > prefall.red.gold ? 'blue' : 'red')
            : (state.rng() < 0.5 ? 'blue' : 'red')
        state.status = 'finished'
        return
      }
    }
  }
  // 확정된 구멍: 걸어 들어가거나 밀려 들어가면 추락
  if (state.holes.length) {
    for (const h of state.heroes) {
      if (h.respawnT > 0 || h.hp <= 0 || h.fallT > 0) continue
      const o = state.holes.find((o) => Math.hypot(h.x - o.x, h.z - o.z) < o.r * 0.65)
      if (o) arenaFall(state, h, o)
    }
  }
  // 낙하 진행 — 구멍 중심으로 빨려 들어가고, 다 떨어지면 사망 확정
  for (const h of state.heroes) {
    if (!(h.fallT > 0) || h.hp <= 0 || h.respawnT > 0) continue
    h.fallT -= dt
    h.mx = 0
    h.mz = 0
    const d = Math.hypot(h.fallX - h.x, h.fallZ - h.z)
    if (d > 0.1) {
      const pull = Math.min(d, 6 * dt)
      h.x += ((h.fallX - h.x) / d) * pull
      h.z += ((h.fallZ - h.z) / d) * pull
    }
    if (h.fallT <= 0) damageHero(state, h, 1e9, null)
  }
  // 전멸 판정(모든 사망 경로 공통) — 한 팀이 비면 종료
  const ab = arenaAliveCount(state, 'blue')
  const ar = arenaAliveCount(state, 'red')
  if (ab === 0 || ar === 0) {
    state.winner = ab === 0 && ar === 0 ? (state.rng() < 0.5 ? 'blue' : 'red') : ab === 0 ? 'red' : 'blue'
    state.status = 'finished'
  }
}

function stepWaves(state, dt) {
  if (state.mode === 'arena') return // 콜로세움: 병사 없음
  if (state.mode === 'defense') return stepDefenseWaves(state, dt) // 방어전: 전용 파도 시스템
  if (isRaidMode(state.mode)) return // 레이드: 정규 웨이브 없음 — 보스/파도 소환 병사가 라인을 민다
  state.waveT -= dt
  if (state.waveT > 0) return
  state.waveT += WAVE_PERIOD
  const grow = MINION_HP_GROWTH * (state.time / 60)
  for (const team of ['blue', 'red']) {
    for (const lane of LANE_IDS) {
      for (let i = 0; i < 6; i++) {
        const ranged = i >= 3 // 0,1,2=근접 / 3,4,5=원거리
        const spec = ranged ? RANGED : MELEE
        const wps = state.map.LANES[lane]
        // 수호석 충돌체에 끼지 않게, 본진에서 레인 쪽으로 살짝 나간 곳에서 출발
        const a = team === 'blue' ? wps[0] : wps[wps.length - 1]
        const b = team === 'blue' ? wps[1] : wps[wps.length - 2]
        const d = Math.hypot(b.x - a.x, b.z - a.z) || 1
        // 최후의 포탑(본진 앞) 너머 레인 쪽에서 출발 — 근접이 앞(중앙 쪽), 원거리가 뒤.
        const off = ranged ? 11 : 14
        state.minions.push({
          id: state.nextId++,
          team,
          lane,
          ranged,
          x: a.x + ((b.x - a.x) / d) * off + (state.rng() - 0.5) * 2.5,
          z: a.z + ((b.z - a.z) / d) * off + (state.rng() - 0.5) * 2.5,
          hp: spec.hp + grow,
          maxHp: spec.hp + grow,
          atkCd: i * 0.3, // 줄지어 공격하게 살짝 어긋나게
          dir: team === 'blue' ? 0 : Math.PI, // 바라보는 방향 (공격 모션용)
          atkSeq: 0, // 공격할 때마다 +1 (찌르기/사격 모션 트리거)
          wpI: team === 'blue' ? 1 : wps.length - 2,
        })
      }
    }
  }
}

function stepHero(state, h, dt) {
  // 상점 세션 감지: 우물/사망으로 상점을 열 수 있게 되면 진입 시점을 스냅샷,
  //   벗어나면(레인 복귀/부활 후 출발) 스냅샷을 버려 그 이전 구매는 취소 불가가 된다.
  const cs = canShop(h)
  if (cs && !h.couldShop) {
    h.shopStack = []
    h.shopChanged = false
  } else if (!cs && h.couldShop) {
    h.shopStack = null
    h.shopChanged = false
  }
  h.couldShop = cs
  h.atkCd = Math.max(0, h.atkCd - dt)
  const skillWas = h.skillCd
  h.skillCd = Math.max(0, h.skillCd - dt)
  h.skill2Cd = Math.max(0, h.skill2Cd - dt)
  h.ultCd = Math.max(0, h.ultCd - dt)
  // 엔지니어 포탑 재고: skillCd는 "다음 재고" 충전 타이머 — 막 다 돌았으면 1개 채우고,
  // 아직 최대(3개)가 아니면 타이머를 다시 돌린다. 설치(castSkill)는 재고만 소모한다.
  if (h.cls === 'engineer') {
    if (skillWas > 0 && h.skillCd <= 0 && (h.turretStock ?? 0) < ENGI_MAX_TURRETS) {
      h.turretStock = (h.turretStock ?? 0) + 1
    }
    if ((h.turretStock ?? 0) < ENGI_MAX_TURRETS && h.skillCd <= 0) {
      h.skillCd = CLASSES.engineer.skill.cd * (1 - itemBonus(h).cdr)
    }
  }
  for (const k in h.itemCd) {
    h.itemCd[k] = Math.max(0, h.itemCd[k] - dt)
    if (h.itemCd[k] === 0) delete h.itemCd[k] // 다 돈 쿨은 지워 스냅샷을 가볍게
  }
  h.dragonT = Math.max(0, h.dragonT - dt)
  h.baronT = Math.max(0, h.baronT - dt)
  h.shieldT = Math.max(0, h.shieldT - dt)
  h.slowT = Math.max(0, h.slowT - dt)
  h.freezeT = Math.max(0, h.freezeT - dt)
  h.berserkT = Math.max(0, h.berserkT - dt)
  h.rageT = Math.max(0, h.rageT - dt)
  h.wardT = Math.max(0, h.wardT - dt)
  if (h.bindT > 0 && (h.bindT = Math.max(0, h.bindT - dt)) === 0) h.bindBy = null
  h.bindAnchorT = Math.max(0, h.bindAnchorT - dt)
  h.vulnT = Math.max(0, h.vulnT - dt)
  h.parryT = Math.max(0, h.parryT - dt)
  h.rootT = Math.max(0, h.rootT - dt)
  h.airT = Math.max(0, h.airT - dt)
  h.bladeT = Math.max(0, h.bladeT - dt)
  if (h.barrierT > 0 && (h.barrierT = Math.max(0, h.barrierT - dt)) === 0) h.barrierHp = 0
  h.stealthT = Math.max(0, h.stealthT - dt)
  h.fearT = Math.max(0, h.fearT - dt)
  h.hasteT = Math.max(0, h.hasteT - dt)
  if (h.thornArmorT > 0) h.thornArmorT = Math.max(0, h.thornArmorT - dt) // 가시갑옷 반사창
  // 가시 낙인: 시한이 다하면 낙인자 위치에서 폭발 — 반경 안 아군 전원(본인 포함) 피해
  if (h.thornBombT > 0) {
    h.thornBombT -= dt
    if (h.thornBombT <= 0) {
      h.thornBombT = 0
      const from = state.heroes.find((b) => b.id === h.thornBombFrom) || null
      pushFx(state, 'quake', h.x, h.z, 4.5, 'red', 1.0)
      for (const o of state.heroes) {
        if (o.team !== h.team || o.respawnT > 0) continue
        if (dist(h, o) > 4.5) continue
        damageHero(state, o, h.thornBombDmg || 0, from)
      }
    }
  }
  if (h.tauntT > 0 && (h.tauntT = Math.max(0, h.tauntT - dt)) === 0) h.tauntBy = null
  h.revealT = Math.max(0, h.revealT - dt)
  h.aggroT = Math.max(0, h.aggroT - dt)
  h.gold += GOLD_PASSIVE * dt // 초당 자동 수입 — 죽어 있어도 계속 모인다(살아 있을 때도 동일 적용)
  // 부활 대기 → 우물에서 부활
  if (h.respawnT > 0) {
    h.respawnT = Math.max(0, h.respawnT - dt)
    if (h.respawnT === 0) {
      const slot = state.heroes.filter((o) => o.team === h.team).indexOf(h)
      const pos = spawnPos(state.map, h.team, slot, state.teamSize)
      h.x = pos.x
      h.z = pos.z
      h.hp = h.maxHp
      h.lastHitBy = null
      h.lastHitT = -99
      h.bushI = -1
      h.dir = h.team === 'blue' ? 0 : Math.PI
      h.knockT = 0; h.knockVx = 0; h.knockVz = 0; h.knockStun = 0; h.airT = 0
      h.trail = [] // 되감기로 죽기 직전 위치로 못 돌아가게 — 부활 시 기록 초기화
      h.trailT = 0
    }
    return
  }
  h.stunT = Math.max(0, h.stunT - dt)
  // 보스: 군중제어를 빠르게 떨쳐낸다 — 5인이 CC를 이어 걸어도 영구 기절하지 않는다
  if (h.isBoss) {
    const ex = dt * BOSS_CC_RESIST
    h.stunT = Math.max(0, h.stunT - ex)
    h.freezeT = Math.max(0, h.freezeT - ex)
    h.fearT = Math.max(0, h.fearT - ex)
    h.airT = Math.max(0, h.airT - ex)
    h.rootT = Math.max(0, h.rootT - ex)
    h.pullT = Math.max(0, h.pullT - ex)
    h.tauntT = Math.max(0, h.tauntT - ex)
  }
  // 광폭화: 상태이상 면역 — 풀 폭주 3초 동안만 매 틱 떨쳐낸다 (페이드 구간엔 면역 없음 — 6초 면역은 과했다)
  if (h.berserkT > BERSERK_FADE) {
    h.stunT = 0
    h.freezeT = 0
    h.airT = 0
    h.fearT = 0
    h.fearFrom = null
  }
  // 중독(주술사 DoT): 매 틱 피해. 가해자를 넘겨 킬 크레딧을 정상 처리한다.
  if (h.poisonT > 0) {
    h.poisonT = Math.max(0, h.poisonT - dt)
    const by = state.heroes.find((o) => o.id === h.poisonBy && o.team !== h.team)
    damageHero(state, h, h.poisonDps * dt, by || null)
  }
  // 정신집중(궁수 빛의 화살): 1초 집중 후 발사. 그동안 제자리(아래 이동에서 막힘), 기절당하면 끊긴다.
  if (h.castT > 0) {
    if (h.stunT > 0) {
      h.castT = 0 // 기절에 끊김 — 불발
    } else {
      h.castT = Math.max(0, h.castT - dt)
      if (h.castT === 0) fireLightArrow(state, h)
    }
  }
  // 귀환 채널링: 누르면 그 자리에 멈춰(이동 입력 무시) RECALL_TIME초 버티면 우물로 복귀.
  //  이동으로는 안 끊기고(자동으로 멈춘다), 기절/피격에만 끊긴다.
  if (h.recallT > 0) {
    if (h.stunT > 0) {
      h.recallT = 0 // 기절에 끊김 (피격은 damageHero에서 끊는다)
    } else {
      h.recallT = Math.max(0, h.recallT - dt)
      if (h.recallT === 0) {
        const slot = state.heroes.filter((o) => o.team === h.team).indexOf(h)
        const pos = spawnPos(state.map, h.team, slot, state.teamSize)
        h.x = pos.x
        h.z = pos.z
        h.dir = h.team === 'blue' ? 0 : Math.PI
        h.bushI = state.map.bushIndexAt(h.x, h.z)
        h.mx = 0 // 귀환 직후엔 정지 — 귀환 전 이동 입력이 남아 저절로 걷는 것 방지
        h.mz = 0
        pushFx(state, 'recall', h.x, h.z, 4, h.team)
      }
    }
  }
  // 사슬갈고리 발사 준비: 짧게 모은 뒤 투사체 발사 (기절당하면 불발)
  if (h.hookWindT > 0) {
    if (h.stunT > 0) h.hookWindT = 0
    else {
      h.hookWindT = Math.max(0, h.hookWindT - dt)
      if (h.hookWindT === 0) fireHook(state, h)
    }
  }
  // 끌려오는 중: 시전자 쪽으로 남은 시간 동안 천천히 당겨지며 스턴(아무것도 못 함)
  if (h.pullT > 0) {
    const by = state.heroes.find((o) => o.id === h.pullBy)
    if (by) {
      const dx = by.x - h.x, dz = by.z - h.z
      const d = Math.hypot(dx, dz)
      const stopGap = HERO_RADIUS * 2 + 0.4
      if (d > stopGap) {
        const frac = Math.min(1, dt / h.pullT) // 남은 시간 대비 이번 틱 이동 비율 → 끝날 때 도착
        h.x += dx * frac
        h.z += dz * frac
        state.map.resolveTerrain(h, HERO_RADIUS, colliders(state))
        h.bushI = state.map.bushIndexAt(h.x, h.z)
      }
    }
    h.stunT = Math.max(h.stunT, h.pullT)
    h.pullT = Math.max(0, h.pullT - dt)
  }
  // 넉백(돌풍술사): 밀려나는 동안 입력 무시. 벽/타워에 막혀 거의 안 밀리면 "벽꽝"으로 기절.
  if (h.knockT > 0) {
    const want = Math.hypot(h.knockVx, h.knockVz) * dt
    const px = h.x, pz = h.z
    h.x += h.knockVx * dt
    h.z += h.knockVz * dt
    state.map.resolveTerrain(h, HERO_RADIUS, colliders(state))
    const moved = Math.hypot(h.x - px, h.z - pz)
    if (h.knockStun > 0 && want > 0.05 && moved < want * KNOCK_WALL_FRAC) {
      h.stunT = Math.max(h.stunT, h.knockStun) // 벽꽝!
      pushFx(state, 'boom', h.x, h.z, 2.4, h.team)
      h.knockT = 0 // 벽에 박혔으니 더 밀리지 않는다
    } else {
      h.knockT = Math.max(0, h.knockT - dt)
    }
    if (h.knockT <= 0) { h.knockVx = 0; h.knockVz = 0; h.knockStun = 0 }
    h.bushI = state.map.bushIndexAt(h.x, h.z)
  }
  // 공포(공포술사): 통제 불능 — 컨트롤을 잃고 랜덤한 방향으로 갈팡질팡 내달린다(약한 슬로우).
  //  이동 입력 무시 (기절/속박이 겹치면 그쪽이 우선). 방향은 FEAR_TURN_T마다 재추첨 — 어디로 튈지 모른다.
  if (h.fearT > 0 && h.stunT <= 0 && h.rootT <= 0 && h.knockT <= 0 && h.pullT <= 0) {
    h.fearTurnT -= dt
    if (h.fearTurnT <= 0) {
      h.fearDir = state.rng() * Math.PI * 2
      h.fearTurnT = FEAR_TURN_T
    }
    h.dir = h.fearDir
    const sp = heroSpeed(h) * FEAR_FLEE_SPD * (h.freezeT > 0 ? FREEZE_MOVE : 1)
    h.x += Math.cos(h.fearDir) * sp * dt
    h.z += Math.sin(h.fearDir) * sp * dt
  }
  // 이동 — 기절·정신집중·귀환 채널·속박·발사준비·넉백·공포 중엔 제자리에 멈춘다(이동 입력 무시)
  if (h.stunT <= 0 && h.castT <= 0 && h.recallT <= 0 && h.rootT <= 0 && h.hookWindT <= 0 && h.knockT <= 0 && h.fearT <= 0 && !(h.fallT > 0)) {
    const len = Math.hypot(h.mx, h.mz)
    if (len > 0.12) {
      // 공격 직후엔 발이 무겁고, 탱커는 방패막기 중 돌진 가속, 빙결 중엔 굼뜨다,
      // 광폭화(전사)·가속(힐러 버프)이면 발이 빨라진다
      const slow = h.slowT > 0 ? ATK_SLOW : 1
      const charge = h.cls === 'tank' && h.shieldT > 0 ? 1.45 : 1
      const frz = h.freezeT > 0 ? FREEZE_MOVE : 1
      const berserk = h.berserkT > 0 ? 1 + BERSERK_SPD * berserkStrength(h) : 1
      const haste = h.hasteT > 0 ? 1 + HASTE_SPD : 1
      const rage = h.rageT > 0 ? 1 + RAGE_SPD : 1 // 검투의 분노: 이동속도 ↑
      const sp = heroSpeed(h) * slow * charge * frz * berserk * haste * rage * Math.min(1, len)
      h.dir = Math.atan2(h.mz, h.mx)
      h.x += (h.mx / len) * sp * dt
      h.z += (h.mz / len) * sp * dt
    }
  }
  state.map.resolveTerrain(h, HERO_RADIUS, colliders(state))
  h.bushI = state.map.bushIndexAt(h.x, h.z) // 수풀 은신 판정
  // 리스폰 존(수호석 뒤편 회복 지대): 우리 편이면 회복, 적이면 따끔!
  for (const team of ['blue', 'red']) {
    if (dist2(h, state.map.FOUNTAIN_POS[team]) > FOUNTAIN_RADIUS * FOUNTAIN_RADIUS) continue
    // 보스는 옥좌(자기 우물) 위에서도 우물 회복을 받지 않는다 — 전용 재생만 쓴다.
    // 콜로세움은 우물이 스폰 지점일 뿐 — 회복도 레이저도 없다(포션이 유일한 회복 수단)
    if (state.mode === 'arena') { /* no-op */ }
    else if (team === h.team) { if (!h.isBoss) h.hp = Math.min(h.maxHp, h.hp + h.maxHp * FOUNTAIN_HEAL * dt) }
    else damageHero(state, h, FOUNTAIN_DMG * dt, null)
  }
  // 자연 회복 (전투 이탈 시) + 이무기 버프 회복.
  // 보스는 제외 — 전용 재생(bossThink, 0.5%/s)만 쓴다. 공통 회복(1.5%/s)까지 겹치면
  // 각성 휴지기(무적 30초)마다 반피를 되채우는 참사가 난다.
  if (state.time - h.lastHurt > REGEN_DELAY && !h.isBoss && state.mode !== 'arena') {
    h.hp = Math.min(h.maxHp, h.hp + h.maxHp * REGEN_RATE * dt) // 콜로세움: 자연 재생 없음 — 포킹이 쌓인다
  }
  if (h.baronT > 0) h.hp = Math.min(h.maxHp, h.hp + h.maxHp * 0.02 * dt)
  if (h.rageT > 0) h.hp = Math.min(h.maxHp, h.hp + h.maxHp * RAGE_REGEN * dt) // 검투의 분노: 지속 회복
  // 아이템 체력 재생 (전투 중에도 항상)
  if (itemBonus(h).regen > 0) h.hp = Math.min(h.maxHp, h.hp + h.maxHp * itemBonus(h).regen * dt)
  // (골드 자동 수입은 위쪽에서 — 죽어 있을 때도 모이도록 부활 분기 앞에서 처리한다)
  // 회전베기(전사 궁극기): 도는 동안 WHIRL_TICK 간격으로 반경 안을 후린다 (이동은 위에서 이미 처리)
  if (h.whirlT > 0) {
    h.whirlT = Math.max(0, h.whirlT - dt)
    h.whirlTickT -= dt
    if (h.whirlTickT <= 0) {
      h.whirlTickT += WHIRL_TICK
      aoeDamage(state, h, h.x, h.z, WHIRL_RADIUS, skillDmg(h, 10, 0.15), 0) // 공격력 계수 (전사) — 폭딜 억제(절반)
      pushFx(state, 'whirl', h.x, h.z, WHIRL_RADIUS, h.team)
      h.revealT = Math.max(h.revealT, 0.4)
    }
  }
  // 대지술사 돌팔매 3연투: 고정 각도(slingDir)로 SLING_INTERVAL마다 돌을 던진다.
  //  이동하며 던질 수 있지만 각도는 안 바뀌고, 기절/공포 중엔 멈췄다가 풀리면 이어 던진다.
  if (h.slingN > 0) {
    h.slingT -= dt
    if (h.slingT <= 0 && canAct(h)) {
      h.slingT += SLING_INTERVAL
      h.slingN--
      h.dir = h.slingDir // 던지는 순간엔 고정 각도를 바라본다
      state.projectiles.push({
        id: state.nextId++, kind: 'rock', team: h.team, owner: h.id,
        x: h.x + Math.cos(h.slingDir) * 1.4, z: h.z + Math.sin(h.slingDir) * 1.4,
        vx: Math.cos(h.slingDir) * ROCK_SPEED, vz: Math.sin(h.slingDir) * ROCK_SPEED,
        travel: 0, dmg: h.slingDmg,
      })
      h.revealT = Math.max(h.revealT, 0.5)
    }
  }
  // 시간술사: 일정 간격으로 현재 위치·체력 표본을 남긴다(깜빡임/역행이 과거로 되돌아갈 좌표).
  if (h.cls === 'chronomancer') {
    h.trailT -= dt
    if (h.trailT <= 0) {
      h.trailT += TRAIL_DT
      h.trail.push({ x: h.x, z: h.z, hp: h.hp })
      if (h.trail.length > TRAIL_MAX) h.trail.shift()
    }
  }
}

// 주변에서 공격받는 아군 영웅의 "가해자(적 영웅)"를 찾는다.
//  - 최근 맞은 아군이 가까이 있고, 그 가해자도 수비 사거리 안이면 그 적을 노린다.
//  - 단, 처음 끼어든 지점(anchor)에서 너무 멀어지게 쫓기 시작하면 포기하고 레인으로 복귀한다.
function findDefendTarget(state, m) {
  if (m.returnT > 0) return null // 복귀 중엔 한눈팔지 않는다
  const r2 = MINION_DEFEND_RANGE * MINION_DEFEND_RANGE
  let best = null
  let bd = r2
  for (const ally of state.heroes) {
    if (ally.team !== m.team || ally.respawnT > 0) continue
    if (state.time - ally.lastHurt > MINION_DEFEND_HURT_T) continue
    if (dist2(m, ally) > r2) continue
    const foe = state.heroes.find(
      (e) => e.id === ally.lastHitBy && e.team !== m.team && e.respawnT <= 0
    )
    if (!foe) continue
    const d = dist2(m, foe)
    if (d < bd) {
      bd = d
      best = foe
    }
  }
  return best
}

function stepMinions(state, dt) {
  for (const m of [...state.minions]) {
    m.atkCd = Math.max(0, m.atkCd - dt)
    m.returnT = Math.max(0, (m.returnT || 0) - dt)
    const spec = m.ranged ? RANGED : MELEE
    const sx0 = m.x
    const sz0 = m.z
    let marched = false

    // 0) 공격받는 아군 영웅 방어: 가해자(적 영웅)를 최우선으로 노린다
    let tgt = null
    let bd = MINION_SIGHT * MINION_SIGHT
    const defender = findDefendTarget(state, m)
    if (defender) {
      // 처음 끼어들 때 시작점을 기억해 두고, 거기서 너무 멀어지면 포기한다
      if (!m.defending) {
        m.defending = true
        m.anchorX = m.x
        m.anchorZ = m.z
      }
      if (Math.hypot(m.x - m.anchorX, m.z - m.anchorZ) > MINION_DEFEND_LEASH) {
        m.defending = false
        m.returnT = 1.5 // 잠깐 레인으로 돌아간다 (다시 끌려가지 않게)
      } else {
        tgt = { ref: { tk: 'hero', id: defender.id }, e: defender }
      }
    } else {
      m.defending = false
    }

    // 1) 평소 타게팅: 시야 안 병사 → 소환물(포탑/펫/분신) → 영웅 → 타워/수호석
    if (!tgt) {
      for (const o of state.minions) {
        if (o.team === m.team) continue
        const d = dist2(m, o)
        if (d < bd) {
          bd = d
          tgt = { ref: { tk: 'minion', id: o.id }, e: o }
        }
      }
    }
    if (!tgt) {
      for (const o of state.summons) {
        if (o.team === m.team) continue
        const d = dist2(m, o)
        if (d < bd) {
          bd = d
          tgt = { ref: { tk: 'summon', id: o.id }, e: o }
        }
      }
    }
    if (!tgt) {
      for (const o of state.heroes) {
        if (o.team === m.team || o.respawnT > 0) continue
        if ((o.bushI >= 0 || o.stealthT > 0) && o.revealT <= 0) continue // 수풀·은신 중은 병사도 못 본다
        const d = dist2(m, o)
        if (d < bd) {
          bd = d
          tgt = { ref: { tk: 'hero', id: o.id }, e: o }
        }
      }
    }
    if (!tgt) {
      for (const t of state.towers) {
        if (!t.alive || t.team === m.team || !towerVulnerable(state, t)) continue
        const d = dist2(m, t)
        if (d < bd) {
          bd = d
          tgt = { ref: { tk: 'tower', id: t.id }, e: t }
        }
      }
      const en = enemyOf(m.team)
      if (nexusVulnerable(state, en) && state.nexus[en].hp > 0) {
        const np = state.map.NEXUS_POS[en]
        const d = dist2(m, np)
        if (d < bd) tgt = { ref: { tk: 'nexus', id: en }, e: np }
      }
    }
    if (tgt) {
      const d = dist(m, tgt.e)
      // 구조물은 몸통 반경만큼 더해 줘야 근접 병사도 수호석/타워에 닿는다
      const pad = tgt.ref.tk === 'tower' ? TOWER_RADIUS : tgt.ref.tk === 'nexus' ? NEXUS_RADIUS : 0
      if (d <= spec.range + 0.5 + pad) {
        m.dir = Math.atan2(tgt.e.z - m.z, tgt.e.x - m.x) // 적을 바라본다
        if (m.atkCd <= 0) {
          m.atkCd = spec.cd
          m.atkSeq++
          // 상대가 병사이면 피해를 깎아 라인 교전이 천천히 풀리게 한다
          let out = tgt.ref.tk === 'minion' ? spec.dmg * MINION_VS_MINION : spec.dmg
          // 보스전 역할 분리: 병사의 일은 건물 철거 — 영웅에겐 잽 수준. 영웅 사냥은 보스의 몫
          if (isRaidMode(state.mode) && m.team === 'red' && tgt.ref.tk === 'hero') out *= state.mode === 'defense' ? 0.75 : 0.55
          if (m.ranged) {
            // 원거리 병사는 작은 화살을 쏜다 ('mbolt' — 영웅 탄과 구분되는 작은 투사체)
            state.projectiles.push({
              id: state.nextId++, kind: 'mbolt', team: m.team,
              x: m.x, z: m.z, target: tgt.ref, dmg: out, speed: 26,
            })
          } else {
            applyDamage(state, tgt.ref, out, { team: m.team })
          }
        }
      } else {
        moveMinion(state, m, tgt.e, dt)
        marched = true
      }
    } else {
      // 레인 행군: 경유지를 차례로 통과한다.
      //  - 경유지에 "닿거나" 진행 방향으로 그 지점을 "지나치면" 다음 경유지로 넘어간다.
      //  - 미드 1차 타워는 경유지(-34,0)/(34,0) 위에 서 있어 그 칸에 3 이내로
      //    못 들어간다 → 닿기만 기다리면 wpI가 안 넘어가 타워를 빙빙 돌며 라인이 멈춘다.
      //    "지나침" 판정을 더해 타워를 돌아 나가면 곧장 다음 칸을 향하게 한다.
      const wps = state.map.LANES[m.lane]
      const dirI = m.team === 'blue' ? 1 : -1
      let guard = 0
      while (guard++ < wps.length) {
        const wp = wps[m.wpI]
        const nextWp = wps[m.wpI + dirI]
        if (!wp) break
        let passed = dist(m, wp) < 3
        if (!passed && nextWp) {
          // 경유지에서 다음 경유지로 향하는 방향 기준, 병사가 그 너머에 있으면 지나친 것
          const fx = nextWp.x - wp.x
          const fz = nextWp.z - wp.z
          if ((m.x - wp.x) * fx + (m.z - wp.z) * fz > 0) passed = true
        }
        if (passed) m.wpI += dirI
        else break
      }
      const wp = wps[m.wpI]
      if (wp) {
        // 현재 칸에 가까워지면 다음 칸을 겨눈다. 그래야 그 칸 위에 선 타워를
        // "목적지"가 아닌 "장애물"로 보고 avoidDir가 깔끔히 돌아 나간다.
        const nextWp = wps[m.wpI + dirI]
        const aim = nextWp && dist(m, wp) < 7 ? nextWp : wp
        moveMinion(state, m, aim, dt)
        marched = true
      }
    }
    state.map.resolveTerrain(m, 0.8, state.towers)
    // 끼임 감지: 가려고 했는데 거의 못 움직였으면 분노 게이지를 올리고,
    // 일정 이상 쌓이면 moveMinion이 옆으로 비껴 빠져나간다 (벽-타워 틈 탈출)
    if (marched) {
      const moved = Math.hypot(m.x - sx0, m.z - sz0)
      if (moved < MINION_SPEED * dt * 0.3) {
        if (!m.stuckT) m.stuckSide = state.rng() < 0.5 ? 1 : -1
        m.stuckT = (m.stuckT || 0) + dt
        if (m.stuckT > 1.6) m.stuckT = 0 // 한참 헤맸으면 반대쪽으로 다시 시도
      } else {
        m.stuckT = Math.max(0, (m.stuckT || 0) - dt * 1.5)
      }
    } else {
      m.stuckT = 0
    }
  }
  // 같은 자리에 겹치지 않게 서로 살짝 밀어내기
  const ms = state.minions
  for (let i = 0; i < ms.length; i++) {
    for (let j = i + 1; j < ms.length; j++) {
      const a = ms[i]
      const b = ms[j]
      let dx = b.x - a.x
      let dz = b.z - a.z
      const d = Math.hypot(dx, dz)
      if (d >= 1.6 || d === 0) continue
      const push = (1.6 - d) / 2
      dx /= d
      dz /= d
      a.x -= dx * push
      a.z -= dz * push
      b.x += dx * push
      b.z += dz * push
    }
  }
}

// 목표를 향해 이동하되, 길을 막는 성벽/바위/타워는 접선으로 비켜 간다.
// (자기 편 타워가 레인 위에 있어도 병사가 끼지 않고 돌아간다)
function moveToward(state, e, to, speed, dt, selfR = 1) {
  const dir = state.map.avoidDir(e, to.x, to.z, colliders(state), selfR)
  e.x += dir.x * speed * dt
  e.z += dir.z * speed * dt
  if (dir.x || dir.z) e.dir = Math.atan2(dir.z, dir.x)
}

// 병사 전용 이동: 평소엔 회피 조향을 쓰되, 끼임이 감지되면(stuckT)
// 목표 방향에서 한쪽으로 크게 비껴 벽-타워 틈에서 빠져나간다.
function moveMinion(state, m, to, dt) {
  if ((m.stuckT || 0) > 0.4) {
    const ang = Math.atan2(to.z - m.z, to.x - m.x) + (m.stuckSide || 1) * 1.9
    m.x += Math.cos(ang) * MINION_SPEED * dt
    m.z += Math.sin(ang) * MINION_SPEED * dt
    m.dir = ang
  } else {
    moveToward(state, m, to, MINION_SPEED, dt, 0.8)
  }
}

// 정글몹: 평소엔 얌전 — 맞으면 반격, 캠프에서 멀어지면 포기하고 복귀(회복)
function stepMonsters(state, dt) {
  for (const m of state.monsters) {
    if (!m.alive) {
      m.respawnT = Math.max(0, m.respawnT - dt)
      if (m.respawnT === 0) {
        m.alive = true
        m.hp = m.maxHp
        m.x = m.camp.x
        m.z = m.camp.z
        m.combatT = 0 // 분노 초기화
        if (m.kind === 'dragon') pushFeed(state, 'spawn', '🐉 용이 나타났다! (아래 강가)')
        else if (m.kind === 'baron') pushFeed(state, 'spawn', '👹 이무기가 나타났다! (위 강가)')
      }
      continue
    }
    const spec = CAMP_MOBS[m.kind] || (m.kind === 'dragon' ? DRAGON : BARON)
    m.atkCd = Math.max(0, (m.atkCd || 0) - dt)
    const tgt = m.aggro ? state.heroes.find((h) => h.id === m.aggro && h.respawnT <= 0) : null
    const far = dist(m, m.camp) > CAMP_LEASH
    if (!tgt || far || dist(m, tgt) > CAMP_LEASH) {
      m.aggro = null
      m.combatT = 0 // 캠프로 복귀 → 분노 초기화
      if (dist(m, m.camp) > 1) {
        m.dir = Math.atan2(m.camp.z - m.z, m.camp.x - m.x) // 복귀 방향을 바라본다
        moveToward(state, m, m.camp, spec.speed * 1.5, dt, 1.2)
        m.hp = Math.min(m.maxHp, m.hp + m.maxHp * 0.5 * dt) // 복귀 중 쑥쑥 회복
      }
      continue
    }
    m.dir = Math.atan2(tgt.z - m.z, tgt.x - m.x) // 공격 대상을 바라본다 (렌더러 회전용)
    // 교전이 길어질수록 분노가 쌓여 피해/이동속도가 오른다 (용·이무기만)
    m.combatT = Math.min(ENRAGE_MAX, (m.combatT || 0) + dt)
    const rage = 1 + spec.enrage * m.combatT
    if (dist(m, tgt) <= spec.range + 1) {
      if (m.atkCd <= 0) {
        m.atkCd = spec.cd
        m.atkSeq = (m.atkSeq || 0) + 1 // 렌더러 공격 모션 트리거
        damageHero(state, tgt, spec.dmg * rage, null)
        if (m.kind === 'baron') {
          // 이무기 독 뿜기: 표적 자리에 독 웅덩이 — life 동안 그 안의 모든 영웅이 도트 피해
          state.zones.push({
            id: state.nextId++, kind: 'venom', team: null, owner: null,
            x: tgt.x, z: tgt.z, r: VENOM_R, t: 0, tickT: 0, life: VENOM_LIFE,
          })
          pushFx(state, 'venom', tgt.x, tgt.z, VENOM_R, null)
        }
      }
    } else {
      // 분노가 쌓이면 발도 빨라져 도망치는(카이팅) 사냥꾼을 따라잡는다
      moveToward(state, m, tgt, spec.speed + spec.rageSpd * m.combatT, dt, 1.2)
    }
  }
}

// 타워: 깐족거린 영웅(아군 영웅을 때린 적) → 병사 → 영웅 순으로 조준
// 타워 표적 한 개 고르기 (used에 든 표적은 제외 — 한 타워가 두 발 쏠 때 서로 다른 적을 노리게).
// 우선순위: 평소엔 병사 > 유저(영웅). 단, 사거리 안에서 우리 편 영웅을
// 때린 적 영웅(다이버)이 있으면 그 영웅으로 표적을 바꿔 반격한다.
//  → 평소엔 병사 뒤에서 타워를 철거할 수 있지만, 전투가 벌어지면 타워에 맞아 물러나야 한다.
function pickTowerTarget(state, t, r2, used) {
  let ref = null
  let bd = r2
  // 1) 우리 편 영웅을 때린 적 영웅 (반격 — 최우선)
  for (const h of state.heroes) {
    if (h.team === t.team || h.respawnT > 0 || h.aggroT <= 0) continue
    if (used.has('hero:' + h.id) || !isHeroVisible(state, h, t.team)) continue
    const d = dist2(t, h)
    if (d < bd) { bd = d; ref = { tk: 'hero', id: h.id } }
  }
  if (ref) return ref
  // 2) 병사
  bd = r2
  for (const m of state.minions) {
    if (m.team === t.team || used.has('minion:' + m.id)) continue
    const d = dist2(t, m)
    if (d < bd) { bd = d; ref = { tk: 'minion', id: m.id } }
  }
  if (ref) return ref
  // 2.5) 사거리 안 적 소환물(엔지니어 포탑/펫/분신)도 병사 다음 순위로 걷어낸다
  bd = r2
  for (const s of state.summons) {
    if (s.team === t.team || used.has('summon:' + s.id)) continue
    const d = dist2(t, s)
    if (d < bd) { bd = d; ref = { tk: 'summon', id: s.id } }
  }
  if (ref) return ref
  // 3) 병사도 없으면 그제야 보이는 적 영웅
  bd = r2
  for (const h of state.heroes) {
    if (h.team === t.team || h.respawnT > 0) continue
    if (used.has('hero:' + h.id) || !isHeroVisible(state, h, t.team)) continue
    const d = dist2(t, h)
    if (d < bd) { bd = d; ref = { tk: 'hero', id: h.id } }
  }
  return ref
}

function stepTowers(state, dt) {
  const r2 = TOWER_RANGE * TOWER_RANGE
  for (const t of state.towers) {
    if (!t.alive) continue
    t.cd = Math.max(0, t.cd - dt)
    if (t.cd > 0) continue
    // 최후의 포탑(tier3)은 더 강력하게 — 미사일을 두 발 쏜다. 표적이 둘 이상이면 각자 다른 적을 노린다.
    const shots = t.tier === 3 ? 2 : 1
    const used = new Set()
    const refs = []
    for (let i = 0; i < shots; i++) {
      const ref = pickTowerTarget(state, t, r2, used)
      if (!ref) break
      used.add(ref.tk + ':' + ref.id)
      refs.push(ref)
    }
    if (refs.length === 0) {
      // 표적이 없으면(영웅이 빠지면) 응징 연사 게이지 초기화
      t.streak = 0
      t.streakTarget = null
      continue
    }
    t.cd = TOWER_CD
    // 응징 연사(다이브 처벌) 가중은 주 표적(첫 발)이 영웅일 때만 누적한다.
    const primary = refs[0]
    if (primary.tk === 'hero') {
      if (t.streakTarget === primary.id) t.streak = (t.streak || 0) + 1
      else {
        t.streak = 0
        t.streakTarget = primary.id
      }
    } else {
      t.streak = 0
      t.streakTarget = null
    }
    for (const ref of refs) {
      let dmg
      if (ref.tk === 'hero') {
        // 주 표적만 연사 가중을 받고, 두 번째 표적은 기본 피해
        const ramp = ref === primary ? Math.min(TOWER_RAMP_MAX, 1 + TOWER_RAMP * t.streak) : 1
        dmg = TOWER_DMG_HERO * ramp
      } else {
        // 보스전: 타워가 병사를 더 아프게 때린다 — 광역기 없는 조합도 파도 국면에서
        // 타워 화력의 도움으로 초크를 지킬 수 있게(조합 복불복으로 2분대 붕괴 방지)
        dmg = TOWER_DMG_MINION * (t.team === 'blue' && (state.mode === 'defense' || (state.mode === 'boss' && state.time < 240)) ? 1.7 : 1)
      }
      state.projectiles.push({
        id: state.nextId++, kind: 'towerbolt', team: t.team,
        x: t.x, z: t.z, target: ref, dmg, speed: 34,
      })
    }
  }
}

function stepProjectiles(state, dt) {
  const remove = new Set()
  for (const p of state.projectiles) {
    if (p.kind === 'fireball') {
      // 직선 비행 — 적 영웅/병사/정글몹에 닿으면 폭발 (주변 휩쓸기)
      p.x += p.vx * dt
      p.z += p.vz * dt
      p.travel += FIREBALL_SPEED * dt
      let hit = p.travel >= FIREBALL_RANGE
      const owner = state.heroes.find((h) => h.id === p.owner)
      const touches = (e) => dist2(p, e) < 2.6 * 2.6
      if (!hit) {
        hit =
          state.heroes.some((e) => e.team !== p.team && e.respawnT <= 0 && touches(e)) ||
          state.minions.some((e) => e.team !== p.team && touches(e)) ||
          state.monsters.some((e) => e.alive && touches(e))
      }
      if (hit) {
        remove.add(p.id)
        pushFx(state, 'boom', p.x, p.z, FIREBALL_AOE, p.team)
        if (owner) aoeDamage(state, owner, p.x, p.z, FIREBALL_AOE, p.dmg, 0, 0) // 순수 폭발(빙결 없음)
      }
      continue
    }
    if (p.kind === 'hook') {
      // 직진하다 첫 적 영웅에 닿으면 1초간 천천히 끌어오며 스턴(stepHero에서 이동/스턴 처리)
      p.x += p.vx * dt
      p.z += p.vz * dt
      p.travel += HOOK_SPEED * dt
      let grabbed = null
      for (const e of state.heroes) {
        if (e.team === p.team || e.respawnT > 0) continue
        if (dist2(p, e) < HOOK_HIT_R * HOOK_HIT_R) { grabbed = e; break }
      }
      if (grabbed) {
        remove.add(p.id)
        const owner = state.heroes.find((hh) => hh.id === p.owner)
        grabbed.pullT = HOOK_PULL_TIME
        grabbed.pullBy = p.owner
        grabbed.stunT = Math.max(grabbed.stunT, HOOK_PULL_TIME)
        if (owner) damageHero(state, grabbed, skillDmg(owner, 40, 0.7), owner) // 공격력 계수
        pushFx(state, 'blink', grabbed.x, grabbed.z, 2.5, p.team)
      } else if (p.travel >= p.max) {
        remove.add(p.id)
      }
      continue
    }
    if (p.kind === 'rock') {
      // 대지술사 돌덩이: 직선 비행 — 첫 적(영웅 > 병사 > 정글몹)에 직격하면
      //  피해를 주고, 착탄 지점 주변에 파편 스플래시(직격의 60%)를 뿌린 뒤 소멸
      p.x += p.vx * dt
      p.z += p.vz * dt
      p.travel += ROCK_SPEED * dt
      const owner = state.heroes.find((hh) => hh.id === p.owner) || { id: p.owner, team: p.team }
      let hit = null
      for (const e of state.heroes) {
        if (e.team === p.team || e.respawnT > 0 || dist2(p, e) > ROCK_HIT_R * ROCK_HIT_R) continue
        damageHero(state, e, p.dmg, owner)
        hit = e
        break
      }
      if (!hit) {
        for (const m of state.minions) {
          if (m.team === p.team || dist2(p, m) > (ROCK_HIT_R - 0.2) ** 2) continue
          damageMinion(state, m, p.dmg, owner)
          hit = m
          break
        }
      }
      if (!hit) {
        for (const m of state.monsters) {
          if (!m.alive || dist2(p, m) > (ROCK_HIT_R + 0.6) ** 2) continue
          damageMonster(state, m, p.dmg, owner)
          hit = m
          break
        }
      }
      if (hit) {
        // 파편 스플래시 — 직격 대상은 제외(직격 피해만), 주변만 60%
        const ix = p.x
        const iz = p.z
        const sr2 = ROCK_SPLASH_R * ROCK_SPLASH_R
        const splash = Math.round(p.dmg * ROCK_SPLASH_FRAC)
        damageInShape(state, owner, (e) => e !== hit && (e.x - ix) ** 2 + (e.z - iz) ** 2 <= sr2, splash, 0)
        pushFx(state, 'rocksplash', p.x, p.z, ROCK_SPLASH_R, p.team)
        remove.add(p.id)
      } else if (p.travel >= ROCK_RANGE) {
        remove.add(p.id)
      }
      continue
    }
    if (p.kind === 'swordwave') {
      // 검성 무형검 검기: 앞으로 날아가며 지나친 적을 한 번씩 벤다(관통, CC 없음)
      p.x += p.vx * dt
      p.z += p.vz * dt
      p.travel += SWORDWAVE_SPEED * dt
      const owner = state.heroes.find((hh) => hh.id === p.owner) || { team: p.team }
      const r2 = SWORDWAVE_R * SWORDWAVE_R
      for (const e of state.heroes) {
        if (e.team === p.team || e.respawnT > 0 || p.hit.has(e.id) || dist2(p, e) > r2) continue
        p.hit.add(e.id)
        damageHero(state, e, p.dmg, owner)
      }
      for (const m of [...state.minions]) {
        if (m.team !== p.team && !p.hit.has(m.id) && dist2(p, m) <= r2) { p.hit.add(m.id); damageMinion(state, m, p.dmg, owner) }
      }
      for (const m of state.monsters) {
        if (m.alive && !p.hit.has(m.id) && dist2(p, m) <= r2) { p.hit.add(m.id); damageMonster(state, m, p.dmg, owner) }
      }
      for (const s of [...state.summons]) {
        if (s.team !== p.team && !p.hit.has(s.id) && dist2(p, s) <= r2) { p.hit.add(s.id); damageSummon(state, s, p.dmg, owner) }
      }
      if (p.travel >= SWORDWAVE_RANGE) remove.add(p.id)
      continue
    }
    if (p.kind === 'pierce' || p.kind === 'lightarrow') {
      // 꿰뚫는 화살/빛의 화살의 시각용 탄 — 피해는 시전 때 lineDamage로 이미 적용됨.
      // 앞으로 날아가다 사거리 끝에서 사라진다.
      p.x += p.vx * dt
      p.z += p.vz * dt
      p.travel += Math.hypot(p.vx, p.vz) * dt
      if (p.travel >= p.max) remove.add(p.id)
      continue
    }
    if (p.kind === 'tornado') {
      // 돌풍술사 회오리: 앞으로 굴러가며 통과한 적을 한 번씩 공중에 띄운다(+피해). 병사/정글몹은 피해만.
      p.x += p.vx * dt
      p.z += p.vz * dt
      p.travel += GUST_SPEED * dt
      const owner = state.heroes.find((hh) => hh.id === p.owner) || { team: p.team }
      const r2 = p.r * p.r
      for (const e of state.heroes) {
        if (e.team === p.team || e.respawnT > 0 || p.hit.has(e.id) || dist2(p, e) > r2) continue
        p.hit.add(e.id)
        damageHero(state, e, p.dmg, owner)
        const cc = e.rageT > 0 ? RAGE_CC_CUT : 1 // 검투의 분노: 받는 CC 감소
        e.airT = Math.max(e.airT, GUST_AIRBORNE * cc) // 공중에 띄운다(렌더러가 몸을 띄움)
        e.stunT = Math.max(e.stunT, GUST_AIRBORNE * cc) // 띄워진 동안은 아무것도 못 함(하드 CC)
      }
      for (const m of [...state.minions]) {
        if (m.team !== p.team && !p.hit.has(m.id) && dist2(p, m) <= r2) { p.hit.add(m.id); damageMinion(state, m, p.dmg, owner) }
      }
      for (const m of state.monsters) {
        if (m.alive && !p.hit.has(m.id) && dist2(p, m) <= r2) { p.hit.add(m.id); damageMonster(state, m, p.dmg, owner) }
      }
      if (p.travel >= p.max) remove.add(p.id)
      continue
    }
    // 유도탄 (기본공격/타워) — 대상이 사라지면 같이 사라진다
    const e = targetEntity(state, p.target)
    if (!e) {
      remove.add(p.id)
      continue
    }
    const d = dist(p, e)
    if (d < 1.4) {
      remove.add(p.id)
      const owner = state.heroes.find((h) => h.id === p.owner) || { team: p.team }
      applyDamage(state, p.target, p.dmg, owner)
      // 흡혈: 기본공격 탄(bolt)이 적 유닛에 적중하면 시전자가 회복 (구조물 제외)
      let ls = p.kind === 'bolt' && owner.items ? itemBonus(owner).lifesteal : 0
      if (p.kind === 'bolt' && owner.cls === 'gladiator') ls += GLAD_BASIC_LIFESTEAL // 검투사 고유 평타 흡혈
      if (ls > 0 && owner.respawnT <= 0 && (p.target.tk === 'hero' || p.target.tk === 'minion' || p.target.tk === 'monster')) {
        owner.hp = Math.min(owner.maxHp, owner.hp + lifestealAmount(p.dmg * ls, state)) // 로그 감쇠 적용
      }
      continue
    }
    p.x += ((e.x - p.x) / d) * p.speed * dt
    p.z += ((e.z - p.z) / d) * p.speed * dt
  }
  if (remove.size) state.projectiles = state.projectiles.filter((p) => !remove.has(p.id))
}

// 궁수 사냥매: 직선으로 날아가며 일정 간격으로 시야 흔적(reveals)을 떨궈 안개를 잠시 걷는다.
//  reveals는 수명(life)이 지나면 사라져 안개가 다시 덮인다.
function stepHawks(state, dt) {
  if (state.reveals.length) {
    for (const rv of state.reveals) rv.t += dt
    state.reveals = state.reveals.filter((rv) => rv.t < rv.life)
  }
  if (!state.hawks.length) return
  const W = state.map.WORLD
  const remove = new Set()
  for (const hk of state.hawks) {
    const adv = Math.hypot(hk.vx, hk.vz) * dt
    hk.x += hk.vx * dt
    hk.z += hk.vz * dt
    hk.travel += adv
    hk.dropAt -= adv
    if (hk.dropAt <= 0) {
      hk.dropAt += HAWK_DROP
      state.reveals.push({ team: hk.team, x: hk.x, z: hk.z, r: HAWK_REVEAL_R, t: 0, life: HAWK_REVEAL_LIFE })
    }
    // 매에 발견된(반경 안) 적 영웅은 1.5초간 둔화 — 정찰뿐 아니라 추격·이탈 방해 유틸
    const sr2 = HAWK_SLOW_R * HAWK_SLOW_R
    for (const e of state.heroes) {
      if (e.team === hk.team || e.respawnT > 0) continue
      if ((e.x - hk.x) ** 2 + (e.z - hk.z) ** 2 <= sr2) e.freezeT = Math.max(e.freezeT, HAWK_SLOW_T)
    }
    const out = hk.x < W.minX - 5 || hk.x > W.maxX + 5 || hk.z < W.minZ - 5 || hk.z > W.maxZ + 5
    if (hk.travel >= hk.max || out) remove.add(hk.id)
  }
  if (remove.size) state.hawks = state.hawks.filter((hk) => !remove.has(hk.id))
}

// 예고형 지면 범위(운석 등): delay 동안 조준점만 보이다가, 다 차면 발동(광역 피해)하고 사라진다.
function stepZones(state, dt) {
  if (!state.zones.length) return
  const remove = new Set()
  for (const z of state.zones) {
    z.t += dt
    // 역병안개: 일회성이 아니라 life 동안 머무는 지속 장판 — tick마다 범위 내 적을 중독시킨다
    if (z.kind === 'plague') {
      z.tickT -= dt
      if (z.tickT <= 0) {
        z.tickT += PLAGUE_TICK
        const owner = state.heroes.find((h) => h.id === z.owner) || { team: z.team }
        const r2 = z.r * z.r
        for (const e of state.heroes) {
          if (e.team === z.team || e.respawnT > 0) continue
          if ((e.x - z.x) ** 2 + (e.z - z.z) ** 2 > r2) continue
          applyPoison(e, owner, z.poisonDps, PLAGUE_POISON_T)
        }
        for (const m of [...state.minions]) {
          if (m.team !== z.team && (m.x - z.x) ** 2 + (m.z - z.z) ** 2 <= r2) damageMinion(state, m, z.poisonDps * PLAGUE_TICK, owner)
        }
        pushFx(state, 'boom', z.x, z.z, z.r * 0.6, z.team)
      }
      if (z.t >= z.life) remove.add(z.id)
      continue
    }
    // 보스 예고 장판: 경고(delay 동안 바닥 표식) → 폭발(피해+상태이상) → (선택) 잔류 장판.
    // "경고를 보고 피한다"가 보스전의 기본 카운터플레이 — 즉발이 아니라 읽고 반응하는 스킬.
    if (z.kind === 'bosszone') {
      if (z.t >= z.delay && !z.exploded) {
        z.exploded = true
        // 소환 장판: 피해 없이 정예를 강림시킨다(하늘빛 강림 연출은 spawnShadowAdd가 낸다)
        if (z.spawnAdd) {
          spawnShadowAdd(state, z.spawnAdd, z.x, z.z)
          remove.add(z.id)
          continue
        }
        const owner = state.heroes.find((o) => o.id === z.owner) || { team: z.team }
        const r2 = z.r * z.r
        const rIn2 = z.rIn * z.rIn
        for (const e of state.heroes) {
          if (e.team === z.team || e.respawnT > 0) continue
          const d2v = (e.x - z.x) ** 2 + (e.z - z.z) ** 2
          if (d2v > r2 || d2v < rIn2) continue // 도넛 안쪽(안전지대)은 무사하다
          damageHero(state, e, z.dmg, owner.id ? owner : null)
          if (z.stun) e.stunT = Math.max(e.stunT, z.stun)
          if (z.freeze) e.freezeT = Math.max(e.freezeT, z.freeze)
          if (z.fear) applyFear(state, e, z.fear)
          if (z.knock) applyKnockback(state, e, z.x, z.z, z.knock, z.knockStun) // 중심에서 바깥으로 밀어낸다
        }
        pushFx(state, z.vfx || 'quake', z.x, z.z, z.r, z.team, 1.0)
        if (!z.life) { remove.add(z.id); continue }
      }
      if (z.exploded) {
        // 잔류 장판(용암/서리): 밟고 있으면 도트 + 둔화
        z.tickT -= dt
        if (z.tickT <= 0) {
          z.tickT += 0.5
          const owner = state.heroes.find((o) => o.id === z.owner) || { team: z.team }
          const r2 = z.r * z.r
          const rIn2 = z.rIn * z.rIn
          for (const e of state.heroes) {
            if (e.team === z.team || e.respawnT > 0) continue
            const d2v = (e.x - z.x) ** 2 + (e.z - z.z) ** 2
            if (d2v > r2 || d2v < rIn2) continue
            if (z.dps) damageHero(state, e, z.dps * 0.5, owner.id ? owner : null)
            if (z.slow) e.freezeT = Math.max(e.freezeT, z.slow)
          }
        }
        if (z.t >= z.delay + z.life) remove.add(z.id)
      }
      continue
    }
    // 이무기 독 웅덩이: 중립 위험 지대 — life 동안 그 안의 모든 영웅이 도트 피해를 받는다
    if (z.kind === 'venom') {
      z.tickT -= dt
      if (z.tickT <= 0) {
        z.tickT += VENOM_TICK
        const r2 = z.r * z.r
        for (const e of state.heroes) {
          if (e.respawnT > 0) continue
          if ((e.x - z.x) ** 2 + (e.z - z.z) ** 2 > r2) continue
          damageHero(state, e, VENOM_DPS * VENOM_TICK, null)
        }
      }
      if (z.t >= z.life) remove.add(z.id)
      continue
    }
    // 시간 지연: life 동안 머무는 장판 — tick마다 범위 내 적을 둔화(빙결로 재활용) + 약한 지속피해
    if (z.kind === 'timewarp') {
      z.tickT -= dt
      if (z.tickT <= 0) {
        z.tickT += TIMEWARP_TICK
        const owner = state.heroes.find((h) => h.id === z.owner) || { team: z.team }
        const r2 = z.r * z.r
        for (const e of state.heroes) {
          if (e.team === z.team || e.respawnT > 0) continue
          if ((e.x - z.x) ** 2 + (e.z - z.z) ** 2 > r2) continue
          const cc = e.rageT > 0 ? RAGE_CC_CUT : 1
          e.freezeT = Math.max(e.freezeT, TIMEWARP_SLOW_T * cc) // 이동·공격이 느려진다
          damageHero(state, e, z.slowDps * TIMEWARP_TICK, owner)
        }
        for (const m of [...state.minions]) {
          if (m.team !== z.team && (m.x - z.x) ** 2 + (m.z - z.z) ** 2 <= r2) damageMinion(state, m, z.slowDps * TIMEWARP_TICK, owner)
        }
        pushFx(state, 'timewarp', z.x, z.z, z.r * 0.7, z.team)
      }
      if (z.t >= z.life) remove.add(z.id)
      continue
    }
    if (z.t < z.delay) continue
    const owner = state.heroes.find((h) => h.id === z.owner) || { team: z.team }
    if (z.kind === 'meteor') {
      aoeDamage(state, owner, z.x, z.z, z.r, z.dmg, 0)
      pushFx(state, 'meteorhit', z.x, z.z, z.r, z.team)
    } else if (z.kind === 'fissure') {
      // 한 파(구간)가 터진다 — 그 구간의 적을 길게 기절
      lineDamage(state, owner, z.x, z.z, z.dir, z.len, z.half, z.dmg, z.stun)
      pushFxDir(state, 'fissure', z.x, z.z, z.len, z.dir, z.team)
    } else if (z.kind === 'vine') {
      // 한 단이 땅에서 솟는다 — 좁은 구간의 적을 속박(기절 아님)
      lineDamage(state, owner, z.x, z.z, z.dir, z.len, z.half, z.dmg, 0, z.root)
      pushFxDir(state, 'vine', z.x, z.z, z.len, z.dir, z.team)
    }
    remove.add(z.id)
  }
  if (remove.size) state.zones = state.zones.filter((z) => !remove.has(z.id))
}

// 환영무희 분신 — 렌더러가 본체와 똑같이 그릴 수 있게 겉모습(띠/직업/이름/레벨)을 복사해 둔다.
//  · 미끼(기본 스킬): 소환 방향으로 직진하다 적 영웅을 만나면 내리찍고(피해) 펑 사라진다.
//  · 전투형(궁극기, combat=true): 봇처럼 적을 쫓아다니며 평타만 친다 — 피해는 본체 공격력의 80%.
//  burst > 0이면 그 거리만큼 진행 방향으로 튀어나간 자리에서 나타난다(연막 연출용).
function spawnClone(state, h, dir = h.dir, combat = false, burst = 0) {
  const hp = Math.round(powerStat(h) * CLONE_HP_COEF + h.maxHp * 0.25)
  const s = {
    id: state.nextId++, kind: 'clone', owner: h.id, team: h.team,
    x: h.x + Math.cos(dir) * burst, z: h.z + Math.sin(dir) * burst, dir,
    hp, maxHp: hp,
    atkCd: 0,
    dmg: combat ? Math.round(atkOf(h) * CLONE_ATK_COEF) : 0,
    range: combat ? CLASSES[h.cls].range : 0,
    aggro: combat ? CLONE_AGGRO : 0, // 인지 0이면 평타하지 않는 미끼(내리찍기 한 방만)
    speed: heroSpeed(h), mobile: true,
    cd: combat ? CLASSES[h.cls].atkCd * (1 - itemBonus(h).atkSpeed) : 99,
    life: CLONE_LIFE,
    chargeT: 0, combat,
    slamT: 0, // 미끼 내리찍기 모션 남은 시간(>0이면 시전 중)
    slamTargetId: null, // 내리찍기 고정 표적 — 도약 추적으로 반드시 명중
    slamFrom: null, // 도약 시작 지점 {x, z}
    slamDmg: combat ? 0 : Math.round(skillDmg(h, 50, 0.9)), // 내리찍기 피해 — 시전 시점 스냅샷(공격력 계수)
    decoyTx: h.x + Math.cos(dir) * 40, decoyTz: h.z + Math.sin(dir) * 40,
    zodiacId: h.zodiacId, cls: h.cls, name: h.name, lvl: h.lvl, isBot: h.isBot,
  }
  state.summons.push(s)
  return s
}

// 소환물 생성(펫/포탑). 주인(owner)의 팀/위치 기준.
function spawnSummon(state, owner, kind, x, z) {
  const spec = SUMMON_SPEC[kind]
  // 소환 시점 주인의 주력 스탯(공·주 평균)을 계수만큼 피해·체력에 얹는다 — 하이브리드 스케일.
  const ps = powerStat(owner)
  const hp = spec.hp + Math.round((spec.hpCoef || 0) * ps)
  state.summons.push({
    id: state.nextId++, kind, team: owner.team, owner: owner.id,
    x, z, dir: owner.dir, hp, maxHp: hp,
    atkCd: 0, dmg: spec.dmg + Math.round((spec.coef || 0) * ps), range: spec.range, aggro: spec.aggro,
    speed: spec.speed, mobile: spec.mobile, cd: spec.cd, life: spec.life,
    chargeT: 0, // 과부하(엔지니어) 남은 시간
    idleT: 0, // 주인 이탈 누적 시간(엔지니어 포탑 휴면 유예)
    leapT: 0, leapDur: 0, leapTargetId: null, leapTk: null, // 사냥 명령 도약(야수조련사) 진행/표적
  })
}

function damageSummon(state, s, amount, attacker) {
  const wasAlive = s.hp > 0
  s.hp -= amount // 제거는 stepSummons에서 hp<=0이면 처리
  // 처치 보상: 잡은 게 영웅이면 소량의 골드 (경험치는 없음 — 소환물 파밍으로 레벨이 새지 않게)
  if (wasAlive && s.hp <= 0 && attacker?.items) awardGold(state, attacker, GOLD_SUMMON, s.x, s.z)
}

// 소환물 갱신: 수명 감소, 가까운 적을 향해 이동/공격, 적이 없으면 (이동형은) 주인을 따라간다.
function stepSummons(state, dt) {
  if (!state.summons.length) return
  const remove = new Set()
  for (const s of state.summons) {
    s.life -= dt
    s.chargeT = Math.max(0, s.chargeT - dt)
    s.atkCd = Math.max(0, s.atkCd - dt)
    if (s.life <= 0 || s.hp <= 0) {
      if (s.hp <= 0) pushFx(state, 'death', s.x, s.z, 1.5, s.team)
      remove.add(s.id)
      continue
    }
    const owner = state.heroes.find((h) => h.id === s.owner)
    // 환영무희 미끼 분신(기본 스킬): 직진하다 보이는 적 영웅이 인지 반경에 들어오면 쫓아가고,
    //  코앞에 오면 내리찍기 모션(slamT) — 그동안 표적을 끝까지 따라붙어(도약) 반드시 명중 후 펑 사라진다.
    //  전투형 분신(궁극기)은 아래 공용 전투 로직(적 인지 → 추격 → 평타)을 그대로 탄다 — 봇처럼 싸운다.
    if (s.kind === 'clone' && !s.combat) {
      if (s.slamT > 0) {
        s.slamT -= dt
        // 도약 추적: 모션 진행도만큼 표적 현재 위치로 따라붙는다 → 도망쳐도 반드시 맞는다
        const tgt = state.heroes.find((e) => e.id === s.slamTargetId && e.respawnT <= 0)
        if (tgt && s.slamFrom) {
          const k = 1 - Math.max(0, s.slamT) / CLONE_SLAM_WINDUP
          s.x = s.slamFrom.x + (tgt.x - s.slamFrom.x) * k
          s.z = s.slamFrom.z + (tgt.z - s.slamFrom.z) * k
          if (dist2(s, tgt) > 0.01) s.dir = Math.atan2(tgt.z - s.z, tgt.x - s.x)
        }
        if (s.slamT <= 0) {
          const att = owner && owner.respawnT <= 0 ? owner : { id: s.owner, team: s.team }
          if (tgt) {
            s.x = tgt.x // 착지 = 표적 머리 위 — 확정 명중
            s.z = tgt.z
            damageHero(state, tgt, s.slamDmg, att)
          }
          // 착지 지점 주변의 다른 적도 휩쓸린다
          const r2 = CLONE_SLAM_RADIUS * CLONE_SLAM_RADIUS
          for (const e of state.heroes) {
            if (e === tgt || e.team === s.team || e.respawnT > 0 || dist2(s, e) > r2) continue
            damageHero(state, e, s.slamDmg, att)
          }
          pushFx(state, 'poof', s.x, s.z, CLONE_SLAM_RADIUS, s.team)
          remove.add(s.id)
        }
        continue
      }
      // 인지: 보이는 가장 가까운 적 영웅 (전장의 안개 규칙 준수 — 안 보이는 적은 못 쫓는다)
      let foe = null
      let bd = CLONE_SEEK_RANGE * CLONE_SEEK_RANGE
      for (const e of state.heroes) {
        if (e.team === s.team || e.respawnT > 0 || !isHeroVisible(state, e, s.team)) continue
        const d = dist2(s, e)
        if (d < bd) { bd = d; foe = e }
      }
      // 코앞이면 내리찍기 시작 — 무기를 치켜드는 모션(atkSeq)과 함께 표적 고정
      if (foe && bd <= CLONE_SLAM_TRIGGER * CLONE_SLAM_TRIGGER) {
        s.slamT = CLONE_SLAM_WINDUP
        s.slamTargetId = foe.id
        s.slamFrom = { x: s.x, z: s.z }
        s.dir = Math.atan2(foe.z - s.z, foe.x - s.x)
        s.atkSeq = (s.atkSeq || 0) + 1
        continue
      }
      // 인지 반경 안의 적은 쫓아가고, 없으면 소환 방향으로 직진
      moveToward(state, s, foe || { x: s.decoyTx, z: s.decoyTz }, s.speed, dt, 1)
      continue
    }
    // 사냥 명령 도약: 적에게 달려드는 중 — 보간 이동(점프), 그동안 다른 행동은 멈춘다.
    //  표적이 도망가도 매 틱 위치를 추적하고, 착지 시점엔 표적과 같은 자리에 내려서 무조건 한 번 문다.
    if (s.leapT > 0) {
      s.leapT = Math.max(0, s.leapT - dt)
      const tgt = findLeapEntity(state, s)
      if (tgt) {
        s.leapTo = { x: tgt.x, z: tgt.z } // 표적 현재 위치 추적
        s.dir = Math.atan2(tgt.z - s.z, tgt.x - s.x)
      }
      const k = s.leapDur > 0 ? 1 - s.leapT / s.leapDur : 1
      s.x = s.leapFrom.x + (s.leapTo.x - s.leapFrom.x) * k
      s.z = s.leapFrom.z + (s.leapTo.z - s.leapFrom.z) * k
      if (s.leapT <= 0) {
        if (tgt) {
          s.x = tgt.x // 착지 = 대상과 동일 위치
          s.z = tgt.z
          const att = owner && owner.respawnT <= 0 ? owner : { id: s.owner, team: s.team }
          if (s.leapTk === 'hero') damageHero(state, tgt, s.dmg, att)
          else if (s.leapTk === 'minion') damageMinion(state, tgt, s.dmg, att)
          else damageMonster(state, tgt, s.dmg, att)
          s.atkCd = s.cd * (s.chargeT > 0 ? OVERCHARGE_ASPD : 1) // 착지 무는 일격 후 평타 쿨 시작
        }
        s.leapFrom = null
        s.leapTo = null
        s.leapTargetId = null
        s.leapTk = null
        state.map.resolveTerrain(s, 1.0, colliders(state)) // 착지 위치 보정
      }
      continue
    }
    // 미니포탑: 주인(엔지니어)이 죽거나 사거리 밖으로 나가도 바로 멈추지 않고 3초 유예 후 휴면.
    //  유예 동안은 계속 사격하며 타이머가 줄어들고(렌더러가 표시), 주인이 사거리 안으로 돌아오면 해제.
    if (s.kind === 'turret') {
      const tethered = owner && owner.respawnT <= 0 && dist(s, owner) <= s.range
      s.idleT = tethered ? 0 : (s.idleT || 0) + dt
      s.dormant = s.idleT >= ENGI_IDLE_GRACE
      if (s.dormant) continue
    }
    // 표적: aggro 범위 내 가장 가까운 적 영웅 > 병사 > 정글몹
    let target = null
    let bd = s.aggro * s.aggro
    let tk = null
    for (const e of state.heroes) {
      if (e.team === s.team || e.respawnT > 0) continue
      const d = dist2(s, e)
      if (d < bd) { bd = d; target = e; tk = 'hero' }
    }
    for (const m of state.minions) {
      if (m.team === s.team) continue
      const d = dist2(s, m)
      if (d < bd) { bd = d; target = m; tk = 'minion' }
    }
    if (!target) {
      for (const m of state.monsters) {
        if (!m.alive) continue
        const d = dist2(s, m)
        if (d < bd) { bd = d; target = m; tk = 'monster' }
      }
    }
    if (target) {
      const d = Math.sqrt(bd)
      s.dir = Math.atan2(target.z - s.z, target.x - s.x)
      const reach = s.range + (tk === 'hero' ? 0 : 1.2)
      if (d > reach && s.mobile) {
        s.x += Math.cos(s.dir) * s.speed * dt
        s.z += Math.sin(s.dir) * s.speed * dt
        state.map.resolveTerrain(s, 1.0, colliders(state))
      } else if (d <= reach + 0.6 && s.atkCd <= 0) {
        s.atkCd = s.cd * (s.chargeT > 0 ? OVERCHARGE_ASPD : 1)
        s.atkSeq = (s.atkSeq || 0) + 1 // 렌더러 공격 모션 트리거(분신 무기 휘두름 등)
        const att = owner && owner.respawnT <= 0 ? owner : { id: s.owner, team: s.team }
        if (tk === 'hero') damageHero(state, target, s.dmg, att)
        else if (tk === 'minion') damageMinion(state, target, s.dmg, att)
        else damageMonster(state, target, s.dmg, att)
        if (!s.mobile) pushFxDir(state, 'chain', s.x, s.z, d, s.dir, s.team) // 포탑 사격 시각
      }
    } else if (s.mobile && owner && owner.respawnT <= 0) {
      const d = dist(s, owner)
      if (d > 5) {
        s.dir = Math.atan2(owner.z - s.z, owner.x - s.x)
        s.x += Math.cos(s.dir) * s.speed * dt
        s.z += Math.sin(s.dir) * s.speed * dt
        state.map.resolveTerrain(s, 1.0, colliders(state))
      }
    }
  }
  if (remove.size) state.summons = state.summons.filter((s) => !remove.has(s.id))
}

// ── 봇 AI ──
// 체력이 낮으면 리스폰 존(수호석 뒤편 회복 지대)으로 후퇴, "보이는" 적 영웅과는 직업 사거리에 맞춰 교전,
// 평소엔 맡은 레인을 행군하며 지나는 길의 정글몹/용/이무기도 사냥한다.
const BOT_SIGHT = 18
// ── 봇 "생각의 리듬" ──
// 표적 선택·교전 자세(붙는다/버틴다)는 매 틱이 아니라 사람 리듬(~0.4s, 난이도 반영)으로만
// 다시 정한다. 그 사이엔 정한 의도를 유지 → 틱 단위로 태세가 뒤집히는 계산기 같은 움직임이 사라진다.
// 체력 급락·표적 소실 같은 큰 사건은 즉시 재판단(사람도 맞으면 정신이 번쩍 든다).
const BOT_THINK_BASE = 0.55 // 기본 판단 주기(초) — easy는 react 배율로 더 뜸을 들인다
const BOT_THINK_HP_DROP = 0.12 // 이만큼(최대 체력 비율) 훅 깎이면 즉시 재판단
const BOT_SWITCH_CLOSER = 0.7 // 표적 교체 조건: 새 후보가 현재 표적보다 "확실히"(거리 70% 미만) 가까울 때만
export const BOT_STUCK_T = 3 // 가려고도 싸우지도 못하고 이만큼 제자리면 "갈 곳 잃음"으로 보고 귀환
// 봇 평타 반응 지연: 쿨이 돌아온 뒤 이만큼(초) 뜸들이고 평타를 친다.
// 봇이 프레임 단위로 칼같이 평타를 박아 "딜레이 없이 쉴 새 없이 맞는" 느낌을 주던 걸 완화 —
// 사람처럼 약간의 반응 시간을 두되, 쿨다운(0.7초 등) 자체는 그대로라 봇은 여전히 제 몫을 한다.
const BOT_REACT_MIN = 0.13
const BOT_REACT_MAX = 0.3

// 봇 난이도(솔로 모드) — 봇 영웅이 주는 피해 배율(dmg)과 평타 반응 지연 배수(react).
// createGame opts.botLevel로 지정하고, 지정 없으면(온라인 서버 포함) normal이다.
//  easy: 뜸을 오래 들이고 덜 아프게 — 처음 하는 사람용 / hard: 칼반응 + 강타
export const BOT_LEVELS = {
  easy: { dmg: 0.65, react: 3 },
  normal: { dmg: 1, react: 1 },
  hard: { dmg: 1.15, react: 0.55 },
}

// 봇 평타: 쿨이 끝나면 곧장 쏘지 않고 짧은 반응 지연을 굴린 뒤 친다.
//  ref: 공성 집중 표적(타워/수호석) — castAttack이 사거리를 검증하고 우선 조준한다.
function botAttack(state, h, dt, ref = null) {
  if (h.atkCd > 0) {
    h.botReact = -1 // 쿨 도는 중 — 다음에 쿨이 끝나면 반응 지연을 새로 뽑는다
    return
  }
  if (h.botReact < 0) {
    const scale = BOT_LEVELS[state.botLevel]?.react || 1
    h.botReact = (BOT_REACT_MIN + state.rng() * (BOT_REACT_MAX - BOT_REACT_MIN)) * scale
  }
  h.botReact -= dt
  if (h.botReact <= 0) {
    castAttack(state, h.id, ref) // 사거리 안 표적이 없으면 castAttack이 알아서 거른다(쿨 안 씀)
    h.botReact = -1
  }
}

// 사람 영웅 자동평타: 버튼을 안 눌러도 사거리 안에 보이는 적 영웅이 있으면 쿨마다 평타.
// (병사/타워/수호석은 자동으로 안 친다 — 막타·타워 어그로는 플레이어가 직접 조절하게)
function stepAutoAttack(state) {
  for (const h of state.heroes) {
    if (h.isBot || h.autoAttack === false) continue
    if (h.respawnT > 0 || h.atkCd > 0 || h.recallT > 0 || h.castT > 0 || !canAct(h)) continue
    if (h.bushI >= 0 || h.stealthT > 0) continue // 수풀 매복·은신 중엔 자동평타로 모습을 들키지 않게 (직접 공격은 가능)
    // 도발당하면 사거리 안일 때 탱커를 자동으로 평타친다 (castAttack이 표적을 탱커로 강제)
    if (h.tauntT > 0) {
      const tk = state.heroes.find((o) => o.id === h.tauntBy && o.team !== h.team && o.respawnT <= 0)
      if (tk && dist(h, tk) <= heroRange(h)) { castAttack(state, h.id); continue }
    }
    if (nearestFoeHeroLike(state, h, heroRange(h))) castAttack(state, h.id) // 분신도 영웅처럼 자동평타 대상
  }
}

// 봇 직업별 아이템 우선순위 — 우물에 들어왔을 때 위에서부터 살 수 있는 걸 산다.
// (사람 플레이어가 아이템으로 일방적 우위를 갖지 않게 봇도 장비를 갖춘다)
const BOT_BUILD = {
  // 5칸: 코어 4개 + 회복의 물병(위기 자힐 액티브 — stepBots가 빈사에 사용한다)
  warrior: ['longsword', 'vampire_scythe', 'plate', 'executioner', 'heal_flask'],
  assassin: ['dagger', 'vampire_scythe', 'executioner', 'boots', 'heal_flask'],
  archer: ['rage_gloves', 'longsword', 'executioner', 'boots', 'heal_flask'],
  mage: ['orb', 'flame_core', 'void_staff', 'guardian_cloak', 'heal_flask'],
  healer: ['orb', 'wisdom_hat', 'frost_staff', 'plate', 'heal_flask'],
  tank: ['leather', 'plate', 'giant_heart', 'thornmail', 'heal_flask'],
  // 한빙술사: 컨트롤 메이지 — 주문력 + 약간의 생존(무른 몸)
  cryomancer: ['orb', 'frost_staff', 'flame_core', 'guardian_cloak', 'heal_flask'],
  // 검투사: 흡혈 브루저 — 공격력 + 흡혈 + 추격(도끼) + 체력
  gladiator: ['longsword', 'vampire_scythe', 'berserker_axe', 'giant_heart', 'heal_flask'],
  // 주술사: DoT zoner — 주문력 위주 + 무른 몸 보강(주문력 방어구)
  warlock: ['orb', 'flame_core', 'void_staff', 'guardian_cloak', 'heal_flask'],
  // 수호기사: AP 인챈터 서폿 — 주문력(보호막) + 쿨감(자주 시전) + 생존
  guardian: ['orb', 'wisdom_hat', 'frost_staff', 'archmage_staff', 'heal_flask'],
  // 검성: 평타 듀얼리스트 — 공격속도 + 공격력 + 흡혈
  swordmaster: ['rage_gloves', 'vampire_scythe', 'executioner', 'dragon_blade', 'heal_flask'],
  // 사슬잡이: 이니시에이터 — 단단함 + 체력/공격 겸용 깃발
  catcher: ['plate', 'war_banner', 'giant_heart', 'executioner', 'heal_flask'],
  // 넝쿨사냥꾼: 속박 정글러 — 단단함 + 체력/공격 겸용 깃발(갱킹 합류)
  snarer: ['plate', 'war_banner', 'giant_heart', 'executioner', 'heal_flask'],
  // 야수조련사: 하이브리드 소환사 — 공/주 혼합(현자의 돌) + 주문·공격 섞어 소환수 강화 + 생존
  beastmaster: ['sage_stone', 'flame_core', 'longsword', 'giant_heart', 'heal_flask'],
  // 엔지니어: 하이브리드 포탑 — 주문력 위주 혼합 + 약간의 생존(후방)
  engineer: ['sage_stone', 'flame_core', 'void_staff', 'plate', 'heal_flask'],
  // 돌풍술사: 넉백 컨트롤러 — 주문력 + 쿨감(자주 시전) + 무른 몸 보강
  windcaller: ['orb', 'wisdom_hat', 'flame_core', 'guardian_cloak', 'heal_flask'],
  // 시간술사: 버스트 다이버 — 주문력 + 폭딜 + 약간의 생존(되감기로 버틴다)
  chronomancer: ['orb', 'flame_core', 'void_staff', 'guardian_cloak', 'heal_flask'],
  // 공포술사: 컨트롤 메이지 — 주문력 + 쿨감 + 무른 몸 보강
  fearmonger: ['orb', 'wisdom_hat', 'flame_core', 'guardian_cloak', 'heal_flask'],
  // 환영무희: 치고 빠지는 암살자 — 공격력 + 이속 + 흡혈
  illusionist: ['dagger', 'berserker_axe', 'vampire_scythe', 'executioner', 'heal_flask'],
  // 대지술사: 지형 브루저 — 단단함 + 주문력 겸용
  terramancer: ['leather', 'frost_staff', 'mirror_shield', 'giant_heart', 'heal_flask'],
}

// 봇 자동 구매: 우물 안 + 빈 칸 있으면 빌드 우선순위에서 안 가진 첫 구매 가능 아이템을 산다.
//  조합으로 상위템에 흡수된 재료는 "이미 거친 것"으로 보고 다시 사지 않는다.
function botShop(state, h) {
  if (h.items.length >= ITEM_SLOTS) return
  // 보스전 아군 봇은 어디서든 보급(buyItem도 허용) — 아니면 골드를 쥔 채 맨몸으로 싸운다
  if (!inFountain(h) && !(isRaidMode(state.mode) && h.team === 'blue')) return
  const upgraded = new Set()
  for (const id of h.items) for (const c of ITEMS_BY_ID[id]?.from || []) upgraded.add(c)
  for (const itemId of BOT_BUILD[h.cls] || []) {
    if (h.items.includes(itemId) || upgraded.has(itemId)) continue
    if (!ITEMS_BY_ID[itemId]) continue
    const quote = buildQuote(h.items, itemId) // 재료 보유 시 조합 할인가로 판단
    if (h.gold >= quote.price) {
      buyItem(state, h.id, itemId)
      return
    }
  }
  // 목록을 다 소화했는데 칸·골드가 남으면(아레나 고액 이월 등) 같은 계열 최고가로 마저 채운다.
  //  BOT_BUILD는 상위템을 직접 사면 그 재료가 "흡수됨" 처리로 스킵돼 실질 3~4개로 줄어드는데,
  //  그대로 두면 부자 봇이 빈 칸에 골드만 쌓는다(콜로세움 후반 라운드에서 두드러짐).
  if (h.gold < 800) return // 코어템 저축 중엔 발동 금지 — 여윳돈이 확실할 때만
  const cats = new Set()
  for (const id of BOT_BUILD[h.cls] || []) {
    const c = ITEMS_BY_ID[id]?.cat
    if (c && c !== 'util') cats.add(c)
  }
  cats.add('defense')
  let best = null
  let bestQ = null
  for (const it of ITEMS) {
    if (!cats.has(it.cat)) continue
    if (it.active && h.items.includes(it.id)) continue // 액티브 중복은 쿨 공유라 낭비
    const q = buildQuote(h.items, it.id)
    if (q.price > h.gold) continue
    if (!best || q.price > bestQ.price) { best = it; bestQ = q }
  }
  if (best) buyItem(state, h.id, best.id)
}

// ── 봇 교전 판단용 점수 헬퍼: "잡을 수 있나 + 살아 돌아올 수 있나"를 수치로 가늠한다 ──
// 받는 피해 배율(직업 기본 방어 + 방어 아이템). 방패막기는 가변이라 제외한다.
const dmgTakenMult = (h) => (CLASSES[h.cls].def ?? 1) * (1 - itemBonus(h).def)
// 평타 기준 대략적 초당 피해. 스킬 딜을 평타의 1.35배로 어림한 점수용 근사치.
const heroDps = (h) =>
  (atkOf(h) / Math.max(0.2, CLASSES[h.cls].atkCd * (1 - itemBonus(h).atkSpeed))) * 1.35
// a가 b를 잡는 데 걸리는 대략적 시간(초) — b의 방어까지 반영
const timeToKill = (a, b) => b.hp / Math.max(1, heroDps(a) * dmgTakenMult(b))

// 나와 가장 가까운 살아있는 적 타워
function nearestEnemyTower(state, h) {
  const en = enemyOf(h.team)
  let best = null
  let bd = Infinity
  for (const t of state.towers) {
    if (t.team !== en || !t.alive) continue
    const d = dist2(t, h)
    if (d < bd) {
      bd = d
      best = t
    }
  }
  return best
}

// 자기 리스폰 존(회복 지대) 안전권에 있는가 — 여기 있는 적은 쫓아봐야
// 회복으로 못 잡고, 우물 피해(FOUNTAIN_DMG)까지 맞으며 킬만 내준다. 추격 표적에서 제외.
const FOUNTAIN_SAFE_PAD = 7 // 안전권 여유 — 존 가장자리에서 얼쩡대는 적도 쫓지 않는다
function inOwnFountainSafety(state, e) {
  const f = state.map.FOUNTAIN_POS[e.team]
  if (!f) return false
  const r = FOUNTAIN_RADIUS + FOUNTAIN_SAFE_PAD
  return dist2(e, f) < r * r
}

// 적 영웅 추격 점수: 내가 잡는 시간(killT) vs 내가 죽는 시간(lifeT), 주변 적/아군 수.
// 준비된 버스트 스킬은 killT를 줄여 더 과감하게, 가까운 적 타워는 들어오는 피해에 더한다.
function botChaseScore(state, h, foe) {
  let killT = timeToKill(h, foe)
  if (h.skillCd <= 0) killT *= 0.7
  if (h.ultCd <= 0 && h.lvl >= ULT_LEVEL) killT *= 0.65
  let incoming = heroDps(foe) * dmgTakenMult(h)
  let foes = 1
  let allies = 1
  for (const e of state.heroes) {
    if (e === foe || e.team === h.team || e.respawnT > 0) continue
    if (!isHeroVisible(state, e, h.team)) continue
    if (dist2(e, foe) < 20 * 20) {
      incoming += heroDps(e) * dmgTakenMult(h)
      foes++
    }
  }
  for (const a of state.heroes) {
    if (a === h || a.team !== h.team || a.respawnT > 0) continue
    if (dist2(a, h) < 20 * 20) allies++
  }
  const tower = nearestEnemyTower(state, h)
  if (tower && dist2(tower, h) < (TOWER_RANGE + 2) ** 2) {
    incoming += TOWER_DMG_HERO * dmgTakenMult(h) * 0.7
  }
  const lifeT = h.hp / Math.max(1, incoming)
  return { killT, lifeT, foes, allies }
}

// 용/이무기를 "확실히 잡는다"는 확신이 설 때만 true. (아군 목록을 받는 공용 판정)
// 합산 DPS로 처치 시간을 추정하고, 그동안 몬스터(분노 가속)가 쏟아낼
// 총 피해를 우리 팀의 총 유효 체력으로 버틸 수 있어야 친다. (저레벨·소수 자폭 방지)
function teamCanTakeMonster(allies, big) {
  if (!allies.length) return false
  let dps = 0
  for (const a of allies) dps += heroDps(a)
  const killT = big.hp / Math.max(1, dps)
  // 너무 오래 걸리면 분노가 폭발한다 — 화력이 안 나오는(저레벨·소수) 도전은 여기서 걸러진다
  if (killT > (big.kind === 'baron' ? 15 : 12)) return false
  const spec = big.kind === 'baron' ? BARON : DRAGON
  // 분노는 교전 내내 0→killT로 쌓이므로 평균은 그 절반으로 본다
  const avgRage = 1 + spec.enrage * Math.min(ENRAGE_MAX, killT) * 0.5
  const monsterTotal = ((spec.dmg * avgRage) / spec.cd) * killT
  // 몬스터는 마지막으로 때린 영웅을 물어 피해가 분산되지만, 물릴 만한 가장 튼튼한
  // 아군조차 총 피해의 절반을 못 받아내면 하나씩 잘려나간다 — 무른 조합의 자멸 방지.
  let tank = 0
  for (const a of allies) tank = Math.max(tank, a.hp / dmgTakenMult(a))
  if (monsterTotal * 0.5 > tank) return false
  let teamEffHp = 0
  for (const a of allies) teamEffHp += a.hp / dmgTakenMult(a)
  return monsterTotal < teamEffHp * 0.6 // 팀 유효 체력의 60% 안쪽 피해면 감당 가능으로 본다
}

// 실제로 곁에 모인(26 안) 아군 기준 — 이 판정이 서면 그때 몬스터에 붙는다.
function canTakeMonster(state, h, big) {
  return teamCanTakeMonster(
    state.heroes.filter((o) => o.team === h.team && o.respawnT <= 0 && dist(o, big) < 26),
    big
  )
}

// ── 팀 단위 콜: 매 틱 새로 계산한다(지속 상태 없음 — 재접속/봇 인계에 안전) ──
const BOT_RALLY_DIST = 65 // 봇이 오브젝트 콜에 응해 달려오는 최대 거리
const RALLY_HOLD = 13 // 인원이 모여 확신이 서기 전까지 어그로 없이 대기하는 거리

// 오브젝트 콜: 집결 가능한 건강한 팀원(봇은 집결 반경, 사람은 이미 곁에 있을 때만 셈)으로
// 용/이무기를 확실히 잡을 수 있고 + 근처 적이 우리보다 많지 않으면 그 몬스터를 노린다.
//
// 커밋(state.objCommit): 한번 치기로 결심하면 죽을 때까지 물고 늘어진다 — 매 틱 재계산으로
//  콜이 껐다 켜졌다 하며 우왕좌왕하는 것을 막는다. 결심 문턱은 "힘 합쳐 8초 안에 잡을
//  각"(엄격)이고, 결심 후엔 "팀이 무너지지 않는 한"(느슨)으로 유지한다(히스테리시스).
// 오브젝트(용/이무기) 도전 창(window) — 모드별 "지금이 칠 타이밍인가" 판정.
//  너무 보수적이면 시도 자체를 안 하므로, 각 모드의 확실한 창을 명시적으로 열어 준다.
//  (이미 커밋된 도전은 창과 무관하게 끝까지 — computeObjectiveCall의 커밋 유지 로직)
function objectiveWindowOpen(state, team) {
  if (state.mode === 'boss') {
    if (team !== 'blue') return true // 레드(보스 진영)는 오브젝트를 치지 않는다
    // 정예 그림자 군세가 살아 있으면 전선이 우선 — 휴지기라도 창을 닫는다
    //  (3페이즈 휴지기는 정예 재소환과 겹치므로 자연히 닫힘 — 2페이즈 휴지기만 파밍 창)
    if (state.heroes.some((x) => x.isBossAdd && x.hp > 0 && x.respawnT <= 0)) return false
    const boss = state.heroes.find((x) => x.isBoss)
    if (boss && boss.bossShieldT > 4) return 'dragon' // 각성 휴지기 = 파밍 창 — 단 용만(이무기 버프는 과함)
    return !bossFrontThreat(state)
  }
  if (state.mode === 'defense') {
    if (team !== 'blue') return true
    if (state.heroes.some((x) => x.isBossAdd && x.hp > 0 && x.respawnT <= 0)) return false // 정예 파도 중 금지
    const reds = state.minions.filter((m) => m.team === 'red').length
    return state.defWaveT > 8 && reds < 6 // 다음 파도까지 여유가 있고 전선이 정리됐을 때만
  }
  return true // 3v3/5v5의 타이밍 기준은 computeObjectiveCall 내부(적 전력 창)에서 본다
}

function computeObjectiveCall(state, team, allowNew = true) {
  const need = Math.ceil((TEAM_SIZES[state.mode] ?? 3) / 2) // 3:3→2명, 5:5→3명
  const nearby = (big, r) => state.heroes.filter(
    (o) => o.team === team && o.respawnT <= 0 && o.hp > o.maxHp * 0.45 &&
      dist(o, big) < (o.isBot ? r : 30)
  )
  // 이미 결심한(커밋된) 오브젝트가 살아 있고 곁에 아군이 남아 싸울 만하면 — 끝까지 밀어붙인다.
  //  커밋은 아래 per-bot 블록에서 "가까운 팀이 잡을 각"이 처음 설 때 세워진다(히스테리시스).
  const committed = state.objCommit[team]
  if (committed) {
    const big = state.monsters.find((m) => m.id === committed.id && m.alive)
    if (big && nearby(big, 34).length >= 1) return big.id // 다 죽거나 흩어지면 해제
    state.objCommit[team] = null
  }
  if (!allowNew) return null // 새 결심 금지(예: 보스전 전선 위협 중) — 진행 중 커밋만 유지
  // 랠리 콜: 집결 반경(RALLY_DIST) 팀으로 잡을 여지가 있으면 그 몬스터로 모인다(아직 커밋 아님).
  for (const big of state.monsters) {
    if (!big.alive || CAMP_MOBS[big.kind]) continue
    if (allowNew === 'dragon' && big.kind !== 'dragon') continue // 제한 창(휴지기): 용만
    const cands = nearby(big, BOT_RALLY_DIST)
    if (cands.length < need || !teamCanTakeMonster(cands, big)) continue
    // 타이밍 기준(3v3/5v5): ① 적이 죽어 있는 "확실한 창"이면 과감하게 연다
    //  ② 창이 아니라면 시야에 적이 하나도 없어야 시작 — 어중간한 오브젝트 한타로 던지지 않는다
    const en = enemyOf(team)
    let foesDown = 0
    let foesNear = 0
    for (const e of state.heroes) {
      if (e.team !== en || e.isBoss) continue
      if (e.respawnT > 2) { foesDown++; continue }
      if (isHeroVisible(state, e, team) && dist(e, big) < 36) foesNear++
    }
    const downNeed = (TEAM_SIZES[state.mode] ?? 3) >= 5 ? 2 : 1
    if (foesDown < downNeed && foesNear > 0) continue
    return big.id
  }
  return null
}

// 수비 콜: 가장 위협받는 우리 구조물(적 영웅이 붙은 타워, 웨이브가 닿은 수호석)을 찾아
// 모자란 만큼(공격 영웅 수 − 이미 곁의 아군 수) 가까운 봇을 수비로 배정한다.
function computeDefensePlan(state) {
  const plan = new Map()
  for (const team of ['blue', 'red']) {
    const en = enemyOf(team)
    const spots = state.towers.filter((t) => t.team === team && t.alive)
    spots.push({ ...state.map.NEXUS_POS[team], tier: 4 }) // 수호석도 수비 지점(최고 가중치)
    let spot = null
    let need = 0
    let score = 0
    for (const t of spots) {
      let hs = 0
      for (const e of state.heroes) {
        if (e.team !== en || e.respawnT > 0 || !isHeroVisible(state, e, team)) continue
        if (dist(e, t) < TOWER_RANGE + 10) hs++
      }
      let mn = 0
      for (const m of state.minions) if (m.team === en && dist(m, t) < TOWER_RANGE + 4) mn++
      const hurt = t.lastHurt != null && state.time - t.lastHurt < 4 // 실제로 두들겨 맞는 중
      // 평상시 라인전은 수비 콜이 아니다: 내곽부터는 적 영웅 1명, 외곽은 영웅 2명부터 —
      // 단, 외곽도 (영웅 1명이 실제로 타워를 치거나 병사를 끼고 있으면) 위험으로 본다.
      // 영웅 없이도 큰 웨이브(4마리+)가 타워를 갉아먹으면 수비를 보내고,
      // 수호석은 웨이브(3마리)만 닿아도 위험이다.
      const danger =
        (t.tier >= 2 ? hs >= 1 : hs >= 2 || (hs >= 1 && (hurt || mn >= 2))) ||
        (mn >= 4 && hurt) || (t.tier === 4 && mn >= 3)
      if (!danger) continue
      const s =
        (hs * 2 + (mn >= 4 ? 1 : 0) + (hurt ? 1 : 0)) *
        (t.tier === 4 ? 2.2 : t.tier === 3 ? 1.8 : t.tier === 2 ? 1.3 : 1)
      if (s > score) {
        score = s
        spot = t
        need = Math.max(1, hs)
      }
    }
    if (!spot) continue
    const already = state.heroes.filter(
      (a) => a.team === team && a.respawnT <= 0 && dist(a, spot) < 20
    ).length
    let want = need - already
    if (want <= 0) continue
    const free = state.heroes
      .filter(
        (a) =>
          a.team === team && a.isBot && a.respawnT <= 0 && !a.botRetreat &&
          a.hp > a.maxHp * 0.45 && dist(a, spot) >= 20
      )
      .sort((a, b) => dist2(a, spot) - dist2(b, spot))
    for (const a of free) {
      if (want-- <= 0) break
      plan.set(a.id, spot)
    }
  }
  return plan
}

// ── 아군 구조 콜: 근처에서 적 영웅에게 맞고 있는 아군이 있으면 그 교전 지점을 돌려준다 ──
const BOT_RESCUE_DIST = 45 // 이 안에서 벌어진 아군 교전에는 달려가 돕는다
function botFindRescue(state, h) {
  let best = null
  let bd = BOT_RESCUE_DIST * BOT_RESCUE_DIST
  for (const e of state.heroes) {
    if (e.team === h.team || e.respawnT > 0 || !isHeroVisible(state, e, h.team)) continue
    const d = dist2(h, e)
    if (d >= bd) continue
    // 이 적 곁(16)에서 최근에 맞은 아군이 있어야 "교전"이다
    const victim = state.heroes.some(
      (a) => a !== h && a.team === h.team && a.respawnT <= 0 &&
        state.time - a.lastHurt < 2.5 && dist2(a, e) < 16 * 16
    )
    if (!victim) continue
    // 뻔히 지는 싸움엔 몸을 던지지 않는다: 내가 합류해도 수적 열세면 관망 (교전 반경 20 기준)
    let foes = 0
    let mates = 1 // 나
    for (const o of state.heroes) {
      if (o.respawnT > 0 || dist2(o, e) > 20 * 20) continue
      if (o.team === h.team) {
        if (o !== h) mates++
      } else if (isHeroVisible(state, o, h.team)) foes++
    }
    if (mates < foes) continue
    bd = d
    best = e
  }
  return best
}

// ── 웨이브 정리 스킬: 교전 상대가 없을 때, 광역기가 닿는 곳에 적 병사가 뭉쳐 있으면 쓴다 ──
// 스킬이 병사에게 닿는 직업만 (단일 대상·영웅 전용·유틸기는 아껴 둔다)
const FARM_SKILL_RANGE = {
  warrior: DASH_AIM - 2, // 베며 돌진 (경로+착지 광역)
  archer: VOLLEY_RANGE * 0.6, // 꿰뚫는 화살 (직선 관통)
  mage: FIREBALL_RANGE - 8, // 화염구 (폭발)
  cryomancer: FROST_RANGE - 1, // 서리파동 (부채꼴)
  gladiator: GLAD_SLASH_RADIUS, // 휘둘러베기 (자기 중심 + 흡혈)
  terramancer: SLING_RANGE - 2, // 돌팔매 (스플래시 3연투)
  windcaller: GUST_RANGE * 0.6, // 돌풍 (굴러가는 회오리)
}
function botFarmSkills(state, h) {
  const canMain = h.skillCd <= 0 && FARM_SKILL_RANGE[h.cls] != null
  const canPlague = h.cls === 'warlock' && h.skill2Cd <= 0 && h.lvl >= SKILL2_LEVEL
  if (!canMain && !canPlague) return
  // 주변 적 병사 무리의 중심과 "뭉친" 마릿수
  let n = 0
  let cx = 0
  let cz = 0
  for (const m of state.minions) {
    if (m.team === h.team || dist2(h, m) > 14 * 14) continue
    n++
    cx += m.x
    cz += m.z
  }
  if (n < 3) return
  cx /= n
  cz /= n
  let packed = 0
  for (const m of state.minions) {
    if (m.team === h.team) continue
    if ((m.x - cx) ** 2 + (m.z - cz) ** 2 < 5 * 5) packed++
  }
  if (packed < 3) return // 광역기 본전(3마리)이 안 나오면 아낀다
  const d = Math.hypot(cx - h.x, cz - h.z)
  if (canMain && d < FARM_SKILL_RANGE[h.cls]) {
    // 전사 돌진은 몸이 쏠린다 — 적 타워 사거리로 뛰어들게 되면 참는다
    if (h.cls === 'warrior') {
      const t = nearestEnemyTower(state, h)
      if (t && (t.x - cx) ** 2 + (t.z - cz) ** 2 < (TOWER_RANGE + 4) ** 2) return
    }
    h.dir = Math.atan2(cz - h.z, cx - h.x) // 무리를 바라보고 (스킬 자동조준이 h.dir을 쓴다)
    castSkill(state, h.id)
    return
  }
  // 주술사: 주력기(저주살)는 영웅 전용이라 보조기(역병안개 장판)로 웨이브를 녹인다
  if (canPlague && d < PLAGUE_RANGE - 1) {
    h.dir = Math.atan2(cz - h.z, cx - h.x)
    castSkill2(state, h.id)
  }
}

// ── 용/이무기 커밋 중 스킬 화력: 몬스터에게 닿는 스킬만 부어 분노가 쌓이기 전에 잡는다 ──
function botMonsterSkills(state, h, big) {
  if (h.skillCd > 0) return
  const d = dist(h, big)
  const aim = () => { h.dir = Math.atan2(big.z - h.z, big.x - h.x) }
  if (h.cls === 'gladiator' && d < GLAD_SLASH_RADIUS) castSkill(state, h.id)
  else if (h.cls === 'mage' && d < FIREBALL_RANGE - 4) { aim(); castSkill(state, h.id) }
  else if (h.cls === 'archer' && d < VOLLEY_RANGE - 4) { aim(); castSkill(state, h.id) }
  else if (h.cls === 'cryomancer' && d < FROST_RANGE - 1) { aim(); castSkill(state, h.id) }
  else if (h.cls === 'terramancer' && d < SLING_RANGE - 2) { aim(); castSkill(state, h.id) }
  else if (h.cls === 'windcaller' && d < GUST_RANGE - 2) { aim(); castSkill(state, h.id) }
  else if (h.cls === 'tank' && big.aggro === h.id && d < 6) castSkill(state, h.id) // 물렸으면 방패막기
}

// 정글이 비었을 때 라인 지원: 적 압박이 큰(우리 타워가 위협받는) 레인을 우선 방어하고,
// 위협이 없으면 가장 가까운 아군 곁으로 가 함께 압박한다 — 캠프 부활을 멍하니 기다리지 않는다.
function botSupportLane(state, h) {
  const en = enemyOf(h.team)
  // ① 방어: 우리 타워 근처에 보이는 적 영웅이 가장 많은 레인으로
  let need = 0
  let point = null
  for (const lane of LANE_IDS) {
    const tower = state.towers.find((t) => t.team === h.team && t.lane === lane && t.alive)
    const ref = tower || state.map.NEXUS_POS[h.team]
    let threat = 0
    for (const e of state.heroes) {
      if (e.team !== en || e.respawnT > 0 || !isHeroVisible(state, e, h.team)) continue
      if (dist(e, ref) < 28) threat++
    }
    if (threat > need) {
      need = threat
      point = ref
    }
  }
  if (point) {
    steerToward(state, h, point)
    return true
  }
  // ② 합류: 위협이 없으면 가장 가까운(조금 떨어진) 아군 영웅에게 가 함께 라인을 민다
  let mate = null
  let mbd = Infinity
  for (const o of state.heroes) {
    if (o === h || o.team !== h.team || o.respawnT > 0) continue
    const d = dist2(h, o)
    if (d < mbd) {
      mbd = d
      mate = o
    }
  }
  if (mate && mbd > 8 * 8) {
    steerToward(state, h, mate)
    return true
  }
  return false // 이미 아군 곁이면 호출부의 일반 라인 푸시로 넘긴다
}


// ── 보스전(5:1) — 보스 전용 두뇌 ─────────────────────────────────────────
// 보스는 미드를 따라 천천히 진군하며(정지 시간 압박), 시야의 영웅에게 타입별 스킬을
// 돌리고, 주기적으로 병사를 소환해 라인을 민다. 영웅들은 정글몹·소환 병사로 성장해
// 아이템·스킬 연계로 보스를 잡는다. CC 저항(BOSS_CC_RESIST)은 stepHero에서.
const BOSS_CC_RESIST = 2.5 // CC 잔여시간 추가 소진 배율 — 연계 CC 영구기절 방지
// 보스 고정 파워 등급 — 레벨 개념 없이, 이 등급 상당의 스탯으로 개전부터 못박는다
// (예전 시간 자동 레벨업으로 얻던 성장분을 여기에 녹여 넣었다). 위협 상승은 국면이 담당.
const BOSS_LEVEL = 6
const BOSS_SUMMON_CD = 13 // 병사 소환 주기
// ── 보스 타임라인(시간 스테이지): 잠 → 대량 소환 → 정예 소환 → 진군 ──
//  바로 진군하지 않는다 — 소환 페이즈 동안 병력의 파도를 막으며 성장하고,
//  정예(그림자 영웅 5기)를 정리한 뒤에야 보스 본체가 움직인다.
const BOSS_SLEEP_END = 30 // 옥좌에서 잠(무적) — 초반 파밍 타임은 짧게, 소환 국면이 곧 온다
const BOSS_MASS_END = 150 // 30~150초: 대량 소환 국면 — 쉴새없는 파도(전투→회복→바로 복귀의 리듬)
const BOSS_MARCH_AT = 240 // 150~240초: 정예 소환 국면(그림자 영웅) — 이후 진군 개시
const BOSS_MASS_EVERY = 10 // 대량 소환 주기 — 한 파도를 정리하면 다음 파도가 이미 오고 있다
const BOSS_MASS_COUNT = 14 // 파도 규모 — 여유가 있으면 안 된다. 외곽 타워 하나는 밀릴 각오
const BOSS_FOCUS_AFTER = 40 // 한 방어선 앞에서 이만큼 지나면 '공성 집중' — 교착을 끊는다
const BOSS_FOCUS_NEAR = 40 // 공성 집중 타이머는 방어선 이 거리 안에서만 차오른다(행군은 무관)
// 방어선을 부수면 잠깐 포효(연출 비트)만 — 회복 창 역할은 각성 휴지기(30초 무적)가 전담한다.
// 예전엔 20초 재정비였는데 휴지기와 중복돼 '보스가 또 논다'로 읽혔다.
const BOSS_REGROUP = 4
// ── 보스 페이즈: 체력이 깎일수록 사나워진다 (한 번 오르면 안 내려간다 — 재생으로 되돌아가도 유지) ──
//  1페이즈 "진군"(100~70%): 기본 로테이션 · 2페이즈 "분노"(70~40%): 스킬/소환 가속 + 피해 ↑
//  3페이즈 "필사"(40%~): 더 빠른 가속 + 타입별 강화(균열 확대/연쇄 증가/포효 광역화)
export const BOSS_PHASE_HP = [0.7, 0.4] // 2·3페이즈 진입 체력비 — UI(체력바 마커)와 공유
const bossPhaseOf = (h) => (h.hp / h.maxHp > BOSS_PHASE_HP[0] ? 1 : h.hp / h.maxHp > BOSS_PHASE_HP[1] ? 2 : 3)
const BOSS_PHASE_CD = [1, 0.8, 0.45] // 페이즈별 스킬 쿨타임 배율 — 필사(3)는 거의 논스톱 발악
const BOSS_PHASE_SUMMON = [1, 0.78, 0.55] // 페이즈별 병사 소환 주기 배율
const BOSS_PHASE_DMG = [1, 1.1, 1.2] // 페이즈별 영웅 피해 배율
const BOSS_HUE = { boss_colossus: 'lava', boss_archmage: 'frost', boss_shadow: 'shadow', boss_thorn: 'venom' } // 예고 장판 색조
const BOSS_AWAKEN_T = 30 // 국면 전환 각성 휴지기(초) — 무적·정지, 아군의 재정비/파밍 시간
const BOSS_AGGRO = 16 // 이 거리 안의 영웅을 상대한다(그 밖이면 진군)
const BOSS_LEASH = 18 // 진군 축(공성 목표)에서 이 이상 벗어난 적은 쫓지 않는다 — 술래잡기 방지

// 보스가 무적인가 — ① 각성 휴지기(어둠의 보호막) ② 기상 전 수면. 표적·피해 판정에서 함께 쓴다.
export function bossInvuln(state, h) {
  return h.isBoss === true && (h.bossShieldT > 0 || state.time < BOSS_SLEEP_END)
}

// ── 보스전 난이도 티어 ──
// 보통은 현행 그대로(전부 1.0) — 기존 밸런스(클리어율 30~45% 밴드)를 기준선으로 보존한다.
// 해금 순서(보통 클리어 → 어려움 → 악몽)는 UI가 강제하고, 엔진은 주어진 티어를 그대로 적용.
// tele(예고 시간 배율)는 악몽만 줄인다 — "배우면 깬다" 원칙상 어려움까지는 읽기 난도 불변.
export const BOSS_TIERS = {
  normal: { hp: 1, atk: 1, cd: 1, adds: 0, wave: 0, tele: 1 },
  hard: { hp: 1.25, atk: 1.15, cd: 0.85, adds: 1, wave: 1, tele: 1 },
  nightmare: { hp: 1.55, atk: 1.35, cd: 0.7, adds: 2, wave: 2, tele: 0.85 },
}
const bossTierOf = (state) => BOSS_TIERS[state.bossTier] || BOSS_TIERS.normal

// 보스 예고 장판 생성 — stepZones('bosszone')가 경고→폭발→잔류를 처리한다.
//  hue: 클라 표식 색조(lava 주황/frost 청/shadow 보라)
function pushBossZone(state, h, opts) {
  state.zones.push({
    id: state.nextId++, kind: 'bosszone', team: h.team, owner: h.id,
    x: opts.x, z: opts.z, r: opts.r, t: 0, tickT: 0,
    rIn: opts.rIn || 0, // >0이면 도넛: 안쪽은 안전지대
    aim: opts.aim || false, // 조준 표식: '아군이 서 있던 자리'를 노리는 기술 — 클라가 십자 마커로 그린다
    // 돌진 경로(from): 시전 위치 → 착지점 사이에 진행 방향 화살표(> > >)를 그린다
    ox: opts.from ? opts.from.x : null,
    oz: opts.from ? opts.from.z : null,
    // 예고 시간: 악몽 티어만 15% 단축(tele 0.85) — 패턴을 아는 숙련자용 압박
    delay: (opts.delay ?? 1.2) * bossTierOf(state).tele, dmg: opts.dmg,
    stun: opts.stun || 0, freeze: opts.freeze || 0, fear: opts.fear || 0,
    knock: opts.knock || 0, knockStun: opts.knockStun || 0, // >0이면 폭발 시 중심에서 바깥으로 밀어낸다
    life: opts.life || 0, dps: opts.dps || 0, slow: opts.slow || 0,
    vfx: opts.vfx || 'quake', hue: opts.hue || 'lava', exploded: false,
    // 소환 장판: delay가 끝나면 피해 대신 이 정예를 하늘빛과 함께 강림시킨다
    spawnAdd: opts.spawnAdd || null,
  })
}

// 파멸의 삼중격(보스 공통기): 표적을 향해 전방 세 갈래로 어둠의 검기를 내뿜는다.
// 정면 근거리 표적은 두세 발을 겹쳐 맞는다 — "보스가 마음먹으면 하나는 죽는다"의 핵심 압박.
function bossFan(state, h, foe) {
  const dir = Math.atan2(foe.z - h.z, foe.x - h.x)
  h.dir = dir
  for (const off of [-0.32, 0, 0.32]) {
    const d = dir + off
    state.projectiles.push({
      id: state.nextId++, kind: 'swordwave', team: h.team, owner: h.id,
      x: h.x, z: h.z, dir: d, vx: Math.cos(d) * SWORDWAVE_SPEED, vz: Math.sin(d) * SWORDWAVE_SPEED,
      dmg: skillDmg(h, 70, 1.4), travel: 0, hit: new Set(),
    })
  }
  pushFx(state, 'shriek', h.x, h.z, 4, h.team, 0.6)
}

// 두꺼운 직선 장판: 표적 방향으로 원형 장판을 일렬로 깔아 굵은 일직선 참격/격류를 만든다.
// 가까운 쪽부터 순차 폭발(파도 문법) — 옆으로 반 발짝이 정답이다.
function pushBossLine(state, h, dir, { count = 5, r = 4.2, gap = 3.4, delay = 1.0, step = 0.12, dmg, effect = null, vfx = 'quake', hue = 'lava' }) {
  for (let k = 0; k < count; k++) {
    const d = 4 + k * gap
    pushBossZone(state, h, {
      x: h.x + Math.cos(dir) * d, z: h.z + Math.sin(dir) * d, r,
      delay: delay + k * step, dmg, ...effect, vfx, hue,
    })
  }
}

function bossThink(state, h, dt) {
  if (!h.bossIntro) {
    h.bossIntro = true
    pushFeed(state, 'obj', `👹 ${CLASSES[h.cls].name} ${h.name} 등장! 힘을 합쳐 쓰러뜨리세요!`)
  }
  // 보스는 레벨 개념이 없다 — 시간 자동 레벨업 없음(위협은 국면 전환으로 강해진다).
  //  체력바가 최대치와 함께 훅 오르던 혼란을 없앤다. 스탯은 개전부터 고정(BOSS_LEVEL로 고정 계산).
  // 재생: 8초간 무피해면 초당 최대체력 0.4% 회복 — 치고 빠지기만 반복하면 못 잡는다.
  // 각성 휴지기(보호막) 중엔 재생하지 않는다 — 깎아 둔 체력이 되돌아가면 김이 샌다.
  if (state.time - h.lastHurt > 8 && h.hp < h.maxHp && !(h.bossShieldT > 0)) {
    h.hp = Math.min(h.maxHp, h.hp + h.maxHp * 0.004 * dt)
  }
  h.bossCd ||= { a: 5, b: 9, c: 14, d: 11, fan: 6, summon: 8 }
  for (const k in h.bossCd) h.bossCd[k] = Math.max(0, h.bossCd[k] - dt)
  // ── 예고된 처형기 집행: 예고가 끝나는 순간 발동한다 (시전 후 취소 없음 — 읽었다면 이미 피했다) ──
  // 가시갑옷 도발 집행: 예고가 끝나는 순간 링(r9) 안의 적을 도발(강제 평타) + 반사창 개시
  if (h.thornTauntAt && state.time >= h.thornTauntAt) {
    h.thornTauntAt = null
    h.thornArmorT = 6
    for (const e of state.heroes) {
      if (e.team === h.team || e.respawnT > 0 || e.isBoss) continue
      if (dist(h, e) > 9) continue
      e.tauntT = 2.2
      e.tauntBy = h.id
    }
    pushFx(state, 'berserk', h.x, h.z, 6, h.team, 1.0)
  }
  // 격돌 돌진: 예고해 둔 착지점으로 몸을 날린다(피해·기절은 예고 장판이 처리)
  if (h.bossDash && state.time >= h.bossDash.at) {
    const t = h.bossDash
    h.bossDash = null
    const dir = Math.atan2(t.z - h.z, t.x - h.x)
    pushFxDir(state, 'dash', h.x, h.z, dist(h, t), dir, h.team)
    h.x = t.x - Math.cos(dir) * 1.5
    h.z = t.z - Math.sin(dir) * 1.5
    h.dir = dir
    state.map.resolveTerrain(h, 2.2, colliders(state))
  }
  // 돌진 준비 중엔 표적을 노려보며 웅크린다 — 표식과 보스가 한 쌍으로 읽힌다("온다!")
  if (h.bossDash) {
    h.dir = Math.atan2(h.bossDash.z - h.z, h.bossDash.x - h.x)
    h.mx = 0
    h.mz = 0
    return
  }
  // 스테이지 0 — 잠(0~45초): 성곽 안 옥좌에서 무적으로 잠들어 있다(우물 레이저가 러시를 응징).
  if (state.time < BOSS_SLEEP_END) {
    h.hp = h.maxHp // 잠든 보스는 흠집도 안 난다 — 원거리 포킹으로 선공 이득을 못 본다
    h.mx = 0
    h.mz = 0
    if (!h.bossWakeWarned && state.time > BOSS_SLEEP_END - 15) {
      h.bossWakeWarned = true
      pushFeed(state, 'obj', '⚠️ 보스가 곧 깨어납니다 — 전열을 갖추세요!')
    }
    return
  }
  if (!h.bossAwake) {
    h.bossAwake = true
    pushFeed(state, 'obj', `👹 ${CLASSES[h.cls].name}이(가) 깨어나 어둠의 병력을 소환한다 — 파도를 막아라!`)
  }
  // 광폭화(엔레이지): 진군 후 11분이 지나면 CC를 무시하고 피해가 1.5배 — 무한 대치 방지
  if (!h.bossEnraged && state.time - (h.bossShieldTotal || 0) > BOSS_MARCH_AT + 660) {
    h.bossEnraged = true
    pushFeed(state, 'obj', '🔥 보스가 광폭화했다! 더는 버틸 수 없다 — 지금 끝내야 한다!')
  }
  if (h.bossEnraged) {
    h.stunT = 0; h.freezeT = 0; h.fearT = 0; h.airT = 0; h.rootT = 0; h.pullT = 0
    pushFx(state, 'berserk', h.x, h.z, 4, h.team, 0.4)
  }
  // ── 페이즈 전환: 체력 70%/40%를 깎이면 국면이 바뀐다 ──
  //  포효(잠깐 멈춤 — 위치 재정비 기회)와 충격파(밀착 응징)로 전환을 온몸으로 알린 뒤,
  //  스킬·소환이 빨라지고 피해가 오른다. 재생으로 체력이 돌아와도 페이즈는 유지된다.
  h.bossPhase ||= 1
  const wantPhase = bossPhaseOf(h)
  if (h.bossPhase < wantPhase) {
    h.bossPhase = wantPhase
    // 각성 휴지기: 어둠의 보호막에 감싸여 30초 무적·정지 — 게임의 시계가 잠시 멈추고,
    // 아군은 재정비·회복·짤막한 파밍(병사 소환은 계속 돈다)으로 다음 국면을 준비한다.
    h.bossShieldT = BOSS_AWAKEN_T
    h.stunT = 0; h.freezeT = 0; h.fearT = 0; h.airT = 0; h.rootT = 0; h.pullT = 0 // 포효가 CC를 털어낸다
    pushFx(state, 'berserk', h.x, h.z, 6, h.team, 1.0)
    // 전환 충격파 — 예고 후 폭발: 경고를 보고 빠지면 안 맞는다
    pushBossZone(state, h, {
      x: h.x, z: h.z, r: 11, delay: 1.6, dmg: skillDmg(h, 100, 2.0), stun: 1.0,
      vfx: 'quake', hue: BOSS_HUE[h.cls] || 'lava',
    })
    pushFeed(state, 'obj', wantPhase === 2
      ? `💢 ${h.name}의 분노가 끓어오른다 — 공격이 거세진다!`
      : `🔥 ${h.name}이(가) 필사적으로 날뛴다 — 마지막 발악이다, 몰아쳐라!`)
    pushFeed(state, 'obj', `🛡️ ${h.name}이(가) 어둠의 보호막에 감싸여 힘을 모은다(${BOSS_AWAKEN_T}초 무적) — 정비하고 맞을 준비를 하라!`)
    // 필사 국면: 그림자 영웅들이 다시 일어난다 — 보스가 힘을 모으는 동안 최후의 군세가 앞장선다
    if (wantPhase === 3 && !h.bossAddsDone2) {
      h.bossAddsDone2 = true
      bossSummonAdds(state, h)
      pushFeed(state, 'obj', `⚔️ ${h.name}의 부름에 그림자 영웅들이 다시 일어난다 — 최후의 군세다!`)
    }
  }
  // 각성 휴지기 소화: 무적·정지 상태로 서서 힘을 모은다 — 소환·공성·성장이 전부 멈춘
  // 진짜 휴지기다(아군은 이 틈에 회복·보급·정글 파밍). 끝나는 순간 더 크고 붉어져 다시 움직인다.
  if (h.bossShieldT > 0) {
    h.bossShieldT -= dt
    h.bossShieldTotal = (h.bossShieldTotal || 0) + dt // 성장·광폭화 시계도 이만큼 늦춘다
    h.stunT = 0; h.freezeT = 0; h.fearT = 0; h.airT = 0; h.rootT = 0; h.pullT = 0
    h.mx = 0
    h.mz = 0
    if (h.bossShieldT <= 0) {
      pushFx(state, 'berserk', h.x, h.z, 9, h.team, 1.2)
      pushFeed(state, 'obj', `💥 보호막이 깨졌다 — 더 크고 사나워진 ${h.name}이(가) 다시 움직인다!`)
    }
    return
  }
  if (h.stunT > 0 || h.pullT > 0 || h.airT > 0 || h.fearT > 0 || h.knockT > 0) {
    h.mx = 0
    h.mz = 0
    return
  }
  // ── 시간 스테이지: 대량 소환(45~150) → 정예 소환(150~240) → 진군(240~) ──
  const stage = state.time < BOSS_MASS_END ? 'mass' : state.time < BOSS_MARCH_AT ? 'elite' : 'march'
  // 정예 소환: 보스 유형에 맞는 그림자 영웅 5기 — 한 번만, 죽으면 부활하지 않는다
  if (stage !== 'mass' && !h.bossAddsDone) {
    h.bossAddsDone = true
    bossSummonAdds(state, h)
    pushFeed(state, 'obj', `⚔️ ${h.name}이(가) 정예 그림자 영웅들을 불러냈다 — 진군 전에 쓰러뜨려라!`)
  }
  // 병사 소환 — 스킬과 독립으로, 어느 국면이든 끊기지 않는다(정예를 빨리 정리해도
  // 파밍이 붕 뜨지 않게). 대량 국면 14마리/10초 → 정예 국면 10마리 → 진군 후 14마리.
  if (h.bossCd.summon <= 0) {
    if (stage === 'mass') {
      // 초반 파밍 국면(대량 소환)은 전 보스 공통 14마리 — 그대로 둔다
      h.bossCd.summon = BOSS_MASS_EVERY
      bossSummon(state, h, { count: BOSS_MASS_COUNT, hpMul: 1.0 })
    } else {
      // 진군 호위 파도는 전 보스 공통 10마리 — 한번 밀리기 시작하면 14마리씩 쌓여
      // 걷잡을 수 없던 문제를 완화한다. (초반 대량 소환 국면은 위에서 14 유지)
      h.bossCd.summon = BOSS_SUMMON_CD * BOSS_PHASE_SUMMON[h.bossPhase - 1]
      bossSummon(state, h, { count: 10 + bossTierOf(state).wave, ...(stage === 'elite' ? { hpMul: 1.0 } : null) })
    }
  }
  // 소환 페이즈 동안 보스는 진군하지 않는다 — 옥좌를 지키며 성곽 안까지 덤벼드는 적만 상대한다.
  if (stage !== 'march') {
    const throne = state.map.NEXUS_POS.red
    let foe = null
    let bd = BOSS_AGGRO * BOSS_AGGRO
    for (const e of state.heroes) {
      if (e.team === h.team || e.respawnT > 0 || e.isBoss) continue
      if (!isHeroVisible(state, e, h.team)) continue
      if (dist2(e, throne) > 26 * 26) continue // 성곽 밖까지 쫓아 나가진 않는다
      const d = dist2(h, e)
      if (d < bd) { bd = d; foe = e }
    }
    if (h.cls === 'boss_colossus') bossColossus(state, h, foe)
    else if (h.cls === 'boss_archmage') bossArchmage(state, h, foe)
    else if (h.cls === 'boss_thorn') bossThorn(state, h, foe)
    else bossShadow(state, h, foe, { x: throne.x, z: throne.z })
    if (h.cls === 'boss_colossus' && h.bossCd.fan <= 0 && foe && dist(h, foe) < 13) {
      h.bossCd.fan = 6 * BOSS_PHASE_CD[h.bossPhase - 1] * bossTierOf(state).cd
      bossFan(state, h, foe) // 성곽 안까지 덤빈 자에겐 삼중격 (카르곤 전용)
    }
    castAttack(state, h.id, null)
    const range = heroRange(h)
    if (foe && dist(h, foe) > range * 0.9) {
      const dir = state.map.avoidDir(h, foe.x, foe.z, state.towers, 2.4)
      h.mx = dir.x
      h.mz = dir.z
    } else if (!foe && dist(h, throne) > 10) {
      // 낚여 나갔다면 옥좌로 복귀
      const dir = state.map.avoidDir(h, throne.x, throne.z, state.towers, 2.4)
      h.mx = dir.x
      h.mz = dir.z
    } else {
      h.mx = 0
      h.mz = 0
      if (foe) h.dir = Math.atan2(foe.z - h.z, foe.x - h.x)
    }
    return
  }
  if (!h.bossMarching) {
    h.bossMarching = true
    pushFeed(state, 'obj', `👹 ${CLASSES[h.cls].name}이(가) 진군을 시작했다 — 방어선을 사수하라!`)
  }
  // 공성 목표: 미드 라인의 다음 방어선을 순서대로 — 외곽 타워 → 내곽 → 최후 포탑 → 수호석.
  // 보스의 진군로가 곧 게임의 시계다: 방어선이 하나씩 무너지며 압박이 조여 온다.
  let siege = null
  let bestX = -Infinity
  for (const t of state.towers) {
    if (!t.alive || t.team !== 'blue' || t.lane !== 'mid') continue
    if (t.x > bestX) { bestX = t.x; siege = { tk: 'tower', id: t.id, x: t.x, z: t.z, surf: TOWER_RADIUS } }
  }
  const nb = state.map.NEXUS_POS.blue
  if (!siege) siege = { tk: 'nexus', id: 'blue', x: nb.x, z: nb.z, surf: NEXUS_RADIUS }
  // 공성 집중(교착 방지): 같은 방어선 근처(BOSS_FOCUS_NEAR)에서 BOSS_FOCUS_AFTER를 넘기면
  // 영웅 교전을 끊고 구조물만 두드린다 — 건물이 반드시 순서대로(외곽→내곽→최후→수호석) 무너진다.
  // 방어선 하나를 부수면 잠깐 포효(연출 비트) 후 곧장 다음 방어선으로 — 쉬는 건 각성 휴지기뿐이다.
  if (h.bossSiegeId !== siege.id) {
    if (h.bossSiegeId != null) {
      h.bossRoarT = BOSS_REGROUP
      pushFx(state, 'berserk', h.x, h.z, 6, h.team)
      pushFeed(state, 'obj', '🛡️ 방어선이 무너졌다 — 보스가 다음 방어선으로 향한다!')
    }
    h.bossSiegeId = siege.id
    h.bossSiegeT = 0
    h.bossFocusWarned = false
  }
  if (h.bossRoarT > 0) {
    h.bossRoarT -= dt
    h.mx = 0
    h.mz = 0
    return
  }
  if (Math.hypot(siege.x - h.x, siege.z - h.z) < BOSS_FOCUS_NEAR) h.bossSiegeT += dt
  const focus = h.bossSiegeT > BOSS_FOCUS_AFTER
  if (focus && !h.bossFocusWarned) {
    h.bossFocusWarned = true
    pushFeed(state, 'obj', '💢 보스가 방어선 파괴에 집중합니다 — 막아설 수 없다!')
  }
  // 표적: 공성 목표 근처(BOSS_LEASH 안)의 보이는 적 중 "가장 약한" 영웅 — 우물 캠핑·낚시 방지.
  // 최약체를 노리는 이유: 보스가 마음먹으면 하나는 반드시 죽는다는 처형압이 난이도의 심장이다.
  const bf = state.map.FOUNTAIN_POS.blue
  const safeR2 = (FOUNTAIN_RADIUS + 4) ** 2
  const leash2 = BOSS_LEASH * BOSS_LEASH
  const aggro2 = BOSS_AGGRO * BOSS_AGGRO
  let foe = null
  let bd = Infinity
  let bfrac = Infinity
  for (const e of state.heroes) {
    if (e.team === h.team || e.respawnT > 0 || e.isBoss) continue
    if (!isHeroVisible(state, e, h.team)) continue
    if (dist2(e, bf) <= safeR2) continue // 우물 안까지 쫓아 들어가진 않는다
    if (dist2(e, siege) > leash2) continue // 공성 목표에서 너무 먼 적은 무시
    const d = dist2(h, e)
    if (d > aggro2) continue
    const frac = e.hp / e.maxHp
    if (frac < bfrac - 0.001 || (Math.abs(frac - bfrac) <= 0.001 && d < bd)) {
      bfrac = frac
      bd = d
      foe = e
    }
  }
  // 타입별 스킬 로테이션 (siege = 진군 축 — 습격류 스킬이 축을 벗어나지 않게)
  if (h.cls === 'boss_colossus') bossColossus(state, h, foe)
  else if (h.cls === 'boss_archmage') bossArchmage(state, h, foe)
  else if (h.cls === 'boss_thorn') bossThorn(state, h, foe)
  else bossShadow(state, h, foe, siege)
  // 파멸의 삼중격 — 카르곤 전용(전사형의 정체성). 전방 세 갈래 검기, 근거리는 겹쳐 맞는다
  if (h.cls === 'boss_colossus' && h.bossCd.fan <= 0 && foe && dist(h, foe) < 13) {
    h.bossCd.fan = 6 * BOSS_PHASE_CD[h.bossPhase - 1] * bossTierOf(state).cd
    bossFan(state, h, foe)
  }
  // ── 행동 결심(3초 커밋): '응징'(붙은 적을 팬다)이냐 '공성'(구조물을 부순다)이냐를 정하고
  //    그동안 유지한다. 틱마다 목표를 바꾸면 타워 앞에서 아무것도 못 때리고 얻어맞기만 하는
  //    우왕좌왕(교전 판정 경계에서 서성이는 사각지대)이 생긴다 — 결심했으면 밀어붙인다.
  const range = heroRange(h) // 국면이 오르면 몸과 함께 사거리도 커진다
  const sDist = Math.hypot(siege.x - h.x, siege.z - h.z) - siege.surf
  const canFight = foe && !focus
  if (
    h.bossDecideT == null || state.time >= h.bossDecideT ||
    (h.bossMode === 'fight' && !canFight) // 응징 대상이 사라졌으면 즉시 공성으로
  ) {
    // 어그로 반경 안에 적이 있으면 응징이 기본 — 공성만 파면 시계가 너무 빨리 돈다.
    // 교착은 공성 집중(BOSS_FOCUS_AFTER)이 끊는다.
    h.bossMode = canFight && bd <= BOSS_AGGRO * BOSS_AGGRO ? 'fight' : 'siege'
    h.bossDecideT = state.time + 3
  }
  if (h.bossMode === 'fight') {
    // 응징: 표적을 사거리 안까지 쫓아 들어가 팬다 — 경계에서 멈춰 서지 않는다
    castAttack(state, h.id, dist(h, foe) <= range ? { tk: 'hero', id: foe.id } : null)
    if (dist(h, foe) > range * 0.9) {
      const dir = state.map.avoidDir(h, foe.x, foe.z, state.towers, 2.4)
      h.mx = dir.x
      h.mz = dir.z
    } else {
      h.mx = 0
      h.mz = 0
      h.dir = Math.atan2(foe.z - h.z, foe.x - h.x)
    }
    return
  }
  // 공성: 구조물로 직행해 부순다 — 영웅이 몸으로 막아도 멈추지 않는다
  // (엔레이지 타이머: 보스를 잡지 못하면 결국 본진이 무너진다). 응징은 스킬 로테이션이 맡는다.
  castAttack(state, h.id, sDist <= range ? siege : null)
  if (sDist <= range * 0.8) {
    h.mx = 0
    h.mz = 0
    h.dir = Math.atan2(siege.z - h.z, siege.x - h.x)
    return
  }
  const dir = state.map.avoidDir(h, siege.x, siege.z, state.towers, 2.4)
  h.mx = dir.x
  h.mz = dir.z
}

// 보스 병사 소환: 절반 근접 + 절반 원거리 — 보스 곁에서 튀어나와 전부 미드(진군로)를 민다.
// 전선은 미드 하나뿐이다: 측면 길엔 타워가 없어 파도를 보내면 "순서대로 무너지는 방어선"
// 이라는 게임의 시계가 깨진다(수호석 직행). 측면 길은 파밍·우회 이동용으로만 남긴다.
function bossSummon(state, h, { count = 6, hpMul = 1.3 } = {}) {
  const lane = 'mid'
  const grow = MINION_HP_GROWTH * (state.time / 60) * 2
  for (let i = 0; i < count; i++) {
    const ranged = i >= count / 2
    const spec = ranged ? RANGED : MELEE
    state.minions.push({
      id: state.nextId++,
      team: h.team,
      lane,
      ranged,
      x: h.x + (state.rng() - 0.5) * 5,
      z: h.z + (state.rng() - 0.5) * 5,
      hp: (spec.hp + grow) * hpMul,
      maxHp: (spec.hp + grow) * hpMul,
      atkCd: i * 0.3,
      dir: Math.PI,
      atkSeq: 0,
      wpI: state.map.nearestWp(lane, h.x, h.z),
    })
  }
  pushFx(state, 'summon', h.x, h.z, 6, h.team, 1.0)
}

// 보스전 정예 소환: 보스 유형에 맞는 '그림자 영웅' 5기 — 성곽에서 뛰쳐나와 미드로 진군한다.
//  일반 영웅과 같은 몸(스킬·평타·봇 두뇌·킬 보상)이지만 죽으면 부활하지 않는다(레이드 쫄 페이즈).
//  잡을 때마다 킬 골드·경험치가 아군의 성장 연료가 된다 — 방치하면 방어선이 먼저 갈린다.
// 5기면 충분하다 — 아군 평균 레벨 + 후퇴 없음이라 순삭당하지 않는다(순삭 문제가 재발하면 확대)
const BOSS_ADD_SQUADS = {
  boss_colossus: ['warrior', 'tank', 'gladiator', 'swordmaster', 'guardian'],
  boss_archmage: ['mage', 'cryomancer', 'warlock', 'terramancer', 'chronomancer'],
  boss_thorn: ['snarer', 'beastmaster', 'terramancer', 'windcaller', 'catcher'], // 자연군 — 덩굴 정령들
  boss_shadow: ['assassin', 'illusionist', 'fearmonger', 'snarer', 'catcher'],
}
// 정예 소환은 두 박자다: ① 바닥에 예고 장판(강림 자리) → ② delay 뒤 그 자리에서 강림.
//  · 장판이 흩뿌려져 깔리므로 아군 봇은 '공격 스킬처럼' 인지해 흩어진다(botDodgeBossZone) —
//    한곳에 응축돼 순간 폭발하던 전열 붕괴를 막는다.
//  · 5기가 한꺼번이 아니라 위상차(0.18초 간격)를 두고 하나씩 강림한다.
//  · 강림 좌표를 넓게 흩뿌려(반경 6~13) 다섯이 겹쳐 서지 않게 한다.
function bossSummonAdds(state, h) {
  const squad = BOSS_ADD_SQUADS[h.cls] || BOSS_ADD_SQUADS.boss_colossus
  // 레벨은 아군 평균에 맞춘다 — 앞서간 아군에게 저레벨 정예가 순삭당하면 골드 셔틀이 된다
  const blues = state.heroes.filter((e) => e.team === 'blue')
  const avgLvl = Math.round(blues.reduce((s, e) => s + e.lvl, 0) / Math.max(1, blues.length))
  const addLvl = Math.max(1, Math.max(h.lvl, avgLvl - 4))
  const count = squad.length + bossTierOf(state).adds // 난이도 티어: 어려움 +1, 악몽 +2
  for (let i = 0; i < count; i++) {
    const cls = squad[i % squad.length]
    const a = Math.PI - 0.7 + (i / (count - 1)) * 1.4 // 서쪽 관문 방향 부채꼴
    const rr = 6 + (i % 2) * 4 + state.rng() * 3 // 반경을 엇갈려(6~13) 겹치지 않게 흩뿌린다
    pushBossZone(state, h, {
      x: h.x + Math.cos(a) * rr, z: h.z + Math.sin(a) * rr, r: 3.4,
      delay: 1.0 + i * 0.18, // 1초 예고 + 위상차 0.18초 — 하나씩 강림
      vfx: 'summon', hue: 'shadow',
      spawnAdd: { cls, lvl: addLvl },
    })
  }
  pushFx(state, 'shriek', h.x, h.z, 9, 'red', 1.0) // 소환 신호 — 보스가 어둠을 부른다
}

// 예고 장판이 터지는 순간 그 자리에 그림자 정예 하나를 강림시킨다(하늘빛 강림 연출 포함).
function spawnShadowAdd(state, spec, x, z) {
  const cls = spec.cls
  const add = makeHeroState(
    { id: `add${state.nextId++}`, name: `그림자 ${CLASSES[cls].name}`, zodiacId: cls, team: 'red', isBot: true },
    cls, { x, z }, state.map, state.rng,
  )
  add.isBoss = false
  add.isBossAdd = true // 부활 없음·후퇴 없음(damageHero/stepBots)
  add.role = 'mid'
  add.lvl = spec.lvl
  add.maxHp = heroMaxHp(add)
  add.hp = add.maxHp
  add.gold = 0
  add.dir = Math.PI
  state.heroes.push(add)
  pushFx(state, 'descend', x, z, 4, 'red', 1.2) // 하늘에서 빛기둥이 내려와 강림(귀환 모션풍)
}

// 전사형 — 대지 강타(예고→광역 기절) / 격돌 돌진(들이받아 띄움) / 회전 격노(지속 광역)
//  강타는 분노할수록 형태가 바뀐다: 단일 균열 → 파생 균열(적 발밑)+용암 → 3중 파문(안→밖 연쇄).
//  회전 격노는 필사 국면에 길어진다(3초→4.5초)
function bossColossus(state, h, foe) {
  const p = h.bossPhase || 1
  const cdMul = BOSS_PHASE_CD[p - 1] * bossTierOf(state).cd // 페이즈 가속 × 난이도 티어
  // 평타 사거리가 아군보다 길어진 대신, 자기 중심 스킬은 "품에 들어온 적"이 있어야 나간다
  const nearFoe = foe && state.heroes.some((e) => e.team !== h.team && e.respawnT <= 0 && dist(h, e) < 9)
  if (h.bossCd.a <= 0 && nearFoe) {
    h.bossCd.a = CLASSES[h.cls].skill.cd * cdMul
    pushFx(state, 'rocksplash', h.x, h.z, 4, h.team) // 땅을 파고드는 예열
    if (p === 1) {
      // 진군: 발밑 단일 균열
      pushBossZone(state, h, {
        x: h.x, z: h.z, r: 9, delay: 1.15, dmg: skillDmg(h, 170, 3.2), stun: 1.0,
        vfx: 'quake', hue: 'lava',
      })
    } else if (p === 2) {
      // 분노: 균열이 넓어지고 용암이 남으며, 파생 균열이 적의 발밑까지 뻗는다
      pushBossZone(state, h, {
        x: h.x, z: h.z, r: 10.5, delay: 1.15, dmg: skillDmg(h, 170, 3.2), stun: 1.0,
        vfx: 'quake', hue: 'lava', life: 3.5, dps: skillDmg(h, 18, 0.3),
      })
      let forks = 0
      for (const e of state.heroes) {
        if (forks >= 2) break
        if (e.team === h.team || e.respawnT > 0 || !isHeroVisible(state, e, h.team)) continue
        if (dist(h, e) > 20) continue
        forks++
        pushBossZone(state, h, {
          x: e.x, z: e.z, r: 5, delay: 1.45, dmg: skillDmg(h, 150, 2.8), stun: 0.6,
          vfx: 'quake', hue: 'lava',
        })
      }
    } else {
      // 필사: 3중 파문 — 안쪽부터 바깥으로 차례로 터진다. 파문 사이 틈을 읽고 빠져나가야 한다
      for (let i = 0; i < 3; i++) {
        pushBossZone(state, h, {
          x: h.x, z: h.z, r: 6 + i * 4, delay: 1.0 + i * 0.5, dmg: skillDmg(h, 160, 3.0), stun: 0.8,
          vfx: 'quake', hue: 'lava',
          ...(i === 0 ? { life: 3.5, dps: skillDmg(h, 18, 0.3) } : null), // 중심엔 용암이 고인다
        })
      }
    }
  }
  // 처형기 '격돌 돌진': 표적의 현재 위치에 착지점을 박고(예고 0.7초) 몸을 날린다 —
  // 표식을 보고 걸어 나가면 빗나간다. 제자리에 있었다면 각오한 것.
  if (h.bossCd.b <= 0 && foe && !h.bossDash) {
    const d = dist(h, foe)
    if (d > 8 && d < 30) {
      h.bossCd.b = CLASSES[h.cls].skill2.cd * cdMul
      pushBossZone(state, h, {
        x: foe.x, z: foe.z, r: 5, delay: 1.0, dmg: skillDmg(h, 250, 5.0), stun: 1.2,
        vfx: 'boom', hue: 'lava', aim: true, from: { x: h.x, z: h.z }, // 경로 화살표(> > >)
      })
      h.bossDash = { x: foe.x, z: foe.z, at: state.time + 1.0 }
    }
  }
  // 시그니처 '단층선': 표적 방향 부챗살 균열이 안쪽부터 물결처럼 터진다(3→4→5갈래).
  // 갈래 "사이"가 안전 — 부챗살 틈을 아는 자만 서 있을 자리를 찾는다.
  if (h.bossCd.d <= 0 && foe && dist(h, foe) < 18) {
    h.bossCd.d = 18 * cdMul
    const rays = p === 3 ? 5 : p === 2 ? 4 : 3
    const base = Math.atan2(foe.z - h.z, foe.x - h.x)
    const spread = Math.PI * 0.7
    for (let i = 0; i < rays; i++) {
      const a = base - spread / 2 + (spread * i) / Math.max(1, rays - 1)
      for (let k = 0; k < 4; k++) {
        const d = 5.5 + k * 4.5
        pushBossZone(state, h, {
          x: h.x + Math.cos(a) * d, z: h.z + Math.sin(a) * d, r: 3.4,
          delay: 1.6 + k * 0.25, dmg: skillDmg(h, 220, 4.2), stun: 0.6,
          vfx: 'quake', hue: 'lava',
        })
      }
    }
    pushFx(state, 'rocksplash', h.x, h.z, 5, h.team)
  }
}

// 마법사형 — 형태 3종: 원형(밀려오는 한파) / 두꺼운 직선(빙결의 격류) / 타겟 장판(빙성 낙하)
//  + 근접 견제기 '염력 폭발'(2페이즈부터).
//  격류는 필사에 V자 두 줄기로 갈라지고, 낙하는 국면당 표적이 는다(4→5→6)
function bossArchmage(state, h, foe) {
  const p = h.bossPhase || 1
  const cdMul = BOSS_PHASE_CD[p - 1] * bossTierOf(state).cd // 페이즈 가속 × 난이도 티어
  // 근접 견제 '염력 폭발'(2페이즈+): 몸에 붙은 적이 있으면 강력한 염력을 방출해
  //  자기 중심에서 바깥으로 크게 밀쳐낸다 — 근접이 달라붙어 순삭하던 걸 끊는다.
  //  예고 0.8초(모여드는 냉기 링)를 보고 미리 빠지면 안 밀리고 안 맞는다.
  if (p >= 2 && h.bossCd.c <= 0) {
    let near = 0
    for (const e of state.heroes) {
      if (e.team !== h.team && e.respawnT <= 0 && dist(h, e) < 9) near++
    }
    if (near >= 1) {
      h.bossCd.c = 9 * cdMul
      pushBossZone(state, h, {
        x: h.x, z: h.z, r: 12, delay: 0.8, dmg: skillDmg(h, 70, 1.2),
        knock: 13, knockStun: 0.5, freeze: 0.6, vfx: 'repulse', hue: 'frost',
      })
    }
  }
  // 타겟 장판 '빙성 낙하'(처형): 보이는 적 영웅 "각자의 발밑"에 얼음 낙석 표식 —
  // 서 있던 자리가 위험해진다. 예고 1.3초 안에 모두가 제자리를 버려야 한다(산개 강제).
  if (h.bossCd.a <= 0 && foe) {
    h.bossCd.a = 14 * cdMul
    let n = 0
    for (const e of state.heroes) {
      if (n >= 2 + p) break // 국면당 3~5개
      if (e.team === h.team || e.respawnT > 0 || !isHeroVisible(state, e, h.team)) continue
      n++
      pushBossZone(state, h, {
        x: e.x, z: e.z, r: 5, delay: 1.7, dmg: skillDmg(h, 250, 5.0), freeze: 1.5,
        vfx: 'abszero', hue: 'frost', aim: true,
      })
    }
  }
  // 두꺼운 직선 '빙결의 격류'(압박): 표적 방향으로 굵은 얼음 급류가 밀려온다 —
  // 가까운 쪽부터 순차 빙결(파도 문법). 옆으로 반 발짝이 정답. 분노부턴 서리밭이 남고,
  // 필사엔 두 줄기(V자)로 갈라져 빠질 각도가 좁아진다.
  if (h.bossCd.b <= 0 && foe && dist(h, foe) < 20) {
    h.bossCd.b = CLASSES[h.cls].skill2.cd * cdMul
    const dir = Math.atan2(foe.z - h.z, foe.x - h.x)
    h.dir = dir
    const dirs = p === 3 ? [dir - 0.22, dir + 0.22] : [dir]
    for (const d of dirs) {
      pushBossLine(state, h, d, {
        count: 6, r: 4.4, gap: 3.2, delay: 1.4, step: 0.16,
        dmg: skillDmg(h, 170, 3.2),
        effect: {
          freeze: 1.6,
          ...(p >= 2 ? { life: 2.8, dps: skillDmg(h, 12, 0.2), slow: 0.5 } : null),
        },
        vfx: 'abszero', hue: 'frost',
      })
    }
  }
  // 시그니처 '밀려오는 한파': 보스 중심에서 얼음 파동이 크게 터진다 — 중앙(보스 발밑)까지
  //  전부 얼어붙는다(안전지대 없음: 붙어서 때리던 근접이 그대로 맞는다). 예고 1.5초 안에
  //  반경 밖으로 걸어 나가면 산다. 국면이 오르면 서리밭이 남는다.
  //  (예전 3중 도넛 밴드는 중앙이 사실상 안전지대가 돼 근접 순삭을 막지 못했다 — 폐기)
  if (h.bossCd.d <= 0 && foe && dist(h, foe) < 14) {
    h.bossCd.d = 20 * cdMul
    pushBossZone(state, h, {
      x: h.x, z: h.z, r: 14.5, delay: 1.5, // 반경 18→14.5(≈80%)
      dmg: skillDmg(h, 253, 4.8), freeze: p >= 2 ? 2.2 : 1.6, // 220→253·4.2→4.8 (+15%)
      vfx: 'abszero', hue: 'frost',
      ...(p >= 2 ? { life: 2.6, dps: skillDmg(h, 14, 0.23), slow: 0.5 } : null),
    })
  }
}

// 암살자형 — 형태 3종: 원형(공포의 포효) / 두꺼운 직선(신월참 1→2→3줄) / 타겟 표식(그림자 습격).
//  습격은 분노할수록: 단일 칼날 → 연격(도주로 예측 2연타) → 참수 난무(여럿 동시 표식).
//  포효는 넓어지고(11→12.5→14) 필사 국면엔 혼자만 있어도 내지른다
// 자연형 — 가시 투척(직선 읽기) / 가시밭(원거리 자리 장악) / 가시 낙인(마크-폭파: 뭉침 응징)
//  / 가시갑옷(반사창: '지금은 때리지 마' 판단 강제). 근접이 무지성으로 붙어 패면 찔리고,
//  원거리가 뭉쳐 쏘면 낙인이 한꺼번에 터진다 — "간격"을 가르치는 보스.
function bossThorn(state, h, foe) {
  const p = h.bossPhase || 1
  const cdMul = BOSS_PHASE_CD[p - 1] * bossTierOf(state).cd // 페이즈 가속 × 난이도 티어
  // 가시 투척: 표적 방향 직선 예고 — 국면이 오르면 부챗살(1→2→3줄)로 빠질 각이 좁아진다
  if (h.bossCd.a <= 0 && foe && dist(h, foe) < 20) {
    h.bossCd.a = CLASSES[h.cls].skill.cd * cdMul
    const dir = Math.atan2(foe.z - h.z, foe.x - h.x)
    h.dir = dir
    const dirs = p === 3 ? [dir - 0.26, dir, dir + 0.26] : p === 2 ? [dir - 0.15, dir + 0.15] : [dir]
    for (const d of dirs) {
      pushBossLine(state, h, d, {
        count: 5, r: 3.8, gap: 3.2, delay: 1.0, dmg: skillDmg(h, 150, 2.8),
        effect: { slow: 0.4 }, vfx: 'quake', hue: 'venom',
      })
    }
  }
  // 가시밭: 제일 멀리서 쏘는 적 발밑 — 잔류 덤불(도트+둔화)로 원거리 자리를 갈아엎는다
  if (h.bossCd.b <= 0) {
    let far = null
    for (const e of state.heroes) {
      if (e.team === h.team || e.respawnT > 0 || e.isBoss) continue
      if (!isHeroVisible(state, e, h.team) || dist(h, e) > 24) continue
      if (!far || dist(h, e) > dist(h, far)) far = e
    }
    if (far) {
      h.bossCd.b = CLASSES[h.cls].skill2.cd * cdMul
      pushBossZone(state, h, {
        x: far.x, z: far.z, r: 6.5, delay: 1.2, dmg: skillDmg(h, 130, 2.4), aim: true,
        vfx: 'quake', hue: 'venom', life: 4, dps: skillDmg(h, 16, 0.28), slow: 0.45,
      })
    }
  }
  // 가시 낙인(시그니처): 보이는 영웅들에게 낙인 — 2.6초 뒤 각자 자리에서 폭발(반경이 겹치면 중첩).
  //  낙인자는 아군에게서 떨어져야 한다 — "흩어져!"를 가르친다. 국면 2→3→4명.
  if (h.bossCd.c <= 0) {
    const want = p === 3 ? 4 : p === 2 ? 3 : 2
    const marks = []
    for (const e of state.heroes) {
      if (marks.length >= want) break
      if (e.team === h.team || e.respawnT > 0 || e.thornBombT > 0) continue
      if (!isHeroVisible(state, e, h.team) || dist(h, e) > 26) continue
      marks.push(e)
    }
    if (marks.length >= 2) {
      h.bossCd.c = 20 * cdMul
      for (const e of marks) {
        e.thornBombT = 2.6
        e.thornBombDmg = skillDmg(h, 180, 3.4)
        e.thornBombFrom = h.id
      }
      pushFeed(state, 'obj', '💥 가시 낙인이 새겨졌다 — 서로에게서 떨어져라!')
    }
  }
  // 가시갑옷(도발형): 0.8초 예고 링 → 못 빠져나간 적을 도발(브램블 강제 평타) + 6초 반사창.
  //  걸리면 반사갑옷을 제 손으로 두드리게 된다 — "링이 보이면 빠져나와라"가 유일한 해법.
  if (h.bossCd.d <= 0 && p >= 2) {
    const near = state.heroes.filter((e) => e.team !== h.team && e.respawnT <= 0 && dist(h, e) < 9).length
    if (near >= 2) {
      h.bossCd.d = 26 * cdMul
      h.thornTauntAt = state.time + 0.8 // 집행은 bossThink 펜딩 섹션에서
      pushBossZone(state, h, { x: h.x, z: h.z, r: 9, delay: 0.8, dmg: 0, vfx: 'quake', hue: 'venom' })
      pushFeed(state, 'obj', '🌵 브램블이 가시를 곤두세운다 — 링 밖으로! 걸리면 강제로 때리게 된다!')
    }
  }
}

function bossShadow(state, h, foe, siege) {
  const p = h.bossPhase || 1
  const cdMul = BOSS_PHASE_CD[p - 1] * bossTierOf(state).cd // 페이즈 가속 × 난이도 티어
  if (h.bossCd.a <= 0) {
    let weakest = null
    for (const e of state.heroes) {
      if (e.team === h.team || e.respawnT > 0 || e.isBoss) continue
      if (!isHeroVisible(state, e, h.team) || dist(h, e) > 26) continue
      if (siege && dist2(e, siege) > BOSS_LEASH * BOSS_LEASH) continue // 정글 낚시에 안 끌려간다
      if (!weakest || e.hp / e.maxHp < weakest.hp / weakest.maxHp) weakest = e
    }
    if (weakest) {
      h.bossCd.a = CLASSES[h.cls].skill.cd * cdMul
      pushFx(state, 'blink', h.x, h.z, 3, h.team)
      const dir = Math.atan2(weakest.z - h.z, weakest.x - h.x)
      h.x = weakest.x + Math.cos(dir) * 2.2 // 등 뒤로 파고든다
      h.z = weakest.z + Math.sin(dir) * 2.2
      h.dir = Math.atan2(weakest.z - h.z, weakest.x - h.x)
      state.map.resolveTerrain(h, 2.2, colliders(state))
      pushFx(state, 'blink', h.x, h.z, 3, h.team)
      // 습격의 칼날은 반 박자 늦게 떨어진다 — 표식(예고)을 보고 몸을 빼면 산다.
      // 분노하면 형태가 바뀐다: 연격(도주로 예측) → 참수 난무(여럿 동시 표식)
      pushBossZone(state, h, {
        x: weakest.x, z: weakest.z, r: 4.2, delay: 1.0, dmg: skillDmg(h, 200, 4.0),
        vfx: 'shadowexec', hue: 'shadow', aim: true,
      })
      if (p === 2) {
        // 연격: 도망갈 방향을 읽고 두 번째 칼날을 심는다
        const px = weakest.x + (weakest.mx || 0) * 6
        const pz = weakest.z + (weakest.mz || 0) * 6
        pushBossZone(state, h, {
          x: px, z: pz, r: 4.2, delay: 1.4, dmg: skillDmg(h, 170, 3.4),
          vfx: 'shadowexec', hue: 'shadow', aim: true,
        })
      } else if (p === 3) {
        // 참수 난무: 보이는 다른 적들에게도 칼날 표식 — 모두가 발밑을 살펴야 한다
        let marks = 0
        for (const e of state.heroes) {
          if (marks >= 2) break
          if (e === weakest || e.team === h.team || e.respawnT > 0) continue
          if (!isHeroVisible(state, e, h.team) || dist(h, e) > 24) continue
          marks++
          pushBossZone(state, h, {
            x: e.x, z: e.z, r: 4.2, delay: 1.2 + marks * 0.15, dmg: skillDmg(h, 170, 3.4),
            vfx: 'shadowexec', hue: 'shadow', aim: true,
          })
        }
      }
      if (p >= 2) h.hasteT = Math.max(h.hasteT, 1.5) // 분노한 그림자는 습격 뒤 더 빨라진다
    }
  }
  if (h.bossCd.b <= 0) {
    const roarR = p === 3 ? 14 : p === 2 ? 12.5 : 11
    let near = 0
    for (const e of state.heroes) {
      if (e.team !== h.team && e.respawnT <= 0 && dist(h, e) < roarR) near++
    }
    if (near >= (p === 3 ? 1 : 2)) {
      h.bossCd.b = CLASSES[h.cls].skill2.cd * cdMul
      // 공포의 포효: 숨을 들이켜는 예고 → 폭발 공포
      pushBossZone(state, h, {
        x: h.x, z: h.z, r: roarR, delay: 1.2, dmg: skillDmg(h, 150, 2.8), fear: 1.6,
        vfx: 'shriek', hue: 'shadow',
      })
    }
  }
  // 두꺼운 직선 '신월참'(읽기): 표적 방향으로 굵은 참격이 뻗는다 — 가까운 쪽부터 순차 폭발.
  // 국면이 오르면 줄기가 는다(1→2→3줄, 좁은 V자) — 빠질 각도가 점점 좁아진다.
  if (h.bossCd.d <= 0 && foe && dist(h, foe) < 18) {
    h.bossCd.d = 15 * cdMul
    const dir = Math.atan2(foe.z - h.z, foe.x - h.x)
    h.dir = dir
    const dirs = p === 3 ? [dir - 0.3, dir, dir + 0.3] : p === 2 ? [dir - 0.18, dir + 0.18] : [dir]
    for (const d of dirs) {
      pushBossLine(state, h, d, {
        count: 5, r: 4.2, gap: 3.4, delay: 1.3, step: 0.14,
        dmg: skillDmg(h, 220, 4.2),
        vfx: 'shadowexec', hue: 'shadow',
      })
    }
  }
}

function stepBots(state, dt) {
  // 팀 콜(오브젝트 집결/구조물 수비)은 틱마다 새로 계산한다.
  //  새 결심은 모드별 창(objectiveWindowOpen)이 열렸을 때만 — 진행 중인 커밋은 창과 무관하게 유지.
  const objCall = {
    blue: computeObjectiveCall(state, 'blue', objectiveWindowOpen(state, 'blue')),
    red: computeObjectiveCall(state, 'red', objectiveWindowOpen(state, 'red')),
  }
  const defendPlan = computeDefensePlan(state)
  for (const h of state.heroes) {
    if (!h.isBot || h.respawnT > 0) continue
    if (h.isBoss) { // 보스는 봇 사고루프 대신 전용 두뇌
      bossThink(state, h, dt)
      continue
    }
    // 무적 보스(수면/각성 휴지기)를 물고 있으면 즉시 표적에서 놓는다 — 아래 어떤 continue
    // 경로(장판 회피·후퇴 등)로 빠지든 무적 보스를 계속 겨냥하지 않게 최상단에서 끊는다.
    if (h.botFoeId) {
      const cf = state.heroes.find((e) => e.id === h.botFoeId)
      if (cf?.isBoss && bossInvuln(state, cf)) { h.botFoeId = null; h.botThinkT = 0 }
    }
    if (h.fallT > 0) { // 추락 중 — 봇 두뇌 정지
      h.mx = 0
      h.mz = 0
      continue
    }
    // 콜로세움: 결투 전용 두뇌 — 패주 귀가·전선 유지 같은 MOBA 습관이 끼기 전에 최상단에서 가로챈다
    if (state.mode === 'arena') {
      arenaBotDuty(state, h, dt)
      continue
    }
    // 액티브 아이템: 위기에 물병(빈사)·정화의 종(굵직한 CC)을 쓴다 — CC 판정보다 먼저(정화는 기절 중에도)
    for (let i = 0; i < h.items.length; i++) {
      const it = ITEMS_BY_ID[h.items[i]]
      if (!it?.active || (h.itemCd[it.id] || 0) > 0) continue
      if (it.active.kind === 'heal' && h.hp < h.maxHp * 0.45) useItem(state, h.id, i)
      else if (it.active.kind === 'cleanse' && (h.stunT > 0.5 || h.freezeT > 0.5 || h.rootT > 0.5)) useItem(state, h.id, i)
    }
    if (h.stunT > 0 || h.castT > 0) {
      h.mx = 0
      h.mz = 0
      continue
    }
    // ── 갈 곳 잃은 봇 구제: 끼임 감지 → 귀환으로 마을(우물) 복귀 ──
    // 스스로 시작한 귀환을 채널링하는 중이면 가만히 기다린다.
    if (h.botRecall) {
      if (h.recallT > 0) {
        h.mx = 0
        h.mz = 0
        continue
      }
      // 채널링 종료: 우물로 복귀(성공)했거나 피격으로 끊겼다(실패) — 어느 쪽이든 초기화
      h.botRecall = false
      h.botStuckT = 0
    }
    // 지난 틱 결과로 끼임을 누적한다: "가려고 했는데"(이동 입력) "싸우지도 못하고"
    // (이번에 공격 안 함) 거의 못 움직였으면(벽/타워/수호석에 박힘) 게이지를 올린다.
    const wantedMove = Math.hypot(h.mx, h.mz) > 0.12
    const attacked = h.atkSeq !== (h.botPrevSeq ?? h.atkSeq)
    const moved = Math.hypot(h.x - (h.botPrevX ?? h.x), h.z - (h.botPrevZ ?? h.z))
    if (wantedMove && !attacked && moved < heroSpeed(h) * dt * 0.25) {
      h.botStuckT = (h.botStuckT || 0) + dt
      if (h.botStuckT > 0.9) h.navUntil = 0 // 헤매기 시작하면 귀환 전에 우선 길부터 다시 찾는다
    } else {
      h.botStuckT = Math.max(0, (h.botStuckT || 0) - dt * 2)
    }
    h.botPrevX = h.x
    h.botPrevZ = h.z
    h.botPrevSeq = h.atkSeq
    // 너무 오래 헤맸으면(우물 밖에서) 귀환을 켜고 가만히 채널링 → 우물로 순간복귀
    if ((h.botStuckT || 0) > BOT_STUCK_T && !inFountain(h)) {
      castRecall(state, h.id)
      if (h.recallT > 0) {
        h.botRecall = true
        h.mx = 0
        h.mz = 0
        continue
      }
    }
    // 우물에 있을 때 장비 보충. 보스전 아군 봇은 원격 보급 — 보스가 본진에 닿으면
    // 봇은 전투에서 벗어날 틈이 없어, 우물 조건을 걸면 골드를 쥔 채 맨몸으로 싸운다.
    if (inFountain(h) || (isRaidMode(state.mode) && h.team === 'blue')) botShop(state, h)
    const cls = CLASSES[h.cls]
    // 적 리스폰 존은 금지 구역 — 우물 피해를 맞으며 회복하는 적을 쫓는 건 자살이다.
    // 들어갔다면 존 중심 반대 방향(바깥)으로 즉시 빠져나오고, 이번 틱은 그걸로 끝.
    // (수호석 방향으로 나가면 안 된다 — 보스전 옥좌처럼 수호석이 존 안에 있는 맵이 있다)
    {
      const ef = state.map.FOUNTAIN_POS[enemyOf(h.team)]
      const escR = FOUNTAIN_RADIUS + 2
      if (ef && dist2(h, ef) < escR * escR) {
        const away = Math.atan2(h.z - ef.z, h.x - ef.x) || Math.PI // 중심에 겹치면 서쪽으로
        steerToward(state, h, {
          x: ef.x + Math.cos(away) * (escR + 6),
          z: ef.z + Math.sin(away) * (escR + 6),
        })
        botAttack(state, h, dt) // 나오는 길에 사거리 안이면 공성/반격은 한다
        continue
      }
    }
    // 보스 예고 장판 위 = 만사 제치고 이탈 (보스전 아군 — '공략' 반사신경)
    if (isRaidMode(state.mode) && h.team === 'blue' && botDodgeBossZone(state, h, dt)) continue
    if (isRaidMode(state.mode) && h.team === 'blue' && botSpreadBomb(state, h, dt)) continue
    // 도발당한 봇: 후퇴/임무보다 우선 — 도발한 탱커에게 끌려가 평타친다
    if (h.tauntT > 0) {
      const tk = state.heroes.find((o) => o.id === h.tauntBy && o.team !== h.team && o.respawnT <= 0)
      if (tk) {
        if (dist(h, tk) > cls.range - 0.5) steerToward(state, h, tk)
        else { h.mx = 0; h.mz = 0 }
        botAttack(state, h, dt)
        continue
      }
    }
    // 후퇴 판단 (탱커는 더 끈질기게 버틴다).
    // 그림자 영웅(보스 정예 소환수)은 후퇴가 없다 — 소모품답게 끝까지 몰아붙인다.
    const panic = h.isBossAdd ? 0 : h.cls === 'tank' ? 0.22 : 0.3
    if (h.hp < h.maxHp * panic) h.botRetreat = true
    if (h.botRetreat && h.hp > h.maxHp * 0.85) h.botRetreat = false
    if (h.botRetreat) {
      if (h.cls === 'tank' && h.skillCd <= 0) castSkill(state, h.id) // 방패 켜고 도망!
      // 보조 스킬로 탈출: 은신(암살자)·광폭화(전사, CC 면역+가속)·가속(힐러)
      if (h.skill2Cd <= 0 && h.lvl >= SKILL2_LEVEL &&
        (h.cls === 'assassin' || h.cls === 'warrior' || h.cls === 'healer' || h.cls === 'cryomancer' || h.cls === 'swordmaster' || h.cls === 'snarer' || h.cls === 'fearmonger' || h.cls === 'illusionist')) castSkill2(state, h.id)
      // 적이 안 보이고 한숨 돌렸으면(최근 피격 없음) 먼 길을 걷지 않고 귀환 채널링으로 복귀
      if (
        h.recallT <= 0 && !inFountain(h) &&
        state.time - h.lastHurt > 2 &&
        dist(h, state.map.FOUNTAIN_POS[h.team]) > 26 && // 가까우면 걷는 게 채널링(4초)보다 빠르다
        !state.heroes.some(
          (e) => e.team !== h.team && e.respawnT <= 0 && isHeroVisible(state, e, h.team) && dist2(e, h) < 24 * 24
        )
      ) {
        castRecall(state, h.id)
        if (h.recallT > 0) {
          h.botRecall = true
          h.mx = 0
          h.mz = 0
          continue
        }
      }
      steerToward(state, h, state.map.FOUNTAIN_POS[h.team]) // 수호석이 아니라 뒤편 리스폰 존으로 후퇴해 회복
      botAttack(state, h, dt) // 도망치면서도 사거리 안이면 반격
      continue
    }
    // 힐러: 아픈 아군이 보이면 우선 치유
    if (h.cls === 'healer') {
      if (h.skillCd <= 0) castSkill(state, h.id) // 대상 없으면 안 쓴다
      if (h.ultCd <= 0 && h.lvl >= ULT_LEVEL) {
        const hurt = state.heroes.filter(
          (a) => a.team === h.team && a.respawnT <= 0 && dist(h, a) <= HEAL_RANGE && a.hp < a.maxHp * 0.55
        ).length
        if (hurt >= 2 || h.hp < h.maxHp * 0.4) castUlt(state, h.id)
      }
    }
    // 수호기사: 다치거나 막 맞은 아군(또는 나)에게 보호막을 둘러 준다
    if (h.cls === 'guardian') {
      if (h.skillCd <= 0) {
        const need = state.heroes.some(
          (a) => a.team === h.team && a.respawnT <= 0 && dist(h, a) <= GUARD_RANGE &&
            (a.hp < a.maxHp * 0.8 || state.time - a.lastHurt < 1.5)
        )
        if (need || h.hp < h.maxHp * 0.75) castSkill(state, h.id)
      }
      if (h.ultCd <= 0 && h.lvl >= ULT_LEVEL) {
        const hurt = state.heroes.filter(
          (a) => a.team === h.team && a.respawnT <= 0 && a.hp < a.maxHp * 0.5
        ).length
        if (hurt >= 2) castUlt(state, h.id)
      }
    }
    // 야수조련사: 펫이 없으면 늑대를 소환해 데리고 다닌다
    if (h.cls === 'beastmaster' && h.skillCd <= 0) {
      if (!state.summons.some((s) => s.owner === h.id && s.mobile)) castSkill(state, h.id)
    }
    // 엔지니어: 포탑이 부족하면 설치한다(전투/푸시용)
    if (h.cls === 'engineer' && (h.turretStock || 0) > 0) {
      const turrets = state.summons.filter((s) => s.owner === h.id && s.kind === 'turret').length
      if (turrets < ENGI_MAX_TURRETS) castSkill(state, h.id)
    }
    // ── 판단 틱: 표적·자세는 생각의 리듬으로만 갱신, 실행(이동/조준/스킬)은 매 틱 ──
    h.botThinkT = (h.botThinkT ?? 0) - dt
    const hpDrop = (h.botLastHp ?? h.hp) - h.hp
    h.botLastHp = h.hp
    if (hpDrop > h.maxHp * BOT_THINK_HP_DROP) h.botThinkT = 0 // 크게 맞음 → 즉시 재판단

    // 현재 표적 유효성 — 죽거나 시야를 잃거나 우물로 도망치면 즉시 재판단
    const findFoeById = (id) =>
      state.heroes.find((e) => e.id === id && e.team !== h.team && e.respawnT <= 0) ||
      state.summons.find((c) => c.id === id && c.kind === 'clone' && c.team !== h.team)
    let foe = h.botFoeId ? findFoeById(h.botFoeId) : null
    if (foe && (
      !isHeroVisible(state, foe, h.team) || inOwnFountainSafety(state, foe) ||
      (foe.isBoss && bossInvuln(state, foe)) || // 무적(보호막/수면)이면 표적을 놓는다 — 때려도 헛심
      dist2(h, foe) > BOT_SIGHT * BOT_SIGHT
    )) foe = null
    if (h.botFoeId && !foe) {
      h.botFoeId = null
      h.botThinkT = 0
    }

    if (h.botThinkT <= 0) {
      // 다음 판단까지의 텀 — 난이도(react)와 봇별 흔들림으로 리듬을 어긋나게
      const react = BOT_LEVELS[state.botLevel]?.react || 1
      h.botThinkT = Math.min(1.1, Math.max(0.25, BOT_THINK_BASE * react)) * (0.7 + state.rng() * 0.6) // 위상차 ±30%
      // 가장 가까운 "보이는" 적 스캔 — 환영무희 분신도 겉모습이 똑같으니 봇은 구분하지 못한다
      let best = null
      let bd = BOT_SIGHT * BOT_SIGHT
      let near = 0
      const consider = (e) => {
        if (!isHeroVisible(state, e, h.team)) return
        if (inOwnFountainSafety(state, e)) return // 우물로 살아 들어간 적은 놓아준다(다이브 금지)
        if (e.isBoss && bossInvuln(state, e)) return // 무적(보호막/수면) — 때려봐야 헛심, 파밍이 이득
        const d2v = dist2(h, e)
        if (d2v < 9 * 9) near++
        if (d2v < bd) {
          bd = d2v
          best = e
        }
      }
      for (const e of state.heroes) {
        if (e.team === h.team || e.respawnT > 0) continue
        consider(e)
      }
      for (const c of state.summons) {
        if (c.kind !== 'clone' || c.team === h.team) continue
        consider(c) // 분신에게도 교전 판단이 그대로 돈다 — 미끼에 낚인다
      }
      // 표적 끈기: 물고 있는 표적이 유효하면, 새 후보가 확실히 더 가까울 때만 갈아탄다
      if (foe && best && best.id !== foe.id) {
        if (Math.sqrt(bd) >= dist(h, foe) * BOT_SWITCH_CLOSER) best = foe
      }
      foe = best || foe
      h.botFoeId = foe ? foe.id : null
      h.botNear = near
      // 교전 자세(유리/불리)도 이 리듬으로만 다시 정한다
      if (foe) {
        const sc = botChaseScore(state, h, foe)
        const healthy = h.hp > h.maxHp * 0.38
        h.botWin = healthy && sc.allies >= sc.foes && sc.killT <= sc.lifeT * 1.33
        h.botLose = !healthy || sc.allies < sc.foes || sc.lifeT < sc.killT * 0.65
        if (isRaidMode(state.mode)) {
          if (foe.isBoss) {
            // 체력이 넉넉한 동안(60%+)은 사거리 끝 트레이드, 그 아래는 일찍 빠져 회복 —
            // 치명 패턴 메타에선 히트앤런 사이클이 정답이다(늦게 빠지면 패턴 한 방에 죽는다)
            h.botLose = h.hp < h.maxHp * 0.6 || foe.thornArmorT > 0 // 가시갑옷 반사창엔 물러난다
          }
          if (h.isBossAdd) {
            h.botWin = true
            h.botLose = false
          }
        }
        h.botKillT = sc.killT
        h.botLifeT = sc.lifeT
      }
    }
    const nearCount = h.botNear || 0
    if (foe) {
      const d = dist(h, foe)
      // 직업 사거리에 맞춰 거리 유지(카이팅): 근접은 파고들고 원거리는 빠진다
      const kite = Math.max(2.6, cls.range - 1)
      h.botStrafe += dt * 0.7
      const away = Math.atan2(h.z - foe.z, h.x - foe.x)
      const to = Math.atan2(foe.z - h.z, foe.x - h.x)
      // ── 교전 stance: 판단 틱에서 정한 의도(h.botWin/h.botLose)를 유지한다 ──
      const tower = nearestEnemyTower(state, h)
      const towerD = tower ? dist(h, tower) : Infinity
      const winning = !!h.botWin
      const losing = !!h.botLose
      // ① 불리한데 적이 붙어 있으면 리스폰 존으로 뺀다(생존 우선). 방어·도주기를 쓰며 사거리 안이면 반격.
      if (losing && d < kite + 4) {
        if (h.cls === 'tank' && h.skillCd <= 0 && d < 10) castSkill(state, h.id) // 방패 켜고 후퇴
        if (
          h.skill2Cd <= 0 &&
          h.lvl >= SKILL2_LEVEL &&
          (h.cls === 'assassin' || h.cls === 'warrior' || h.cls === 'healer' || h.cls === 'cryomancer' || h.cls === 'swordmaster' || h.cls === 'snarer' || h.cls === 'fearmonger' || h.cls === 'illusionist')
        ) {
          castSkill2(state, h.id)
        }
        steerToward(state, h, state.map.FOUNTAIN_POS[h.team]) // 수호석이 아니라 뒤편 리스폰 존으로 후퇴해 회복
        botAttack(state, h, dt)
        continue
      }
      // ② 적이 사거리 밖 → 추격은 "유리"할 때만. 확신 없으면 쫓지 않고 임무로 빠진다(자폭 방지).
      //    여기서 도망은 가지 않는다 — 불리 상황은 ①에서 이미 처리했다.
      if (d > kite + 1.5) {
        let dive = true // 적 타워 사거리 안 다이브는 빈사 적 + 즉살각 + 생환 여유가 있을 때만
        if (towerD < TOWER_RANGE + 3) {
          dive = foe.hp < foe.maxHp * 0.4 && h.botKillT < 1.3 && h.botLifeT > h.botKillT * 1.6
        }
        // 보스 상대 원거리 봇은 '유리' 판정 없이도 접근한다 — 카이팅 태세(botWin=false 고정)
        // 때문에 부활·정비 복귀 봇이 사거리 밖 전투를 타워 뒤에서 구경만 하던 문제.
        // 접근은 사거리 끝(카이팅 밴드)까지만. 근접 직업은 제외 — 포효(공포)+처형 표식
        // 콤보 사거리로 제 발로 걸어 들어가 연쇄 전멸한다(시뮬 12판 전패 확인).
        if ((winning || (isRaidMode(state.mode) && foe.isBoss && !losing && CLASSES[h.cls].range >= 8)) && dive) {
          steerToward(state, h, foe) // 옆걸음 없이 전속 직진으로 따라붙는다
          botAttack(state, h, dt)
          botCombatSkills(state, h, foe, d, nearCount)
          continue
        }
        // 확신 없으면 추격을 접고 아래 임무 로직으로 떨어진다(라인/정글) — 도망은 안 친다.
      } else {
        // ③ 적이 사거리 안 → 도망치지 않고 선다.
        //    유리하면 공격 사거리까지 파고들어 들러붙어 딜하고, 호각이면 사거리 가장자리를
        //    유지하며 평타를 트레이드한다(붙으면만 살짝 빠지는 진짜 카이팅).
        // 데드존: 목표 거리를 "한 점"이 아니라 폭 있는 띠로 유지 — 띠 안이면 서서
        // 딜에 집중한다. 틱마다 전진↔후퇴가 뒤집히던 계산기 떨림이 사라진다.
        let ang = null
        if (winning) {
          const engage = Math.max(2.6, cls.range - 1.5)
          if (d > engage + 0.8) ang = to
          else if (d < engage - 2.4) ang = away
        } else {
          if (d < kite - 2.0) ang = away
          else if (d > kite + 1.2) ang = to
        }
        if (ang == null) {
          h.mx = 0
          h.mz = 0
        } else {
          // 붙어 싸우는 중엔 옆걸음을 줄여(딜 집중), 거리 좁힐 땐 직진한다.
          const wob = winning && d > cls.range - 1 ? 0 : 0.22
          h.mx = Math.cos(ang) * (1 - wob) + Math.cos(h.botStrafe) * wob
          h.mz = Math.sin(ang) * (1 - wob) + Math.sin(h.botStrafe) * wob
        }
        botAttack(state, h, dt)
        botCombatSkills(state, h, foe, d, nearCount)
        continue
      }
    }
    // 교전 상대가 없으면 임무 수행 — 지난 틱에 정한 공성 집중 표적(타워/수호석)이 있으면 우선 친다
    botAttack(state, h, dt, h.botFocus) // 병사/정글/타워 등 사거리 안 아무거나
    h.botFocus = null // 집중 표적은 botLaneMove가 틱마다 다시 정한다
    botFarmSkills(state, h) // 뭉친 병사 웨이브엔 스킬도 아끼지 않는다
    // 수비 콜: 위협받는 우리 구조물로 달려간다 (도착하면 위 교전/평타 로직이 싸움을 잡는다)
    // 수호석(tier 4)는 몸통이 커서(반경 4.5 + 영웅 1.3 = 5.8) 문턱을 넉넉히 둬야
    // 경계에서 몸통에 갈리며 제자리걸음(끼임 오판)하지 않는다.
    const dp = defendPlan.get(h.id)
    if (dp) {
      if (dist(h, dp) > (dp.tier === 4 ? 9 : 6)) steerToward(state, h, dp)
      else {
        h.mx = 0
        h.mz = 0
      }
      continue
    }
    // 아군 구조: 시야 밖(BOT_SIGHT 너머) 조금 떨어진 곳에서 아군이 적 영웅에게 맞고 있으면
    // 먼발치에서 구경하지 않고 달려가 함께 싸운다. (도착하면 위 교전 로직이 이어받는다)
    if (h.hp > h.maxHp * 0.5) {
      const rescue = botFindRescue(state, h)
      if (rescue) {
        steerToward(state, h, rescue)
        continue
      }
    }
    // 오브젝트 콜: 팀이 용/이무기를 노린다 — 인원이 모여 확신(canTakeMonster)이 서기 전엔
    // 어그로가 끌리지 않는 거리(RALLY_HOLD)에서 대기하며 팀원을 기다린다.
    // 보스전 전선 위협 시 "새 결심"은 objCall 단계에서 이미 걸러졌다(진행 중 커밋은 유지).
    // 그림자 영웅(소환수)은 오브젝트에 절대 눈길을 주지 않는다 — 오직 챔피언만.
    const call = h.isBossAdd ? null : objCall[h.team]
    if (call && h.hp > h.maxHp * 0.55) {
      const big = state.monsters.find((m) => m.id === call && m.alive)
      if (big) {
        // 결심(커밋)이 서 있거나 지금 가까운 팀이 잡을 각이면 — 붙어서 끝까지 친다.
        //  한번 결심하면 canTakeMonster를 다시 묻지 않는다(추정치가 흔들려도 물러나지 않음 →
        //  우왕좌왕 방지). 결심은 죽을 때까지 유지(computeObjectiveCall가 몬스터 사망 시 해제).
        const committed = state.objCommit[h.team]?.id === call
        if (committed || canTakeMonster(state, h, big)) {
          if (!committed) state.objCommit[h.team] = { id: big.id, until: state.time + 30 } // 결심!
          h.botBigT = state.time + 0.5 // 용/이무기 평타 허용
          botMonsterSkills(state, h, big) // 스킬을 부어 분노가 쌓이기 전에 잡는다
          if (dist(h, big) > CLASSES[h.cls].range - 1) steerToward(state, h, big)
          else {
            h.mx = 0
            h.mz = 0
          }
        } else if (big.aggro && state.heroes.some((a) => a.id === big.aggro && a.team === h.team)) {
          // 우리 팀이 이미 물렸는데 확신이 안 선다 — 리쉬 밖까지 빠져 어그로가 풀리게 돕는다
          botHoldOutside(state, h, big, CAMP_LEASH + 4)
        } else {
          botHoldOutside(state, h, big, RALLY_HOLD) // 아직 커밋 전 — 팀이 모일 때까지 대기
        }
        continue
      }
    }
    // 궁수: 이따금 사냥매를 띄워 앞쪽 안개를 정찰
    if (h.cls === 'archer' && h.skill2Cd <= 0 && h.lvl >= SKILL2_LEVEL && state.rng() < 0.006) {
      castSkill2(state, h.id)
    }
    // 보스전 아군 전용 룰셋: 수성 > 파도 요격 > 정글 > 전선 대기.
    // 범용 정글러 역할은 "위협보다 파밍"을 골라 방어선이 갈리는 걸 구경한다 — 여기선 수성이 항상 먼저다.
    if (isRaidMode(state.mode) && h.team === 'blue') {
      botBossDuty(state, h, dt)
      continue
    }
    // 그림자 영웅(소환수): 정글·용·이무기 파밍을 하지 않는다 — 오직 챔피언 사냥 또는 미드 진군.
    //  (파밍하러 갔다가 용에게 일망타진 당하는 그림 방지. 챔피언 교전은 위 로직이 이미 잡았다.)
    if (h.isBossAdd) {
      botLaneMove(state, h, dt)
      continue
    }
    // 정글러: 캠프/오브젝트를 돌다 근처 교전에 합류(갱킹). 할 일이 없으면 레인 합류.
    if (h.role === 'jungle') {
      if (botJungleRole(state, h, dt)) continue
    }
    if (h.botSeekT > 0 ? false : botJungleMove(state, h)) continue
    botLaneMove(state, h, dt)
  }
}

// 보스 예고 장판 회피 — '공략을 아는 플레이어'처럼 경고를 읽고 가장 가까운 바깥으로 빠진다.
// 여러 장판이 겹치면(융단/파문) 가장 먼저 터질 것부터 피한다.
// (도넛 안전지대 패턴은 전부 폐기됨 — 이제 장판은 전부 '바깥으로 나가면 산다'는 규칙이다)
// 가시 낙인 대응: 낙인이 붙으면 제일 가까운 아군에게서 떨어진다 — 겹폭발 방지.
//  (사람이 배우는 '흩어져!'를 봇도 흉내 — 봇 밴드가 학습 상한을 대변한다)
function botSpreadBomb(state, h, dt) {
  if (!(h.thornBombT > 0)) return false
  let near = null
  let bd = 6 * 6
  for (const e of state.heroes) {
    if (e === h || e.team !== h.team || e.respawnT > 0) continue
    const d2 = dist2(h, e)
    if (d2 < bd) { bd = d2; near = e }
  }
  if (!near) return false // 이미 홀로 — 그냥 싸운다
  const dx = h.x - near.x
  const dz = h.z - near.z
  const d = Math.hypot(dx, dz) || 0.001
  steerToward(state, h, { x: h.x + (dx / d) * 7, z: h.z + (dz / d) * 7 })
  botAttack(state, h, dt) // 떨어지면서도 사거리 안이면 계속 때린다
  return true
}

function botDodgeBossZone(state, h, dt) {
  let zone = null
  let soonest = Infinity
  for (const z of state.zones) {
    if (z.kind !== 'bosszone' || z.exploded || z.t >= z.delay) continue
    const d2v = (h.x - z.x) ** 2 + (h.z - z.z) ** 2
    if (d2v > (z.r + 0.8) ** 2) continue
    const left = z.delay - z.t
    if (left < soonest) { soonest = left; zone = z }
  }
  if (!zone) return false
  const dx = h.x - zone.x
  const dz = h.z - zone.z
  const d = Math.hypot(dx, dz) || 0.001
  // 중심에서 멀어지는 방향으로 반경 밖까지 빠진다
  steerToward(state, h, {
    x: zone.x + (dx / d) * (zone.r + 2.5),
    z: zone.z + (dz / d) * (zone.r + 2.5),
  })
  botAttack(state, h, dt) // 피하면서도 사거리 안이면 계속 때린다
  return true
}

// 보스전: 전선(다음 방어선)이 위협받고 있나 — 수성이 용/이무기 사냥보다 항상 먼저다
function bossFrontThreat(state) {
  let front = null
  let bx = -Infinity
  for (const t of state.towers) {
    if (!t.alive || t.team !== 'blue' || t.lane !== 'mid') continue
    if (t.x > bx) { bx = t.x; front = t }
  }
  front ||= state.map.NEXUS_POS.blue
  for (const e of state.heroes) {
    if (e.team !== 'red' || e.respawnT > 0) continue
    if (e.isBoss && e.bossShieldT > 6) continue
    if (!isHeroVisible(state, e, 'blue')) continue
    if (dist2(e, front) < (e.isBoss ? 70 * 70 : 44 * 44)) return true
  }
  let mobs = 0
  for (const m of state.minions) {
    if (m.team === 'red' && dist2(m, front) < 38 * 38) mobs++
  }
  return mobs >= 3
}

// ── 보스전 아군 봇 전용 룰셋 ──
// 우선순위: ① 전선(다음 방어선)이 위협받으면 수성 집결 ② 밀려오는 파도 요격(골드+저지)
//           ③ 위협이 없을 때만 정글 파밍 ④ 그마저 없으면 전선 앞 대기.
// 교전 자체(추격/스킬/후퇴)는 파이프라인 앞단의 공용 전투 로직이 잡는다 — 여기선 "어디에 있을까"만 정한다.
// ── 콜로세움 봇 듀티 — 결투 본능: 목표는 언제나 적이다 ──
//  안개가 없으므로 적의 "위치"는 항상 안다(부쉬 속이면 공격만 불가 — 다가가면 드러난다).
//  집(스폰 구석)으로 도망가 캠핑하는 습성을 끊고, 붕괴 경고·구멍을 최우선으로 피한다.
function arenaBotDuty(state, h, dt) {
  // 준비 페이즈: 1000골드를 아이템에 쓴다(공통 루프보다 먼저 가로챘으므로 여기서 직접)
  if (state.arenaPhase === 'shop') {
    botShop(state, h)
    h.mx = 0
    h.mz = 0
    return
  }
  // ⓪-1 끼임 구제 — 콜로세움엔 공통 루프의 귀환 구제가 닿지 않는다(최상단 가로채기).
  //  "가려는데"(지난 틱 이동 입력) "싸우지도 못하고" 제자리면 게이지를 올리고,
  //  차면 병사처럼 목표에서 크게 비껴 옆걸음으로 벽을 빠져나온다. 트리거마다 반대쪽 재시도.
  {
    const wanted = Math.hypot(h.mx || 0, h.mz || 0) > 0.12
    const attacked = h.atkSeq !== (h.botPrevSeq ?? h.atkSeq)
    const moved = Math.hypot(h.x - (h.botPrevX ?? h.x), h.z - (h.botPrevZ ?? h.z))
    const held = h.stunT > 0 || h.freezeT > 0 || h.rootT > 0 || h.castT > 0 // CC·시전은 끼임이 아니다
    if (!held && wanted && !attacked && moved < heroSpeed(h) * dt * 0.25) {
      h.botStuckT = (h.botStuckT || 0) + dt
      if (h.botStuckT > 0.6) h.navUntil = 0 // 우선 길부터 다시 찾는다
    } else {
      h.botStuckT = Math.max(0, (h.botStuckT || 0) - dt * 2)
    }
    h.botPrevX = h.x
    h.botPrevZ = h.z
    h.botPrevSeq = h.atkSeq
    if ((h.botStuckT || 0) > 1.1) {
      h.botStuckT = 0
      h.stuckSide = -(h.stuckSide || (state.rng() < 0.5 ? 1 : -1))
      h.arenaDetourT = 0.8
    }
    if ((h.arenaDetourT || 0) > 0) {
      h.arenaDetourT -= dt
      const ref = state.heroes.find((e) => e.id === h.botFoeId && e.hp > 0) || { x: 0, z: 0 }
      const ang = Math.atan2(ref.z - h.z, ref.x - h.x) + (h.stuckSide || 1) * 1.9
      h.mx = Math.cos(ang)
      h.mz = Math.sin(ang)
      botAttack(state, h, dt)
      return
    }
  }
  // 봇이 스스로 계산한 목표는 경기장 밖(원형 벽 너머)일 수 있다 — 그대로 두면
  // A*가 길을 못 찾아 벽에 직진하며 박힌다. 항상 벽 안쪽으로 눌러 담는다.
  const clampArena = (p) => {
    const r = Math.hypot(p.x, p.z)
    const m = ARENA_R - 4
    if (r > m) {
      p.x *= m / r
      p.z *= m / r
    }
    return p
  }
  // ⓪ 붕괴 회피 — 경고 장판 위면 즉시 탈출(공격보다 목숨)
  for (const w of state.holeWarns) {
    const d = Math.hypot(h.x - w.x, h.z - w.z)
    if (d < w.r + 1.5) {
      const dx = (h.x - w.x) / (d || 0.001)
      const dz = (h.z - w.z) / (d || 0.001)
      steerToward(state, h, clampArena({ x: w.x + dx * (w.r + 3), z: w.z + dz * (w.r + 3) }))
      botAttack(state, h, dt)
      return
    }
  }
  // ① 표적: 가장 가까운 생존 적(진짜 위치 — 노포그)
  let foe = null
  let bd = 1e9
  for (const e of state.heroes) {
    if (e.team === h.team || e.respawnT > 0 || e.hp <= 0) continue
    const d = dist2(h, e)
    if (d < bd) { bd = d; foe = e }
  }
  if (!foe) { h.mx = 0; h.mz = 0; return }
  h.botFoeId = foe.id
  const d = Math.sqrt(bd)
  const range = CLASSES[h.cls].range
  // 회복 열매 판단 — 전투를 계속할지, 빠져서 회복할지, 회복하러 가는 적을 끊을지
  let orb = null
  let orbD = 1e9
  for (const o of state.healOrbs) {
    const od = Math.hypot(h.x - o.x, h.z - o.z)
    if (od < orbD) { orbD = od; orb = o }
  }
  if (orb) {
    const foeOrbD = Math.hypot(foe.x - orb.x, foe.z - orb.z)
    const myNeed = 1 - h.hp / h.maxHp
    const foeNeed = 1 - foe.hp / foe.maxHp
    // 회복 러시: 다쳤고(35%+) 경합에서 유리하거나(내가 더 가까움) 빈사(60%+)면 달린다 — 가는 길에도 때린다
    if (myNeed >= 0.35 && orbD < 32 && (orbD < foeOrbD - 1 || myNeed >= 0.6)) {
      steerToward(state, h, orb)
      botAttack(state, h, dt)
      return
    }
    // 컷 플레이: 나는 건강한데 다친 적이 열매로 향하면 열매 앞을 선점해 끊는다
    if (myNeed <= 0.2 && foeNeed >= 0.4 && foeOrbD < 12 && orbD < foeOrbD + 8) {
      steerToward(state, h, orb)
      botAttack(state, h, dt)
      return
    }
  }
  // ② 스탠스: 체력이 밀리면 사거리 끝 카이팅, 아니면 압박 — 단 구석 캠핑은 없다
  const losing = h.hp < h.maxHp * 0.35 && foe.hp > foe.maxHp * 0.5
  let goal
  if (losing && d < range * 0.9) {
    // 뒤로 빠지되 구멍은 밟지 않는다
    const dx = (h.x - foe.x) / (d || 0.001)
    const dz = (h.z - foe.z) / (d || 0.001)
    goal = clampArena({ x: h.x + dx * 6, z: h.z + dz * 6 })
  } else if (d > range * 0.85) {
    goal = { x: foe.x, z: foe.z } // 접근 — 부쉬 속이어도 위치는 안다
  } else if (range >= 9 && d < range * 0.6) {
    // 원거리 카이팅 마이크로: 너무 붙으면 최대 사거리로 물러난다 — 때리면서 뒷걸음질.
    //  개활지(모래벌판)의 지형 이점은 이 한 걸음에서 나온다
    const dx = (h.x - foe.x) / (d || 0.001)
    const dz = (h.z - foe.z) / (d || 0.001)
    goal = clampArena({ x: h.x + dx * (range * 0.85 - d), z: h.z + dz * (range * 0.85 - d) })
  } else if (!state.map.lineFree(h.x, h.z, foe.x, foe.z)) {
    // 사거리 안이어도 벽이 시야선을 막으면 제자리 대치 금지 — 돌아가서 마주 본다.
    //  (협로 중앙 장벽을 사이에 두고 서로 멀뚱히 서 있던 교착의 주범)
    goal = { x: foe.x, z: foe.z }
  } else {
    goal = null // 사거리 안: 제자리 공방(스킬은 공통 루프가 쏜다)
  }
  if (goal) {
    // 확정 구멍 관통 방지: 목표 직전 위치가 구멍 위면 접선 방향으로 우회
    for (const o of state.holes) {
      const gd = Math.hypot(goal.x - o.x, goal.z - o.z)
      if (gd < o.r + 1.2) {
        const px = -(goal.z - o.z) / (gd || 0.001)
        const pz = (goal.x - o.x) / (gd || 0.001)
        goal = { x: o.x + (goal.x - o.x) / (gd || 0.001) * (o.r + 2) + px * 3, z: o.z + (goal.z - o.z) / (gd || 0.001) * (o.r + 2) + pz * 3 }
        break
      }
    }
    steerToward(state, h, goal)
  } else {
    h.mx = 0
    h.mz = 0
  }
  // 전투: 평타 + 직업 스킬(보이는 표적에만 — 부쉬 속은 위치만 알 뿐 조준 불가)
  botAttack(state, h, dt)
  if (isHeroVisible(state, foe, h.team) && d < range + 6) {
    const nearCount = state.heroes.filter((e) => e.team !== h.team && e.respawnT <= 0 && dist(h, e) < 12).length
    botCombatSkills(state, h, foe, d, nearCount)
  }
}

function botBossDuty(state, h, dt) {
  // 전선 = 다음에 무너질 우리 방어선(살아있는 미드 타워 중 가장 동쪽, 없으면 수호석)
  let front = null
  let bx = -Infinity
  for (const t of state.towers) {
    if (!t.alive || t.team !== 'blue' || t.lane !== 'mid') continue
    if (t.x > bx) { bx = t.x; front = t }
  }
  const nb = state.map.NEXUS_POS.blue
  front ||= { x: nb.x, z: nb.z }
  // ① 위협 판정: 붉은 "영웅"(보스/그림자)이 전선을 위협할 때만 집결·대기한다.
  //    보스는 더 먼 거리(진군 중)부터 세어 도착 전에 전열을 갖춘다.
  //    병사 무리는 여기서 세지 않는다 — 대기 모드가 가로채면 타워 옆에서 사거리 밖
  //    무리를 구경만 하게 된다. 파도 정리는 ②(요격: 붙어서 때린다)의 일이다.
  let threat = 0
  for (const e of state.heroes) {
    if (e.team !== 'red' || e.respawnT > 0) continue
    if (e.isBoss && e.bossShieldT > 6) continue // 각성 휴지기의 보스는 위협이 아니다 — 파밍 시간.
    // 단 보호막이 깨지기 직전(6초)엔 위협으로 세어 미리 전선에 재집결한다 — 흩어진 채 맞으면 각개격파당한다
    if (!isHeroVisible(state, e, 'blue')) continue
    if (dist2(e, front) < (e.isBoss ? 70 * 70 : 44 * 44)) threat += 3
  }
  if (threat >= 3) {
    // 수성: 전선으로 집결 — 도착하면 공용 교전 로직이 싸움을 잡는다
    if (dist(h, front) > 15) steerToward(state, h, front)
    else botHoldOutside(state, h, front, 9)
    botAttack(state, h, dt)
    return
  }
  // ② 파도 요격: 전선 가까이(50) 들어온 파도만 상대한다 — 성곽 앞까지 마중 나가면
  //    전선이 비고, 적진에서 소모돼 귀환·복귀를 반복하는 사이 타워가 갈린다.
  //    파도는 타워 사거리와 함께 초크에서 받아친다(전투→회복→바로 복귀의 리듬).
  let mob = null
  let md = Infinity
  for (const m of state.minions) {
    if (m.team !== 'red') continue
    if (dist2(m, front) > 50 * 50) continue // 아직 먼 파도는 오게 둔다
    const d = dist2(h, m)
    if (d < md) { md = d; mob = m }
  }
  if (mob) {
    if (dist(h, mob) > CLASSES[h.cls].range - 1) steerToward(state, h, mob)
    else {
      h.mx = 0
      h.mz = 0
    }
    botAttack(state, h, dt)
    botFarmSkills(state, h)
    return
  }
  // ③ 정글: 파도가 없을 때만 캠프를 돈다 (거리 무제한 — 전장 전체가 아군 농장)
  if (botJungleMove(state, h)) return
  // ④ 대기: 전선 앞에서 전열을 갖춘다
  botHoldOutside(state, h, front, 11)
}

// 정글러 봇: ① 갱킹 — 가까운 레인에서 적과 싸우는 아군이 있으면 달려가 합류
//            ② 정글링 — 용/이무기(여건 되면)·늑대 캠프 사냥
//            ③ 할 일이 없으면 false (호출부가 레인 합류로 넘긴다)
function botJungleRole(state, h, dt) {
  // ① 갱킹: 보이는 적 근처(28)에 싸우는 아군이 있으면 그쪽으로
  let gankTo = null
  let gbd = 48 * 48
  for (const e of state.heroes) {
    if (e.team === h.team || e.respawnT > 0) continue
    if (!isHeroVisible(state, e, h.team)) continue
    const ally = state.heroes.some(
      (a) => a.team === h.team && a !== h && a.respawnT <= 0 && dist2(a, e) < 26 * 26
    )
    if (!ally) continue
    const d = dist2(h, e)
    if (d < gbd) {
      gbd = d
      gankTo = e
    }
  }
  // 보스전: 멀리 있는 보스를 쫓아 지도를 가로지르지 않는다 — 가까울 때만 합류하고,
  // 멀면 파밍을 계속한다(방어는 수비 콜이 부른다). 안 그러면 첫 접촉 후 전원이
  // 보스에 영구 고착돼 성장이 멈춘다.
  if (gankTo && state.mode === 'boss' && gankTo.isBoss && dist(h, gankTo) > 30) gankTo = null
  if (gankTo && h.hp > h.maxHp * 0.45) {
    steerToward(state, h, gankTo)
    return true
  }
  // ② 정글링 (지나는 길의 늑대 + 여건 되면 용/이무기)
  if (botJungleMove(state, h)) return true
  // ③ 정글이 비었으면 라인 지원 — 위협받는 레인 방어/아군 합류 (캠프 부활을 멍하니 안 기다린다)
  if (botSupportLane(state, h)) return true
  // ④ 그래도 할 일이 없으면 다음 캠프 부활을 기다리며 그 자리로
  const respawning = state.monsters.find((m) => CAMP_MOBS[m.kind] && !m.alive)
  if (respawning) {
    steerToward(state, h, respawning.camp)
    return true
  }
  return false
}

// 직업별 교전 스킬 사용
function botCombatSkills(state, h, foe, d, nearCount) {
  // 보조 스킬(Lv3): 직업색에 맞춰 교전 중 적절히 쓴다
  if (h.skill2Cd <= 0 && h.lvl >= SKILL2_LEVEL) {
    if (h.cls === 'warrior' && (nearCount >= 1 || d < DASH_AIM)) castSkill2(state, h.id) // 광폭화로 들이친다
    else if (h.cls === 'tank' && d < TAUNT_RADIUS - 1) castSkill2(state, h.id) // 붙으면 도발
    else if (h.cls === 'healer') castSkill2(state, h.id) // 가속으로 교전 보조
    else if (h.cls === 'mage' && d < CHAIN_RANGE) castSkill2(state, h.id) // 사거리 안이면 체인 라이트닝
    else if (h.cls === 'assassin' && h.hp < h.maxHp * 0.4) castSkill2(state, h.id) // 위기엔 은신으로 빠진다
    else if (h.cls === 'cryomancer' && d < FROSTNOVA_RADIUS) castSkill2(state, h.id) // 붙으면 서리고리로 얼린다
    else if (h.cls === 'gladiator' && d > 3 && d < GLAD_LEAP_AIM) castSkill2(state, h.id) // 도약으로 붙는다
    else if (h.cls === 'warlock' && d < PLAGUE_RANGE) castSkill2(state, h.id) // 역병안개를 깐다
    else if (h.cls === 'guardian' && (nearCount >= 1 || d < WARD_RADIUS)) castSkill2(state, h.id) // 결속(받피감소)
    else if (h.cls === 'catcher' && d < ENSNARE_RADIUS) castSkill2(state, h.id) // 붙으면 옭아매기로 묶는다
    else if (h.cls === 'swordmaster' && h.hp < h.maxHp * 0.45) castSkill2(state, h.id) // 위기엔 잔영 스텝으로 빠진다
    else if ((h.cls === 'beastmaster' || h.cls === 'engineer') && state.summons.some((s) => s.owner === h.id)) {
      castSkill2(state, h.id) // 사냥 명령 / 과부하
    }
    else if (h.cls === 'windcaller' && d < REPULSE_RADIUS) castSkill2(state, h.id) // 붙으면 밀쳐낸다(피일)
    else if (h.cls === 'chronomancer' && d < TIMEWARP_RANGE - 1) castSkill2(state, h.id) // 시간 지연으로 둔화·고립
    else if (h.cls === 'fearmonger' && h.hp < h.maxHp * 0.6) castSkill2(state, h.id) // 망령걸음(장막)으로 버틴다
    else if (h.cls === 'illusionist' && h.hp < h.maxHp * 0.45) castSkill2(state, h.id) // 분신과 자리바꿈으로 이탈
    else if (h.cls === 'terramancer' && d < QUAKE_WALL_AHEAD + 2) castSkill2(state, h.id) // 융기 기절 → 돌팔매 연계
  }
  const ready = h.skillCd <= 0
  if (ready) {
    if (h.cls === 'warrior' && d < DASH_AIM - 2) castSkill(state, h.id)
    else if (h.cls === 'archer' && d < CLASSES.archer.range) castSkill(state, h.id)
    else if (h.cls === 'mage' && d < FIREBALL_RANGE - 6) castSkill(state, h.id)
    else if (h.cls === 'assassin' && d < BLINK_RANGE - 2 && h.hp > h.maxHp * 0.45) castSkill(state, h.id)
    else if (h.cls === 'tank' && d < 14) castSkill(state, h.id) // 방패 들고 돌격!
    else if (h.cls === 'cryomancer' && d < FROST_RANGE - 1) castSkill(state, h.id) // 서리파동으로 얼린다
    else if (h.cls === 'gladiator' && d < GLAD_SLASH_RADIUS + 1) castSkill(state, h.id) // 붙으면 휘둘러베기(흡혈)
    else if (h.cls === 'warlock' && d < CURSE_RANGE - 1) castSkill(state, h.id) // 저주살(중독)
    else if (h.cls === 'catcher' && d > 4 && d < HOOK_RANGE - 1) castSkill(state, h.id) // 사슬갈고리로 끌어온다
    else if (h.cls === 'snarer' && d > 3 && d < NET_RANGE - 1) castSkill(state, h.id) // 올가미로 멀리서 묶는다
    else if (h.cls === 'windcaller' && d < GUST_RANGE - 1) castSkill(state, h.id) // 돌풍으로 밀쳐낸다
    else if (h.cls === 'chronomancer' && d < TIMELEAP_RANGE - 1 && h.hp > h.maxHp * 0.4) castSkill(state, h.id) // 시간 도약으로 파고든다
    else if (h.cls === 'swordmaster' && d < 6) castSkill(state, h.id) // 붙으면 발도 카운터(반격)
    else if (h.cls === 'fearmonger' && d < FEAR_RANGE - 1) castSkill(state, h.id) // 공포의 시선으로 흩어놓는다
    else if (h.cls === 'illusionist' && d < 10) castSkill(state, h.id) // 분신+은신으로 교란
    else if (h.cls === 'terramancer' && d < SLING_RANGE - 2) castSkill(state, h.id) // 돌팔매 3연투
    // 힐러 치유·수호기사 보호막은 stepBots 위쪽에서 항상 챙긴다
  }
  if (h.ultCd > 0 || h.lvl < ULT_LEVEL) return
  if (h.cls === 'warrior' && (nearCount >= 2 || (d < WHIRL_RADIUS - 2 && foe.hp < foe.maxHp * 0.5))) {
    castUlt(state, h.id)
  } else if (h.cls === 'archer' && d < RAIN_RANGE - 4 && (foe.hp < foe.maxHp * 0.6 || nearCount >= 2)) {
    castUlt(state, h.id)
  } else if (h.cls === 'mage' && (nearCount >= 2 || (d < STORM_RADIUS - 2 && foe.hp < foe.maxHp * 0.5))) {
    castUlt(state, h.id)
  } else if (h.cls === 'assassin' && d < EXECUTE_RANGE - 1 && foe.hp < foe.maxHp * 0.45) {
    castUlt(state, h.id)
  } else if (h.cls === 'tank' && nearCount >= 2) {
    castUlt(state, h.id)
  } else if (h.cls === 'cryomancer' && (nearCount >= 2 || (d < ABSZERO_RADIUS && foe.hp < foe.maxHp * 0.6))) {
    castUlt(state, h.id) // 절대영도로 한타를 얼린다
  } else if (h.cls === 'gladiator' && (nearCount >= 1 || h.hp < h.maxHp * 0.6)) {
    castUlt(state, h.id) // 분노로 버티며 싸운다
  } else if (h.cls === 'warlock' && (nearCount >= 2 || (d < DOOM_RADIUS && foe.hp < foe.maxHp * 0.7))) {
    castUlt(state, h.id) // 파멸의 낙인
  } else if (h.cls === 'swordmaster' && (nearCount >= 1 || d < 8)) {
    castUlt(state, h.id) // 무형검으로 평타 몰아치기
  } else if (h.cls === 'catcher' && (nearCount >= 2 || (d < GUILLOTINE_RADIUS && foe.hp < foe.maxHp * 0.6))) {
    castUlt(state, h.id) // 단죄
  } else if (h.cls === 'snarer' && (nearCount >= 2 || d < SNARE_RADIUS)) {
    castUlt(state, h.id) // 포획망으로 한타를 묶는다
  } else if (h.cls === 'beastmaster' && (nearCount >= 1 || d < 10)) {
    castUlt(state, h.id) // 곰 소환
  } else if (h.cls === 'engineer' && (nearCount >= 1 || d < 13)) {
    castUlt(state, h.id) // 거포 설치
  } else if (h.cls === 'windcaller' && (nearCount >= 2 || d < TYPHOON_RADIUS)) {
    castUlt(state, h.id) // 태풍으로 한타를 날려버린다
  } else if (h.cls === 'chronomancer' && (h.hp < h.maxHp * 0.35 || (nearCount >= 1 && foe.hp < foe.maxHp * 0.4))) {
    castUlt(state, h.id) // 역행 — 위기 탈출/막타 후 안전 귀환
  } else if (h.cls === 'fearmonger' && d < SHRIEK_TELE_RANGE - 1 && (nearCount >= 2 || foe.hp < foe.maxHp * 0.5)) {
    castUlt(state, h.id) // 단말마 — 적진으로 파고들어 광역 공포 이니시
  } else if (h.cls === 'illusionist' && (nearCount >= 1 || h.hp < h.maxHp * 0.5)) {
    castUlt(state, h.id) // 환영난무 — 교란 + 은신
  } else if (h.cls === 'terramancer' && d < CAGE_RANGE - 1 && foe.hp < foe.maxHp * 0.55) {
    castUlt(state, h.id) // 바위감옥 — 빈사 적을 가둬 마무리
  }
  // 수호기사 궁극(불굴의 진형)은 stepBots 위쪽 능동 블록에서 챙긴다
}

// 봇 조향: 직선 보행이 정적 지형에 막히지 않으면 국소 회피(avoidDir)로 직진하고,
// 막히면 A* 경로(캐시)를 따라간다 — 본진 성벽·협곡 같은 오목 지형에 끼어
// 제자리걸음하다 귀환해 버리던 문제의 근본 해결. (동적 장애물인 타워는 avoidDir 몫)
const NAV_REPATH = 0.9 // 경로 재탐색 주기(초) — 매 틱 A*를 돌리지 않게 캐시한다
function steerToward(state, h, to) {
  const node = navWaypoint(state, h, to)
  const dir = state.map.avoidDir(h, node.x, node.z, colliders(state), 1.3)
  h.mx = dir.x
  h.mz = dir.z
}

// 지금 향할 경유 좌표 하나를 돌려준다 (직선이 뚫려 있으면 목표 그대로)
function navWaypoint(state, h, to) {
  if (state.map.lineFree(h.x, h.z, to.x, to.z)) {
    h.navPath = null
    return to
  }
  const moved = !h.navGoal || (h.navGoal.x - to.x) ** 2 + (h.navGoal.z - to.z) ** 2 > 5 * 5
  if (!h.navPath || moved || state.time >= (h.navUntil || 0)) {
    h.navPath = state.map.findPath(h.x, h.z, to.x, to.z)
    h.navGoal = { x: to.x, z: to.z }
    h.navUntil = state.time + NAV_REPATH
  }
  const path = h.navPath
  if (!path || !path.length) return to // 길이 없으면 직진 (국소 회피 + 끼임 구제에 맡긴다)
  // 도달한 노드는 걷어내고, 다음 노드가 직선으로 보이면 미리 건너뛴다
  while (
    path.length > 1 &&
    ((path[0].x - h.x) ** 2 + (path[0].z - h.z) ** 2 < 2.2 * 2.2 ||
      state.map.lineFree(h.x, h.z, path[1].x, path[1].z))
  ) {
    path.shift()
  }
  return path[0]
}

// 정글 사냥: 지나는 길의 늑대, 아군이 모여 있으면 용/이무기 도전
function botJungleMove(state, h) {
  // 용/이무기 도전 — 분노 때문에 어설프게 덤비면 잡기 전에 쓰러진다.
  //  곁의 아군 합산 화력으로 "분노가 폭발하기 전에 처치 + 우리 팀이 피해를 버틴다"는
  //  확신(canTakeMonster)이 설 때만 친다 → 저레벨·소수가 무리하게 치는 자폭을 막는다.
  for (const big of state.monsters) {
    if (!big.alive || CAMP_MOBS[big.kind]) continue
    // 커밋이 서 있거나 지금 잡을 각이면 붙는다 — 한번 결심하면 재판정 없이 끝까지(우왕좌왕 방지).
    const committed = state.objCommit[h.team]?.id === big.id
    if (committed || (h.hp > h.maxHp * 0.55 && canTakeMonster(state, h, big))) {
      if (!committed) state.objCommit[h.team] = { id: big.id, until: state.time + 30 }
      h.botBigT = state.time + 0.5 // 용/이무기 평타 허용
      botMonsterSkills(state, h, big)
      if (dist(h, big) > CLASSES[h.cls].range - 1) steerToward(state, h, big)
      else {
        h.mx = 0
        h.mz = 0
      }
      return true
    }
  }
  // 가까운 늑대 캠프 (멀리 돌아가진 않는다).
  // 보스전 아군: 라인 병사가 없어 정글이 유일한 농장 — 거리 불문 가장 가까운 캠프로.
  let camp = null
  let bd = isRaidMode(state.mode) && h.team === 'blue' ? Infinity : 16 * 16
  for (const m of state.monsters) {
    if (!m.alive || !CAMP_MOBS[m.kind]) continue
    const d = dist2(h, m)
    if (d < bd) {
      bd = d
      camp = m
    }
  }
  if (!camp || h.hp < h.maxHp * 0.6) return false
  if (dist(h, camp) > CLASSES[h.cls].range - 1) steerToward(state, h, camp)
  else {
    h.mx = 0
    h.mz = 0
  }
  return true
}

// 목표에서 안전거리(기본: 타워 사거리 밖)를 두고 대기 — 제자리 진동 없이 한 자리에 머문다.
function botHoldOutside(state, h, objective, hold = TOWER_RANGE + 3) {
  const d = dist(h, objective)
  if (d < hold - 1) {
    const away = Math.atan2(h.z - objective.z, h.x - objective.x)
    h.mx = Math.cos(away) * 0.6
    h.mz = Math.sin(away) * 0.6
  } else if (d > hold + 3) {
    steerToward(state, h, objective)
  } else {
    h.mx = 0
    h.mz = 0
  }
}

// 타워에 들이박을 수 없을 때(병사 방패 없음) 다른 할 일을 찾는다.
//  1) 이 레인에 아군 병사가 멀리서 오고 있으면 마중 나가 함께 전진
//  2) 가까운 정글몹 탐험 (적당한 거리 안)
//  3) 다른 레인에서 밀고 있는 아군 병사에 합류
//  4) 가까운 아군 영웅 지원
// 호출부(botLaneMove)가 이 선택을 잠시 유지(botSeekT)해 타워 앞 진동을 막는다.
function botSeekWork(state, h, lane, objective) {
  // 1) 이 레인 선두 아군 병사
  let lead = null
  let lbd = Infinity
  for (const m of state.minions) {
    if (m.team !== h.team || m.lane !== lane) continue
    const d = dist(m, objective)
    if (d < lbd) {
      lbd = d
      lead = m
    }
  }
  if (lead && lbd > TOWER_RANGE + 6) {
    // 웨이브가 아직 타워에서 멀다 → 마중 나가 함께 온다
    steerToward(state, h, lead)
    return true
  }
  if (lead) return false // 웨이브가 곧 타워에 닿는다 → 잠깐 대기(holdOutside)했다 push
  // 2) 적당히 가까운 정글몹(늑대) 탐험
  let camp = null
  let cbd = 30 * 30
  for (const m of state.monsters) {
    if (!m.alive || !CAMP_MOBS[m.kind]) continue
    const d = dist2(h, m)
    if (d < cbd) {
      cbd = d
      camp = m
    }
  }
  if (camp && h.hp > h.maxHp * 0.45) {
    steerToward(state, h, camp)
    return true
  }
  // 3) 다른 레인에서 밀고 있는 아군 병사에 합류
  let mn = null
  let mbd = Infinity
  for (const m of state.minions) {
    if (m.team !== h.team) continue
    const d = dist2(h, m)
    if (d < mbd) {
      mbd = d
      mn = m
    }
  }
  if (mn) {
    steerToward(state, h, mn)
    return true
  }
  // 4) 가까운 아군 영웅 지원
  let mate = null
  let tbd = Infinity
  for (const o of state.heroes) {
    if (o === h || o.team !== h.team || o.respawnT > 0) continue
    const d = dist2(h, o)
    if (d < tbd) {
      tbd = d
      mate = o
    }
  }
  if (mate) {
    steerToward(state, h, mate)
    return true
  }
  return false
}

// 그 레인에서 "목표(적 타워/수호석)에 가장 가까운" 아군 병사 = 우리 전선의 선두.
function frontLaneMinion(state, team, lane, objective) {
  let front = null
  let bd = Infinity
  for (const m of state.minions) {
    if (m.team !== team || m.lane !== lane) continue
    const d = dist(m, objective)
    if (d < bd) {
      bd = d
      front = m
    }
  }
  return front
}

// 레인 봇: 경유지를 따라 적 본진 쪽으로. 목표 타워 근처에선
// 아군 병사가 받아주고 있을 때만 들어간다 (타워 다이브 금지).
function botLaneMove(state, h, dt) {
  h.botSeekT = Math.max(0, (h.botSeekT || 0) - dt)
  const lane = laneOfRole(h.role)
  const en = enemyOf(h.team)
  const objective =
    state.towers.find((t) => t.team === en && t.lane === lane && t.tier === 1 && t.alive) ||
    state.towers.find((t) => t.team === en && t.lane === lane && t.tier === 2 && t.alive) ||
    state.towers.find((t) => t.team === en && t.tier === 3 && t.alive) || // 최후의 포탑
    state.map.NEXUS_POS[en]
  // "딴 일" 모드: 타워 앞에서 못 밀 때 한번 정한 일을 잠시 유지한다.
  // (매 틱 라인 푸시로 되돌아가 타워 사거리 경계를 들락날락하던 진동을 막는다)
  if (h.botSeekT > 0) {
    if (botSeekWork(state, h, lane, objective)) return
    h.botSeekT = 0 // 할 일이 없어졌으면 아래 일반 로직으로
  }
  // 적 타워 근처(넉넉한 반경)에서의 행동을 한 자리에서 결정한다 — 사거리 경계 진동 방지
  const dObj = dist(h, objective)
  // 목표가 수호석(최후의 포탑이 부서져 열림)면 접근하는 대로 수호석만 두들긴다 —
  // 평타가 곁의 병사으로 새서 게임을 못 끝내던 문제 방지 (사거리 검증은 castAttack이 한다)
  if (!objective.id && nexusVulnerable(state, en) && dObj < NEXUS_RADIUS + 12) {
    h.botFocus = { tk: 'nexus', id: en }
  }
  if (objective.id && dObj < TOWER_RANGE + 8) {
    const shield = state.minions.some((m) => m.team === h.team && dist(m, objective) < TOWER_RANGE)
    // 타워 표면까지의 거리로 사거리를 잰다 (중심거리로 재면 근접이 영영 못 닿는다)
    const inReach = dObj - TOWER_RADIUS <= CLASSES[h.cls].range - 0.5
    // 병사 방패가 있으면 타워는 병사를 때리니 안전하게 들어가 "타워를" 친다.
    if (shield) {
      h.botFocus = { tk: 'tower', id: objective.id } // 평타가 병사으로 새지 않게 집중
      if (inReach) {
        h.mx = 0
        h.mz = 0
      } else {
        steerToward(state, h, objective)
      }
      return
    }
    // 타워가 빈사(내 평타 세 방 이내)면 방패 없이도 들어가 마무리한다 —
    // 한두 대는 맞더라도 철거 가치가 크고, 다 잡은 타워 앞에서 얼쩡대던 문제를 없앤다.
    if (objective.hp <= atkOf(h) * 3 && h.hp > h.maxHp * 0.45) {
      h.botFocus = { tk: 'tower', id: objective.id }
      if (inReach) {
        h.mx = 0
        h.mz = 0
      } else {
        steerToward(state, h, objective)
      }
      return
    }
    // 방패가 없으면 들이박지 않는다 → 다른 할 일을 정해 잠시 유지하고, 없으면 대기
    h.botSeekT = 2.5
    if (botSeekWork(state, h, lane, objective)) return
    botHoldOutside(state, h, objective)
    return
  }
  // 전선 합류: 아군 병사를 앞질러(타워 쪽으로) 달려나가지 않는다.
  //  봇 발이 병사보다 빨라 웨이브를 두고 타워 앞에서 멍하니 기다리던 문제를 막는다.
  //  → 목표까지 남긴 거리가 "내 최전방 아군 병사"보다 더 가까우면(앞서 나감)
  //    싸우고 있는 병사 전선으로 돌아가 함께 민다. (castAttack은 stepBots에서
  //    이미 매 틱 호출되어, 전선에 붙으면 사거리 안 적 병사를 자동 타격한다)
  const front = frontLaneMinion(state, h.team, lane, objective)
  if (front && dObj < dist(front, objective) - 3) {
    if (dist(h, front) > Math.max(2.5, CLASSES[h.cls].range - 2)) steerToward(state, h, front)
    else {
      h.mx = 0
      h.mz = 0
    }
    return
  }
  // 경유지 행군: 가장 가까운 경유지의 "다음 칸"을 향한다.
  // (가까운 칸 자체를 향하면 본진 옆에서 출발 경유지(수호석)와
  //  충돌체 경계 사이를 제자리 왕복하는 함정에 빠진다)
  const wps = state.map.LANES[lane]
  const dirI = h.team === 'blue' ? 1 : -1
  const wp = wps[state.map.nearestWp(lane, h.x, h.z) + dirI]
  if (!wp) {
    steerToward(state, h, objective)
    return
  }
  // 경유지보다 목표가 더 가까우면 목표로 직행
  steerToward(state, h, dist(h, objective) < dist(h, wp) + 6 ? objective : wp)
}

const r1 = (v) => Math.round(v * 10) / 10
const r2d = (v) => Math.round(v * 100) / 100

// 게스트에게 보낼 직렬화 스냅샷 (렌더러도 이 형태만 본다)
export function makeView(state) {
  return {
    phase: 'play',
    status: state.status,
    mode: state.mode, // 렌더러/미니맵이 맞는 크기의 맵을 만들 수 있게
    bossTier: state.bossTier, // 보스전 난이도(레이드 바 배지·종료 보상 산정)
    arenaLayout: state.arenaLayout, // 콜로세움 내부 구조 — 클라 맵 재구성용
    arenaPhase: state.arenaPhase, // 콜로세움: shop/fight/sudden (HUD 페이즈 표시)
    arenaPts: state.arenaPts ? { ...state.arenaPts } : null, // 팀별 토너먼트 포인트 — 복사 필수(델타 코덱이 참조 비교라 원본을 넘기면 변경이 전송 안 됨)
    arenaDeduct: state.arenaDeduct, // 패배 시 차감량 — 종료 연출에서 하트가 터지는 개수
    arenaT: r2d(state.arenaT), // 현재 페이즈 남은 시간
    healOrbs: state.healOrbs.map((o) => ({ id: o.id, x: o.x, z: o.z })), // 회복 열매(💖 렌더)
    holes: state.holes.map((o) => ({ id: o.id, x: o.x, z: o.z, r: o.r })), // 붕괴 구멍 — 복사 필수(원본 참조를 넘기면 델타 코덱이 push를 못 본다)
    holeWarns: state.holeWarns.map((w) => ({ id: w.id, x: w.x, z: w.z, r: w.r, t: r2d(w.at - state.time) })), // 경고 장판
    wave: state.wave, // 무한 방어: 현재 파도(HUD 카운터·종료 기록)
    defWaveT: r2d(state.defWaveT), // 무한 방어: 다음 파도까지(HUD 타이머)
    nexusPos: state.map.NEXUS_POS, // 시야(inSight) 계산용
    time: r2d(state.time),
    countdown: Math.ceil(state.countdown),
    go: state.status === 'playing' && state.time < COUNTDOWN_TIME + 1.2,
    timePlayed: Math.max(0, Math.floor(state.time - COUNTDOWN_TIME)), // 경과 시간(초) — 카운트다운 제외
    winner: state.winner,
    kills: { ...state.kills },
    heroes: state.heroes.map((h) => ({
      id: h.id,
      name: h.name,
      title: h.title || null, // 장착 칭호 — 이름표 표시용
      thornBombT: r2d(h.thornBombT || 0), // 가시 낙인 카운트다운(머리 위 ❗ 표시)
      thornArmorT: r2d(h.thornArmorT || 0), // 가시갑옷 반사창(💢 표시)
      zodiacId: h.zodiacId,
      color: h.color,
      team: h.team,
      cls: h.cls,
      isBot: h.isBot,
      role: h.role,
      homeX: h.homeX, // 우물 중심 (canShop/inFountain 판정용)
      homeZ: h.homeZ,
      x: r1(h.x),
      z: r1(h.z),
      dir: r2d(h.dir),
      hp: Math.ceil(h.hp),
      maxHp: h.maxHp,
      lvl: h.lvl,
      xp: Math.floor(h.xp),
      xpNeed: h.lvl >= MAX_LEVEL ? 0 : xpNeed(h.lvl),
      gold: Math.floor(h.gold),
      items: h.items.slice(),
      itemCds: h.items.map((id) => r2d(h.itemCd[id] || 0)), // 슬롯별 액티브 남은 쿨(초)
      shopUndo: !!h.shopChanged, // 이번 상점 세션에 무료 취소할 변경이 있나
      power: Math.round(powerStat(h)), // 스킬 계수가 곱해지는 주력 스탯(공격력/주문력) — 툴팁 계산용
      dmgMult: r2d(dmgMult(h)), // 버프 피해 배율(용/이무기) — 툴팁 계산용

      atkCd: r2d(h.atkCd),
      atkSeq: h.atkSeq,
      skillCd: r2d(h.skillCd),
      skill2Cd: r2d(h.skill2Cd),
      skill2Locked: h.lvl < SKILL2_LEVEL,
      // 엔지니어 포탑 재고 (스킬 버튼에 갯수 배지로 표시)
      ...(h.cls === 'engineer' ? { turretStock: h.turretStock || 0 } : null),
      ultCd: r2d(h.ultCd),
      ultLocked: h.lvl < ULT_LEVEL,
      stunT: r2d(h.stunT),
      freezeT: r2d(h.freezeT),
      fearT: r2d(h.fearT),
      whirlT: r2d(h.whirlT),
      shieldT: r2d(h.shieldT),
      berserkT: r2d(h.berserkT),
      rageT: r2d(h.rageT),
      poisonT: r2d(h.poisonT),
      barrierHp: Math.ceil(h.barrierHp),
      wardT: r2d(h.wardT),
      bindT: r2d(h.bindT), // 결속: 묶여 있으면 >0 (구체 연출)
      bindBy: h.bindBy, // 나를 결속한 수호기사 id (링크 연출)
      bindAnchorT: r2d(h.bindAnchorT), // 수호기사 앵커 (구체 연출)
      vulnT: r2d(h.vulnT),
      parryT: r2d(h.parryT),
      rootT: r2d(h.rootT),
      fallT: r2d(h.fallT), // 콜로세움 추락 연출(씬이 아래로 가라앉힌다)
      bladeT: r2d(h.bladeT),
      hookWindT: r2d(h.hookWindT),
      pullT: r2d(h.pullT),
      stealthT: r2d(h.stealthT),
      hasteT: r2d(h.hasteT),
      tauntT: r2d(h.tauntT),
      castT: r2d(h.castT), // 정신집중 남은 시간 (렌더러 표시 + 클라 이동 예측 정지)
      knockT: r2d(h.knockT), // 넉백에 밀려나는 중 (클라 이동 예측 정지 — 서버 변위에 맡김)
      airT: r2d(h.airT), // 돌풍에 띄워진(공중) 남은 시간 — 렌더러가 몸을 띄운다
      recallT: r2d(h.recallT),
      // 시간술사 역행 미리보기: 궁극기가 켜져 있을 때만, 되돌아갈 과거 지점을 그림자로 보여 준다
      ...(h.cls === 'chronomancer' && h.ultCd <= 0 && h.lvl >= ULT_LEVEL && h.respawnT <= 0
        ? (() => { const p = trailSampleBack(h, REWIND_BACK); return { rewindGhost: { x: r1(p.x), z: r1(p.z) } } })()
        : null),
      respawnT: r2d(h.respawnT),
      bushI: h.bushI,
      revealT: r2d(h.revealT),
      // 보스전: 현재 국면(1~3)과 각성 보호막 잔여 — 위협 링 색·보호막 구체 연출용
      ...(h.isBoss ? { bossPhase: h.bossPhase || 1, bossShieldT: r2d(h.bossShieldT || 0) } : null),
      dragonT: r1(h.dragonT),
      baronT: r1(h.baronT),
      kills: h.kills,
      deaths: h.deaths,
      assists: h.assists,
      killStreak: h.killStreak, // 현상금 표식용 (안 죽고 쌓은 연속 킬)
      jungleKills: h.jungleKills || 0, // 일일 미션(정글몹 처치) 집계용
      // 업적 집계용 — 경기 종료 시 onFinish가 읽는다
      dragonKills: h.dragonKills || 0, baronKills: h.baronKills || 0,
      soldierKills: h.soldierKills || 0, bestStreak: h.bestStreak || 0,
      mvSpeed: r2d(heroSpeed(h)), // 클라 이동 예측용(현재 이동속도)
    })),
    minions: state.minions.map((m) => ({
      id: m.id,
      team: m.team,
      ranged: m.ranged,
      x: r1(m.x),
      z: r1(m.z),
      dir: r2d(m.dir),
      atkSeq: m.atkSeq,
      hp: Math.ceil(m.hp),
      maxHp: Math.ceil(m.maxHp),
    })),
    monsters: state.monsters.map((m) => ({
      id: m.id,
      kind: m.kind,
      alive: m.alive,
      x: r1(m.x),
      z: r1(m.z),
      // 바라보는 방향 — 교전 전엔 맵 중앙(강 건너)을 향한다
      dir: r2d(m.dir != null ? m.dir : Math.atan2(0 - m.z, 0 - m.x)),
      atkSeq: m.atkSeq || 0, // 렌더러 공격 모션 트리거
      hp: Math.ceil(m.hp),
      maxHp: m.maxHp,
      respawnT: m.alive ? 0 : Math.ceil(m.respawnT),
      enrage: r1(m.combatT || 0), // 분노 누적 시간(초) — 렌더러가 붉게 달아오르게
    })),
    summons: state.summons.map((s) => ({
      id: s.id, kind: s.kind, team: s.team, x: r1(s.x), z: r1(s.z), dir: r2d(s.dir),
      hp: Math.ceil(s.hp), maxHp: s.maxHp, charge: s.chargeT > 0 ? 1 : 0, dormant: s.dormant ? 1 : 0,
      // 분신: 렌더러가 본체와 똑같이 그리도록 겉모습을 싣는다 (atkSeq=평타 모션, slam=내리찍기 모션)
      ...(s.kind === 'clone'
        ? { zodiacId: s.zodiacId, cls: s.cls, name: s.name, lvl: s.lvl, isBot: s.isBot, atkSeq: s.atkSeq || 0, slam: r2d(s.slamT || 0) }
        : null),
      // leap: 도약 진행도(1→0, 점프 모션용) · idle: 포탑 휴면까지 남은 유예 시간(타이머 표시용)
      leap: s.leapT > 0 && s.leapDur > 0 ? r2d(s.leapT / s.leapDur) : 0,
      idle: s.kind === 'turret' && !s.dormant && s.idleT > 0 ? r1(ENGI_IDLE_GRACE - s.idleT) : 0,
    })),
    towers: state.towers.map((t) => ({
      id: t.id,
      team: t.team,
      lane: t.lane,
      tier: t.tier,
      x: t.x,
      z: t.z,
      hp: Math.ceil(t.hp),
      maxHp: t.maxHp,
      alive: t.alive,
      vuln: t.alive && towerVulnerable(state, t),
    })),
    nexus: {
      blue: {
        hp: Math.ceil(state.nexus.blue.hp), maxHp: NEXUS_HP, vuln: nexusVulnerable(state, 'blue'),
        underAttack: state.nexus.blue.lastHurt != null && state.time - state.nexus.blue.lastHurt < 2.5,
      },
      red: {
        hp: Math.ceil(state.nexus.red.hp), maxHp: NEXUS_HP, vuln: nexusVulnerable(state, 'red'),
        underAttack: state.nexus.red.lastHurt != null && state.time - state.nexus.red.lastHurt < 2.5,
      },
    },
    projectiles: [
      ...state.projectiles.map((p) => ({
        id: p.id,
        kind: p.kind,
        team: p.team,
        x: r1(p.x),
        z: r1(p.z),
        // 검기는 호(초승달) 모양이라 렌더러가 진행 방향으로 눕혀 그린다
        ...(p.kind === 'swordwave' ? { dir: r2d(p.dir) } : {}),
      })),
      // 사냥매도 투사체 풀로 그린다 (보간/안개 처리 공용)
      ...state.hawks.map((hk) => ({ id: hk.id, kind: 'hawk', team: hk.team, x: r1(hk.x), z: r1(hk.z) })),
    ],
    // 사냥매가 걷어 둔 시야 흔적 — 렌더러 시야/안개 + isHeroVisible(inSight)가 함께 본다
    reveals: state.reveals.map((rv) => ({ team: rv.team, x: r1(rv.x), z: r1(rv.z), r: rv.r })),
    // 예고 범위는 운석(조준점)만 클라에 보낸다 — 대지균열 파는 거의 즉발이라 fx로만 보인다
    stoneWalls: state.tempWalls.map((w) => ({ id: w.id, x: r1(w.x), z: r1(w.z), t: r2d(w.t), life: w.life })),
    zones: state.zones.filter((z) => z.kind === 'meteor' || z.kind === 'venom' || z.kind === 'bosszone').map((z) => ({
      id: z.id, kind: z.kind, team: z.team, x: r1(z.x), z: r1(z.z),
      r: z.r, t: r2d(z.t), delay: z.delay,
      ...(z.life != null ? { life: z.life } : null), // 지속 장판(독 웅덩이/용암·서리)의 사라짐 페이드용
      ...(z.kind === 'bosszone'
        ? {
          hue: z.hue,
          ...(z.rIn ? { rIn: z.rIn } : null),
          ...(z.aim ? { aim: true } : null),
          ...(z.ox != null ? { ox: r1(z.ox), oz: r1(z.oz) } : null), // 돌진 경로 화살표용 시전 원점
        }
        : null),
    })),
    fx: state.fx.map((n) => ({
      id: n.id, kind: n.kind, x: r1(n.x), z: r1(n.z), r: n.r, t: r2d(n.t), team: n.team,
      ...(n.dir != null ? { dir: r2d(n.dir) } : null),
      ...(n.life != null ? { life: n.life } : null),
      ...(n.kind === 'gold' ? { n: n.n, owner: n.owner } : null),
    })),
    feed: state.feed.slice(-5),
  }
}
