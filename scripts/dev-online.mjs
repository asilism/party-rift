// 개발용: 룸 서버(8787)와 vite 개발 서버(5173)를 한 번에 띄운다.
// vite가 /ws 를 룸 서버로 프록시하므로 브라우저는 5173 하나로 접속하면 된다.
import { spawn } from 'node:child_process'

// Windows에서 npx는 npx.cmd 라 shell:true 로 띄워야 spawn ENOENT가 안 난다.
// --watch: server/*.js 를 고치면 룸 서버를 자동 재시작(vite는 이미 핫리로드).
// 안 그러면 서버 코드 수정이 dev 세션에 반영 안 돼 옛 동작이 계속 돈다.
const procs = [
  spawn('node', ['--watch', 'server/index.js'], { stdio: 'inherit', shell: true }),
  spawn('npx', ['vite'], { stdio: 'inherit', shell: true }),
]

function shutdown() {
  procs.forEach((p) => p.kill('SIGTERM'))
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
procs.forEach((p) => p.on('exit', shutdown))
