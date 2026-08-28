const { REST, Routes } = require('discord.js')
const fs = require('fs')
const path = require('path')

async function deployCommands(config) {
    const commandsPath = path.join(__dirname, '..', 'commands')
    const files = fs.readdirSync(commandsPath).filter((file) => file.endsWith('.js'))

    const commands = files.map((file) => require(path.join(commandsPath, file)).data.toJSON())

    const rest = new REST().setToken(config.token)

    await rest.put(
        Routes.applicationCommands(config.applicationId),
        { body: commands }
    )

    return commands.length
}

module.exports = { deployCommands }
