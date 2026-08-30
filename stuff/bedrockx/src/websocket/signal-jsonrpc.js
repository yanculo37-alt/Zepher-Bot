const { EventEmitter, once } = require('node:events')
const { WebSocket } = require('ws')
const { SignalStructure } = require('../nethernet/index')
const { v4fast: v4 } = require("uuid-1345")
const JSONBigInt = require('json-bigint')({ useNativeBigInt: true })

const BASE_DELAY_MS = 15000
const MAX_DELAY_MS = 5 * 60 * 1000
const RATE_LIMIT_MIN_DELAY_MS = 60000

const LOG_EVERY_N_AFTER = 5

function backoffDelay(retryCount, rateLimited) {
    const exponential = BASE_DELAY_MS * Math.pow(2, Math.min(retryCount, 10))
    const jitter = 0.85 + Math.random() * 0.3
    let delay = Math.min(exponential * jitter, MAX_DELAY_MS)
    if (rateLimited) delay = Math.max(delay, RATE_LIMIT_MIN_DELAY_MS)
    return Math.round(delay)
}

class NethernetJSONRPC extends EventEmitter {
    constructor(networkId, authflow, version, serverNetworkId) {
        super()
        this.networkId = networkId
        this.serverNetworkId = serverNetworkId
        this.authflow = authflow
        this.version = version
        this.ws = null
        this.credentials = []
        this.candidates = []
        this.signalCandidates = []

        this.pingInterval = null
        this.retryCount = 0
        this.destroyed = false
        this.lastLiveness = 0
        this.connectionId = null
        this.didSendCandidates = false

        this.rateLimited = false
        this.retryAfterMs = null
    }

    async connect() {
        if (this.ws?.readyState === WebSocket.OPEN) throw new Error('Already connected signaling server');
        this.destroyed = false

        await this.init()
        await Promise.race([
            once(this, "credentials"),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out waiting for TURN credentials from the NetherNet signalling server')), 15000))
        ])
    }

    async destroy(resume = false) {
        this.destroyed = !resume

        if (this.pingInterval) {
            clearInterval(this.pingInterval)
            this.pingInterval = null
        }

        const ws = this.ws
        this.ws = null

        if (ws) {
            ws.removeAllListeners("open")
            ws.removeAllListeners("close")
            ws.removeAllListeners("error")
            ws.removeAllListeners("message")

            if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                await new Promise((resolve) => {
                    const done = () => resolve()

                    ws.once("close", done)

                    try {
                        ws.close(1000, "Normal Closure")
                    } catch {
                        resolve()
                    }
                })
            }
        }

