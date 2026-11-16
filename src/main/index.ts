import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { registerIpc } from './ipc'

const isDev = !app.isPackaged

/** `beacon --open=<slug>` (or BEACON_OPEN) jumps straight to a video or series. */
const initialSlug =
  process.argv.find((arg) => arg.startsWith('--open='))?.slice('--open='.length) ??
  process.env['BEACON_OPEN'] ??
  null

let mainWindow: BrowserWindow | null = null

/**
 * Dev aid: BEACON_SHOT=<path> renders the app, saves a PNG of the page and quits.
 * Handy for checking layout without a second monitor.
 */
function captureIfRequested(window: BrowserWindow): void {
  const target = process.env['BEACON_SHOT']
  if (!target) return
  window.webContents.once('did-finish-load', () => {
    setTimeout(async () => {
      const script = process.env['BEACON_SHOT_SCRIPT']
      if (script) {
        try {
          const result = await window.webContents.executeJavaScript(script)
          console.log('[shot] script result:', result)
        } catch (err) {
          console.error('[shot] script failed', err)
        }
        await new Promise((resolve) =>
          setTimeout(resolve, Number(process.env['BEACON_SHOT_SETTLE'] ?? 4500))
        )
      }
      const image = await window.webContents.capturePage()
      writeFileSync(target, image.toPNG())
      app.quit()
    }, Number(process.env['BEACON_SHOT_DELAY'] ?? 3500))
  })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 540,
    show: false,
    backgroundColor: '#08090c',
    autoHideMenuBar: true,
    frame: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.once('ready-to-show', () => {
    console.log('[window] ready-to-show')
    mainWindow?.show()
  })

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[window] did-finish-load')
  })

  mainWindow.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error('[window] did-fail-load', code, description, url)
  })

  mainWindow.webContents.on('console-message', (event) => {
    const details = event as unknown as { level?: string; message?: string; sourceId?: string }
    console.log(`[renderer:${details.level ?? 'log'}] ${details.message ?? ''}`)
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  // A frameless fullscreen app still needs a way out on a keyboard.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    if (input.control && input.key.toLowerCase() === 'q') {
      event.preventDefault()
      app.quit()
    }
    if (input.key === 'F11') {
      event.preventDefault()
      mainWindow?.setFullScreen(!mainWindow.isFullScreen())
    }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (isDev && devUrl) {
    void mainWindow.loadURL(devUrl)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  captureIfRequested(mainWindow)
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

  app.whenReady().then(() => {
    registerIpc()
    ipcMain.handle('app:initialSlug', () => initialSlug)
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
