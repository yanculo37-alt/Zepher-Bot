'use strict'

const fs = require('fs')
const path = require('path')
const logger = require('./logger')

const WHITELIST_PATH = path.join(__dirname, '..', 'whitelist.js')

function loadWhitelistFile() {
    try {
        delete require.cache[require.resolve(WHITELIST_PATH)]
        const mod = require(WHITELIST_PATH)
        const ids = mod.WHITELISTED_REALM_IDS ?? mod.whitelist ?? mod
        return Array.isArray(ids) ? ids.map((id) => String(id).trim()).filter(Boolean) : []
    } catch (error) {
        logger.error(`Failed to load whitelist file: ${error.message}`)
        return []
    }
}

function watchWhitelistFile(onChange) {
    let timer = null

    try {
        fs.watch(WHITELIST_PATH, () => {
            if (timer) clearTimeout(timer)
            timer = setTimeout(() => {
                Promise.resolve(onChange(loadWhitelistFile())).catch((error) => {
                    logger.error(`Failed to sync whitelist: ${error.message}`)
                })
            }, 250)
        })
    } catch (error) {
        logger.error(`Failed to watch whitelist file: ${error.message}`)
    }
}

module.exports = { WHITELIST_PATH, loadWhitelistFile, watchWhitelistFile }
