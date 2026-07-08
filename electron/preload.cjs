const { contextBridge } = require('electron')

// 데스크톱 표식 — App.jsx가 이 플래그를 보고 솔로(오프라인) 플로우로 분기한다.
contextBridge.exposeInMainWorld('zodiacDesktop', {
  electron: process.versions.electron,
})
