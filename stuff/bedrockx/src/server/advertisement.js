class NethernetServerAdvertisement {
  version = 4
  motd = 'Bedrock Protocol Server'
  levelName = 'bedrock-protocol'
  gamemodeId = 0
  playerCount = 1
  playersMax = 8
  isEditorWorld = false
  hardcore = false
  unknown1 = 4
  unknown2 = 8

  constructor(obj) {
    Object.assign(this, obj)
  }

  static fromBuffer(buffer) {
    const advertisement = new NethernetServerAdvertisement()
    let offset = 0

    advertisement.version = buffer.readUInt8(offset++)

    const motdLength = buffer.readUInt8(offset++)
    advertisement.motd = buffer.toString('utf8', offset, offset + motdLength)
    offset += motdLength

    const levelNameLength = buffer.readUInt8(offset++)
    advertisement.levelName = buffer.toString('utf8', offset, offset + levelNameLength)
    offset += levelNameLength

    advertisement.gamemodeId = buffer.readUInt8(offset++)

    advertisement.playerCount = buffer.readInt32LE(offset)
    offset += 4

    advertisement.playersMax = buffer.readInt32LE(offset)
    offset += 4

    if (offset < buffer.length) {
      advertisement.isEditorWorld = buffer.readUInt8(offset++) === 1
    }

    if (offset < buffer.length) {
      advertisement.hardcore = buffer.readUInt8(offset++) === 1
    }

    if (offset < buffer.length) {
      advertisement.unknown1 = buffer.readUInt8(offset++)
    }

    if (offset < buffer.length) {
      advertisement.unknown2 = buffer.readUInt8(offset++)
    }

    return advertisement
  }

  toBuffer() {
    const motdBuffer = Buffer.from(this.motd, 'utf8')
    const levelNameBuffer = Buffer.from(this.levelName, 'utf8')

    const buffers = []

    buffers.push(Buffer.from([this.version]))

    buffers.push(Buffer.from([motdBuffer.length]))
    buffers.push(motdBuffer)

    buffers.push(Buffer.from([levelNameBuffer.length]))
    buffers.push(levelNameBuffer)

    buffers.push(Buffer.from([this.gamemodeId]))

    const playerCountBuffer = Buffer.alloc(4)
    playerCountBuffer.writeInt32LE(this.playerCount, 0)
    buffers.push(playerCountBuffer)

    const playersMaxBuffer = Buffer.alloc(4)
    playersMaxBuffer.writeInt32LE(this.playersMax, 0)
    buffers.push(playersMaxBuffer)

    buffers.push(Buffer.from([this.isEditorWorld ? 1 : 0]))

    buffers.push(Buffer.from([this.hardcore ? 1 : 0]))

    buffers.push(Buffer.from([this.unknown1]))
    buffers.push(Buffer.from([this.unknown2]))

    return Buffer.concat(buffers)
  }
}

class ServerAdvertisement {
  motd = 'Bedrock Protocol Server'
  levelName = 'bedrock-protocol'
  playersOnline = 0
  playersMax = 5
  gamemode = 'Creative'
  serverId = Date.now().toString()
  gamemodeId = 1
  portV4 = undefined
  portV6 = undefined

  constructor(obj, port, version = "1.26.40") {
    if (obj?.name) obj.motd = obj.name
    this.protocol = 2168
    this.version = version
    this.portV4 = port
    this.portV6 = port
    Object.assign(this, obj)
  }

  fromString(str) {
    const [header, motd, protocol, version, playersOnline, playersMax, serverId, levelName, gamemode, gamemodeId, portV4, portV6] = str.split(';')
    Object.assign(this, { header, motd, protocol, version, playersOnline, playersMax, serverId, levelName, gamemode, gamemodeId, portV4, portV6 })
    for (const numeric of ['playersOnline', 'playersMax', 'gamemodeId', 'portV4', 'portV6']) {
      if (this[numeric] !== undefined) {
        this[numeric] = this[numeric] ? parseInt(this[numeric]) : null
      }
    }
    return this
  }

  toString() {
    return [
      'MCPE',
      this.motd,
      this.protocol,
      this.version,
      this.playersOnline,
      this.playersMax,
      this.serverId,
      this.levelName,
      this.gamemode,
      this.gamemodeId,
      this.portV4,
      this.portV6,
      '0'
    ].join(';') + ';'
  }

  toBuffer(version) {
    const str = this.toString(version)
    const length = Buffer.byteLength(str)
    const buf = Buffer.alloc(2 + length)
    buf.writeUInt16BE(length, 0)
    buf.write(str, 2)
    return buf
  }
}

module.exports = {
  ServerAdvertisement,
  NethernetServerAdvertisement,
  getServerName(client) {
    return new ServerAdvertisement().toBuffer()
  },
  fromServerName(string) {
    return new ServerAdvertisement().fromString(string)
  }
}