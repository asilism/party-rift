// 개발용: 룸 서버(8787)와 vite 개발 서버(5173)를 한 번에 띄운다.
// vite가 /ws 를 룸 서버로 프록시하므로 브라우저는 5173 하나로 접속하면 된다.
import { spawn } from 'node:child_process'

const procs = [
  spawn('node', ['server/index.js'], { stdio: 'inherit' }),
  spawn('npx', ['vite'], { stdio: 'inherit' }),
]

function shutdown() {
  procs.forEach((p) => p.kill('SIGTERM'))
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
procs.forEach((p) => p.on('exit', shutdown))
