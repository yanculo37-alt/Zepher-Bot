const fs = require('fs')
const path = require('path')

function loadCommands(client) {
    client.commands = new Map()

    const commandsPath = path.join(__dirname, '..', 'commands')
    const files = fs.readdirSync(commandsPath).filter((file) => file.endsWith('.js'))

    for (const file of files) {
        const command = require(path.join(commandsPath, file))
        client.commands.set(command.data.name, command)
    }

    return client.commands
}

module.exports = { loadCommands }
