const { resilientFetch } = require('../../utils/resilientFetch')

const endpoint = 'bedrock.frontendlegacy.realms.minecraft-services.net'
const gameVersion = '1.26.45'
const protocolVersion = '2169'

async function describeAccessDenied(response) {
    let detail = ''
    try {
        detail = (await response.text()) || ''
    } catch {
        detail = ''
    }

    const lower = detail.toLowerCase()
    if (lower.includes('block') || lower.includes('ban')) {
        return "You're banned from this Realm."
    }

    return "You don't have access to this Realm. You're either not invited, or were removed from it."
}

async function throwForFailedStatus(response) {
    if (response.status === 403) {
        throw new Error(await describeAccessDenied(response))
    }
    throw new Error(`Realm lookup failed with status ${response.status}`)
}

function assertRealmJoinable(realm) {
    if (realm.state === 'CLOSED') throw new Error('This Realm is closed.')
    if (realm.expired) throw new Error('This Realm has expired.')
}

class RealmAPI {
    constructor(xboxAccount) {
        this.xboxAccount = xboxAccount
        this.headers = {
            Accept: '*/*',
            charset: 'utf-8',
            'client-version': gameVersion,
            'x-clientplatform': 'iOS',
            'x-networkprotocolversion': protocolVersion,
            'content-type': 'application/json',
            'user-agent': 'MCPE/IOS',
            'Accept-Language': 'en-US',
            Host: endpoint
        }
    }

    async init() {
        this.authToken = await this.xboxAccount.getXboxToken('https://pocket.realms.minecraft.net/')
    }

    async authorizedRequest(requestPath, init = {}) {
        return resilientFetch(`https://${endpoint}${requestPath}`, {
            ...init,
            headers: {
                ...this.headers,
                authorization: this.authToken,
                ...(init.headers ?? {})
            }
        })
    }

    async getRealmByCode(realmCode) {
        const response = await this.authorizedRequest(`/worlds/v1/link/${realmCode}`)

        if (response.status === 404 || response.status === 400) return null
        if (!response.ok) await throwForFailedStatus(response)

        const realm = await response.json()

        if (!realm.member) {
            const acceptResponse = await this.authorizedRequest(`/invites/v1/link/accept/${realmCode}`, { method: 'POST' })
            if (!acceptResponse.ok) await throwForFailedStatus(acceptResponse)
        }

        return this.getRealmById(realm.id)
    }

    async getRealmById(realmId) {
        const response = await this.authorizedRequest(`/worlds/${realmId}`)

        if (response.status === 404) return null
        if (!response.ok) await throwForFailedStatus(response)

        return response.json()
    }

    async getRealms() {
        const response = await this.authorizedRequest('/worlds')

        if (!response.ok) await throwForFailedStatus(response)

        const data = await response.json()

        return Array.isArray(data) ? data : Array.isArray(data?.servers) ? data.servers : []
    }

    async getConnectionInfo(realmId) {
        while (true) {
            const response = await this.authorizedRequest(`/worlds/${realmId}/join`)

            if (response.status === 200) return response.json()
            if (response.status === 503) {
                await new Promise((resolve) => setTimeout(resolve, 1800))
                continue
            }

            await throwForFailedStatus(response)
        }
    }
}

module.exports = { RealmAPI, gameVersion, protocolVersion, assertRealmJoinable }
