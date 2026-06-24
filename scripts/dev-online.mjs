// 개발용: 룸 서버(8787)와 vite 개발 서버(5173)를 한 번에 띄운다.
// vite가 /ws 를 룸 서버로 프록시하므로 브라우저는 5173 하나로 접속하면 된다.
import { spawn } from 'node:child_process'

// Windows에서 npx는 npx.cmd 라 shell:true 로 띄워야 spawn ENOENT가 안 난다.
const procs = [
  spawn('node', ['server/index.js'], { stdio: 'inherit', shell: true }),
  spawn('npx', ['vite'], { stdio: 'inherit', shell: true }),
]

function shutdown() {
  procs.forEach((p) => p.kill('SIGTERM'))
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
procs.forEach((p) => p.on('exit', shutdown))
