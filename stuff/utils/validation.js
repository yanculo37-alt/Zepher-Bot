function isValidRealmCode(code) {
    return typeof code === 'string' && /^[a-zA-Z0-9_-]{6,17}$/.test(code.trim())
}

function isValidRealmId(id) {
    return typeof id === 'string' && /^[0-9]+$/.test(id.trim())
}

module.exports = { isValidRealmCode, isValidRealmId }