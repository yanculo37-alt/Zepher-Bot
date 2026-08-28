const { Events, ChannelType } = require('discord.js')
const { getRelay } = require('../stuff/bedrockx/chatRelay')
const logger = require('../stuff/utils/logger')

module.exports = {
    name: Events.MessageCreate,
    async execute(message) {
        if (message.author.bot) return
        if (message.channel.type !== ChannelType.DM) return

        const relay = getRelay(message.author.id)
        if (!relay) return

        const content = message.content?.trim()
        if (!content) return

        try {
            relay.client.chat(content)
        } catch (error) {
            logger.error(`[chat relay] Failed to relay DM from ${message.author.id}: ${error.message}`)
        }
    }
}
