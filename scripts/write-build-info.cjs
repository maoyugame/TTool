const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const root = path.join(__dirname, '..')
const output = path.join(root, 'dist', 'build-info.json')

function git(args, fallback = '') {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim()
  } catch {
    return fallback
  }
}

function gitDirty() {
  try {
    execFileSync('git', ['diff', '--quiet', '--ignore-submodules', 'HEAD', '--'], { cwd: root, stdio: 'ignore', windowsHide: true })
    return false
  } catch {
    return true
  }
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const revision = process.env.TTOOL_BUILD_SHA || process.env.GITHUB_SHA || git(['rev-parse', 'HEAD'], 'unknown')
const sourceDate = Number(process.env.SOURCE_DATE_EPOCH)
const builtAt = Number.isFinite(sourceDate) && sourceDate > 0
  ? new Date(sourceDate * 1000).toISOString()
  : new Date().toISOString()
const info = {
  schemaVersion: 1,
  version: String(pkg.version || '0.0.0'),
  revision,
  shortRevision: revision === 'unknown' ? revision : revision.slice(0, 12),
  dirty: process.env.GITHUB_ACTIONS === 'true' ? false : gitDirty(),
  builtAt,
}

fs.mkdirSync(path.dirname(output), { recursive: true })
fs.writeFileSync(output, JSON.stringify(info, null, 2) + '\n', 'utf8')
console.log(`[build-info] ${info.version} ${info.shortRevision}${info.dirty ? '-dirty' : ''}`)
