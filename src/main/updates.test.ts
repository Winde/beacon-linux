import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UpdateFetch, UpdateResponse } from './updates'
import {
  appImageName,
  checksumFor,
  compareVersions,
  currentAppImage,
  parseRelease,
  relaunchArgs,
  Updater,
  writableAppImage
} from './updates'

function jsonResponse(value: unknown): UpdateResponse {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(value),
    text: () => Promise.resolve(''),
    body: null
  }
}

function textResponse(text: string): UpdateResponse {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(null),
    text: () => Promise.resolve(text),
    body: null
  }
}

function bodyResponse(body: Uint8Array): UpdateResponse {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(null),
    text: () => Promise.resolve(''),
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(body)
        controller.close()
      }
    })
  }
}

function releasePayload(version: string): unknown {
  const base = `https://github.com/Winde/beacon-linux/releases/download/v${version}`
  const name = appImageName(version)
  return {
    tag_name: `v${version}`,
    assets: [
      { name, browser_download_url: `${base}/${name}` },
      { name: 'SHA256SUMS.txt', browser_download_url: `${base}/SHA256SUMS.txt` }
    ]
  }
}

const temporaries: string[] = []

function temporary(): string {
  const directory = mkdtempSync(join(tmpdir(), 'beacon-update-'))
  temporaries.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of temporaries.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('compareVersions', () => {
  it.each([
    ['0.1.5', '0.1.4', 1],
    ['0.1.4', '0.1.4', 0],
    ['v0.2.0', '0.2.0', 0],
    ['0.10.0', '0.9.9', 1],
    ['oops', '0.1.0', 0]
  ])('ranks %s against %s', (a, b, sign) => {
    expect(Math.sign(compareVersions(a, b))).toBe(sign)
  })

  it('puts a pre-release before the release it leads to', () => {
    expect(compareVersions('0.2.0-rc.1', '0.2.0')).toBeLessThan(0)
    expect(compareVersions('0.2.0', '0.2.0-rc.1')).toBeGreaterThan(0)
    expect(compareVersions('0.2.0-rc.2', '0.2.0-rc.1')).toBeGreaterThan(0)
  })
})

describe('parseRelease', () => {
  it('reads the tag without its v and keeps the assets it can trust', () => {
    const release = parseRelease({
      tag_name: 'v0.2.0',
      assets: [
        {
          name: 'Beacon-0.2.0-x86_64.AppImage',
          browser_download_url:
            'https://github.com/Winde/beacon-linux/releases/download/v0.2.0/Beacon-0.2.0-x86_64.AppImage'
        },
        {
          name: 'elsewhere.AppImage',
          browser_download_url: 'https://example.com/elsewhere.AppImage'
        },
        { name: 'notes.txt' }
      ]
    })

    expect(release.version).toBe('0.2.0')
    expect(release.assets).toEqual([
      {
        name: 'Beacon-0.2.0-x86_64.AppImage',
        url: 'https://github.com/Winde/beacon-linux/releases/download/v0.2.0/Beacon-0.2.0-x86_64.AppImage'
      }
    ])
  })

  it('refuses a release without a version', () => {
    expect(() => parseRelease({ tag_name: 'nightly' })).toThrow(/no usable version/)
    expect(() => parseRelease(null)).toThrow(/unexpected/)
  })
})

describe('checksumFor', () => {
  const hash = 'a'.repeat(64)

  it('finds the hash for a file in a sha256sum listing', () => {
    const sums = [`${'b'.repeat(64)}  other.tar`, `${hash}  Beacon-0.2.0-x86_64.AppImage`].join('\n')

    expect(checksumFor(sums, 'Beacon-0.2.0-x86_64.AppImage')).toBe(hash)
    expect(checksumFor(sums, 'missing.AppImage')).toBeNull()
  })
})

describe('writableAppImage', () => {
  it('resolves the file the AppImage runtime names', () => {
    const directory = temporary()
    const target = join(directory, 'Beacon.AppImage')
    writeFileSync(target, 'old')

    expect(writableAppImage({ APPIMAGE: target }, () => true)).toBe(target)
    expect(writableAppImage({ APPIMAGE: target }, () => false)).toBeNull()
    expect(writableAppImage({}, () => true)).toBeNull()
    expect(writableAppImage({ APPIMAGE: join(directory, 'gone') }, () => true)).toBeNull()
  })

  it('reads the running process environment', () => {
    expect(currentAppImage({ APPIMAGE: '/nonexistent/Beacon.AppImage' })).toBeNull()
  })
})

describe('relaunchArgs', () => {
  it('drops the deep link so an update lands on the start screen', () => {
    expect(relaunchArgs(['--open=campaign-1', '--no-sandbox'], {})).toEqual(['--no-sandbox'])
  })

  it('keeps extract-and-run for an AppImage that is not FUSE-mounted', () => {
    expect(relaunchArgs([], { APPDIR: '/tmp/appimage_extracted_1a2b' })).toEqual([
      '--appimage-extract-and-run'
    ])
    expect(relaunchArgs([], { APPDIR: '/tmp/.mount_BeaconAbCd' })).toEqual([])
    expect(relaunchArgs(['--appimage-extract-and-run'], { APPDIR: '/tmp/extracted' })).toEqual([
      '--appimage-extract-and-run'
    ])
  })
})

describe('Updater', () => {
  function updater(fetch: UpdateFetch, options: { version?: string; appImage?: string | null } = {}) {
    return new Updater({
      currentVersion: () => options.version ?? '0.1.4',
      appImage: () => options.appImage ?? null,
      fetch
    })
  }

  it('reports a newer stable release', async () => {
    const fetch = vi.fn(() => Promise.resolve(jsonResponse(releasePayload('0.2.0'))))

    const info = await updater(fetch, {
      appImage: '/home/deck/Applications/Beacon.AppImage'
    }).check()

    expect(fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/Winde/beacon-linux/releases/latest',
      expect.objectContaining({ headers: expect.objectContaining({ accept: 'application/vnd.github+json' }) })
    )
    expect(info).toEqual({ current: '0.1.4', latest: '0.2.0', available: true, canInstall: true })
  })

  it('does not call an older or equal release an update', async () => {
    for (const version of ['0.1.4', '0.1.3']) {
      const info = await updater(
        () => Promise.resolve(jsonResponse(releasePayload(version))),
        { appImage: '/home/deck/Applications/Beacon.AppImage' }
      ).check()
      expect(info.available).toBe(false)
      expect(info.canInstall).toBe(false)
    }
  })

  it('knows when this build cannot replace itself', async () => {
    const info = await updater(() => Promise.resolve(jsonResponse(releasePayload('0.2.0')))).check()

    expect(info.available).toBe(true)
    expect(info.canInstall).toBe(false)
  })

  it('explains a GitHub that is out of reach', async () => {
    await expect(
      updater(() => Promise.reject(new TypeError('fetch failed'))).check()
    ).rejects.toThrow(/Could not reach GitHub/)
  })

  it('explains a refused request', async () => {
    const fetch = () =>
      Promise.resolve({ ...jsonResponse(null), ok: false, status: 404 } as UpdateResponse)

    await expect(updater(fetch).check()).rejects.toThrow(/No release has been published/)
  })

  it('installs into place after checking', async () => {
    const directory = temporary()
    const target = join(directory, 'Beacon.AppImage')
    writeFileSync(target, 'old build')

    const bytes = Buffer.from('new build')
    const hash = createHash('sha256').update(bytes).digest('hex')
    const name = appImageName('0.2.0')
    const fetch: UpdateFetch = (url) => {
      if (url.startsWith('https://api.github.com/')) {
        return Promise.resolve(jsonResponse(releasePayload('0.2.0')))
      }
      if (url.endsWith('SHA256SUMS.txt')) {
        return Promise.resolve(textResponse(`${hash}  ${name}\n`))
      }
      return Promise.resolve(bodyResponse(bytes))
    }
    const service = updater(fetch, { appImage: target })

    await service.check()
    const installed = await service.install()

    expect(installed).toBe(target)
    expect(readFileSync(target, 'utf8')).toBe('new build')
    expect(existsSync(`${target}.part`)).toBe(false)
  })

  it('leaves the old build alone when the checksum does not match', async () => {
    const directory = temporary()
    const target = join(directory, 'Beacon.AppImage')
    writeFileSync(target, 'old build')

    const name = appImageName('0.2.0')
    const fetch: UpdateFetch = (url) => {
      if (url.startsWith('https://api.github.com/')) {
        return Promise.resolve(jsonResponse(releasePayload('0.2.0')))
      }
      if (url.endsWith('SHA256SUMS.txt')) {
        return Promise.resolve(textResponse(`${'0'.repeat(64)}  ${name}\n`))
      }
      return Promise.resolve(bodyResponse(Buffer.from('corrupted')))
    }
    const service = updater(fetch, { appImage: target })

    await service.check()
    await expect(service.install()).rejects.toThrow(/checksum/)

    expect(readFileSync(target, 'utf8')).toBe('old build')
    expect(existsSync(`${target}.part`)).toBe(false)
  })

  it('refuses to install before a check, or without an AppImage', async () => {
    const fetch = () => Promise.resolve(jsonResponse(releasePayload('0.2.0')))

    await expect(updater(fetch).install()).rejects.toThrow(/Check for updates/)

    const service = updater(fetch)
    await service.check()
    await expect(service.install()).rejects.toThrow(/cannot update itself/)
  })
})
