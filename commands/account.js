const { SlashCommandBuilder, MessageFlags, ApplicationIntegrationType, InteractionContextType } = require('discord.js')
const { XboxAccount, clearAuthCacheForUser } = require('../stuff/api/xbox/xbox')
const { getAccountByDiscordId, getAccountByXuid, linkAccount, unlinkAccount } = require('../database/models/account')
const { disconnectAllForUser } = require('../stuff/bedrockx/index')
const { successContainer, errorContainer, infoContainer, ComponentsV2Flags } = require('../stuff/utils/containers')
const logger = require('../stuff/utils/logger')

function microsoftLinkUrl(code) {
    return `https://www.microsoft.com/link?otc=${encodeURIComponent(code)}`
}

async function link(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral })

    const existing = await getAccountByDiscordId(interaction.user.id)
    if (existing) {
        await interaction.editReply({
            components: [errorContainer('Account already linked', `Your Discord account is already linked to ${existing.gamertag}. Use /account unlink first if you want to link a different account.`)],
            flags: ComponentsV2Flags
        })
        return
    }

    let codeSent = false

    const account = new XboxAccount(interaction.user.id, async (data) => {
        if (codeSent) return
        codeSent = true

        await interaction.editReply({
            components: [infoContainer(
                'Authentication required',
                `Go to ${data.verification_uri} and enter the code ${data.user_code} to continue.`,
                { label: 'Open & enter code', url: microsoftLinkUrl(data.user_code) }
            )],
            flags: ComponentsV2Flags
        })
    })

    try {
        const profile = await account.getProfile()

        if (!profile.xuid) {
            logger.error(`Link failed for ${interaction.user.id}: no XUID returned from Xbox profile`)

            await interaction.editReply({
                components: [errorContainer('Authentication error', 'Failed to link your account. Please try again.')],
                flags: ComponentsV2Flags
            })
            return
        }

        const conflict = await getAccountByXuid(profile.xuid)
        if (conflict && conflict.discordId !== interaction.user.id) {
            await interaction.editReply({
                components: [errorContainer('Account already in use', 'This Minecraft account is already linked to another Discord user.')],
                flags: ComponentsV2Flags
            })
            return
        }

        await linkAccount(interaction.user.id, profile.xuid, profile.gamertag)

        await interaction.editReply({
            components: [successContainer('Successfully linked', `Linked to ${profile.gamertag}.`)],
            flags: ComponentsV2Flags
        })
    } catch (error) {
        logger.error(`Link failed for ${interaction.user.id}: ${error.message}`)

        await interaction.editReply({
            components: [errorContainer('Authentication error', 'Failed to link your account. Please try again.')],
            flags: ComponentsV2Flags
        })
    }
}

async function unlink(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral })

    const account = await getAccountByDiscordId(interaction.user.id)
    if (!account) {
        await interaction.editReply({
            components: [errorContainer('No linked account', 'You do not have a linked Minecraft account.')],
            flags: ComponentsV2Flags
        })
        return
    }

    disconnectAllForUser(interaction.user.id)

    await unlinkAccount(interaction.user.id)

    try {
        await clearAuthCacheForUser(interaction.user.id)
    } catch (error) {
        logger.warn(`Failed to clear auth cache for ${interaction.user.id}: ${error.message}`)
    }

    await interaction.editReply({
        components: [successContainer('Successfully unlinked', `Your account ${account.gamertag} has been unlinked.`)],
        flags: ComponentsV2Flags
    })
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('account')
        .setDescription('Manage your linked Minecraft account')
        .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel])
        .addSubcommand((subcommand) =>
            subcommand
                .setName('link')
                .setDescription('Link your Microsoft account')
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName('unlink')
                .setDescription('Unlink your Microsoft account')
        ),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand()

        if (subcommand === 'link') return link(interaction)
        if (subcommand === 'unlink') return unlink(interaction)
    }
}