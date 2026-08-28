const { RakClient, RakServer } = require('./binding')
const { EventEmitter } = require('events')
const { MessageID } = require('./constants')

class Client extends EventEmitter {
  constructor(hostname, port, options = {}) {
    super()
    this.client = new RakClient(hostname, port, options)
    this.startListening()
  }

  connect() {
    return this.client.connect(this)
  }

  close() {
    return this.client.close()
  }

  startListening() {
    this.client.listen((buffers, address, guid) => {
      for (let i = 0; i < buffers.length; i++) {
        const buffer = buffers[i];
        const buf = Buffer.from(buffer);
        const id = buf[0];

        try {
          if (id < MessageID.ID_USER_PACKET_ENUM) {
            switch (id) {
              case MessageID.ID_UNCONNECTED_PONG:
                if (buf.byteLength > 5) {
                  const extra = Buffer.from(buf.slice(5));
                  this.emit('pong', { extra });
                } else {
                  this.emit('pong', {});
                }
                break;
              case MessageID.ID_CONNECTION_REQUEST_ACCEPTED:
                this.emit('connect', {
                  address,
                  guid
                });
                break;
              case MessageID.ID_CONNECTION_LOST:
              case MessageID.ID_DISCONNECTION_NOTIFICATION:
              case MessageID.ID_CONNECTION_BANNED:
              case MessageID.ID_INCOMPATIBLE_PROTOCOL_VERSION:
                this.emit('disconnect', {
                  address,
                  guid,
                  reason: id
                });
                break;
              default:
                break;
            }
          } else {
            this.emit('encapsulated', {
              buffer: buf
            });
          }
        } catch (e) {
          this.emit('error', e, buf);
        }
      }
    }, this);
  }

  send(message, priority, reliability, orderingChannel = 0, broadcast = false) {
    if (message instanceof Buffer && message.buffer.byteLength !== message.byteLength) message = new Uint8Array(message)

    const ret = this.client.send(message instanceof ArrayBuffer ? message : message.buffer, priority, reliability, orderingChannel, broadcast)

    return ret
  }
}

function ServerClient(server, address, guid) {
  const [hostname, port] = address.split('/')
  this.address = address
  this.guid = guid
  this.send = (...args) => server.send(hostname, port, ...args)
  this.close = (silent) => server.kick(guid, silent)

  this.neuter = () => {
    this.send = () => { }
  }
}

class Server extends EventEmitter {
  constructor(hostname, port, options) {
    super()
    this.server = new RakServer(hostname, port, options)
    this.close = () => this.server.close()
    this.connections = new Map()
    if (options.message) this.setOfflineMessage(options.message)
  }

  setOfflineMessage(message) {
    if (!(message instanceof Buffer)) Buffer.from(message)
    this.server.setPongResponse(message)
  }

  listen() {
    return this.server.listen(packets => {
      for (const [buffer, address, guid] of packets) {
        const buf = Buffer.from(buffer)
        try {
          const id = buf[0]
          if (id < MessageID.ID_USER_PACKET_ENUM) {
            if (id === MessageID.ID_NEW_INCOMING_CONNECTION) {
              const client = new ServerClient(this, address, guid)
              this.connections.set(guid, client)
              this.emit('openConnection', client)
            } else if (id === MessageID.ID_DISCONNECTION_NOTIFICATION || id === MessageID.ID_CONNECTION_LOST || id === MessageID.ID_INCOMPATIBLE_PROTOCOL_VERSION) {
              if (this.connections.has(guid)) {
                const con = this.connections.get(guid)
                this.emit('closeConnection', con, id)
                con.neuter()
              }
              this.connections.delete(guid)
            }
          } else {
            this.emit('encapsulated', { buffer: buf, address, guid })
          }
        } catch (e) {
          console.log(e, buf)
          this.emit('error', e, buf)
        }
      }
    })
  }

  send(sendAddr, sendPort, message, priority, reliability, orderingChannel = 0, broadcast = false) {
    if (message instanceof Buffer && message.buffer.byteLength !== message.byteLength) message = new Uint8Array(message)
    const ret = this.server.send(sendAddr, parseInt(sendPort), message instanceof ArrayBuffer ? message : message.buffer, priority, reliability, orderingChannel, broadcast)
    if (ret <= 0) {
      const targetAddress = `${sendAddr}/${sendPort}`
      for (const [, conn] of this.connections) {
        if (conn.address === targetAddress) {
          conn.neuter()
          break
        }
      }
      return ret
    }
    return ret
  }

  kick(clientGuid, silent) {
    this.server.kick(clientGuid, silent)
  }
}

module.exports = { Client, Server }