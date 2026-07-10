// 조디악 럼블(ZODIAC RUMBLE) 온라인 서버 (서버 권위, 매치메이킹 큐 기반).
//  - /ws : 큐 입장 → 드래프트 → 카운트다운 → 실시간 전투의 전 생애주기를 서버가 주도.
//  - 그 외 : dist/ 정적 파일 서빙(빌드돼 있을 때) → 한 포트로 배포 가능.
//
// 흐름:
//  1) 클라가 hello(deviceId)로 접속. 진행 중이던 큐/매치가 있으면 그대로 이어준다(재접속 복구).
//  2) queue(mode)로 대기열 입장. 목표 인원이 차거나 1분이 지나면 매치 생성(빈자리는 봇).
//  3) 매치: 랜덤 팀 배정 → 스네이크 드래프트(사람 10초/봇 자동) → 3초 카운트다운 → 플레이.
//  4) 플레이: realtime 세션이 60Hz 시뮬 / 30Hz 바이너리 델타 스냅샷을 방송.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'
import { createMatchmaker, MODES } from './matchmaking.js'
import { createMatch, PICK_MS, draftPickRemainingMs } from './match.js'
import { createRealtimeSession } from './realtime.js'

const PORT = Number(process.env.PORT || 8787)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.join(__dirname, '..', 'dist')

const LOOP_MS = 250 // 생애주기 스케줄러 주기
const BOT_PICK_MS = 700 // 봇이 "고민"하는 시간(연출)
const PLAY_GRACE_MS = 20_000 // 플레이 중 끊긴 사람을 봇으로 넘기기까지 유예(재접속 허용)

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
}

const httpServer = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0])
  let file = path.join(DIST, urlPath === '/' ? 'index.html' : urlPath)
  if (!file.startsWith(DIST)) {
    res.writeHead(403).end()
    return
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html')
  if (!fs.existsSync(file)) {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('조디악 럼블 서버 동작 중. 앱은 `npm run build` 후 이 포트로, 개발 중엔 vite(5173)로 접속하세요.')
    return
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
})

// 저지연: 압축(perMessageDeflate)은 작은 스냅샷 프레임엔 CPU·지연만 더한다 — 명시적으로 끈다.
const wss = new WebSocketServer({ server: httpServer, path: '/ws', perMessageDeflate: false })
const mm = createMatchmaker()

// deviceId -> { ws }
const conns = new Map()
// matchId -> entry { match, session, turnSeat, turnAt, countdownAt, disc:Map<deviceId,discAt> }
const matches = new Map()
// deviceId -> matchId (현재 속한 매치)
const deviceMatch = new Map()

const send = (ws, msg) => {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg))
}
const sendTo = (devId, msg) => {
  const c = conns.get(devId)
  if (c) send(c.ws, msg)
}
// 실시간 바이너리 프레임을 한 기기로
function sendBytes(devId, bytes) {
  const c = conns.get(devId)
  if (c && c.ws.readyState === c.ws.OPEN) c.ws.send(bytes)
}

// ── 큐 ──
function queueSnapshotFor(deviceId, now = Date.now()) {
  const mode = mm.modeOf(deviceId)
  return mode ? mm.snapshot(mode, now) : null
}
function broadcastQueue(mode, now = Date.now()) {
  const snap = mm.snapshot(mode, now)
  for (const e of mm.queues.get(mode).entries) sendTo(e.deviceId, { t: 'queue', queue: snap })
}

// ── 매치 ──
function entryOf(deviceId) {
  const id = deviceMatch.get(deviceId)
  return id ? matches.get(id) : null
}

function matchSnapshot(entry, now = Date.now()) {
  const snap = entry.match.snapshot()
  if (snap.phase === 'draft') {
    snap.pickRemainingMs = draftPickRemainingMs(entry.match, entry.turnSeat, entry.turnAt, now)
  }
  return snap
}

function broadcastMatch(entry, now = Date.now()) {
  const snap = matchSnapshot(entry, now)
  for (const p of entry.match.participants) {
    if (p.isBot || !p.deviceId) continue
    sendTo(p.deviceId, { t: 'match', match: snap, you: p.seat })
  }
}