        if (resume) return this.reconnectWithBackoff()
    }

    async reconnectWithBackoff() {
        if (this.destroyed) return

        const delay = this.retryAfterMs ?? backoffDelay(this.retryCount, this.rateLimited)
        this.retryAfterMs = null

        if (this.shouldLogAttempt()) {
            const reason = this.rateLimited ? 'rate limited (429)' : 'connection lost'
            console.warn(`[nethernet-signal] Reconnecting in ${Math.round(delay / 1000)}s (${reason}, attempt ${this.retryCount})`)
        }

        await new Promise((r) => setTimeout(r, delay));

        if (this.destroyed) return

        try {
            await this.init();
        } catch (e) {
            if (this.shouldLogAttempt()) {
                console.error(`[nethernet-signal] Reconnect attempt ${this.retryCount} failed: ${e?.message ?? e}`)
            }
            this.reconnectWithBackoff().catch(() => {})
        }
    }

    shouldLogAttempt() {
        return this.retryCount <= LOG_EVERY_N_AFTER || this.retryCount % LOG_EVERY_N_AFTER === 0
    }

    async init() {
        const xbl = await this.authflow.getMinecraftBedrockServicesToken({ version: this.version })

        const address = `https://signal.franchise.minecraft-services.net/ws/v1.0/messaging/connect`;

        try {
            const ws = new WebSocket(address, { headers: { Authorization: xbl.mcToken, "session-id": v4(), "request-id": v4() } })
            this.ws = ws
            this.lastLiveness = Date.now()

            ws.on("unexpected-response", (req, res) => {
                this.rateLimited = res.statusCode === 429
                const retryAfterHeader = res.headers?.['retry-after']
                this.retryAfterMs = retryAfterHeader ? parseRetryAfter(retryAfterHeader) : null
                if (this.shouldLogAttempt()) {
                    console.warn(`[nethernet-signal] Signalling server responded ${res.statusCode}${this.rateLimited ? ' (rate limited)' : ''}`)
                }
                res.resume()
                ws.terminate()
            })

            ws.on("open", () => this.onOpen())
            ws.on("close", (code, reason) => this.onClose(code, reason.toString()))
            ws.on("error", (err) => this.onError(err))
            ws.on("message", (data) => this.onMessage(data))

            if (!this.pingInterval) {
                this.pingInterval = setInterval(() => {
                    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return

                    this.ws.send(JSON.stringify({ params: {}, jsonrpc: "2.0", method: "System_Ping_v1_0", id: v4() }))

                    if (Date.now() - this.lastLiveness > 60000) {
                        try {
                            this.ws.terminate?.()
                        } catch { }
                    }
                }, 2000)
            }
        } catch (error) {
            this.emit("error", error)
        }
    }

    onOpen() {
        this.retryCount = 0
        this.rateLimited = false
        this.retryAfterMs = null
        this.lastLiveness = Date.now()
        this.ws.send(JSON.stringify({
            params: {},
            jsonrpc: "2.0",
            method: "Signaling_TurnAuth_v1_0",
            id: v4()
        }))
    }

    onError(err) {
        const message = err?.message ?? String(err)
        if (!/unexpected server response: 429/i.test(message) && this.shouldLogAttempt()) {
            console.error(`[nethernet-signal] Socket error: ${message}`)
        }

        if (this.listenerCount("error") > 0) {
            this.emit("error", err instanceof Error ? err : new Error(String(err)))
        }
    }

    async onClose(code, reason) {
        if (this.ws === null && this.pingInterval) {
            clearInterval(this.pingInterval)
            this.pingInterval = null
        }

        if (this.destroyed) return

        this.retryCount++
        try {
            await this.destroy(true)
        } catch (err) {
            if (this.shouldLogAttempt()) {
                console.error(`[nethernet-signal] Error while reconnecting: ${err?.message ?? err}`)
            }
            this.reconnectWithBackoff().catch(() => {})
        }
    }

    onMessage(res) {
        this.lastLiveness = Date.now()

        let message = null

        try {
            if (typeof res === "string") {
                message = JSON.parse(res)
            } else if (Buffer.isBuffer(res)) {
                message = JSON.parse(res.toString("utf8"))
            } else {
                return
            }
        } catch (error) {
            return
        }

        if (Array.isArray(message.result?.TurnAuthServers)) {
            this.credentials = parseTurnServers(JSON.stringify(message.result))
            this.emit("credentials", this.credentials)
        }

        switch (message.method) {
            case "System_Pong_v1_0":
                this.ws.send(JSON.stringify({ id: message.id, result: null, jsonrpc: "2.0" }))
                break
            case "Signaling_ReceiveMessage_v1_0":
                this.ws.send(JSON.stringify({ id: message.id, result: null, jsonrpc: "2.0" }))
                const params = Array.isArray(message.params)? message.params : message.params ? [message.params]: []
                for (const param of params) {
                    this.sendDeliveryNotification(param.From, param.Id)
                    let signalMessage = param.Message
                    try {
                        const parsed = JSON.parse(param.Message)

                        switch (parsed.method) {
                            case "Signaling_WebRtc_v1_0":
                                if (parsed.params?.message) signalMessage = parsed.params.message
                                break
                            case "Signaling_DeliveryNotification_V1_0":
                                continue
                        }
                    } catch (e) {
                        console.error(e)
                    }

                    if (signalMessage.includes("could not be delivered")) continue

                    let signal = SignalStructure.fromString(signalMessage)
                    signal.connectionId = BigInt(signal.connectionId)
                    signal.networkId = this.networkId
                    signal.serverNetworkId = param.From ?? this.serverNetworkId

                    if (signal.type === "CANDIDATEADD") {
                        signal.data += " network-cost 10";

                        if (!this.didSendCandidates) {
                            this.signalCandidates.push(signal);
                            return
                        }
                    }

                    if (
                        signal.type === "CONNECTRESPONSE" &&
                        signal.connectionId === this.connectionId &&
                        !this.didSendCandidates
                    ) {
                        for (const candidate of this.candidates) {
                            this.write(candidate)
                        }

                        for (const signalCandidate of this.signalCandidates) {
                            this.emit("signal", signalCandidate)
                        }

                        this.didSendCandidates = true
                    }

                    this.emit("signal", signal)
                }
                break
            default:
                break
        }
    }

    write(signal) {
        if (!this.ws) throw new Error('WebSocket not connected')

        let uuidv4 = v4()

        if (signal.type === "CANDIDATEADD" && !this.candidates.includes(signal)) {
            this.candidates.length === 0 ? signal.data += " network-cost 50" : signal.data += " network-cost 10"

            if (signal.data.includes("tcp") || signal.data.includes("::1") || signal.data.includes("127.0.0.1")) return;

            this.candidates.push(signal)
            return
        }

        if (signal.type === "CONNECTREQUEST") this.connectionId = signal.connectionId

        const message = JSONBigInt.stringify({
            params: {
                toPlayerId: String(signal.serverNetworkId ?? this.serverNetworkId),
                messageId: uuidv4,
                message: JSONBigInt.stringify({
                    params: {
                        netherNetId: String(signal.networkId),
                        message: signal.toString(),
                    },
                    jsonrpc: "2.0",
                    method: "Signaling_WebRtc_v1_0",
                })
            },
            jsonrpc: "2.0",
            method: "Signaling_SendClientMessage_v1_0",
            id: uuidv4
        })

        this.ws.send(message)
    }

    sendDeliveryNotification(toPlayerId, messageId) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return

        const uuidv4 = v4()
        const message = JSONBigInt.stringify({
            params: {
                toPlayerId,
                messageId: uuidv4,
                message: JSONBigInt.stringify({
                    params: {
                        messageId
                    },
                    jsonrpc: "2.0",
                    method: "Signaling_DeliveryNotification_V1_0"
                })
            },
            jsonrpc: "2.0",
            method: "Signaling_SendClientMessage_v1_0",
            id: uuidv4
        })

        this.ws.send(message)
    }
}

