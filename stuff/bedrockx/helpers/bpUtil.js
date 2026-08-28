"use strict";

const { v4 } = require("uuid");

const deviceMapping = {
    iOS: {
        flow: "sisu",
        authTitle: require("prismarine-auth").Titles.MinecraftIOS,
        deviceType: "iOS",
        deviceOS: 2,
        maxViewDistance: 18,
        memoryTier: 5,
        platformType: 1,
        UIProfile: 1,
        scid: "00000000-0000-0000-0000-00006bf082d7",
        deviceModel: "iPhone14,3",
        userAgent: "MCPE/iOS",
        titleId: "1810924247",
        deviceVersion: "0.0.0"
    },
    Android: {
        flow: "sisu",
        authTitle: require("prismarine-auth").Titles.MinecraftAndroid,
        deviceType: "Android",
        deviceOS: 1,
        maxViewDistance: 10,
        memoryTier: 3,
        platformType: 1,
        UIProfile: 1,
        scid: "00000000-0000-0000-0000-000067b57dac",
        deviceModel: "SAMSUNG SM-G955U",
        userAgent: "MCPE/Android",
        titleId: "1739947436",
        deviceVersion: "0.0.0"
    }
};

function generateRandomString(length, characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz1234567890_-") {
    const array = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
        array[i] = characters.charCodeAt(~~(Math.random() * characters.length));
    }
    return Buffer.from(array).toString();
}

function getDeviceId(deviceOS = 2) {
    if (deviceOS === 2) return v4().replace(/-/g, "").toUpperCase();
    return v4().replace(/-/g, "");
}

function getInputMode(deviceOS) {
    const map = {
        10: 3, 11: 3, 12: 3, 13: 3,
        1: 2, 2: 2, 4: 2, 14: 2,
        3: 1, 7: 1, 8: 1, 15: 1,
        5: 4, 6: 4,
        9: 0, 0: 0
    };
    return map[deviceOS] || 2;
}

function translateDisconnectMessage(disconnect) {
    if (!disconnect) return "Connection closed unexpectedly";
    const msg = disconnect.message || disconnect.reason || "Connection closed unexpectedly";
    return String(msg).replace(/§./g, "").replace(/%/g, "");
}

function cleanLeftovers(intervals, timeouts = []) {
    try {
        intervals.forEach(clearInterval);
        timeouts.forEach(clearTimeout);
    } catch {}
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
    deviceMapping,
    generateRandomString,
    getDeviceId,
    getInputMode,
    translateDisconnectMessage,
    cleanLeftovers,
    delay
};
