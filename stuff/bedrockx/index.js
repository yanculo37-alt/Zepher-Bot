const { createRealmClient } = require('./client')
const { unregisterRelaysForClient } = require('./chatRelay')
const { describeDisconnect } = require('../utils/disconnectReasons')
const { isRealmWhitelisted } = require('../../database/models/whitelist')

const activeConnections = new Map()

function connectionKey(discordId, realmId) {
    return `${discordId}:${realmId}`
}

function hasActiveConnection(discordId, realmId) {
    return activeConnections.has(connectionKey(discordId, realmId))
}

function getActiveConnection(discordId, realmId) {
    return activeConnections.get(connectionKey(discordId, realmId))
}

function connectToRealm(discordId, realmId, authflow, connection, deviceProfile) {
    return new Promise((resolve, reject) => {
        const key = connectionKey(discordId, realmId)

        if (isRealmWhitelisted(realmId)) {
            reject(new Error('This Realm is whitelisted. No operations can be performed on it.'))
            return
        }

        if (activeConnections.has(key)) {
            reject(new Error('A connection to this realm is already active'))
            return
        }

        const client = createRealmClient(authflow, connection, deviceProfile)
        let settled = false

        const timeout = setTimeout(() => {
            if (settled) return
            settled = true

            client.disconnect('Connection timed out')
            reject(new Error('Connection timed out'))
        }, 30000)

        activeConnections.set(key, client)

        client.once('start_game', () => {
            if (settled) return
            settled = true

            clearTimeout(timeout)
            resolve(client)
        })

        client.on('kick', (data) => {
            const alreadySettled = settled
            settled = true

            clearTimeout(timeout)
            activeConnections.delete(key)
            unregisterRelaysForClient(client)

            if (!alreadySettled) reject(new Error(describeDisconnect(data)))
        })

        client.on('error', (error) => {
            const alreadySettled = settled
            settled = true

            clearTimeout(timeout)
            activeConnections.delete(key)
            unregisterRelaysForClient(client)
            client.disconnect('Protocol error')

            if (!alreadySettled) reject(error instanceof Error ? error : new Error(String(error)))
        })

        client.once('close', () => {
            activeConnections.delete(key)
            unregisterRelaysForClient(client)
        })
    })
}

function getActiveConnectionsForUser(discordId) {
    const results = []

    for (const [key, client] of activeConnections) {
        const [ownerId, realmId] = key.split(':')
        if (ownerId === discordId) results.push({ realmId, client })
    }

    return results
}

function disconnectFromRealm(discordId, realmId, reason) {
    const key = connectionKey(discordId, realmId)
    const client = activeConnections.get(key)

    if (!client) return false

    client.disconnect(reason)
    activeConnections.delete(key)
    unregisterRelaysForClient(client)

    return true
}

function disconnectAllForUser(discordId) {
    for (const [key, client] of activeConnections) {
        if (key.startsWith(`${discordId}:`)) {
            client.disconnect('Shutting down')
            activeConnections.delete(key)
            unregisterRelaysForClient(client)
        }
    }
}

function disconnectAll() {
    for (const [key, client] of activeConnections) {
        client.disconnect('Shutting down')
        activeConnections.delete(key)
        unregisterRelaysForClient(client)
    }
}

module.exports = {
    connectToRealm,
    disconnectFromRealm,
    disconnectAllForUser,
    disconnectAll,
    hasActiveConnection,
    getActiveConnection,
    getActiveConnectionsForUser
}
