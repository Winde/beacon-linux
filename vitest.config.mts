import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve('src/renderer/src'),
      '@shared': resolve('src/shared')
    }
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    // Node by default; DOM-dependent files opt in with `// @vitest-environment jsdom`.
    environment: 'node',
    restoreMocks: true
  }
})
