"use strict";

const fs = require("fs");
const path = require("path");
const { v4 } = require("uuid");

const { createClient } = require("../src/createClient");
const {
    deviceMapping,
    generateRandomString,
    getDeviceId,
    getInputMode
} = require("./bpUtil");

const steveSkinPath = path.join(__dirname, "../src", "skins", "steve.json");
let steveSkin = {};
try {
    steveSkin = JSON.parse(fs.readFileSync(steveSkinPath, "utf8"));
} catch {
    console.warn("[bpClient] steve.json not found at", steveSkinPath);
}

class bpClient {
    constructor(address, dbUser, server, configuration = {}) {
        this.address = address;
        this.dbUser = dbUser;
        this.server = server;
        this.configuration = configuration;
        this.clients = [];
        this.userFlow = deviceMapping["iOS"];
    }
    validate() {
        const transport = this.configuration.transport || "DEFAULT";
        switch (transport) {
            case "DEFAULT":
                if (!this.address.ip || !this.address.port) return "No IP/Port";
                if (typeof this.address.port !== "number") return "Bad Port";
                break;
            case "NETHERNET":
            case "NETHERNET_JSONRPC":
                if (typeof this.address.networkId !== "string") return "No Nethernet Network ID";
                break;
            default:
                return "Unsupported Network Protocol";
        }
        return null;
    }
    #prepareOptions() {
        const {
            transport = "DEFAULT",
            worldtype = "Realm",
            clienttype = "Online",
            offlineprofile = { name: "Test", xuid: "", uuid: v4() },
            world = { world: null },
            useSignalling = true,
            wsCrash = { enabled: true, type: 1 },
        } = this.configuration;
        const deviceOS = this.userFlow.deviceOS;
        return {
            host: this.address.ip,
            port: this.address.port,
            transport,
            networkId: transport.startsWith("NETHERNET") ? this.address.networkId : "",
            version: this.configuration.version || "1.26.30",
            authflow: this.dbUser.authflow,
            authTitle: this.userFlow.authTitle,
            deviceType: this.userFlow.deviceType,
            flow: this.userFlow.flow,
            crash: wsCrash.enabled ? { enabled: true, type: wsCrash.type || 1 } : { enabled: false },
            offlineprofile,
            worldtype,
            ...world,
            clienttype,
            useSignalling,
            userFlow: this.userFlow,
            userId: this.dbUser.discordId,
            skinData: {
                ...steveSkin,
                ClientRandomId: Number(generateRandomString(19, "1234567890")),
                CurrentInputMode: getInputMode(deviceOS),
                DefaultInputMode: getInputMode(deviceOS),
                DeviceModel: this.userFlow.deviceModel,
                DeviceOS: deviceOS,
                DeviceId: getDeviceId(deviceOS),
                GUIScale: 0,
                LanguageCode: "en_US",
                OverrideSkin: false,
                PlatformOnlineId: deviceOS === 2 ? generateRandomString(19, "1234567890") : "",
                SelfSignedId: v4(),
                UIProfile: this.userFlow.UIProfile,
                MaxViewDistance: this.userFlow.maxViewDistance,
                MemoryTier: this.userFlow.memoryTier,
                PlatformType: this.userFlow.platformType,
                GraphicsMode: ~~(Math.random() * 2),
                TrustedSkin: true,
            },
        };
    }
    async connect() {
        const validationError = this.validate();
        if (validationError) return validationError;
        const { count = 1 } = this.configuration;
        const spawnClient = async () => {
            const options = this.#prepareOptions();
            const client = createClient(options);
            client.wasKicked = false;
            client.localIntervals = [];
            client.connectGraceTimer = setTimeout(() => {
                client.connectGraceTimer = null;
            }, 15000);
            this.#registerListeners(client);
            this.clients.push(client);
            return client;
        };

        try {
            if (count > 1) {
                return await Promise.all(Array(count).fill(0).map(() => spawnClient()));
            } else {
                return await spawnClient();
            }
        } catch (err) {
            this.#cleanupAll();
            throw err;
        }
    }
    #registerListeners(client) {
        client._disconnect = client.disconnect;
        client.disconnect = () => this.disconnect(client);
        client.once("kick", (data) => {
            if (client.wasKicked) return;
            console.log("[bpClient] kick:", data);
            this.disconnect(client);
        });
        client.on("error", (error) => {
            if (client.wasKicked) return;
            if (error?.partialReadError || /read error|partial|incomplete/i.test(String(error?.message || error))) {
                console.warn("[bpClient:recoverable]", error?.message || error);
                return;
            }
            client.emit("kick", { message: String(error?.message || error) });
        });
        client.on("close", () => {
            if (client.wasKicked) return;
            if (client.connectGraceTimer) return;
            client.emit("kick", { message: "Connection closed unexpectedly" });
        });
        client.once("start_game", (packet) => {
            client.plrRuntimeID = packet.runtime_entity_id;
            client.currentPos = packet.player_position;
            client.write("serverbound_loading_screen", { type: 2 });
            client.write("set_local_player_as_initialized", { runtime_entity_id: packet.runtime_entity_id });
            if (client.connectGraceTimer) {
                clearTimeout(client.connectGraceTimer);
                client.connectGraceTimer = null;
            }

            client.on("respawn", (data) => {
                switch (data.state) {
                    case 0:
                        client.write("respawn", {
                            runtime_entity_id: packet.runtime_entity_id,
                            state: 2,
                            position: client.currentPos,
                        });
                        break;
                    case 1:
                        client.write("player_action", {
                            runtime_entity_id: packet.runtime_entity_id,
                            action: "respawn",
                            position: client.currentPos,
                            result_position: client.currentPos,
                            face: -1,
                        });
                        break;
                }
            });
        });
        client.on("move_player", (packet) => {
            if (packet.runtime_id === Number(client.plrRuntimeID)) client.currentPos = packet.position;
        });
    }

    disconnect(client) {
        const targets = client ? [client] : [...this.clients];
        targets.forEach((c) => {
            if (c.localIntervals) c.localIntervals.forEach(clearInterval);
            if (c.connectGraceTimer) {
                clearTimeout(c.connectGraceTimer);
                c.connectGraceTimer = null;
            }
            if (c.wasKicked) return;
            c.wasKicked = true;
            try { c._disconnect(); } catch {}
            const idx = this.clients.indexOf(c);
            if (idx > -1) this.clients.splice(idx, 1);
        });
        if (this.clients.length === 0) this.#cleanupAll();
    }
    #cleanupAll() {
        this.clients = [];
    }
}

module.exports = bpClient;