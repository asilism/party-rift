import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 7인치 휴대기기 가로 와이드 기준. 정적 호스팅(예: GitHub Pages) 고려해 base는 상대경로.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    host: true, // 0.0.0.0 바인딩 → LAN/공유기 포트포워딩으로 접속 가능
    port: 5173,
    strictPort: true,
    allowedHosts: true, // 공인 IP/도메인으로 들어오는 Host 헤더 허용
    // 온라인 모드 WebSocket → 룸 서버(node server/index.js, 8787)로 프록시
    proxy: {
      '/ws': { target: 'ws://127.0.0.1:8787', ws: true },
    },
  },
  preview: {
    host: true,
    port: 4173,
    allowedHosts: true,
    proxy: {
      '/ws': { target: 'ws://127.0.0.1:8787', ws: true },
    },
  },
})
