const { SlashCommandBuilder, ApplicationIntegrationType, InteractionContextType } = require('discord.js')
const { XboxAccount } = require('../stuff/api/xbox/xbox')
const { RealmAPI, assertRealmJoinable } = require('../stuff/api/realm/realm')
const { getAccountByDiscordId } = require('../database/models/account')
const { connectToRealm, hasActiveConnection } = require('../stuff/bedrockx/index')
const { isValidRealmCode, isValidRealmId } = require('../stuff/utils/validation')
const { blockIfWhitelisted } = require('../stuff/utils/whitelistGuard')
const { successContainer, errorContainer, infoContainer, plainContainer, ComponentsV2Flags } = require('../stuff/utils/containers')
const { describeDisconnect } = require('../stuff/utils/disconnectReasons')
const logger = require('../stuff/utils/logger')

const FLUSH_INTERVAL_MS = 1_500
const MAX_LINES_PER_MSG = 12
const MAX_CHARS_PER_MSG = 1_800

function normalizeConnection(raw) {
    if (raw.networkProtocol === 'DEFAULT') {
        const [ip, port] = raw.address.split(':')
        return { transport: 'DEFAULT', ip, port: Number(port) }
    }

    if (raw.networkProtocol === 'NETHERNET' || raw.networkProtocol === 'NETHERNET_JSONRPC') {
        return { transport: raw.networkProtocol, networkId: raw.address }
    }

    throw new Error(`Unrecognized realm connection response (networkProtocol: ${raw.networkProtocol})`)
}

function extractBedPosition(packet) {
    const meta = packet?.metadata
    if (!Array.isArray(meta)) return undefined

    const entry = meta.find((m) => m && m.key === 'player_bed_position')
    const value = entry?.value
    if (!value || typeof value !== 'object') return undefined
    if (typeof value.x !== 'number' || typeof value.y !== 'number' || typeof value.z !== 'number') return undefined

    return { x: value.x, y: value.y, z: value.z }
}

function formatPos(position) {
    return `${Math.round(position.x)}, ${Math.round(position.y)}, ${Math.round(position.z)}`
}

function escapeMd(text) {
    return String(text).replace(/([\\*_`~|>])/g, '\\$1')
}

function possessive(name) {
    return /s$/i.test(name) ? `${name}'` : `${name}'s`
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bed')
        .setDescription('Join a realm and log bed positions')
        .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel])
        .addStringOption((option) => option
            .setName('destination')
            .setDescription('Realm code or realm id')
            .setRequired(true)),

    async execute(interaction) {
        await interaction.deferReply()

        const dm = async (components) => {
            try {
                await interaction.user.send({ components, flags: ComponentsV2Flags })
            } catch {
                await interaction.editReply({ components: [errorContainer('DMs closed', "I couldn't send you a DM. Please enable DMs from server members and try again.")], flags: ComponentsV2Flags }).catch(() => {})
            }
        }

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

        if (isId && hasActiveConnection(interaction.user.id, destination)) {
            await interaction.editReply({ components: [errorContainer('Already running', 'You already have a running operation. Try /cancel first.')], flags: ComponentsV2Flags })
            return
        }

        await interaction.editReply({ components: [infoContainer('Connecting', 'Connecting to the Realm, this may take a moment.')], flags: ComponentsV2Flags })

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

            assertRealmJoinable(realm)

            const realmId = String(realm.id)

            if (!isId && hasActiveConnection(interaction.user.id, realmId)) {
                await interaction.editReply({ components: [errorContainer('Already running', 'You already have a running operation. Try /cancel first.')], flags: ComponentsV2Flags })
                return
            }

            const rawConnection = await realmApi.getConnectionInfo(realm.id)
            const connection = normalizeConnection(rawConnection)
            const deviceProfile = account.getDeviceProfile()

            const client = await connectToRealm(interaction.user.id, realmId, account.authflow, connection, deviceProfile)

            const seen = new Map()
            const queue = []

            const flush = async () => {
                if (!queue.length) return

                const lines = []
                let chars = 0
                while (queue.length && lines.length < MAX_LINES_PER_MSG) {
                    const next = queue[0]
                    if (chars + next.length + 1 > MAX_CHARS_PER_MSG) break
                    lines.push(queue.shift())
                    chars += next.length + 1
                }
                if (!lines.length) return

                await dm([plainContainer(lines.join('\n'))])
            }

            const flushInterval = setInterval(async () => {
                await flush()
                if (client.kicked) clearInterval(flushInterval)
            }, FLUSH_INTERVAL_MS)

            client.on('add_player', (packet) => {
                const username = packet?.username || packet?.name || packet?.display_name || 'Unknown'
                const position = extractBedPosition(packet)
                if (!position) return

                const key = `${position.x}|${position.y}|${position.z}`
                if (seen.get(username) === key) return

                seen.set(username, key)
                queue.push(`${possessive(escapeMd(username))} bed is at ${formatPos(position)}`)
            })

            client.on('kick', async (data) => {
                clearInterval(flushInterval)
                await flush().catch(() => {})
                const reasonText = describeDisconnect(data)
                logger.info(`Disconnected from realm ${realmId}: ${reasonText}`)

                await dm([errorContainer('Disconnected', `Lost connection to ${realm.name}.\n${reasonText}`)])
            })

            await interaction.editReply({ components: [successContainer('Bed logger started', `Connected to ${realm.name}. Bed positions will appear in your DMs.`)], flags: ComponentsV2Flags })
        } catch (error) {
            logger.error(`Bed logger failed for ${interaction.user.id}: ${error.message}`)

            const reasonText = error.message && error.message.trim().length > 0
                ? error.message
                : 'The Realm closed the connection and did not give a reason.'

            await interaction.editReply({ components: [errorContainer('Connection failed', reasonText)], flags: ComponentsV2Flags })
        }
    }
}
