// 매치메이킹 큐 — 순수 로직(네트워크/타이머와 분리해 테스트 가능).
//
// 규칙(요구사항):
//  - 플레이어는 "대기열 입장" 시 모드(3v3/5v5)를 골라 그 모드 큐에 들어간다.
//  - 큐에 첫 사람이 들어온 순간부터 1분(WAIT_MS)을 기다린다.
//  - 목표 인원(3v3=6, 5v5=10)이 차면 즉시, 1분이 지나면 최소 1명만 있어도 매치를 만든다.
//  - 사람이 모자란 자리는 봇이 채운다(매치 쪽 책임).
//
// 시간(now)은 호출자가 주입한다 → 결정적 테스트 가능. 실제 타이머는 server/index.js가 돌린다.

export const WAIT_MS = 60_000 // 첫 입장 후 매칭까지 최대 대기
export const TARGETS = { '3v3': 6, '5v5': 10 }
export const MODES = Object.keys(TARGETS)

export function targetFor(mode) {
  return TARGETS[mode] || TARGETS['3v3']
}

export function createMatchmaker() {
  // mode -> { entries: [{ deviceId, joinAt }], startAt: number|null }
  const queues = new Map()
  for (const m of MODES) queues.set(m, { entries: [], startAt: null })

  const deviceMode = new Map() // deviceId -> mode (현재 어느 큐에 있는지)

  // 큐 입장. 다른 큐에 있었다면 옮긴다. 같은 기기 재입장은 무시(중복 방지).
  function join(deviceId, mode, now) {
    if (!MODES.includes(mode)) throw new Error('알 수 없는 게임 모드예요.')
    if (deviceMode.get(deviceId) === mode) return snapshot(mode, now)
    leave(deviceId) // 다른 큐에서 제거
    const q = queues.get(mode)
    if (q.entries.length === 0) q.startAt = now
    q.entries.push({ deviceId, joinAt: now })
    deviceMode.set(deviceId, mode)
    return snapshot(mode, now)
  }

  // 큐 이탈(나가기/연결 끊김). 어느 큐에 있든 제거.
  function leave(deviceId) {
    const mode = deviceMode.get(deviceId)
    if (!mode) return null
    const q = queues.get(mode)
    q.entries = q.entries.filter((e) => e.deviceId !== deviceId)
    q.startAt = q.entries.length ? q.entries[0].joinAt : null
    deviceMode.delete(deviceId)
    return mode
  }

  function modeOf(deviceId) {
    return deviceMode.get(deviceId) || null
  }

  // 이 모드 큐가 지금(now) 매치를 만들 조건이 됐는가?
  function ready(mode, now) {
    const q = queues.get(mode)
    if (!q || q.entries.length === 0) return false
    if (q.entries.length >= targetFor(mode)) return true
    return q.startAt != null && now - q.startAt >= WAIT_MS
  }

  // 매치로 보낼 사람들을 큐에서 빼서 반환(목표 인원까지). 남은 사람은 큐에 유지.
  function takeMatch(mode, now) {
    const q = queues.get(mode)
    const take = q.entries.slice(0, targetFor(mode))
    const rest = q.entries.slice(targetFor(mode))
    q.entries = rest
    // 남은(초과) 인원은 새 매칭 창을 now부터 다시 기다린다.
    q.startAt = rest.length ? now : null
    if (rest.length) rest[0].joinAt = now
    for (const e of take) deviceMode.delete(e.deviceId)
    return take.map((e) => e.deviceId)
  }

  function snapshot(mode, now) {
    const q = queues.get(mode)
    const target = targetFor(mode)
    const remainingMs = q.startAt == null ? WAIT_MS : Math.max(0, WAIT_MS - (now - q.startAt))
    return { mode, count: q.entries.length, target, remainingMs }
  }

  return { queues, join, leave, modeOf, ready, takeMatch, snapshot }
}
