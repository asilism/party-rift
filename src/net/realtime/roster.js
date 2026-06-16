// 기기당 1명(첫 참가자)만 조종한다는 규칙 — 클라(내 엔티티 찾기)와 서버(입력 소유권)에서
// 똑같이 써야 어긋나지 않으므로 공통 모듈로 둔다.

// 참가자 목록에서 "기기당 첫 참가자"만 골라낸다(주행/전투하는 사람).
export function racers(players) {
  const seen = new Set()
  const out = []
  for (const p of players || []) {
    const dev = p.deviceId ?? p.id
    if (seen.has(dev)) continue
    seen.add(dev)
    out.push(p)
  }
  return out
}

// 이 기기가 조종하는 엔티티 id(없으면 null) — 관전자/추가 참가자는 null.
export function racerIdFor(players, deviceId) {
  const r = racers(players).find((p) => (p.deviceId ?? p.id) === deviceId)
  return r ? r.id : null
}