function formMatch(mode) {
  const now = Date.now()
  const humanIds = mm.takeMatch(mode, now)
  if (!humanIds.length) return
  const match = createMatch(humanIds, mode)
  const entry = { match, session: null, turnSeat: null, turnAt: 0, disc: new Map() }
  matches.set(match.code, entry)
  for (const d of humanIds) deviceMatch.set(d, match.code)
  broadcastMatch(entry, now)
}

// 드래프트가 끝나면 실시간 세션을 띄우고 드래프트 로스터로 시작한다.
function startPlay(entry) {
  const { match } = entry
  match.toPlay() // 전장 안에서 엔진의 "곧 시작" 3초 카운트다운이 이어진다.
  const session = createRealtimeSession('rift', match.room, sendBytes)
  entry.session = session
  session.begin()
  session.start({ mode: match.mode, roster: match.roster() })
  // 끊긴 채로 플레이에 들어간 사람은 유예 타이머 시작
  const now = Date.now()
  for (const [devId] of match.room.devices) {
    if (!conns.get(devId)) entry.disc.set(devId, now)
  }
  // 모두에게 phase=play 매치 스냅샷 한 번(클라가 전장으로 전환)
  broadcastMatch(entry, now)
}

function endMatch(entry, reason) {
  entry.session?.end()
  for (const p of entry.match.participants) {
    if (p.deviceId) {
      deviceMatch.delete(p.deviceId)
      sendTo(p.deviceId, { t: 'gate', reason })
    }
  }
  matches.delete(entry.match.code)
}

// 사람이 매치를 떠남(나가기/유예 만료) → 그 자리를 봇으로. 사람 0명이면 매치 종료.
function leaveMatch(entry, deviceId, { silent } = {}) {
  const match = entry.match
  const seat = match.seatOf(deviceId)
  const entityId = seat?.zodiacId
  match.makeBotSeat(deviceId)
  deviceMatch.delete(deviceId)
  entry.disc.delete(deviceId)
  if (entry.session && entityId) entry.session.takeOver([entityId]) // 플레이 중이면 엔티티를 봇이 인계
  if (!silent) sendTo(deviceId, { t: 'gate' })
  if (!match.hasHuman()) {
    endMatch(entry)
    return
  }
  if (match.phase !== 'play') broadcastMatch(entry)
}

// ── 생애주기 스케줄러(단일 루프) ──
function loop() {
  const now = Date.now()

  // 1) 큐: 남은시간 갱신 방송 + 매치 형성
  for (const mode of MODES) {
    const q = mm.queues.get(mode)
    if (q.entries.length) broadcastQueue(mode, now)
    while (mm.ready(mode, now)) formMatch(mode)
  }

  // 2) 매치 진행
  for (const entry of [...matches.values()]) {
    const match = entry.match

    if (match.phase === 'draft') {
      if (match.allPicked()) {
        startPlay(entry) // 전원 픽 완료 → 곧바로 전장 시작
      } else {
        const cur = match.currentPicker()
        if (cur && cur.seat !== entry.turnSeat) {
          // 새 차례 시작 — 타이머 리셋
          entry.turnSeat = cur.seat
          entry.turnAt = now
          broadcastMatch(entry, now)
        }
        const limit = cur.isBot ? BOT_PICK_MS : PICK_MS
        if (cur && now - entry.turnAt >= limit) {
          match.autoPickCurrent()
          entry.turnSeat = null // 다음 루프에서 새 차례(또는 전원완료) 처리
          broadcastMatch(entry, now)
        }
      }
    } else if (match.phase === 'play') {
      // 끊긴 사람 유예 만료 → 봇 인계
      for (const [devId, at] of entry.disc) {
        if (now - at >= PLAY_GRACE_MS) leaveMatch(entry, devId, { silent: true })
      }
    }
  }
}
const loopTimer = setInterval(loop, LOOP_MS)

