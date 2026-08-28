'use strict'


const { createClient } = require('../src')
const { v3, v4 } = require('uuid')

function generateRandomString(length, characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz1234567890_-') {
    let out = ''
    for (let i = 0; i < length; i++) out += characters[Math.floor(Math.random() * characters.length)]
    return out
}

const androidDevice = {
    deviceType: 'Android',
    deviceOS: 1,
    maxViewDistance: 10,
    memoryTier: 3,
    platformType: 1,
    UIProfile: 1,
    deviceModel: 'SAMSUNG SM-G955U'
}

function safeUuidV3() {
    try { return v3(v4(), v4()) } catch { return v4() }
}

function silence(client) {
    if (!client || typeof client.on !== 'function') return client
    client.on('error', () => {})
    client.on('kick', () => { try { client.disconnect?.() } catch {} })
    return client
}

async function createInstance(realm, account, settings) {
    const {
        protocol = 'DEFAULT',
        address = '',
        external = { type: 0, enabled: false }
    } = settings ?? {}

    const [host, portRaw] = address.includes(':') ? address.split(':') : [address, null]
    const port = portRaw ? Number(portRaw) : 19132

    const options = {
        authflow: account.authflow,

        host,
        port,
        networkId: host,

        version: '1.26.40',
        protocolVersion: 2168,
        transport: protocol,

        external,
        skinData: {
            ClientRandomId: Number(generateRandomString(19, '0123456789')),
            CurrentInputMode: 2,
            DefaultInputMode: 2,

            DeviceModel: androidDevice.deviceModel,
            DeviceOs: androidDevice.deviceOS,
            DeviceId: v4().replace(/-/g, ''),

            PlayFabId: '',
            GUIScale: [0, -1, -2][Math.floor(Math.random() * 3)],
            LanguageCode: 'en_US',

            OverrideSkin: false,
            SelfSignedId: safeUuidV3(),
            PlatformOnlineId: '',
            PlatformOfflineId: safeUuidV3(),

            UIProfile: androidDevice.UIProfile,
            MaxViewDistance: androidDevice.maxViewDistance,
            MemoryTier: androidDevice.memoryTier,

            PlatformType: androidDevice.platformType,
            GraphicsMode: ~~(Math.random() * 2),
            TrustedSkin: false
        }
    }

    const primary = silence(createClient(options))
    if (external?.enabled && external?.type === 3) {
        const pair = [silence(createClient(options)), silence(createClient(options))]
        void primary
        return Promise.all(pair)
    }
    return primary
}

module.exports = createInstance
