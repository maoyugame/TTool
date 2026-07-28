'use strict'

// 贴图状态只描述可持久化、可测试的视觉/交互意图。窗口创建、setOpacity、
// setIgnoreMouseEvents 等 Electron 副作用由调用方根据此纯状态执行。
const PIN_STATE_SCHEMA_VERSION = 1

const PIN_STATE_LIMITS = Object.freeze({
  minZoom: 0.25,
  maxZoom: 4,
  minOpacity: 0.2,
  maxOpacity: 1,
  precision: 3,
})

const DEFAULT_PIN_STATE = Object.freeze({
  zoom: 1,
  opacity: 1,
  rotation: 0,
  flipX: false,
  flipY: false,
  locked: false,
  clickThrough: false,
  hidden: false,
  thumbnail: false,
})

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function finiteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const number = Number(value)
    return Number.isFinite(number) ? number : null
  }
  return null
}

function normalizeBoolean(value, fallback) {
  if (value === true || value === false) return value
  if (value === 1 || value === '1') return true
  if (value === 0 || value === '0') return false
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true') return true
    if (normalized === 'false') return false
  }
  return fallback
}

function roundStateNumber(value) {
  const factor = 10 ** PIN_STATE_LIMITS.precision
  const rounded = Math.round(value * factor) / factor
  return Object.is(rounded, -0) ? 0 : rounded
}

function normalizeBoundedNumber(value, fallback, minimum, maximum) {
  const number = finiteNumber(value)
  if (number === null) return fallback
  return roundStateNumber(Math.min(maximum, Math.max(minimum, number)))
}

function normalizeRotation(value, fallback) {
  const number = finiteNumber(value)
  if (number === null) return fallback
  const normalized = ((number % 360) + 360) % 360
  const rounded = roundStateNumber(normalized)
  return rounded >= 360 ? 0 : rounded
}

function fieldValue(source, keys) {
  for (const key of keys) {
    if (hasOwn(source, key)) return source[key]
  }
  return undefined
}

function flipValue(source, axis) {
  const direct = fieldValue(source, axis === 'x' ? ['flipX', 'horizontalFlip'] : ['flipY', 'verticalFlip'])
  if (direct !== undefined) return direct
  if (!isRecord(source.flip)) return undefined
  return fieldValue(source.flip, axis === 'x' ? ['x', 'horizontal'] : ['y', 'vertical'])
}

function normalizeStateWithBase(raw, base) {
  const source = isRecord(raw) ? raw : {}
  const hiddenInput = fieldValue(source, ['hidden'])
  const visibleInput = fieldValue(source, ['visible'])
  const hidden = hiddenInput !== undefined
    ? normalizeBoolean(hiddenInput, base.hidden)
    : visibleInput !== undefined
      ? !normalizeBoolean(visibleInput, !base.hidden)
      : base.hidden

  return {
    zoom: normalizeBoundedNumber(fieldValue(source, ['zoom']), base.zoom, PIN_STATE_LIMITS.minZoom, PIN_STATE_LIMITS.maxZoom),
    opacity: normalizeBoundedNumber(fieldValue(source, ['opacity']), base.opacity, PIN_STATE_LIMITS.minOpacity, PIN_STATE_LIMITS.maxOpacity),
    rotation: normalizeRotation(fieldValue(source, ['rotation']), base.rotation),
    flipX: normalizeBoolean(flipValue(source, 'x'), base.flipX),
    flipY: normalizeBoolean(flipValue(source, 'y'), base.flipY),
    locked: normalizeBoolean(fieldValue(source, ['locked', 'lock']), base.locked),
    clickThrough: normalizeBoolean(fieldValue(source, ['clickThrough', 'clickthrough']), base.clickThrough),
    hidden,
    thumbnail: normalizeBoolean(fieldValue(source, ['thumbnail', 'minimized']), base.thumbnail),
  }
}

function normalizePinState(raw, fallback) {
  const base = fallback === undefined
    ? DEFAULT_PIN_STATE
    : normalizeStateWithBase(fallback, DEFAULT_PIN_STATE)
  return normalizeStateWithBase(raw, base)
}

