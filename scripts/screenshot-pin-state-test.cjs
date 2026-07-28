'use strict'

const assert = require('node:assert/strict')
const {
  DEFAULT_PIN_STATE,
  PIN_STATE_LIMITS,
  normalizePinState,
  samePinState,
  transitionPinState,
  toPinStatePersistencePayload,
  fromPinStatePersistencePayload,
  serializePinState,
  parsePinState,
} = require('../electron/screenshot-pin-state.cjs')

assert.deepEqual(DEFAULT_PIN_STATE, {
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

const normalized = normalizePinState({
  zoom: 999,
  opacity: -1,
  rotation: -90,
  flip: { horizontal: 'true', vertical: 'false' },
  locked: 'true',
  clickThrough: 'false',
  visible: false,
  thumbnail: 1,
})
assert.deepEqual(normalized, {
  zoom: PIN_STATE_LIMITS.maxZoom,
  opacity: PIN_STATE_LIMITS.minOpacity,
  rotation: 270,
  flipX: true,
  flipY: false,
  locked: true,
  clickThrough: false,
  hidden: true,
  thumbnail: true,
})

const source = {
  zoom: 3.9,
  opacity: 0.21,
  rotation: 350,
  flipX: false,
  flipY: false,
  locked: false,
  clickThrough: false,
  hidden: false,
  thumbnail: false,
}
const zoomed = transitionPinState(source, { type: 'zoomBy', delta: 4 })
assert.equal(zoomed.zoom, PIN_STATE_LIMITS.maxZoom)
assert.equal(source.zoom, 3.9, '状态转换不得修改输入')
assert.notStrictEqual(zoomed, source)

const transformed = transitionPinState(
  transitionPinState(
    transitionPinState(
      transitionPinState(zoomed, { type: 'opacityBy', delta: -5 }),
      { type: 'rotateBy', degrees: 370 }
    ),
    { type: 'toggleFlipX' }
  ),
  { type: 'patch', patch: { locked: true, clickThrough: true, hidden: true, thumbnail: true } }
)
assert.deepEqual(transformed, {
  zoom: 4,
  opacity: 0.2,
  rotation: 0,
  flipX: true,
  flipY: false,
  locked: true,
  clickThrough: true,
  hidden: true,
  thumbnail: true,
})

const boundedPatch = transitionPinState(transformed, {
  type: 'patch',
  patch: { zoom: 0.001, opacity: 100, rotation: 725.5555 },
})
assert.deepEqual(boundedPatch, {
  ...transformed,
  zoom: 0.25,
  opacity: 1,
  rotation: 5.556,
})
assert.equal(samePinState(boundedPatch, { ...boundedPatch, rotation: 365.556 }), true)
assert.equal(samePinState(boundedPatch, { ...boundedPatch, locked: false }), false)

assert.deepEqual(transitionPinState(boundedPatch, { type: 'setVisible', value: true }), {
  ...boundedPatch,
  hidden: false,
})
assert.deepEqual(transitionPinState(boundedPatch, { type: 'reset' }), { ...DEFAULT_PIN_STATE })

const persistedState = {
  zoom: 1.25,
  opacity: 0.5,
  rotation: 270,
  flipX: true,
  flipY: false,
  locked: true,
  clickThrough: false,
  hidden: true,
  thumbnail: true,
}
const payload = toPinStatePersistencePayload(persistedState)
assert.deepEqual(payload, {
  schemaVersion: 1,
  state: persistedState,
})
const serialized = serializePinState(persistedState)
assert.equal(
  serialized,
  '{"schemaVersion":1,"state":{"zoom":1.25,"opacity":0.5,"rotation":270,"flipX":true,"flipY":false,"locked":true,"clickThrough":false,"hidden":true,"thumbnail":true}}'
)
assert.deepEqual(fromPinStatePersistencePayload(payload), persistedState)
assert.deepEqual(parsePinState(serialized), persistedState)
assert.deepEqual(fromPinStatePersistencePayload({ schemaVersion: 2, state: persistedState }), { ...DEFAULT_PIN_STATE })
assert.deepEqual(parsePinState('not-json'), { ...DEFAULT_PIN_STATE })

console.log('screenshot pin-state tests passed')
