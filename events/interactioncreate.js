const { Events, MessageFlags } = require('discord.js')
const { errorContainer, ComponentsV2Flags } = require('../stuff/utils/containers')
const { logCommandUsage } = require('../stuff/utils/commandLogger')
const config = require('../config.json')
const logger = require('../stuff/utils/logger')

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction, client) {
        if (!interaction.isChatInputCommand()) return

        const command = client.commands.get(interaction.commandName)
        if (!command) return

        logCommandUsage(client, config, interaction)

        try {
            await command.execute(interaction)
        } catch (error) {
            logger.error(`Command ${interaction.commandName} failed: ${error.message}`)

            const container = errorContainer('Unexpected error', 'Something went wrong while running this command.')

            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ components: [container], flags: ComponentsV2Flags })
            } else {
                await interaction.reply({ components: [container], flags: MessageFlags.Ephemeral | ComponentsV2Flags })
            }
        }
    }
}
