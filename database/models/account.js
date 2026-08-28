const mongoose = require('mongoose')

const accountSchema = new mongoose.Schema({
    discordId: { type: String, required: true, unique: true },
    xuid: { type: String, required: true, unique: true },
    gamertag: { type: String, required: true },
    linkedAt: { type: Date, default: Date.now }
})

const Account = mongoose.model('account', accountSchema)

async function getAccountByDiscordId(discordId) {
    return Account.findOne({ discordId })
}

async function getAccountByXuid(xuid) {
    return Account.findOne({ xuid })
}

async function linkAccount(discordId, xuid, gamertag) {
    return Account.findOneAndUpdate(
        { discordId },
        { discordId, xuid, gamertag, linkedAt: new Date() },
        { upsert: true, new: true }
    )
}

async function unlinkAccount(discordId) {
    return Account.findOneAndDelete({ discordId })
}

module.exports = { Account, getAccountByDiscordId, getAccountByXuid, linkAccount, unlinkAccount }
