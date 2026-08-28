'use strict'

function toError(err) {
  if (err instanceof Error) return err
  const error = typeof err === 'string'
    ? new Error(err)
    : new Error(err && typeof err === 'object' && err.message ? String(err.message) : 'Unknown connection error')

  if (err && typeof err === 'object') {
    if (err.partialReadError === true) error.partialReadError = true
    if (err.code) error.code = err.code
  }

  return error
}

function isRecoverableProtocolError(error) {
  const msg = String(error?.message || error || '')
  return error?.partialReadError === true ||
    msg.includes('Read error for undefined') ||
    msg.includes('Missing characters in string') ||
    msg.includes('PartialReadError') ||
    msg.includes('Incomplete packet') ||
    msg.includes('Bad packet header') ||
    msg.includes('bad batch packet header') ||
    msg.includes('unexpected end of file')
}

function safeEmitError(emitter, err) {
  const error = toError(err)
  try {
    if (emitter && typeof emitter.listenerCount === 'function' && emitter.listenerCount('error') > 0) {
      emitter.emit('error', error)
    } else if (!isRecoverableProtocolError(error)) {
      console.warn('[Apex:protocol:recoverable] suppressed error with no listener:', error.message)
    }
  } catch (e) {
    console.warn('[Apex:protocol:recoverable] failed to emit error:', (e && e.message) || e)
  }
}

module.exports = { safeEmitError, toError, isRecoverableProtocolError }
