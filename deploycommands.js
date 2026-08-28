const config = require('./config.json')
const logger = require('./stuff/utils/logger')
const { deployCommands } = require('./handlers/deployhandler')

deployCommands(config)
    .then((count) => logger.info(`Deployed ${count} slash commands`))
    .catch((error) => {
        logger.error(`Failed to deploy commands: ${error.message}`)
        process.exit(1)
    })
