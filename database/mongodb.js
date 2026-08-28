const mongoose = require('mongoose')
const logger = require('../stuff/utils/logger')

async function connectDatabase(uri) {
    mongoose.set('strictQuery', true)

    await mongoose.connect(uri)

    logger.info('Connected to MongoDB')

    return mongoose.connection
}

async function disconnectDatabase() {
    await mongoose.disconnect()
}

module.exports = { connectDatabase, disconnectDatabase }
