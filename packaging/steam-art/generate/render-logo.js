// Renders the transparent logo from build/icon.svg with the background rect
// removed. Run from the repository root with the local Electron:
//   ./node_modules/.bin/electron packaging/steam-art/generate/render-logo.js
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

app.commandLine.appendSwitch('disable-gpu')

app.whenReady().then(async () => {
  const svg = fs
    .readFileSync(path.join(process.cwd(), 'build/icon.svg'), 'utf8')
    .replace(/<rect[^>]*\/>/, '')
  const html = `<!doctype html><html><head><style>html,body{margin:0;background:transparent}svg{display:block;width:512px;height:512px}</style></head><body>${svg}</body></html>`
  const win = new BrowserWindow({
    width: 512,
    height: 512,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: true }
  })
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  await new Promise((resolve) => setTimeout(resolve, 500))
  const image = await win.webContents.capturePage()
  fs.writeFileSync(path.join(process.cwd(), 'packaging/steam-art/logo.png'), image.toPNG())
  app.quit()
})
