'use strict'

const relaysByUser = new Map()

function registerRelay(discordId, realmId, client, dmChannel) {
    relaysByUser.set(discordId, { discordId, realmId, client, dmChannel })
}

function unregisterRelay(discordId) {
    return relaysByUser.delete(discordId)
}

function unregisterRelaysForClient(client) {
    for (const [discordId, relay] of relaysByUser) {
        if (relay.client === client) relaysByUser.delete(discordId)
    }
}

function getRelay(discordId) {
    return relaysByUser.get(discordId) ?? null
}

module.exports = {
    registerRelay,
    unregisterRelay,
    unregisterRelaysForClient,
    getRelay
}
