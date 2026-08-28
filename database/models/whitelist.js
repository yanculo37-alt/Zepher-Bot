'use strict'

const mongoose = require('mongoose')

const whitelistSchema = new mongoose.Schema({
    realmId: { type: String, required: true, unique: true },
    addedAt: { type: Date, default: Date.now }
})

const Whitelist = mongoose.model('whitelist', whitelistSchema)

const cache = new Set()

function normalizeId(realmId) {
    return String(realmId ?? '').trim()
}

async function syncWhitelist(realmIds) {
    const ids = [...new Set((realmIds || []).map(normalizeId).filter((id) => id.length > 0))]

    if (ids.length > 0) {
        await Whitelist.bulkWrite(ids.map((realmId) => ({
            updateOne: {
                filter: { realmId },
                update: { $setOnInsert: { realmId, addedAt: new Date() } },
                upsert: true
            }
        })))
    }

    await Whitelist.deleteMany({ realmId: { $nin: ids } })

    await refreshWhitelistCache()

    return ids.length
}

async function refreshWhitelistCache() {
    const docs = await Whitelist.find({}, { realmId: 1 }).lean()

    cache.clear()
    for (const doc of docs) cache.add(normalizeId(doc.realmId))

    return cache.size
}

function isRealmWhitelisted(realmId) {
    return cache.has(normalizeId(realmId))
}

async function isRealmWhitelistedFresh(realmId) {
    const id = normalizeId(realmId)
    if (id.length === 0) return false
    if (cache.has(id)) return true

    const doc = await Whitelist.findOne({ realmId: id }).lean()
    if (doc) cache.add(id)

    return Boolean(doc)
}

function getWhitelistedRealmIds() {
    return [...cache]
}

module.exports = {
    Whitelist,
    syncWhitelist,
    refreshWhitelistCache,
    isRealmWhitelisted,
    isRealmWhitelistedFresh,
    getWhitelistedRealmIds
}