module.exports = { NethernetJSONRPC }

function parseTurnServers(dataString) {
    const iceServers = []
    const TurnAuthServers = JSON.parse(dataString)?.TurnAuthServers ?? []

    for (const server of TurnAuthServers) {
        const urls = server?.Urls ?? []
        const username = typeof server?.Username === "string" ? server.Username : undefined
        const credential = typeof server?.Password === "string" ? server.Password : (typeof server?.Credential === "string" ? server.Credential : undefined)

        for (const rawUrl of urls) {
            const parsedUrl = parseIceUrl(rawUrl)
            if (!parsedUrl) continue

            const urlCandidates = new Set([formatIceUrl(parsedUrl)])

            if (parsedUrl.isTurn) {
                if (parsedUrl.transport !== "tcp") urlCandidates.add(formatIceUrl({ ...parsedUrl, transport: "udp" }))
                if (parsedUrl.scheme !== "turns") urlCandidates.add(formatIceUrl({ ...parsedUrl, scheme: "turns", port: 5349, transport: "udp" }))
            }

            for (const url of urlCandidates) {
                parsedUrl.isTurn ? iceServers.push({ urls: url, username, credential }) : iceServers.push({ urls: url })
            }
        }
    }

    return iceServers
}

function parseIceUrl(url) {
    const match = url.trim().match(/^(?<scheme>stuns?|turns?)(?::\/\/|:)?(?<host>[^:?\s]+)(?::(?<port>\d+))?(?:\?(?<query>.*))?$/i)
    if (!match || !match.groups) return null

    const scheme = match.groups.scheme.toLowerCase()
    const hostname = match.groups.host
    const port = match.groups.port ? parseInt(match.groups.port, 10) : defaultPortForScheme(scheme)

    if (!hostname || Number.isNaN(port)) return null

    const isTurn = scheme.startsWith("turn")

    let transport
    if (scheme === "turns") transport = "tcp"

    if (isTurn) transport = match.groups.query?.split("&").find(param => param.startsWith("transport="))?.split("=")[1] ?? "udp"
    if (!transport) transport = "udp"

    return { scheme, hostname, port, transport, isTurn }
}

function formatIceUrl(parsed) {
    const protocol = parsed.scheme
    const base = `${protocol}:${parsed.hostname}:${parsed.port}`

    if (!parsed.isTurn) return base

    return `${base}?transport=${parsed.transport ?? "udp"}`
}

function defaultPortForScheme(scheme) {
    return scheme === "stuns" ? 3478 : 5349
}

function parseRetryAfter(headerValue) {
    const seconds = Number(headerValue)
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)

    const date = Date.parse(headerValue)
    if (!Number.isNaN(date)) return Math.max(0, date - Date.now())

    return null
}
