const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, ApplicationIntegrationType, InteractionContextType } = require('discord.js')
const { XboxAccount } = require('../stuff/api/xbox/xbox')
const { RealmAPI } = require('../stuff/api/realm/realm')
const { getAccountByDiscordId } = require('../database/models/account')
const { isValidRealmCode, isValidRealmId } = require('../stuff/utils/validation')
const { blockIfWhitelisted } = require('../stuff/utils/whitelistGuard')
const { successContainer, errorContainer, infoContainer, ComponentsV2Flags } = require('../stuff/utils/containers')
const logger = require('../stuff/utils/logger')

const REALMS_PER_PAGE = 5
const PLAYERS_PER_PAGE = 5
const PAGINATION_TIMEOUT_MS = 5 * 60_000

function buildNavRow(prefix, page, totalPages, disabled = false) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`${prefix}_prev`)
            .setLabel('Back')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(disabled || page === 0),
        new ButtonBuilder()
            .setCustomId(`${prefix}_next`)
            .setLabel('Next')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(disabled || page >= totalPages - 1)
    )
}

async function sendPaginated(interaction, prefix, totalPages, buildPage) {
    let page = 0

    const render = () => {
        const components = buildPage(page)
        if (totalPages > 1) components.push(buildNavRow(prefix, page, totalPages))
        return components
    }

    await interaction.editReply({ components: render(), flags: ComponentsV2Flags })

    if (totalPages <= 1) return

    const message = await interaction.fetchReply()

    const collector = message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: PAGINATION_TIMEOUT_MS,
        filter: (buttonInteraction) => buttonInteraction.user.id === interaction.user.id
    })

    collector.on('collect', async (buttonInteraction) => {
        if (buttonInteraction.customId === `${prefix}_prev`) page = Math.max(0, page - 1)
        if (buttonInteraction.customId === `${prefix}_next`) page = Math.min(totalPages - 1, page + 1)

        await buttonInteraction.update({ components: render(), flags: ComponentsV2Flags })
    })

    collector.on('end', async () => {
        await interaction.editReply({
            components: [errorContainer('Command expired', 'This command has expired, run another one.'), buildNavRow(prefix, page, totalPages, true)],
            flags: ComponentsV2Flags
        }).catch(() => {})
    })
}

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

        const [profilesByXuid, devicesByXuid] = onlineXuids.length
            ? await Promise.all([
                account.fetchProfilesByXuids(onlineXuids),
                account.fetchPresenceByXuids(onlineXuids)
            ])
            : [new Map(), new Map()]

        const entries = onlinePlayers.map((player) => {
            const profile = profilesByXuid.get(player.uuid)

            return {
                gamertag: profile?.gamertag || player.name || 'Unknown',
                gamerpic: profile?.gamerpic ?? null,
                xuid: player.uuid,
                device: devicesByXuid.get(player.uuid) || 'Unknown'
            }
        })

        const totalPages = Math.max(1, Math.ceil(entries.length / PLAYERS_PER_PAGE))

        const buildPage = (page) => {
            const pageNote = totalPages > 1 ? `\n-# Page ${page + 1} of ${totalPages}` : ''
            const summary = `**${realm.name}** ${onlinePlayers.length}/${maxPlayers} players online`

            if (!entries.length) {
                return [successContainer('Realm players', `${summary}\n\nNo players are currently online.`)]
            }

            const start = page * PLAYERS_PER_PAGE
            const pageEntries = entries.slice(start, start + PLAYERS_PER_PAGE)

            return [
                successContainer('Realm players', `${summary}${pageNote}`),
                ...pageEntries.map((entry) => successContainer(
                    entry.gamertag,
                    `XUID: \`${entry.xuid}\`\nDevice: ${entry.device}`,
                    undefined,
                    entry.gamerpic
                ))
            ]
        }

        await sendPaginated(interaction, 'realmplayers', totalPages, buildPage)
    } catch (error) {
        logger.error(`Realm player list failed for ${interaction.user.id}: ${error.message}`)

        const reasonText = error.message && error.message.trim().length > 0
            ? error.message
            : 'Failed to fetch the player list. Please try again.'

        await interaction.editReply({ components: [errorContainer('Lookup failed', reasonText)], flags: ComponentsV2Flags })
    }
}

