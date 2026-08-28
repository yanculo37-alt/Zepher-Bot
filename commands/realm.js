const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, ApplicationIntegrationType, InteractionContextType } = require('discord.js')
const { XboxAccount } = require('../stuff/api/xbox/xbox')
const { RealmAPI } = require('../stuff/api/realm/realm')
const { getAccountByDiscordId } = require('../database/models/account')
const { isValidRealmCode, isValidRealmId } = require('../stuff/utils/validation')
const { blockIfWhitelisted } = require('../stuff/utils/whitelistGuard')
const { successContainer, errorContainer, infoContainer, ComponentsV2Flags } = require('../stuff/utils/containers')
const logger = require('../stuff/utils/logger')

const REALMS_PER_PAGE = 5
const PAGINATION_TIMEOUT_MS = 5 * 60_000

async function players(interaction) {
    await interaction.deferReply()

    const destination = interaction.options.getString('destination').trim()

    const isId = isValidRealmId(destination)
    const isCode = isValidRealmCode(destination)

    if (isId && await blockIfWhitelisted(interaction, destination)) return

    if (!isId && !isCode) {
        await interaction.editReply({ components: [errorContainer('Invalid Realm information', 'The value you provided is not a valid Realm code or Realm ID.')], flags: ComponentsV2Flags })
        return
    }

    const linkedAccount = await getAccountByDiscordId(interaction.user.id)
    if (!linkedAccount) {
        await interaction.editReply({ components: [errorContainer('No linked account', 'You need to link your Minecraft account first using /account link.')], flags: ComponentsV2Flags })
        return
    }

    await interaction.editReply({
        components: [infoContainer('Looking up Realm', 'Fetching the player list for this Realm…')],
        flags: ComponentsV2Flags
    })

    const account = new XboxAccount(interaction.user.id)

    try {
        const realmApi = new RealmAPI(account)
        await realmApi.init()

        const realm = isId
            ? await realmApi.getRealmById(destination)
            : await realmApi.getRealmByCode(destination)

        if (!realm) {
            await interaction.editReply({ components: [errorContainer('Invalid Realm information', isId ? 'No Realm was found for the provided ID.' : 'No Realm was found for the provided code.')], flags: ComponentsV2Flags })
            return
        }

        if (await blockIfWhitelisted(interaction, realm.id)) return

        const invitedPlayers = Array.isArray(realm.players) ? realm.players : []
        const onlinePlayers = invitedPlayers.filter((player) => player.online)
        const maxPlayers = realm.maxPlayers ?? onlinePlayers.length
        const onlineXuids = onlinePlayers.map((player) => player.uuid)

        const [gamertagsByXuid, devicesByXuid] = onlineXuids.length
            ? await Promise.all([
                account.fetchGamertagsByXuids(onlineXuids),
                account.fetchPresenceByXuids(onlineXuids)
            ])
            : [new Map(), new Map()]

        const list = onlineXuids.length
            ? onlineXuids
                .map((xuid) => {
                    const gamertag = gamertagsByXuid.get(xuid)
                    if (!gamertag) return null
                    return `• ${gamertag} | ${devicesByXuid.get(xuid) || 'Unknown'}`
                })
                .filter(Boolean)
                .join('\n')
            : 'No players are currently online.'

        await interaction.editReply({
            components: [successContainer('Realm players', `**${realm.name}** ${onlinePlayers.length}/${maxPlayers} players online\n\n${list}`)],
            flags: ComponentsV2Flags
        })
    } catch (error) {
        logger.error(`Realm player list failed for ${interaction.user.id}: ${error.message}`)

        const reasonText = error.message && error.message.trim().length > 0
            ? error.message
            : 'Failed to fetch the player list. Please try again.'

        await interaction.editReply({ components: [errorContainer('Lookup failed', reasonText)], flags: ComponentsV2Flags })
    }
}

