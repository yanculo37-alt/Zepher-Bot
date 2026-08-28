const { Client, GatewayIntentBits, Partials } = require('discord.js')
const config = require('./config.json')
const { connectDatabase, disconnectDatabase } = require('./database/mongodb')
const { syncWhitelist } = require('./database/models/whitelist')
const { watchWhitelistFile, loadWhitelistFile } = require('./stuff/utils/whitelistWatcher')
const { loadCommands } = require('./handlers/commandhandler')
const { loadEvents } = require('./handlers/eventhandler')
const { deployCommands } = require('./handlers/deployhandler')
const { disconnectAll } = require('./stuff/bedrockx/index')
const { startChannelPurger, stopChannelPurger } = require('./stuff/utils/channelPurger')
const logger = require('./stuff/utils/logger')
const fs = require('fs')
const path = require('path')

const configPath = path.join(__dirname, 'config.json')

// Re-reads config.json from disk each time it's called, so adding/removing
// a channel id there takes effect on the next purge cycle without a restart.
function getPurgeChannelIds() {
    try {
        const raw = fs.readFileSync(configPath, 'utf8')
        const parsed = JSON.parse(raw)
        return Array.isArray(parsed.purgeChannelIds) ? parsed.purgeChannelIds : []
    } catch (err) {
        logger.error(`Failed to read purgeChannelIds from config.json: ${err.message}`)
        return []
    }
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ],
    partials: [Partials.Channel, Partials.Message]
})

async function main() {
    await connectDatabase(config.mongodbUri)

    const whitelisted = await syncWhitelist(loadWhitelistFile())
    logger.info(`Synced ${whitelisted} whitelisted realm id(s) to MongoDB`)

    watchWhitelistFile(async (ids) => {
        const count = await syncWhitelist(ids)
        logger.info(`Whitelist file changed, synced ${count} realm id(s) to MongoDB`)
    })

    loadCommands(client)
    loadEvents(client)

    try {
        const count = await deployCommands(config)
        logger.info(`Deployed ${count} slash commands`)
    } catch (error) {
        logger.error(`Failed to deploy commands on startup: ${error.message}`)
    }

    await client.login(config.token)

    startChannelPurger(client, getPurgeChannelIds)
}

async function shutdown(signal) {
    logger.info(`Received ${signal}, shutting down`)

    stopChannelPurger()
    disconnectAll()
    await disconnectDatabase()
    client.destroy()

    process.exit(0)
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

main().catch((error) => {
    logger.error(`Failed to start End Services: ${error.message}`)
    process.exit(1)
})
