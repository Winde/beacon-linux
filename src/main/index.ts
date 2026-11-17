import { app, BrowserWindow, ipcMain, powerMonitor, screen, shell } from 'electron'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { client, registerIpc } from './ipc'
import { useSimpleInputMethod } from './linux-env'
import { pageZoom } from './window-scale'

// Before Chromium creates its input method and GTK loads a module by name.
useSimpleInputMethod(process.env)

const isDev = !app.isPackaged

/** `beacon --open=<slug>` (or BEACON_OPEN) jumps straight to a video or series. */
const initialSlug =
  process.argv.find((arg) => arg.startsWith('--open='))?.slice('--open='.length) ??
  process.env['BEACON_OPEN'] ??
  null

let mainWindow: BrowserWindow | null = null
/** How long quitting waits for the last progress batch; the rest stays on disk. */
const QUIT_FLUSH_WAIT = 2_000
let flushingBeforeQuit = false

/** Best effort, like the app's background flush; a failed send stays queued. */
function flushProgress(): void {
  void client.flushProgress().catch(() => false)
}

/**
 * Dev aid: BEACON_SHOT=<path> renders the app, saves a PNG of the page and quits.
 * Handy for checking layout without a second monitor.
 */
function captureIfRequested(window: BrowserWindow): void {
  // A development aid, not part of a packaged app: BEACON_SHOT_SCRIPT runs
  // arbitrary JavaScript in the renderer, so it must not ship.
  if (!isDev) return
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

/**
 * Zoom the page so a screen keeps the size it was drawn at, whatever the
 * display is. Gamescope would otherwise scale a small window up to the
 * television, which is what made the app look zoomed in and pixelated.
 */
function fitPageToWindow(window: BrowserWindow): void {
  const [width, height] = window.getContentSize()
  if (width < 1 || height < 1) return
  window.webContents.setZoomFactor(pageZoom(width, height))
}

function createWindow(): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  // The one document this window may show. A page-initiated navigation away
  // from it would hand the preload bridge to whatever loaded next.
  const appUrl = new URL(
    isDev && devUrl ? devUrl : pathToFileURL(join(__dirname, '../renderer/index.html')).href
  ).href

  mainWindow = new BrowserWindow({
    // A television is the target. Gamescope scales a smaller window up to the
    // display, so open fullscreen at the display's own resolution; F11 leaves
    // fullscreen on a desktop.
    width: screen.getPrimaryDisplay().workAreaSize.width,
    height: screen.getPrimaryDisplay().workAreaSize.height,
    minWidth: 960,
    minHeight: 540,
    fullscreen: true,
    show: false,
    backgroundColor: '#08090c',
    autoHideMenuBar: true,
    frame: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  fitPageToWindow(mainWindow)
  // Fullscreen changes the window size, and a reload can reset the zoom.
  mainWindow.on('resize', () => {
    if (mainWindow) fitPageToWindow(mainWindow)
  })
  mainWindow.webContents.on('did-finish-load', () => {
    if (mainWindow) fitPageToWindow(mainWindow)
  })

  mainWindow.once('ready-to-show', () => {
    console.log('[window] ready-to-show')
    mainWindow?.show()
  })

  // The app flushes progress when it goes inactive. A window that loses focus,
  // hides or minimises is the desktop equivalent: send what is owed now rather
  // than after the twenty-second timer.
  mainWindow.on('blur', flushProgress)
  mainWindow.on('hide', flushProgress)
  mainWindow.on('minimize', flushProgress)

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[window] did-finish-load')
  })

  mainWindow.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error('[window] did-fail-load', code, description, url)
  })

  if (isDev) {
    // Only in development: renderer logs can quote remote URLs and responses,
    // and a packaged app has no terminal to read them from anyway.
    mainWindow.webContents.on('console-message', (event) => {
      const details = event as unknown as { level?: string; message?: string; sourceId?: string }
      console.log(`[renderer:${details.level ?? 'log'}] ${details.message ?? ''}`)
    })
  }

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== appUrl) event.preventDefault()
  })

  mainWindow.webContents.on('will-redirect', (event, url) => {
    if (url !== appUrl) event.preventDefault()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Nothing opens a window today; if something ever does, only a real web
    // address goes to the desktop, never a local path or a custom scheme.
    try {
      const target = new URL(url)
      if (target.protocol === 'https:') void shell.openExternal(target.href)
    } catch {
      // Unparseable: drop it.
    }
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

    // Closing is the normal exit on a TV, so give the queue a short chance to
    // put its last position on the wire. Anything that misses the window is
    // already on disk and goes out on the next launch.
    app.on('before-quit', (event) => {
      if (flushingBeforeQuit) return
      event.preventDefault()
      flushingBeforeQuit = true
      let timer: ReturnType<typeof setTimeout> | undefined
      const deadline = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, QUIT_FLUSH_WAIT)
      })
      void Promise.race([client.flushProgress().catch(() => false), deadline])
        .finally(() => {
          clearTimeout(timer)
          app.quit()
        })
    })
    powerMonitor.on('suspend', flushProgress)
    powerMonitor.on('lock-screen', flushProgress)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
