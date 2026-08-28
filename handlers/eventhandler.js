const fs = require('fs')
const path = require('path')

function loadEvents(client) {
    const eventsPath = path.join(__dirname, '..', 'events')
    const files = fs.readdirSync(eventsPath).filter((file) => file.endsWith('.js'))

    for (const file of files) {
        const event = require(path.join(eventsPath, file))

        if (event.once) {
            client.once(event.name, (...args) => event.execute(...args, client))
        } else {
            client.on(event.name, (...args) => event.execute(...args, client))
        }
    }
}

module.exports = { loadEvents }
