const DEFAULT_WIDGET_OPACITY = 0.9
const MIN_WIDGET_OPACITY = 0.5
const MAX_WIDGET_OPACITY = 1

const DEFAULT_CODEX_USAGE_CONFIG = Object.freeze({
  enabled: false,
  widgetOpacity: DEFAULT_WIDGET_OPACITY,
})

function normalizeWidgetOpacity(value) {
  const opacity = Number(value)
  if (!Number.isFinite(opacity)) return DEFAULT_WIDGET_OPACITY
  return Math.round(Math.min(MAX_WIDGET_OPACITY, Math.max(MIN_WIDGET_OPACITY, opacity)) * 100) / 100
}

function normalizeCodexUsageConfig(raw) {
  return {
    enabled: Boolean(raw && raw.enabled),
    widgetOpacity: normalizeWidgetOpacity(raw && raw.widgetOpacity),
  }
}

function readCodexUsageConfigFile(file, fsImpl = fs) {
  try {
    return normalizeCodexUsageConfig(JSON.parse(fsImpl.readFileSync(file, 'utf8')))
  } catch {
    return { ...DEFAULT_CODEX_USAGE_CONFIG }
  }
}

function writeCodexUsageConfigFile(file, config, fsImpl = fs) {
  try {
    fsImpl.mkdirSync(path.dirname(file), { recursive: true })
    fsImpl.writeFileSync(file, JSON.stringify(normalizeCodexUsageConfig(config), null, 2), 'utf8')
    return true
  } catch {
    return false
  }
}

module.exports = {
  DEFAULT_CODEX_USAGE_CONFIG,
  DEFAULT_WIDGET_OPACITY,
  MIN_WIDGET_OPACITY,
  MAX_WIDGET_OPACITY,
  normalizeWidgetOpacity,
  normalizeCodexUsageConfig,
  readCodexUsageConfigFile,
  writeCodexUsageConfigFile,
}
const fs = require('node:fs')
const path = require('node:path')
