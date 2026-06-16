// 게임 무관(generic) 실시간 스냅샷 코덱 — ②(델타 + 바이너리).
//
// 권위 서버가 매 틱 만드는 view(직렬화 가능한 평범한 객체)를
//  1) 직전에 보낸 view와 비교해 "바뀐 부분만"(delta) 추리고,
//  2) JSON 문자열 대신 촘촘한 바이너리(ArrayBuffer)로 인코딩한다.
//
// 게임별 스키마가 필요 없다 — view 모양만 보고 동작하므로 새 게임도 그대로 얹힌다.
// 큰 배열(예: karts/heroes/minions)은 원소가 { id, ... } 꼴이면 엔티티 단위 델타로,
// 그 밖(스칼라·중첩 객체·원시 배열)은 값이 바뀌었을 때만 통째로 싣는다.
//
// WebSocket은 TCP라 전송이 신뢰·순서 보장 → 서버는 "마지막으로 보낸 view" 하나만
// 기준으로 델타를 만들면 모든 클라가 동일 순서로 받아 안전하다. 중간 합류자에겐 full을 보낸다.

const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v)
const isIdList = (a) =>
  Array.isArray(a) && a.length > 0 && isObj(a[0]) && 'id' in a[0]

function deepEqual(a, b) {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false
    return true
  }
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a)
    const kb = Object.keys(b)
    if (ka.length !== kb.length) return false
    for (const k of ka) if (!deepEqual(a[k], b[k])) return false
    return true
  }
  return false
}

// 엔티티(같은 id) 한 쌍을 비교해 바뀐 필드만 추린다. null이면 변화 없음.
function diffEntity(prev, next) {
  const out = { id: next.id }
  let changed = false
  for (const k of Object.keys(next)) {
    if (k === 'id') continue
    if (!deepEqual(prev[k], next[k])) {
      out[k] = next[k]
      changed = true
    }
  }
  return changed ? out : null
}

// id 리스트 두 개를 비교 → { a:[새 엔티티 전체], u:[{id,...바뀐 필드}], d:[사라진 id] }
function diffList(prev, next) {
  const prevById = new Map(prev.map((e) => [e.id, e]))
  const nextIds = new Set(next.map((e) => e.id))
  const a = []
  const u = []
  for (const e of next) {
    const p = prevById.get(e.id)
    if (!p) a.push(e)
    else {
      const d = diffEntity(p, e)
      if (d) u.push(d)
    }
  }
  const d = []
  for (const id of prevById.keys()) if (!nextIds.has(id)) d.push(id)
  const patch = {}
  if (a.length) patch.a = a
  if (u.length) patch.u = u
  if (d.length) patch.d = d
  // 순서가 바뀌었을 수도 있으니(정렬되는 ranking 등) 최종 순서를 같이 싣는다.
  const order = next.map((e) => e.id)
  const prevOrder = prev.map((e) => e.id)
  if (!deepEqual(order, prevOrder)) patch.o = order
  return Object.keys(patch).length ? { __l: patch } : null
}

// 직전 view(prev)와 새 view(next)의 델타 패치. prev가 없으면 full을 그대로 쓴다.
export function diffView(prev, next) {
  const patch = {}
  for (const k of Object.keys(next)) {
    const nv = next[k]
    const pv = prev[k]
    if (isIdList(nv) && Array.isArray(pv)) {
      const lp = diffList(pv, nv)
      if (lp) patch[k] = lp
    } else if (!deepEqual(pv, nv)) {
      patch[k] = nv
    }
  }
  return patch
}

// 패치를 직전 view에 적용해 새 view를 만든다(불변: prev는 건드리지 않음).
export function applyPatch(prev, patch) {
  const out = { ...prev }
  for (const k of Object.keys(patch)) {
    const pv = patch[k]
    if (isObj(pv) && pv.__l) {
      const lp = pv.__l
      const base = Array.isArray(prev[k]) ? prev[k] : []
      const byId = new Map(base.map((e) => [e.id, e]))
      if (lp.d) for (const id of lp.d) byId.delete(id)
      if (lp.a) for (const e of lp.a) byId.set(e.id, e)
      if (lp.u) for (const d of lp.u) byId.set(d.id, { ...byId.get(d.id), ...d })
      const order = lp.o || base.map((e) => e.id).filter((id) => byId.has(id))
      // a로 새로 들어온 id가 order에 없으면 뒤에 붙인다.
      if (lp.o == null && lp.a) for (const e of lp.a) if (!order.includes(e.id)) order.push(e.id)
      out[k] = order.map((id) => byId.get(id)).filter(Boolean)
    } else {
      out[k] = pv
    }
  }
  return out
}

// ── 바이너리 (de)serializer ───────────────────────────────────────────────
// 태그: 0 null/undefined · 1 false · 2 true · 3 int32 · 4 float32 · 5 float64
//       6 string · 7 array · 8 object
const T_NULL = 0, T_FALSE = 1, T_TRUE = 2, T_INT = 3, T_F32 = 4, T_F64 = 5
const T_STR = 6, T_ARR = 7, T_OBJ = 8