function titleCase(value) {
    if (typeof value !== 'string' || !value.length) return null

    return value
        .toLowerCase()
        .split('_')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')
}

async function info(interaction) {
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
        components: [infoContainer('Looking up Realm', 'Fetching information about this Realm…')],
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

        const ownerProfiles = realm.ownerUUID
            ? await account.fetchProfilesByXuids([realm.ownerUUID]).catch(() => new Map())
            : new Map()
        const ownerProfile = realm.ownerUUID ? ownerProfiles.get(realm.ownerUUID) : null
        const ownerName = ownerProfile?.gamertag || realm.owner

        const invitedPlayers = Array.isArray(realm.players) ? realm.players : []
        const onlineCount = invitedPlayers.filter((player) => player.online).length
        const operatorCount = invitedPlayers.filter((player) => player.operator).length

        const overview = []
        if (realm.motd) overview.push(realm.motd)
        if (ownerName) overview.push(`Owner: ${ownerName}`)
        if (realm.ownerUUID) overview.push(`Owner XUID: \`${realm.ownerUUID}\``)

        const status = realm.expired
            ? 'Expired'
            : titleCase(realm.state) || 'Unknown'

        const details = [`ID: \`${realm.id}\``, `Status: ${status}`]

        const worldType = titleCase(realm.worldType)
        if (worldType) details.push(`World type: ${worldType}`)

        if (realm.minigameName) details.push(`Minigame: ${realm.minigameName}`)

        if (typeof realm.daysLeft === 'number' && !realm.expired) details.push(`Days left: ${realm.daysLeft}`)

        details.push(`Players online: ${onlineCount}/${realm.maxPlayers ?? invitedPlayers.length}`)
        details.push(`Invited players: ${invitedPlayers.length}`)
        details.push(`Operators: ${operatorCount}`)

        const defaultPermission = titleCase(realm.defaultPermission)
        if (defaultPermission) details.push(`Default permission: ${defaultPermission}`)

        await interaction.editReply({
            components: [
                successContainer(realm.name || 'Unnamed Realm', overview.join('\n') || 'No description set.', undefined, ownerProfile?.gamerpic ?? null),
                infoContainer('Details', details.join('\n'))
            ],
            flags: ComponentsV2Flags
        })
    } catch (error) {
        logger.error(`Realm info failed for ${interaction.user.id}: ${error.message}`)

        const reasonText = error.message && error.message.trim().length > 0
            ? error.message
            : 'Failed to fetch Realm information. Please try again.'

        await interaction.editReply({ components: [errorContainer('Lookup failed', reasonText)], flags: ComponentsV2Flags })
    }
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
    let ownerProfiles = new Map()
    try {
        const realmApi = new RealmAPI(account)
        await realmApi.init()

        realms = await realmApi.getRealms()

        const ownerXuids = [...new Set(realms.map((realm) => realm.ownerUUID).filter(Boolean))]
        if (ownerXuids.length) {
            ownerProfiles = await account.fetchProfilesByXuids(ownerXuids).catch(() => new Map())
        }
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

    const buildPage = (page) => {
        const start = page * REALMS_PER_PAGE
        const pageRealms = realms.slice(start, start + REALMS_PER_PAGE)
        const pageNote = totalPages > 1 ? `\n-# Page ${page + 1} of ${totalPages}` : ''

        return [
            successContainer('Your Realms', `${realms.length} ${realms.length === 1 ? 'Realm' : 'Realms'}${pageNote}`),
            ...pageRealms.map((realm) => {
                const ownerProfile = realm.ownerUUID ? ownerProfiles.get(realm.ownerUUID) : null
                const ownerName = ownerProfile?.gamertag || realm.owner

                const lines = [`ID: \`${realm.id}\``]
                if (ownerName) lines.push(`Owner: ${ownerName}`)
                if (realm.ownerUUID) lines.push(`XUID: \`${realm.ownerUUID}\``)

                return successContainer(realm.name || 'Unnamed Realm', lines.join('\n'), undefined, ownerProfile?.gamerpic ?? null)
            })
        ]
    }

    await sendPaginated(interaction, 'realmlist', totalPages, buildPage)
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
                .setName('info')
                .setDescription('View information about a Realm')
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
        if (subcommand === 'info') return info(interaction)
        if (subcommand === 'list') return list(interaction)
    }
}
