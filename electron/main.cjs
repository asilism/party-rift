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
// --win-size=800x360 — 모바일 가로 등 다른 해상도로 띄워 레이아웃 확인용
const winSize = (getArg('win-size') || '1280x720').split('x').map(Number)

const delay = (ms) => new Promise((r) => setTimeout(r, ms))

async function shot(win, name) {
  // WebGL 합성 타이밍에 따라 capturePage가 간헐적으로 실패(UnknownVizError) — 짧게 재시도
  for (let i = 0; ; i++) {
    try {
      const img = await win.webContents.capturePage()
      fs.writeFileSync(path.join(smokeDir, name), img.toPNG())
      return
    } catch (e) {
      if (i >= 2) throw e
      await delay(800)
    }
  }
}

// 스모크: 첫 실행 플로우 전체를 걷는다 —
//   타이틀 → 프로필(수호 지신) → 메인 메뉴 → 모드·난이도 → 캐릭터 선택(+가이드) → 전투
// 각 화면을 캡처해 새 셸이 전부 렌더되는지 확인한다.
async function runSmoke(win) {
  const js = (code) => win.webContents.executeJavaScript(code)
  await delay(1500)
  await js(`localStorage.clear(); location.reload()`) // 항상 "처음 온 사람" 경험으로
  await delay(3500) // 리로드 + 배경 전장(디오라마) 카운트다운까지
  await shot(win, 'shot-1-title.png')
  await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))`)
  await delay(600)
  if (await js(`!!document.querySelector('.profile-screen')`)) {
    await shot(win, 'shot-2-profile.png')
    await js(`document.querySelectorAll('.toy-zodiac')[2]?.click()`) // 🐯
    await delay(600)
  }
  await shot(win, 'shot-3-menu.png')
  await js(`document.querySelector('.menu-screen__list .toy-btn--yellow')?.click()`)
  await delay(600)
  await shot(win, 'shot-4-mode.png')
  await js(`document.querySelector('.mode-card')?.click()`)
  await delay(700)
  if (await js(`!!document.querySelector('.solo-help')`)) {
    await shot(win, 'shot-5-guide.png')
    await js(`document.querySelector('.solo-help__ok')?.click()`)
    await delay(400)
  }
  await shot(win, 'shot-6-char.png')
  await js(`document.querySelector('.char-card:not(:disabled)')?.click()`)
  await delay(400)
  await js(`document.querySelector('.char-show__start')?.click()`)
  await delay(9000) // three.js 청크 로드 + 카운트다운 지나 실제 전투 프레임까지
  await shot(win, 'shot-7-play.png')
  app.quit()
}

function createWindow() {
  const win = new BrowserWindow({
    width: winSize[0] || 1280,
    height: winSize[1] || 720,
    useContentSize: true, // 캡처/레이아웃 확인 시 내용 크기가 지정값과 일치하게
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
