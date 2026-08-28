'use strict'

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_RETRIES = 2
const RETRY_DELAY_MS = 1_000

const RETRYABLE_CODES = new Set([
    'ECONNRESET',
    'ETIMEDOUT',
    'ENOTFOUND',
    'EAI_AGAIN',
    'ECONNREFUSED',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_SOCKET',
])

function errorCode(error) {
    return error?.cause?.code || error?.code || null
}

function isRetryable(error) {
    if (!error) return false
    if (error.name === 'AbortError') return true
    const code = errorCode(error)
    if (code && RETRYABLE_CODES.has(code)) return true
    return /fetch failed/i.test(error.message || '')
}

function describeNetworkError(error) {
    if (!error) return 'A network error occurred while contacting the server.'
    if (error.name === 'AbortError') return 'The request took too long and timed out.'

    const code = errorCode(error)
    switch (code) {
        case 'ENOTFOUND':
        case 'EAI_AGAIN':
            return "Couldn't resolve the server's address. Check the network this bot is running on."
        case 'ECONNREFUSED':
            return 'The server refused the connection.'
        case 'ECONNRESET':
            return 'The connection was reset partway through the request.'
        case 'UND_ERR_CONNECT_TIMEOUT':
            return 'Connecting to the server timed out.'
        default:
            return code
                ? `A network error occurred while contacting the server (${code}).`
                : 'A network error occurred while contacting the server.'
    }
}

async function resilientFetch(url, init = {}, options = {}) {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const retries = options.retries ?? DEFAULT_RETRIES
    let lastError
    for (let attempt = 0; attempt <= retries; attempt++) {
        const controller = new AbortController()
        const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs)
        try {
            const response = await fetch(url, { ...init, signal: controller.signal })
            clearTimeout(timeoutHandle)
            return response
        } catch (error) {
            clearTimeout(timeoutHandle)
            lastError = error
            if (attempt < retries && isRetryable(error)) {
                await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * (attempt + 1)))
                continue
            }

            throw new Error(describeNetworkError(error))
        }
    }
    throw new Error(describeNetworkError(lastError))
}
module.exports = { resilientFetch }