function buildRealmListPage(realms, page, totalPages) {
    const start = page * REALMS_PER_PAGE
    const pageRealms = realms.slice(start, start + REALMS_PER_PAGE)

    const list = pageRealms
        .map((realm) => `**${realm.name}**\nID: \`${realm.id}\``)
        .join('\n\n')

    const description = `${list}\n\n-# Page ${page + 1} of ${totalPages}`

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('realmlist_prev')
            .setLabel('Back')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === 0),
        new ButtonBuilder()
            .setCustomId('realmlist_next')
            .setLabel('Next')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page >= totalPages - 1)
    )

    return { container: successContainer('Your Realms', description), row }
}

async function list(interaction) {
    await interaction.deferReply()

    const linkedAccount = await getAccountByDiscordId(interaction.user.id)
    if (!linkedAccount) {
        await interaction.editReply({ components: [errorContainer('No linked account', 'You need to link your Minecraft account first using /account link.')], flags: ComponentsV2Flags })
        return
    }

    await interaction.editReply({
        components: [infoContainer('Fetching Realms', 'Fetching the list of Realms you own or belong to…')],
        flags: ComponentsV2Flags
    })

    const account = new XboxAccount(interaction.user.id)

    let realms
    try {
        const realmApi = new RealmAPI(account)
        await realmApi.init()

        realms = await realmApi.getRealms()
    } catch (error) {
        logger.error(`Realm list failed for ${interaction.user.id}: ${error.message}`)

        const reasonText = error.message && error.message.trim().length > 0
            ? error.message
            : 'Failed to fetch your Realms. Please try again.'

        await interaction.editReply({ components: [errorContainer('Lookup failed', reasonText)], flags: ComponentsV2Flags })
        return
    }

    if (!realms.length) {
        await interaction.editReply({ components: [errorContainer('No Realms found', "You don't own or belong to any Realms.")], flags: ComponentsV2Flags })
        return
    }

    const totalPages = Math.ceil(realms.length / REALMS_PER_PAGE)
    let page = 0

    const { container, row } = buildRealmListPage(realms, page, totalPages)
    const components = totalPages > 1 ? [container, row] : [container]

    await interaction.editReply({ components, flags: ComponentsV2Flags })

    if (totalPages <= 1) return

    const message = await interaction.fetchReply()

    const collector = message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: PAGINATION_TIMEOUT_MS,
        filter: (buttonInteraction) => buttonInteraction.user.id === interaction.user.id
    })

    collector.on('collect', async (buttonInteraction) => {
        if (buttonInteraction.customId === 'realmlist_prev') page = Math.max(0, page - 1)
        if (buttonInteraction.customId === 'realmlist_next') page = Math.min(totalPages - 1, page + 1)

        const nextPage = buildRealmListPage(realms, page, totalPages)

        await buttonInteraction.update({ components: [nextPage.container, nextPage.row], flags: ComponentsV2Flags })
    })

    collector.on('end', async () => {
        const expiredRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('realmlist_prev').setLabel('Back').setStyle(ButtonStyle.Secondary).setDisabled(true),
            new ButtonBuilder().setCustomId('realmlist_next').setLabel('Next').setStyle(ButtonStyle.Secondary).setDisabled(true)
        )

        await interaction.editReply({
            components: [errorContainer('Command expired', 'This command has expired, run another one.'), expiredRow],
            flags: ComponentsV2Flags
        }).catch(() => {})
    })
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('realm')
        .setDescription('Realm management commands')
        .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel])
        .addSubcommand((subcommand) =>
            subcommand
                .setName('players')
                .setDescription("View a realm's player list")
                .addStringOption((option) => option
                    .setName('destination')
                    .setDescription('Realm code or realm id')
                    .setRequired(true))
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName('list')
                .setDescription('List all Realms you own or belong to')
        ),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand()

        if (subcommand === 'players') return players(interaction)
        if (subcommand === 'list') return list(interaction)
    }
}