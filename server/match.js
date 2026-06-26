// 매치(한 경기) 순수 로직 — 팀 배정 / 스네이크 드래프트 / 카운트다운.
// 네트워크·타이머와 분리해 결정적으로 테스트한다. 실제 타이머는 server/index.js가 돌린다.
//
// 생애주기(phase):
//   'draft'     → 모든 자리가 직업을 고를 때까지
//   'countdown' → "이제 곧 경기가 시작합니다" 카운트다운(기본 3초)
//   'play'      → 서버 권위 실시간 시뮬(realtime 세션이 인계)
//
// 드래프트 픽 순서(요구사항): 블루1 · 레드1 · 레드2 · 블루2 · 블루3 · 레드3 … (스네이크)
//   사람은 10초 제한(초과 시 자동 픽), 봇은 자동 픽. 같은 팀 같은 직업 선택 불가.

import { ZODIAC } from '../src/shared/zodiac.js'
import { CLASS_IDS, TEAM_SIZES, CLASS_ROLE, DRAFT_ROLE_PRIORITY } from '../src/games/rift/engine.js'

export const PICK_MS = 20_000 // 사람 픽 제한

// 드래프트 픽 잔여시간(ms) — 클라 타이머 바가 쓴다.
//  · 봇 차례 / 픽 종료 → null (바 숨김)
//  · "갓 시작한 차례"(turnSeat이 아직 현재 픽커로 리셋되기 전: 픽 직후 브로드캐스트 순간)
//    → 항상 풀타임. 안 그러면 turnAt이 이전 차례 기준이라 이전 선수의 잔여가 새어 나가고,
//    클라가 그 첫 스냅샷으로 데드라인을 굳혀 "나중 픽일수록 몇 초밖에 안 남는" 버그가 난다.
export function draftPickRemainingMs(match, turnSeat, turnAt, now) {
  const cur = match.currentPicker()
  if (!cur || cur.isBot) return null
  if (cur.seat !== turnSeat) return PICK_MS
  return turnAt ? Math.max(0, turnAt + PICK_MS - now) : null
}
// 본게임 시작 전 카운트다운(3초)은 엔진(status:'countdown', COUNTDOWN_TIME)이 담당한다.
// 드래프트가 끝나면 곧바로 실시간 세션을 시작하고, 전장 안에서 "곧 시작" 카운트다운을 보여준다.

// 피셔-예이츠 셔플(주입 rng로 결정적)
function shuffle(arr, rng) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// 스네이크 픽 순서의 "팀 시퀀스" — 블루, 레드,레드, 블루,블루, … 마지막 1개.
// teamSize=3 → [B,R,R,B,B,R] / teamSize=5 → [B,R,R,B,B,R,R,B,B,R]
export function snakeTeamOrder(teamSize) {
  const total = teamSize * 2
  const order = ['blue']
  let team = 'red'
  while (order.length < total) {
    order.push(team)
    if (order.length < total) order.push(team)
    team = team === 'blue' ? 'red' : 'blue'
  }
  return order
}

let matchSeq = 0
function nextMatchId() {
  matchSeq = (matchSeq + 1) % 1_000_000
  return `M${matchSeq.toString(36).toUpperCase().padStart(4, '0')}`
}

