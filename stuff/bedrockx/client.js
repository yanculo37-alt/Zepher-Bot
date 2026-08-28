const { createClient, PROTOCOL_VERSION, GAME_VERSION } = require('./src/index')
const { v4, v3 } = require('uuid')

function toActiveFlags(flags) {
    if (Array.isArray(flags)) return flags
    if (!flags || typeof flags !== 'object') return []
    return Object.keys(flags).filter((key) => flags[key])
}

function buildClientOptions(authflow, connection, deviceProfile) {
    const [host, port] = connection.transport === 'DEFAULT'
        ? [connection.ip, connection.port]
        : [undefined, undefined]

    return {
        authflow,
        host,
        port,
        networkId: connection.transport.includes('NETHERNET') ? connection.networkId : undefined,
        transport: connection.transport,
        version: GAME_VERSION,
        protocolVersion: PROTOCOL_VERSION,
        authTitle: deviceProfile.authTitle,
        deviceType: deviceProfile.deviceType,
        flow: 'sisu',
        skinData: {
            ClientRandomId: Number(String(Date.now()).slice(-9)),
            CurrentInputMode: 2,
            DefaultInputMode: 2,
            DeviceModel: deviceProfile.deviceModel,
            DeviceOs: deviceProfile.deviceOS,
            DeviceId: v4().replace(/-/g, ''),
            GUIScale: -1,
            LanguageCode: 'en_US',
            OverrideSkin: false,
            SelfSignedId: v3(v4(), v4()),
            PlatformOnlineId: '',
            PlatformOfflineId: v3(v4(), v4()),
            UIProfile: deviceProfile.UIProfile,
            MaxViewDistance: deviceProfile.maxViewDistance,
            MemoryTier: deviceProfile.memoryTier,
            PlatformType: deviceProfile.platformType,
            GraphicsMode: 1,
            TrustedSkin: false
        }
    }
}

function attachMovement(client) {
    client.currentPosition = { x: 0, y: 0, z: 0 }
    client.tick = 0n
    client.activeInputFlags = []

    client.move = function move(position, subClientNumber = 0) {
        if (typeof position !== 'object' || !client.runtime) return

        const data = {
            position: { x: position.x, y: position.y, z: position.z },
            move_vector: { x: 0, z: 0 },
            analogue_move_vector: { x: 0, z: 0 },
            pitch: 0,
            yaw: 0,
            head_yaw: 0,
            delta: {
                x: position.x - client.currentPosition.x,
                y: position.y - client.currentPosition.y,
                z: position.z - client.currentPosition.z
            },
            input_data: toActiveFlags(client.activeInputFlags),
            interact_rotation: { x: 0, z: 0 },
            camera_orientation: { x: 0, y: 0, z: 0 },
            raw_move_vector: { x: 0, z: 0 },
            input_mode: 'touch',
            play_mode: 'screen',
            interaction_model: 'touch',
            tick: client.tick
        }

        client.currentPosition = { x: position.x, y: position.y, z: position.z }
        client.write(`player_auth_input${subClientNumber > 0 ? `_${subClientNumber}` : ''}`, data)
        client.tick++
    }
}

function attachChat(client) {
    client.chat = function chat(message) {
        if (!client.runtime) throw new Error('Cannot send chat before the player has spawned')

        client.write('text', {
            needs_translation: false,
            category: 'authored',
            type: 'chat',
            source_name: client.username ?? '',
            message,
            xuid: String(client.profile?.xuid ?? ''),
            platform_chat_id: '',
            has_filtered_message: false,
            filtered_message: ''
        })
    }
}

const DEATH_TEMPLATES = {
    'death.attack.mob': (p) => `${p[0]} was slain by ${p[1] ?? 'a mob'}`,
    'death.attack.player': (p) => `${p[0]} was slain by ${p[1] ?? 'a player'}`,
    'death.attack.arrow': (p) => `${p[0]} was shot by ${p[1] ?? 'an arrow'}`,
    'death.attack.lava': (p) => `${p[0]} tried to swim in lava`,
    'death.attack.onFire': (p) => `${p[0]} went up in flames`,
    'death.attack.inFire': (p) => `${p[0]} burned to death`,
    'death.attack.fireball': (p) => `${p[0]} was fireballed by ${p[1] ?? 'a mob'}`,
    'death.attack.drown': (p) => `${p[0]} drowned`,
    'death.attack.fall': (p) => `${p[0]} fell from a high place`,
    'death.attack.flyIntoWall': (p) => `${p[0]} experienced kinetic energy`,
    'death.attack.outOfWorld': (p) => `${p[0]} fell out of the world`,
    'death.attack.generic': (p) => `${p[0]} died`,
    'death.attack.magic': (p) => `${p[0]} was killed by magic`,
    'death.attack.wither': (p) => `${p[0]} withered away`,
    'death.attack.explosion': (p) => `${p[0]} blew up`,
    'death.attack.explosion.player': (p) => `${p[0]} was blown up by ${p[1] ?? 'someone'}`,
    'death.attack.magma': (p) => `${p[0]} discovered the floor was lava`,
    'death.attack.starve': (p) => `${p[0]} starved to death`,
    'death.attack.cactus': (p) => `${p[0]} was pricked to death`,
    'death.attack.anvil': (p) => `${p[0]} was squashed by a falling anvil`,
    'death.attack.fallingBlock': (p) => `${p[0]} was squashed by a falling block`,
    'death.attack.lightningBolt': (p) => `${p[0]} was struck by lightning`,
    'death.attack.freeze': (p) => `${p[0]} froze to death`,
    'death.attack.sting': (p) => `${p[0]} was stung to death`,
    'death.attack.trident': (p) => `${p[0]} was skewered by ${p[1] ?? 'a trident'}`,
    'death.attack.thrown': (p) => `${p[0]} was pummeled by ${p[1] ?? 'someone'}`,
    'death.attack.fireworks': (p) => `${p[0]} went off with a bang`,
    'death.attack.sonic_boom': (p) => `${p[0]} was obliterated by a sonically-charged shockwave`
}

