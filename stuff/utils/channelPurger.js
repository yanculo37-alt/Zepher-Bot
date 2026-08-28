const logger = require('./logger')

const PURGE_INTERVAL_MS = 10 * 60 * 1000 // 10 minutes
const BULK_DELETE_AGE_LIMIT_MS = 14 * 24 * 60 * 60 * 1000 // Discord bulkDelete only works on messages < 14 days old

let intervalHandle = null

/**
 * Deletes every message currently in a channel.
 * Messages younger than 14 days are removed in batches via bulkDelete.
 * Anything older has to be deleted one-by-one (Discord API limitation).
 */
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

            // Stop once a fetch comes back with fewer than 100 (nothing left) to avoid looping forever
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

/**
 * Starts the recurring purge loop. Reads the channel id list fresh from
 * config on every cycle, so editing config.json takes effect on the next tick
 * without needing a restart (as long as something reloads the config module,
 * e.g. by requiring it with a cache-busting read - see index.js wiring).
 */
function startChannelPurger(client, getChannelIds) {
    if (intervalHandle) {
        clearInterval(intervalHandle)
    }

    const tick = async () => {
        const channelIds = getChannelIds() || []
        if (channelIds.length === 0) return
        await runPurgeCycle(client, channelIds)
    }

    // Run once shortly after startup, then every 10 minutes
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

module.exports = { startChannelPurger, stopChannelPurger, purgeChannel }
