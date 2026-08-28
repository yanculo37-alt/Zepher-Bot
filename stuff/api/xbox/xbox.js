const { Authflow, Titles } = require('prismarine-auth')
const { getAuthCacheEntry, setAuthCacheEntry, deleteAuthCacheForUser } = require('../../../database/models/authCache')
const { resilientFetch } = require('../../utils/resilientFetch')

function mongoCacheFactory({ username, cacheName }) {
    return {
        async getCached() {
            const entry = await getAuthCacheEntry(username, cacheName)
            return entry?.data ?? {}
        },
        async setCached(value) {
            await setAuthCacheEntry(username, cacheName, value)
        },
        async setCachedPartial(value) {
            const entry = await getAuthCacheEntry(username, cacheName)
            await setAuthCacheEntry(username, cacheName, { ...(entry?.data ?? {}), ...value })
        },
        async reset() {
            await setAuthCacheEntry(username, cacheName, {})
        }
    }
}

const DEVICE_TYPE_LABELS = {
    Win32: 'Windows',
    WindowsOneCore: 'Windows',
    XboxOne: 'Xbox',
    Scarlett: 'Xbox',
    Durango: 'Xbox',
    iOS: 'iOS',
    Android: 'Android',
    Nintendo: 'Switch'
}

function formatDeviceType(type) {
    if (!type) return 'Unknown'
    return DEVICE_TYPE_LABELS[type] || type
}

function createDeviceProfile() {
    return {
        authTitle: Titles.MinecraftIOS,
        deviceType: 'iOS',
        deviceModel: 'iPhone14,5',
        deviceOS: 5,
        UIProfile: 0,
        maxViewDistance: 12,
        memoryTier: 3,
        platformType: 0
    }
}

class XboxAccount {
    constructor(discordId, onMsaCode) {
        this.discordId = discordId

        this.authflow = new Authflow(discordId, mongoCacheFactory, {
            flow: 'sisu',
            authTitle: Titles.MinecraftIOS,
            deviceType: 'iOS'
        }, onMsaCode)
    }

    async getXboxToken(relyingParty = 'https://multiplayer.minecraft.net/') {
        const token = await this.authflow.getXboxToken(relyingParty)

        if (token?.userXUID) this.xuid = token.userXUID

        return `XBL3.0 x=${token.userHash};${token.XSTSToken}`
    }

    async fetchGamertag() {
        const authHeader = await this.getXboxToken('http://xboxlive.com')

        const response = await resilientFetch('https://profile.xboxlive.com/users/me/profile/settings?settings=Gamertag', {
            headers: {
                'x-xbl-contract-version': '2',
                Authorization: authHeader
            }
        })

        if (!response.ok) {
            throw new Error(`Failed to fetch Xbox profile, status ${response.status}`)
        }

        const data = await response.json()
        const gamertagSetting = data?.profileUsers?.[0]?.settings?.find((setting) => setting.id === 'Gamertag')

        return gamertagSetting?.value
    }

    async fetchGamertagsByXuids(xuids) {
        if (!Array.isArray(xuids) || !xuids.length) return new Map()

        const token = await this.authflow.getXboxToken('http://xboxlive.com')
        const authHeader = `XBL3.0 x=${token.userHash};${token.XSTSToken}`

        const response = await resilientFetch('https://profile.xboxlive.com/users/batch/profile/settings', {
            method: 'POST',
            headers: {
                'x-xbl-contract-version': '2',
                'content-type': 'application/json',
                Authorization: authHeader
            },
            body: JSON.stringify({ userIds: xuids, settings: ['Gamertag'] })
        })

        if (!response.ok) {
            throw new Error(`Failed to fetch Xbox profiles, status ${response.status}`)
        }

        const data = await response.json()
        const profiles = Array.isArray(data?.profileUsers) ? data.profileUsers : []

        const gamertagsByXuid = new Map()
        for (const profile of profiles) {
            const gamertag = profile.settings?.find((setting) => setting.id === 'Gamertag')?.value
            if (gamertag) gamertagsByXuid.set(profile.id, gamertag)
        }

        return gamertagsByXuid
    }

    async fetchPresenceByXuids(xuids) {
        if (!Array.isArray(xuids) || !xuids.length) return new Map()

        const token = await this.authflow.getXboxToken('http://xboxlive.com')
        const authHeader = `XBL3.0 x=${token.userHash};${token.XSTSToken}`

        const response = await resilientFetch('https://userpresence.xboxlive.com/users/batch', {
            method: 'POST',
            headers: {
                'x-xbl-contract-version': '3',
                'content-type': 'application/json',
                Accept: 'application/json',
                Authorization: authHeader
            },
            body: JSON.stringify({ users: xuids, level: 'device' })
        })

        if (!response.ok) {
            throw new Error(`Failed to fetch Xbox presence, status ${response.status}`)
        }

        const data = await response.json()
        const records = Array.isArray(data) ? data : []

        const devicesByXuid = new Map()
        for (const record of records) {
            devicesByXuid.set(record.xuid, formatDeviceType(record?.devices?.[0]?.type))
        }

        return devicesByXuid
    }

    async getProfile() {
        const token = await this.getXboxToken()
        this.gamertag = await this.fetchGamertag()

        return {
            xuid: this.xuid,
            gamertag: this.gamertag,
            token
        }
    }

    getDeviceProfile() {
        return { ...createDeviceProfile() }
    }
}

module.exports = { XboxAccount, createDeviceProfile, clearAuthCacheForUser: deleteAuthCacheForUser }