function formatDeathMessage(key, params) {
    const template = DEATH_TEMPLATES[key]
    if (template) return template(params)

    const player = params[0] ?? 'A player'
    const readableCause = key.replace('death.attack.', '').replace(/[._]/g, ' ')
    return `${player} died (${readableCause || 'unknown cause'})`
}

const JOIN_TRANSLATION_KEYS = new Set(['multiplayer.player.joined', 'multiplayer.player.joined.renamed'])
const LEAVE_TRANSLATION_KEYS = new Set(['multiplayer.player.left', 'multiplayer.player.left.renamed'])

function attachRealmEvents(client) {
    client.playerNamesByUuid = new Map()
    client._playerListSeeded = false

    client.on('text', (packet) => {
        if (packet.type === 'chat') {
            if (client.username && packet.source_name === client.username) return
            client.emit('realm_chat', { player: packet.source_name, message: packet.message })
            return
        }

        if (packet.type === 'translation' || packet.type === 'system') {
            const key = packet.message
            const params = Array.isArray(packet.parameters) ? packet.parameters : []

            if (JOIN_TRANSLATION_KEYS.has(key) || LEAVE_TRANSLATION_KEYS.has(key)) return

            if (typeof key === 'string' && key.startsWith('death.')) {
                client.emit('realm_death', { player: params[0], message: formatDeathMessage(key, params) })
                return
            }

            client.emit('realm_system', { key, params })
        }
    })

    client.on('player_list', (packet) => {
        const records = Array.isArray(packet.records) ? packet.records : []
        const isInitialRoster = !client._playerListSeeded

        for (const record of records) {
            if (record.type === 'add') {
                client.playerNamesByUuid.set(record.uuid, record.username)

                if (!isInitialRoster && record.username !== client.username) {
                    client.emit('realm_join', { player: record.username })
                }
            } else if (record.type === 'remove') {
                const name = client.playerNamesByUuid.get(record.uuid) ?? 'A player'
                client.playerNamesByUuid.delete(record.uuid)

                if (name !== client.username) {
                    client.emit('realm_leave', { player: name })
                }
            }
        }

        client._playerListSeeded = true
    })
}

function createRealmClient(authflow, connection, deviceProfile) {
    const options = buildClientOptions(authflow, connection, deviceProfile)
    const client = createClient(options)

    client.kicked = false
    client.moveIntervalHandle = null

    attachMovement(client)
    attachChat(client)
    attachRealmEvents(client)

    client._disconnect = client.disconnect
    client.disconnect = (reason) => {
        if (client.kicked) return
        client.kicked = true

        if (client.moveIntervalHandle) clearInterval(client.moveIntervalHandle)
        client.moveIntervalHandle = null

        client.removeAllListeners()
        client._disconnect(reason)
    }

    client.on('close', () => {
        client.emit('kick', { message: 'Connection to server lost' })
    })

    client.on('start_game', ({ player_position = { x: 0, y: 0, z: 0 }, runtime_entity_id = 0, current_tick = 0 } = {}) => {
        client.currentPosition = player_position
        client.runtime = runtime_entity_id
        client.tick = BigInt(current_tick)

        client.write('serverbound_loading_screen', { type: 2 })

        client.moveIntervalHandle = setInterval(() => {
            client.move(client.currentPosition)
        }, 50)
    })

    client.on('respawn', (data) => {
        if (!client.runtime) return

        if (data.state === 0) {
            client.write('respawn', {
                runtime_entity_id: BigInt(client.runtime),
                state: 2,
                position: client.currentPosition
            })
        } else if (data.state === 1) {
            client.write('player_action', {
                runtime_entity_id: BigInt(client.runtime),
                action: 'respawn',
                position: client.currentPosition,
                result_position: client.currentPosition,
                face: -1
            })
        }
    })

    return client
}

module.exports = { createRealmClient }
