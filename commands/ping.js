'use strict'

const { SlashCommandBuilder, ApplicationIntegrationType, InteractionContextType } = require('discord.js')
const { infoContainer, ComponentsV2Flags } = require('../stuff/utils/containers')

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Check the bot\'s latency')
        .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),

    async execute(interaction) {
        const sent = await interaction.deferReply({ fetchReply: true })
        const roundtrip = sent.createdTimestamp - interaction.createdTimestamp
        const wsPing = interaction.client.ws.ping

        await interaction.editReply({
            components: [infoContainer('Pong', `Roundtrip: ${roundtrip}ms\nWebSocket: ${wsPing}ms`)],
            flags: ComponentsV2Flags
        })
    }
}