function samePinState(left, right) {
  const a = normalizePinState(left)
  const b = normalizePinState(right)
  return a.zoom === b.zoom &&
    a.opacity === b.opacity &&
    a.rotation === b.rotation &&
    a.flipX === b.flipX &&
    a.flipY === b.flipY &&
    a.locked === b.locked &&
    a.clickThrough === b.clickThrough &&
    a.hidden === b.hidden &&
    a.thumbnail === b.thumbnail
}

function actionNumber(value, fallback) {
  const number = finiteNumber(value)
  return number === null ? fallback : number
}

function transitionPinState(current, rawAction) {
  const state = normalizePinState(current)
  const action = isRecord(rawAction) ? rawAction : {}
  const type = typeof action.type === 'string' ? action.type : ''

  switch (type) {
    case 'patch':
      return normalizePinState(action.patch, state)
    case 'reset':
      return normalizePinState(action.state)
    case 'setZoom':
      return normalizePinState({ zoom: action.value }, state)
    case 'zoomBy':
      return normalizePinState({ zoom: state.zoom + actionNumber(action.delta, 0) }, state)
    case 'setOpacity':
      return normalizePinState({ opacity: action.value }, state)
    case 'opacityBy':
      return normalizePinState({ opacity: state.opacity + actionNumber(action.delta, 0) }, state)
    case 'setRotation':
      return normalizePinState({ rotation: action.value }, state)
    case 'rotateBy':
      return normalizePinState({ rotation: state.rotation + actionNumber(action.degrees, 0) }, state)
    case 'setFlipX':
      return normalizePinState({ flipX: action.value }, state)
    case 'setFlipY':
      return normalizePinState({ flipY: action.value }, state)
    case 'toggleFlipX':
      return normalizePinState({ flipX: !state.flipX }, state)
    case 'toggleFlipY':
      return normalizePinState({ flipY: !state.flipY }, state)
    case 'setFlip':
      if (action.axis === 'x' || action.axis === 'horizontal') return normalizePinState({ flipX: action.value }, state)
      if (action.axis === 'y' || action.axis === 'vertical') return normalizePinState({ flipY: action.value }, state)
      return state
    case 'toggleFlip':
      if (action.axis === 'x' || action.axis === 'horizontal') return normalizePinState({ flipX: !state.flipX }, state)
      if (action.axis === 'y' || action.axis === 'vertical') return normalizePinState({ flipY: !state.flipY }, state)
      return state
    case 'setLocked':
    case 'setLock':
      return normalizePinState({ locked: action.value }, state)
    case 'toggleLocked':
    case 'toggleLock':
      return normalizePinState({ locked: !state.locked }, state)
    case 'setClickThrough':
      return normalizePinState({ clickThrough: action.value }, state)
    case 'toggleClickThrough':
      return normalizePinState({ clickThrough: !state.clickThrough }, state)
    case 'setHidden':
      return normalizePinState({ hidden: action.value }, state)
    case 'setVisible':
      return normalizePinState({ hidden: !normalizeBoolean(action.value, !state.hidden) }, state)
    case 'toggleHidden':
      return normalizePinState({ hidden: !state.hidden }, state)
    case 'setThumbnail':
      return normalizePinState({ thumbnail: action.value }, state)
    case 'toggleThumbnail':
      return normalizePinState({ thumbnail: !state.thumbnail }, state)
    default:
      return state
  }
}

function toPinStatePersistencePayload(state) {
  return {
    schemaVersion: PIN_STATE_SCHEMA_VERSION,
    state: normalizePinState(state),
  }
}

function fromPinStatePersistencePayload(payload) {
  if (!isRecord(payload) || payload.schemaVersion !== PIN_STATE_SCHEMA_VERSION || !isRecord(payload.state)) {
    return normalizePinState()
  }
  return normalizePinState(payload.state)
}

function serializePinState(state) {
  return JSON.stringify(toPinStatePersistencePayload(state))
}

function parsePinState(serialized) {
  try {
    return fromPinStatePersistencePayload(JSON.parse(String(serialized)))
  } catch {
    return normalizePinState()
  }
}

module.exports = {
  PIN_STATE_SCHEMA_VERSION,
  PIN_STATE_LIMITS,
  DEFAULT_PIN_STATE,
  normalizePinState,
  samePinState,
  transitionPinState,
  reducePinState: transitionPinState,
  toPinStatePersistencePayload,
  fromPinStatePersistencePayload,
  serializePinState,
  parsePinState,
}
