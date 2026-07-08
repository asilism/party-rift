// 조디악 러쉬 앱 아이콘 생성 — public/favicon.svg(브랜드 원본)를 512x512 PNG로
// 래스터해 build/icon.png에 저장한다. electron-builder가 이 PNG로 각 OS 아이콘을 만든다.
// 실행: npx electron scripts/render-icon.cjs  (이 CLI 환경에선 env -u ELECTRON_RUN_AS_NODE 필요)
const { app, BrowserWindow } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

const SIZE = 512

app.disableHardwareAcceleration() // 오프스크린 + 투명 배경을 소프트웨어 렌더로 안정화

app.whenReady().then(async () => {
  try {
    const svg = fs.readFileSync(path.join(__dirname, '..', 'public', 'favicon.svg'), 'utf8')
    const html =
      `<!doctype html><meta charset="utf-8">` +
      `<style>html,body{margin:0;background:transparent;overflow:hidden}svg{width:${SIZE}px;height:${SIZE}px;display:block}</style>` +
      svg
    const win = new BrowserWindow({
      width: SIZE,
      height: SIZE,
      show: false,
      frame: false,
      transparent: true,
      useContentSize: true,
      webPreferences: { offscreen: true },
    })
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    await new Promise((r) => setTimeout(r, 600))
    let img = await win.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE })
    // 고DPI 화면에선 물리 픽셀로 커져서 캡처된다 → 512로 정규화
    if (img.getSize().width !== SIZE) img = img.resize({ width: SIZE, height: SIZE })
    const out = path.join(__dirname, '..', 'build', 'icon.png')
    fs.mkdirSync(path.dirname(out), { recursive: true })
    fs.writeFileSync(out, img.toPNG())
    console.log('아이콘 저장:', out, JSON.stringify(img.getSize()))
    app.exit(0)
  } catch (e) {
    console.error('아이콘 생성 실패:', e)
    app.exit(1)
  }
})
