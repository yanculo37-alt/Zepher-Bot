const { EmbedBuilder, ApplicationCommandOptionType } = require('discord.js')
const logger = require('./logger')

function flattenOptions(options = []) {
    let commandPath = []
    let args = []

    for (const option of options) {
        if (option.type === ApplicationCommandOptionType.SubcommandGroup || option.type === ApplicationCommandOptionType.Subcommand) {
            const nested = flattenOptions(option.options)
            commandPath = [option.name, ...nested.commandPath]
            args = [...args, ...nested.args]
        } else {
            args.push({ name: option.name, value: option.value })
        }
    }

    return { commandPath, args }
}

async function logCommandUsage(client, config, interaction) {
    if (!config.logChannelId) return

    try {
        const channel = client.channels.cache.get(config.logChannelId)
            || await client.channels.fetch(config.logChannelId).catch(() => null)

        if (!channel || !channel.isTextBased()) return

        const { commandPath, args } = flattenOptions(interaction.options?.data ?? [])
        const fullCommand = [interaction.commandName, ...commandPath].join(' ')

        const argsText = args.length
            ? args.map((arg) => `${arg.name}: ${arg.value}`).join('\n')
            : 'None'

        const embed = new EmbedBuilder()
            .setColor(0x2b2d31)
            .setTitle('Command used')
            .setThumbnail(interaction.user.displayAvatarURL({ size: 256 }))
            .addFields(
                { name: 'User', value: interaction.user.tag, inline: true },
                { name: 'User ID', value: interaction.user.id, inline: true },
                { name: 'Ping', value: `<@${interaction.user.id}>`, inline: true },
                { name: 'Command', value: `/${fullCommand}`, inline: false },
                { name: 'Arguments', value: `\`\`\`\n${argsText}\n\`\`\``, inline: false }
            )
            .setTimestamp()

        await channel.send({ embeds: [embed] })
    } catch (error) {
        logger.error(`Failed to log command usage: ${error.message}`)
    }
}

module.exports = { logCommandUsage }