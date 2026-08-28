const { Events } = require('discord.js')
const logger = require('../stuff/utils/logger')

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
        logger.info(`Logged in as ${client.user.tag}`)
    }
}