// ── 연결 ──
wss.on('connection', (ws) => {
  ws._socket?.setNoDelay?.(true) // 저지연: Nagle 비활성 — 작은 입력/스냅샷 프레임이 묶여 늦게 나가는 걸 막는다
  ws.isAlive = true
  ws.on('pong', () => (ws.isAlive = true))
  let deviceId = null

  ws.on('message', (raw) => {
    let msg
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    try {
      handle(msg)
    } catch (err) {
      send(ws, { t: 'error', message: err.message || '오류가 발생했어요.' })
    }
  })

  function handle(msg) {
    if (msg.t === 'hello') {
      deviceId = String(msg.deviceId || '').slice(0, 64)
      if (!deviceId) throw new Error('deviceId가 필요해요.')
      const prev = conns.get(deviceId)
      if (prev && prev.ws !== ws) prev.ws.terminate()
      conns.set(deviceId, { ws })
      resumeOrGate(deviceId)
      return
    }
    if (!deviceId) throw new Error('먼저 hello를 보내야 해요.')

    switch (msg.t) {
      case 'queue': {
        // 이미 매치 중이면 큐 입장 무시
        if (deviceMatch.has(deviceId)) break
        const snap = mm.join(deviceId, String(msg.mode || ''), Date.now())
        sendTo(deviceId, { t: 'queue', queue: snap })
        break
      }
      case 'leaveQueue': {
        mm.leave(deviceId)
        sendTo(deviceId, { t: 'gate' })
        break
      }
      case 'startNow': {
        // 대기 시간을 건너뛰고 지금 큐에 있는 사람으로 즉시 매치(빈자리는 봇).
        const mode = mm.modeOf(deviceId)
        if (mode) formMatch(mode)
        break
      }
      case 'pick': {
        const entry = entryOf(deviceId)
        if (!entry) break
        entry.match.pick(deviceId, String(msg.classId || ''))
        entry.turnSeat = null // 다음 차례 타이머는 루프가 새로 잡는다(전원 완료면 다음 틱에 startPlay)
        broadcastMatch(entry)
        break
      }
      case 'leaveMatch': {
        const entry = entryOf(deviceId)
        if (entry) leaveMatch(entry, deviceId)
        else sendTo(deviceId, { t: 'gate' })
        break
      }
      // ── 실시간 입력(플레이 중) ──
      case 'rtInput': {
        entryOf(deviceId)?.session?.input(deviceId, msg.input)
        break
      }
      case 'rtAction': {
        entryOf(deviceId)?.session?.action(deviceId, msg.action)
        break
      }
      case 'rtResync': {
        // 클라가 막 구독함 → 다음 틱에 full 스냅샷 한 장을 보내 동기화 보장
        entryOf(deviceId)?.session?.deviceJoined(deviceId)
        break
      }
      case 'ping': {
        // 클라 RTT 계측용 에코 — 클라 타임스탬프(ct)를 그대로 돌려준다
        send(ws, { t: 'pong', ct: msg.ct })
        break
      }
      default:
        break
    }
  }

  ws.on('close', () => {
    if (!deviceId) return
    const conn = conns.get(deviceId)
    if (!conn || conn.ws !== ws) return // 새 연결로 교체된 경우
    conns.delete(deviceId)
    // 큐에 있었으면 큐에서 제거
    const mode = mm.modeOf(deviceId)
    if (mode) {
      mm.leave(deviceId)
      return
    }
    // 매치 중이면: 플레이 단계는 유예 타이머, 그 외(드래프트/카운트다운)는 자리 유지(재접속 대기)
    const entry = entryOf(deviceId)
    if (entry && entry.match.phase === 'play') entry.disc.set(deviceId, Date.now())
  })
})

// 재접속 복구 또는 대문으로 안내
function resumeOrGate(deviceId) {
  const entry = entryOf(deviceId)
  if (entry) {
    entry.disc.delete(deviceId) // 유예 취소
    const snap = matchSnapshot(entry)
    const seat = entry.match.seatOf(deviceId)
    sendTo(deviceId, { t: 'match', match: snap, you: seat?.seat ?? null })
    // 플레이 중이면 다음 틱에 full 스냅샷 한 장
    if (entry.match.phase === 'play') entry.session?.deviceJoined(deviceId)
    return
  }
  const qsnap = queueSnapshotFor(deviceId)
  if (qsnap) {
    sendTo(deviceId, { t: 'queue', queue: qsnap })
    return
  }
  sendTo(deviceId, { t: 'gate' })
}

// 죽은 연결 정리(킵얼라이브)
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate()
      continue
    }
    ws.isAlive = false
    ws.ping()
  }
}, 25000)
wss.on('close', () => {
  clearInterval(heartbeat)
  clearInterval(loopTimer)
})

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`[zodiac-rumble] 서버 시작: http://0.0.0.0:${PORT} (ws: /ws)`)
})
