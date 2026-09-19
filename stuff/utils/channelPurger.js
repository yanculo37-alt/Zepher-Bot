const logger = require('./logger')

const PURGE_INTERVAL_MS = 10 * 60 * 1000
const BULK_DELETE_AGE_LIMIT_MS = 14 * 24 * 60 * 60 * 1000

let intervalHandle = null

async function purgeChannel(channel) {
    let totalDeleted = 0

    try {
        let keepGoing = true

        while (keepGoing) {
            const messages = await channel.messages.fetch({ limit: 100 })
            if (messages.size === 0) break

            const now = Date.now()
            const bulkable = messages.filter((m) => now - m.createdTimestamp < BULK_DELETE_AGE_LIMIT_MS)
            const old = messages.filter((m) => now - m.createdTimestamp >= BULK_DELETE_AGE_LIMIT_MS)

            if (bulkable.size > 0) {
                const deleted = await channel.bulkDelete(bulkable, true)
                totalDeleted += deleted.size
            }

            for (const msg of old.values()) {
                try {
                    await msg.delete()
                    totalDeleted++
                } catch (err) {
                    logger.warn(`Failed to delete old message ${msg.id} in #${channel.name ?? channel.id}: ${err.message}`)
                }
            }

            keepGoing = messages.size === 100
        }

        if (totalDeleted > 0) {
            logger.info(`Purged ${totalDeleted} message(s) from #${channel.name ?? channel.id}`)
        }
    } catch (err) {
        logger.error(`Failed to purge channel ${channel.id}: ${err.message}`)
    }
}

async function runPurgeCycle(client, channelIds) {
    for (const channelId of channelIds) {
        try {
            const channel = await client.channels.fetch(channelId)
            if (!channel) {
                logger.warn(`Purge config: channel ${channelId} not found`)
                continue
            }
            await purgeChannel(channel)
        } catch (err) {
            logger.error(`Purge config: could not fetch channel ${channelId}: ${err.message}`)
        }
    }
}

function startChannelPurger(client, getChannelIds) {
    if (intervalHandle) {
        clearInterval(intervalHandle)
    }

    const tick = async () => {
        const channelIds = getChannelIds() || []
        if (channelIds.length === 0) return
        await runPurgeCycle(client, channelIds)
    }

    setTimeout(tick, 5000)
    intervalHandle = setInterval(tick, PURGE_INTERVAL_MS)

    logger.info(`Channel auto-purge started (every ${PURGE_INTERVAL_MS / 60000} min)`)
}

function stopChannelPurger() {
    if (intervalHandle) {
        clearInterval(intervalHandle)
        intervalHandle = null
    }
}

module.exports = { startChannelPurger, stopChannelPurger }
