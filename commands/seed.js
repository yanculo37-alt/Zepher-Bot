'use strict'

const { SlashCommandBuilder, ApplicationIntegrationType, InteractionContextType } = require('discord.js')
const { XboxAccount } = require('../stuff/api/xbox/xbox')
const { RealmAPI, assertRealmJoinable } = require('../stuff/api/realm/realm')
const { getAccountByDiscordId } = require('../database/models/account')
const { createRealmClient } = require('../stuff/bedrockx/client')
const { isValidRealmCode, isValidRealmId } = require('../stuff/utils/validation')
const { blockIfWhitelisted } = require('../stuff/utils/whitelistGuard')
const { successContainer, errorContainer, infoContainer, ComponentsV2Flags } = require('../stuff/utils/containers')
const { describeDisconnect } = require('../stuff/utils/disconnectReasons')
const logger = require('../stuff/utils/logger')

const CHUNKBASE_PLATFORM = 'bedrock_26_0'

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

function toSignedSeed(seed) {
    const b = BigInt(seed)
    return (b > 9223372036854775807n ? b - 18446744073709551616n : b).toString()
}

function chunkbaseUrl(seed) {
    return `https://www.chunkbase.com/apps/seed-map#seed=${seed}&platform=${CHUNKBASE_PLATFORM}&dimension=overworld&x=0&z=0&zoom=0`
}

function fetchSeed(authflow, connection, deviceProfile) {
    return new Promise((resolve, reject) => {
        const client = createRealmClient(authflow, connection, deviceProfile)

        const timeout = setTimeout(() => {
            try { client.disconnect('Timed out') } catch {}
            reject(new Error('Connection timed out'))
        }, 30_000)

        client.once('start_game', (packet) => {
            clearTimeout(timeout)
            const seed = packet?.seed != null ? toSignedSeed(packet.seed) : null
            try { client.disconnect('Seed retrieved') } catch {}
            resolve(seed)
        })

        client.once('kick', (data) => {
            clearTimeout(timeout)
            reject(new Error(describeDisconnect(data)))
        })

        client.once('error', (error) => {
            clearTimeout(timeout)
            reject(error instanceof Error ? error : new Error(String(error)))
        })
    })
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('seed')
        .setDescription('Retrieve the seed of a Minecraft Realm')
        .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel])
        .addStringOption((option) => option
            .setName('destination')
            .setDescription('Realm code or realm ID')
            .setRequired(true)),

    async execute(interaction) {
        await interaction.deferReply()

        const destination = interaction.options.getString('destination').trim()

        const isId   = isValidRealmId(destination)
        const isCode = isValidRealmCode(destination)

        if (isId && await blockIfWhitelisted(interaction, destination)) return

        if (!isId && !isCode) {
            await interaction.editReply({
                components: [errorContainer('Invalid destination', 'The value you provided is not a valid Realm code or Realm ID.')],
                flags: ComponentsV2Flags
            })
            return
        }

        const linkedAccount = await getAccountByDiscordId(interaction.user.id)
        if (!linkedAccount) {
            await interaction.editReply({
                components: [errorContainer('No linked account', 'You need to link your Minecraft account first using /link.')],
                flags: ComponentsV2Flags
            })
            return
        }

        await interaction.editReply({
            components: [infoContainer('Connecting', 'Connecting to the Realm to retrieve the seed…')],
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
                await interaction.editReply({
                    components: [errorContainer('Invalid destination', isId
                        ? 'No Realm was found for the provided ID.'
                        : 'No Realm was found for the provided code.')],
                    flags: ComponentsV2Flags
                })
                return
            }

            if (await blockIfWhitelisted(interaction, realm.id)) return

            assertRealmJoinable(realm)

            const rawConnection = await realmApi.getConnectionInfo(realm.id)
            const connection    = normalizeConnection(rawConnection)
            const deviceProfile = account.getDeviceProfile()

            const seed = await fetchSeed(account.authflow, connection, deviceProfile)

            if (!seed) {
                await interaction.editReply({
                    components: [errorContainer('Seed unavailable', `Connected to **${realm.name}** but the seed was not present in the connection packet.`)],
                    flags: ComponentsV2Flags
                })
                return
            }

            await interaction.editReply({
                components: [successContainer(
                    'Seed retrieved',
                    `**${realm.name}**\nSeed: \`${seed}\``,
                    { label: 'Open in Chunkbase', url: chunkbaseUrl(seed) }
                )],
                flags: ComponentsV2Flags
            })
        } catch (error) {
            logger.error(`[/seed] Failed for ${interaction.user.id}: ${error.message}`)

            const reasonText = error.message && error.message.trim().length > 0
                ? error.message
                : 'The Realm closed the connection and did not give a reason.'

            await interaction.editReply({
                components: [errorContainer('Connection failed', reasonText)],
                flags: ComponentsV2Flags
            })
        }
    }
}