'use strict'

const { SlashCommandBuilder, ApplicationIntegrationType, InteractionContextType } = require('discord.js')
const { XboxAccount } = require('../stuff/api/xbox/xbox')
const { RealmAPI, assertRealmJoinable } = require('../stuff/api/realm/realm')
const { getAccountByDiscordId } = require('../database/models/account')
const { connectToRealm, disconnectFromRealm, hasActiveConnection } = require('../stuff/bedrockx/index')
const { registerRelay, getRelay } = require('../stuff/bedrockx/chatRelay')
const { isValidRealmCode, isValidRealmId } = require('../stuff/utils/validation')
const { blockIfWhitelisted } = require('../stuff/utils/whitelistGuard')
const { successContainer, errorContainer, infoContainer, plainContainer, ComponentsV2Flags } = require('../stuff/utils/containers')
const { describeDisconnect } = require('../stuff/utils/disconnectReasons')
const logger = require('../stuff/utils/logger')

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

function attachRelayLogging(client, dmChannel, realmName) {
    const send = (content) => {
        dmChannel.send({ components: [plainContainer(content)], flags: ComponentsV2Flags }).catch((error) => {
            logger.error(`[relay] Failed to send DM log: ${error.message}`)
        })
    }

    client.on('realm_chat', ({ player, message }) => {
        send(`**${player}**: ${message}`)
    })

    client.on('realm_join', ({ player }) => {
        send(`**${player}** joined ${realmName}`)
    })

    client.on('realm_leave', ({ player }) => {
        send(`**${player}** left ${realmName}`)
    })

    client.on('realm_death', ({ message }) => {
        send(message)
    })
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('join')
        .setDescription('Connect to a Minecraft Realm and relay its chat to your DMs')
        .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel])
        .addStringOption((option) => option
            .setName('destination')
            .setDescription('Realm code or realm id')
            .setRequired(true)),

    async execute(interaction) {
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

        if (getRelay(interaction.user.id)) {
            await interaction.editReply({ components: [errorContainer('Already running', 'You already have a running operation. Try /cancel first.')], flags: ComponentsV2Flags })
            return
        }

        if (isId && hasActiveConnection(interaction.user.id, destination)) {
            await interaction.editReply({ components: [errorContainer('Already running', 'You already have a running operation. Try /cancel first.')], flags: ComponentsV2Flags })
            return
        }

        await interaction.editReply({ components: [infoContainer('Connecting', 'Connecting to the Realm, this may take a moment.')], flags: ComponentsV2Flags })

        const account = new XboxAccount(interaction.user.id)
        let realmId

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

            realmId = String(realm.id)

            if (!isId && hasActiveConnection(interaction.user.id, realmId)) {
                await interaction.editReply({ components: [errorContainer('Already running', 'You already have a running operation. Try /cancel first.')], flags: ComponentsV2Flags })
                return
            }

            let dmChannel
            try {
                dmChannel = await interaction.user.createDM()
                await dmChannel.send({ components: [infoContainer('Connecting…', `Setting up your relay with **${realm.name}**.`)], flags: ComponentsV2Flags })
            } catch (error) {
                await interaction.editReply({ components: [errorContainer('DMs are closed', "I can't message you. Please enable direct messages from server members and run /join again.")], flags: ComponentsV2Flags })
                return
            }

            const rawConnection = await realmApi.getConnectionInfo(realm.id)
            const connection = normalizeConnection(rawConnection)
            const deviceProfile = account.getDeviceProfile()
            const gamertag = await account.fetchGamertag().catch(() => undefined)

            const client = await connectToRealm(interaction.user.id, realmId, account.authflow, connection, deviceProfile)

            client.username = gamertag ?? ''
            client.profile = { xuid: account.xuid }

            registerRelay(interaction.user.id, realmId, client, dmChannel)
            attachRelayLogging(client, dmChannel, realm.name)

            client.on('kick', (data) => {
                const reasonText = describeDisconnect(data)
                logger.info(`[/join] Connection for realm ${realmId} ended: ${reasonText}`)
                dmChannel.send({ components: [errorContainer('Disconnected', reasonText)], flags: ComponentsV2Flags }).catch(() => {})
            })

            await interaction.editReply({ components: [successContainer('Successfully joined', `Connected to **${realm.name}**. Check your DMs.`)], flags: ComponentsV2Flags })
            await dmChannel.send({
                components: [successContainer(
                    'Connected',
                    `You're connected to **${realm.name}**.\nSend a message here and it'll be sent as chat in the Realm. Chat, joins/leaves, and deaths from the Realm will show up here too.\nUse \`/cancel\` to disconnect.`
                )],
                flags: ComponentsV2Flags
            })
        } catch (error) {
            logger.error(`[/join] Failed for ${interaction.user.id}: ${error.message}`)

            if (realmId) disconnectFromRealm(interaction.user.id, realmId, 'Join failed')

            const timedOut = /timed out/i.test(error.message)
            const title = timedOut ? 'Connection timed out' : 'Connection failed'
            const reasonText = error.message && error.message.trim().length > 0
                ? error.message
                : 'The Realm closed the connection and did not give a reason.'

            await interaction.editReply({ components: [errorContainer(title, reasonText)], flags: ComponentsV2Flags })
        }
    }
}
