const { SlashCommandBuilder, ApplicationIntegrationType, InteractionContextType } = require('discord.js')
const { disconnectAllForUser, getActiveConnectionsForUser } = require('../stuff/bedrockx/index')
const { successContainer, errorContainer, ComponentsV2Flags } = require('../stuff/utils/containers')

const activeJobs = global.__executeActiveJobs || (global.__executeActiveJobs = new Map())

module.exports = {
    data: new SlashCommandBuilder()
        .setName('cancel')
        .setDescription('Cancel every active Realm connection')
        .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),

    async execute(interaction) {
        await interaction.deferReply()

        const userId = interaction.user.id
        const connections = getActiveConnectionsForUser(userId)
        const executeJob = activeJobs.get(userId)

        if (connections.length === 0 && !executeJob) {
            await interaction.editReply({ components: [errorContainer('Nothing to cancel', "You don't have an active or in-progress Realm connection.")], flags: ComponentsV2Flags })
            return
        }

        if (connections.length > 0) {
            disconnectAllForUser(userId)
        }

        if (executeJob) {
            executeJob.cancel()
        }

        const parts = []
        if (connections.length > 0) {
            const list = connections.map((c) => `\`${c.realmId}\``).join(', ')
            parts.push(`Disconnected from ${connections.length === 1 ? 'Realm' : 'Realms'} ${list}`)
        }
        if (executeJob) {
            parts.push('Cancelled active execute loop')
        }

        await interaction.editReply({ components: [successContainer('Cancelled', parts.join('\n'))], flags: ComponentsV2Flags })
    }
}