// humanDeviceIds: 매치에 들어온 사람 기기 id 배열(1명 이상). 모자란 자리는 봇.
export function createMatch(humanDeviceIds, mode, rng = Math.random) {
  const teamSize = TEAM_SIZES[mode] ? TEAM_SIZES[mode] : 3
  const target = teamSize * 2
  const code = nextMatchId()

  // 1) 사람/봇 자리 구성 후 셔플 → 랜덤 팀 배정의 토대
  const slots = []
  for (const deviceId of humanDeviceIds.slice(0, target)) slots.push({ deviceId, isBot: false })
  while (slots.length < target) slots.push({ deviceId: null, isBot: true })
  const shuffled = shuffle(slots, rng)

  // 2) 지신(아바타) 고유 배정 + 팀 배정(앞 절반 블루 / 뒤 절반 레드)
  const zos = shuffle(ZODIAC, rng).slice(0, target)
  const participants = shuffled.map((s, i) => {
    const z = zos[i]
    const team = i < teamSize ? 'blue' : 'red'
    return {
      seat: i,
      team,
      deviceId: s.deviceId,
      isBot: s.isBot,
      zodiacId: z.id,
      name: z.name,
      color: z.color,
      cls: null, // 드래프트에서 채워진다
    }
  })

  // 3) 스네이크 픽 순서 → participant 자리(seat) 시퀀스
  const teamOrder = snakeTeamOrder(teamSize)
  const byTeam = { blue: participants.filter((p) => p.team === 'blue'), red: participants.filter((p) => p.team === 'red') }
  const ptr = { blue: 0, red: 0 }
  const pickOrder = teamOrder.map((t) => byTeam[t][ptr[t]++].seat)

  const room = { code, devices: new Map(), lastState: null } // realtime 세션 호환 객체
  function rebuildDevices() {
    room.devices = new Map()
    for (const p of participants) {
      if (p.isBot || !p.deviceId) continue
      room.devices.set(p.deviceId, { players: [enginePlayer(p)] })
    }
  }

  const match = {
    code,
    mode,
    teamSize,
    phase: 'draft', // 'draft' | 'play'
    participants,
    pickOrder,
    pickPtr: 0,
    room,

    seatOf(deviceId) {
      return participants.find((p) => p.deviceId === deviceId) || null
    },
    hasHuman() {
      return participants.some((p) => !p.isBot && p.deviceId)
    },
    currentPicker() {
      if (this.phase !== 'draft' || this.pickPtr >= pickOrder.length) return null
      return participants[pickOrder[this.pickPtr]]
    },
    allPicked() {
      return this.pickPtr >= pickOrder.length
    },
    // 이미 고른 직업 — 아군·적군 통틀어 매치 전체에서 같은 캐릭터는 한 명뿐
    takenClasses() {
      return participants.filter((p) => p.cls).map((p) => p.cls)
    },
    availableClasses() {
      const taken = new Set(this.takenClasses())
      return CLASS_IDS.filter((c) => !taken.has(c))
    },

    // 사람이 직업을 고른다. 자기 차례·중복 아님 검증. 끝나면 다음 자리로.
    pick(deviceId, classId) {
      const cur = this.currentPicker()
      if (!cur) throw new Error('지금은 픽할 차례가 아니에요.')
      if (cur.deviceId !== deviceId) throw new Error('당신 차례가 아니에요.')
      if (!CLASS_IDS.includes(classId)) throw new Error('알 수 없는 직업이에요.')
      if (this.takenClasses().includes(classId)) throw new Error('이미 다른 선수가 고른 직업이에요.')
      cur.cls = classId
      this._advance()
      return cur
    },

    // 현재 차례를 자동 픽(봇 / 사람 시간초과). 팀 조합 밸런스를 맞춰 고른다.
    autoPickCurrent() {
      const cur = this.currentPicker()
      if (!cur) return null
      cur.cls = this.balancedClassFor(cur.team)
      this._advance()
      return cur
    },

    // 팀 조합 밸런스 픽: 우리 팀에 아직 없는 역할을 우선순위대로 채운다.
    //  · 같은 팀이 이미 가진 역할은 건너뛰고(다 차면 우선순위 다시 한 바퀴 → 2번째 카피 허용),
    //  · 그 역할의 전역 미사용 직업 중에서 무작위로 한 명. 후보가 없으면 다음 역할로.
    balancedClassFor(team) {
      const avail = this.availableClasses()
      if (!avail.length) return CLASS_IDS[0]
      const have = new Set(
        participants.filter((p) => p.team === team && p.cls).map((p) => CLASS_ROLE[p.cls]),
      )
      const order = [...DRAFT_ROLE_PRIORITY.filter((r) => !have.has(r)), ...DRAFT_ROLE_PRIORITY]
      for (const role of order) {
        const pool = avail.filter((c) => CLASS_ROLE[c] === role)
        if (pool.length) return pool[Math.floor(rng() * pool.length)]
      }
      return avail[Math.floor(rng() * avail.length)] // 안전망(역할 미분류 등)
    },

    _advance() {
      this.pickPtr++ // 전원 픽 완료 판단은 allPicked()로. 세션 시작은 index.js가 toPlay()로 진행.
    },

    // 사람이 나감/끊김 → 그 자리를 봇으로. 진행 중이면 다음 픽에서 자동 처리됨.
    makeBotSeat(deviceId) {
      const p = participants.find((x) => x.deviceId === deviceId)
      if (!p) return false
      p.isBot = true
      p.deviceId = null
      p.name = `${p.name}봇`
      room.devices.delete(deviceId)
      return true
    },

    // 드래프트 끝 → 플레이(실시간 세션 시작 직전 index.js가 호출)
    toPlay() {
      rebuildDevices()
      this.phase = 'play'
    },

    // 엔진/실시간 세션에 넘길 풀 로스터(사람+봇, 팀·직업 확정)
    roster() {
      return participants.map(enginePlayer)
    },

    // 클라로 보낼 드래프트/카운트다운 스냅샷
    snapshot() {
      return {
        code,
        mode,
        teamSize,
        phase: this.phase,
        pickPtr: this.pickPtr,
        pickOrder,
        current: this.currentPicker()?.seat ?? null,
        players: participants.map((p) => ({
          seat: p.seat,
          team: p.team,
          isBot: p.isBot,
          mine: false, // 클라가 자기 deviceId로 덮어쓴다
          deviceId: p.deviceId,
          zodiacId: p.zodiacId,
          name: p.name,
          color: p.color,
          cls: p.cls,
        })),
      }
    },
  }

  rebuildDevices()
  return match
}

function enginePlayer(p) {
  return {
    id: p.zodiacId, // 엔티티 id = 지신 id(매치 내 고유)
    name: p.name,
    zodiacId: p.zodiacId,
    color: p.color,
    team: p.team,
    cls: p.cls,
    isBot: p.isBot,
    deviceId: p.deviceId || undefined,
  }
}
