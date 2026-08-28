const mongoose = require('mongoose')

const authCacheSchema = new mongoose.Schema({
    discordId: { type: String, required: true },
    cacheName: { type: String, required: true },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    updatedAt: { type: Date, default: Date.now }
})

authCacheSchema.index({ discordId: 1, cacheName: 1 }, { unique: true })

const AuthCache = mongoose.model('authcache', authCacheSchema)

async function getAuthCacheEntry(discordId, cacheName) {
    return AuthCache.findOne({ discordId, cacheName })
}

async function setAuthCacheEntry(discordId, cacheName, data) {
    return AuthCache.findOneAndUpdate(
        { discordId, cacheName },
        { discordId, cacheName, data, updatedAt: new Date() },
        { upsert: true, new: true }
    )
}

async function deleteAuthCacheEntry(discordId, cacheName) {
    return AuthCache.findOneAndDelete({ discordId, cacheName })
}

async function deleteAuthCacheForUser(discordId) {
    return AuthCache.deleteMany({ discordId })
}

module.exports = {
    AuthCache,
    getAuthCacheEntry,
    setAuthCacheEntry,
    deleteAuthCacheEntry,
    deleteAuthCacheForUser
}