class Writer {
  constructor() {
    this.buf = new Uint8Array(1024)
    this.view = new DataView(this.buf.buffer)
    this.pos = 0
  }
  ensure(n) {
    if (this.pos + n <= this.buf.length) return
    let len = this.buf.length * 2
    while (len < this.pos + n) len *= 2
    const next = new Uint8Array(len)
    next.set(this.buf)
    this.buf = next
    this.view = new DataView(next.buffer)
  }
  u8(v) { this.ensure(1); this.view.setUint8(this.pos, v); this.pos += 1 }
  u32(v) { this.ensure(4); this.view.setUint32(this.pos, v); this.pos += 4 }
  i32(v) { this.ensure(4); this.view.setInt32(this.pos, v); this.pos += 4 }
  f32(v) { this.ensure(4); this.view.setFloat32(this.pos, v); this.pos += 4 }
  f64(v) { this.ensure(8); this.view.setFloat64(this.pos, v); this.pos += 8 }
  str(s) {
    const bytes = ENC.encode(s)
    this.u32(bytes.length)
    this.ensure(bytes.length)
    this.buf.set(bytes, this.pos)
    this.pos += bytes.length
  }
  done() { return this.buf.slice(0, this.pos) }
}

const ENC = new TextEncoder()
const DEC = new TextDecoder()
// 정수지만 f32로 손실 없이 못 담을 만큼 크면 int32/f64로. r1~r3로 반올림된 소수는 f32로 충분.
const INT_MIN = -2147483648, INT_MAX = 2147483647

function writeValue(w, v) {
  if (v == null) { w.u8(T_NULL); return }
  const t = typeof v
  if (t === 'boolean') { w.u8(v ? T_TRUE : T_FALSE); return }
  if (t === 'number') {
    if (Number.isInteger(v) && v >= INT_MIN && v <= INT_MAX) { w.u8(T_INT); w.i32(v); return }
    // f32로 왕복했을 때 (반올림 오차 무시하고) 충분히 가까우면 f32, 아니면 f64
    if (Number.isFinite(v) && Math.fround(v) === Math.fround(v)) { w.u8(T_F32); w.f32(v); return }
    w.u8(T_F64); w.f64(v); return
  }
  if (t === 'string') { w.u8(T_STR); w.str(v); return }
  if (Array.isArray(v)) {
    w.u8(T_ARR); w.u32(v.length)
    for (const item of v) writeValue(w, item)
    return
  }
  // object
  const keys = Object.keys(v)
  w.u8(T_OBJ); w.u32(keys.length)
  for (const k of keys) { w.str(k); writeValue(w, v[k]) }
}

class Reader {
  constructor(bytes) {
    this.buf = bytes
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    this.pos = 0
  }
  u8() { const v = this.view.getUint8(this.pos); this.pos += 1; return v }
  u32() { const v = this.view.getUint32(this.pos); this.pos += 4; return v }
  i32() { const v = this.view.getInt32(this.pos); this.pos += 4; return v }
  f32() { const v = this.view.getFloat32(this.pos); this.pos += 4; return v }
  f64() { const v = this.view.getFloat64(this.pos); this.pos += 8; return v }
  str() {
    const len = this.u32()
    const s = DEC.decode(this.buf.subarray(this.pos, this.pos + len))
    this.pos += len
    return s
  }
}

function readValue(r) {
  const t = r.u8()
  switch (t) {
    case T_NULL: return null
    case T_FALSE: return false
    case T_TRUE: return true
    case T_INT: return r.i32()
    case T_F32: return r.f32()
    case T_F64: return r.f64()
    case T_STR: return r.str()
    case T_ARR: {
      const n = r.u32()
      const a = new Array(n)
      for (let i = 0; i < n; i++) a[i] = readValue(r)
      return a
    }
    case T_OBJ: {
      const n = r.u32()
      const o = {}
      for (let i = 0; i < n; i++) { const k = r.str(); o[k] = readValue(r) }
      return o
    }
    default: throw new Error(`unknown tag ${t}`)
  }
}

export function packValue(v) {
  const w = new Writer()
  writeValue(w, v)
  return w.done()
}

export function unpackValue(bytes) {
  return readValue(new Reader(bytes))
}

// 한 스냅샷을 바이트로. prev==null이면 full(헤더 0), 아니면 델타(헤더 1).
export function encodeSnapshot(prev, next) {
  const w = new Writer()
  if (prev == null) {
    w.u8(0)
    writeValue(w, next)
  } else {
    w.u8(1)
    writeValue(w, diffView(prev, next))
  }
  return w.done()
}

// 바이트 → view. 델타면 prev에 적용해 합친다.
export function decodeSnapshot(prev, bytes) {
  const r = new Reader(bytes)
  const kind = r.u8()
  const val = readValue(r)
  return kind === 0 ? val : applyPatch(prev, val)
}
