'use strict'

const { isRealmWhitelisted, isRealmWhitelistedFresh } = require('../../database/models/whitelist')
const { errorContainer, ComponentsV2Flags } = require('./containers')

const WHITELIST_MESSAGE = 'This Realm is whitelisted. No operations can be performed on it.'

class WhitelistedRealmError extends Error {
    constructor(realmId) {
        super(WHITELIST_MESSAGE)
        this.name = 'WhitelistedRealmError'
        this.realmId = String(realmId ?? '')
    }
}

function assertRealmAllowed(realmId) {
    if (isRealmWhitelisted(realmId)) throw new WhitelistedRealmError(realmId)
}

async function isBlockedRealm(realmId) {
    return isRealmWhitelistedFresh(realmId)
}

function whitelistReply() {
    return {
        components: [errorContainer('Realm whitelisted', WHITELIST_MESSAGE)],
        flags: ComponentsV2Flags
    }
}

async function blockIfWhitelisted(interaction, realmId) {
    if (!(await isRealmWhitelistedFresh(realmId))) return false

    if (interaction.deferred || interaction.replied) {
        await interaction.editReply(whitelistReply())
    } else {
        await interaction.reply(whitelistReply())
    }

    return true
}

module.exports = {
    WHITELIST_MESSAGE,
    WhitelistedRealmError,
    assertRealmAllowed,
    isBlockedRealm,
    whitelistReply,
    blockIfWhitelisted
}
