// 조디악 러쉬 — Electron 데스크톱 셸.
// 빌드된 웹 클라이언트(dist/)를 file://로 열고, preload가 window.zodiacDesktop을 주입해
// 앱이 솔로(오프라인 봇전) 플로우로 분기한다. 게임 서버는 필요 없다(멀티는 후속).
//
// 실행 모드:
//   electron .                              → dist/index.html (npm run build 선행)
//   electron . --dev-url=http://...:5173    → vite dev 서버에 붙어 개발
//   electron . --smoke=<dir>                → 자동으로 봇전에 진입해 스크린샷을 남기고 종료(검증용)
const { app, BrowserWindow } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

const argv = process.argv.slice(1)
const getArg = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : null
}
const devUrl = getArg('dev-url')
const smokeDir = getArg('smoke')

const delay = (ms) => new Promise((r) => setTimeout(r, ms))

async function shot(win, name) {
  const img = await win.webContents.capturePage()
  fs.writeFileSync(path.join(smokeDir, name), img.toPNG())
}

// 스모크: (첫 실행이면 가이드 캡처 후 닫기) → 설정 화면 캡처 → 직업 선택 → 전투 시작 → 전장 캡처 → 종료
async function runSmoke(win) {
  await delay(2500)
  const hasGuide = await win.webContents.executeJavaScript(`!!document.querySelector('.solo-help')`)
  if (hasGuide) {
    await shot(win, 'solo-guide.png')
    await win.webContents.executeJavaScript(`document.querySelector('.solo-help__ok')?.click()`)
    await delay(300)
  }
  await shot(win, 'solo-setup.png')
  // 직업 선택 → (리액트 리렌더로 시작 버튼이 풀릴 때까지 한 박자) → 전투 시작
  await win.webContents.executeJavaScript(`document.querySelector('.draft-class')?.click()`)
  await delay(400)
  await win.webContents.executeJavaScript(`document.querySelector('.solo__start')?.click()`)
  await delay(9000) // three.js 청크 로드 + 카운트다운 지나 실제 전투 프레임까지
  await shot(win, 'solo-play.png')
  app.quit()
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    autoHideMenuBar: true,
    backgroundColor: '#0b1020',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      backgroundThrottling: false, // 창이 가려져도 로컬 시뮬(30Hz 방송)은 계속 돈다
    },
  })
  if (devUrl) win.loadURL(devUrl)
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  if (smokeDir) {
    win.webContents.once('did-finish-load', () => {
      runSmoke(win).catch((e) => {
        console.error('smoke 실패:', e)
        app.exit(1)
      })
    })
  }
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())
