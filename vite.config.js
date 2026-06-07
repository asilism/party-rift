import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 7인치 휴대기기 가로 와이드 기준. 정적 호스팅(예: GitHub Pages) 고려해 base는 상대경로.
export default defineConfig({
  base: './',
  plugins: [react()],
})
