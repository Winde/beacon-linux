import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

/**
 * The renderer's CSP has no inline scripts in production. In development,
 * React Refresh injects its own inline module preamble, so that build needs
 * `'unsafe-inline'`; the shipped HTML must not.
 */
function csp(): Plugin {
  return {
    name: 'beacon-csp',
    transformIndexHtml: {
      order: 'post',
      handler(html, context) {
        const scriptSrc = context.server ? "'self' 'unsafe-inline'" : "'self'"
        return html.replace('__SCRIPT_SRC__', scriptSrc)
      }
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': resolve('src/shared') }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': resolve('src/shared') }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react(), csp()],
    // Vite leaves the renderer unminified here, which ships ~1.8 MB of JS.
    // The app is read from disk on every launch, so minify it.
    build: { minify: true }
  }
})
