import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { initCloudSave } from './shared/cloudSave.js'
import './styles/global.css'

// ☁️ 클라우드 세이브를 렌더보다 먼저 — 화면이 localStorage를 읽기 전에 최신 스냅샷을 적용해야
// 새 기기에서도 첫 화면부터 이어진다. 웹·미설정·오프라인은 즉시 통과(상한 2.5초).
function boot() {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}
initCloudSave().catch(() => {}).finally(boot)
