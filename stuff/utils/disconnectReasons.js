'use strict'


const REASON_TEXT = {
    unknown: 'The Realm closed the connection without giving a reason.',
    cant_connect_no_internet: "The Realm's host doesn't appear to have an internet connection right now.",
    no_permissions: "You don't have permission to join that Realm.",
    unrecoverable_error: 'The Realm hit an error it could not recover from.',
    third_party_blocked: 'Xbox Live rejected the connection.',
    third_party_no_internet: "The Realm's host lost their connection to Xbox Live.",
    third_party_bad_ip: 'Xbox Live could not be reached from this network.',
    third_party_no_server_or_server_locked: 'Xbox Live has no record of that server, or it is locked.',
    version_mismatch: "Your client version doesn't match what the Realm expects.",
    skin_issue: 'The Realm rejected the skin on this account.',
    invite_session_not_found: "That invite doesn't point to an active session anymore.",
    local_server_not_found: 'The local server could not be located.',
    legacy_disconnect: 'The Realm ended the session.',
    user_leave_game_attempted: 'The connection ended because the account left the game.',
    platform_locked_skins_error: 'This skin is restricted to a single platform and was rejected.',
    realms_world_unassigned: "This Realm doesn't have a world assigned to it yet.",
    realms_server_cant_connect: 'Could not reach the Realm server.',
    realms_server_hidden: 'This Realm is currently hidden and not accepting new connections.',
    realms_server_disabled_beta: 'Realms are turned off for this beta build.',
    realms_server_disabled: 'Realms are currently disabled.',
    cross_platform_disallowed: 'Cross platform play is off, so this account cannot join.',
    cant_connect: 'Could not connect to that world.',
    session_not_found: "That Realm isn't reachable anymore, it may have been shut down or renamed.",
    client_settings_incompatible_with_server: "This client's settings aren't compatible with the Realm.",
    server_full: 'The Realm is full right now. Nothing to do but wait for a slot to open up.',
    invalid_platform_skin: 'The equipped skin is not valid on this platform.',
    edition_version_mismatch: 'This Realm needs a different edition version than what was used to connect.',
    edition_mismatch: 'This world was saved on a different edition of the game and cannot be opened here.',
    edition_mismatch_edu_to_vanilla: 'This Realm needs Minecraft Education, not the regular game.',
    edition_mismatch_vanilla_to_edu: "This Realm is running the regular game, not Minecraft Education.",
    level_newer_than_exe_version: 'This world was last saved on a newer game version than the one being used.',
    banned_skin: 'The equipped skin is banned and the Realm refused the connection.',
    timeout: 'The Realm never responded in time.',
    server_not_found: 'No server could be found at that address.',
    outdated_server: 'The Realm is running an older game version than this client expects.',
    outdated_client: 'This client is on an older game version than the Realm expects.',
    no_premium_platform: "This account's platform doesn't support Realms.",
    multiplayer_disabled: 'Multiplayer is turned off for this world.',
    no_wifi: 'No network connection was available to complete the join.',
    world_corruption: 'The world data on the Realm looks corrupted.',
    no_reason: 'The Realm ended the connection without a stated reason.',
    disconnected: 'The Realm disconnected this session.',
    invalid_player: "This account isn't allowed to join, the Realm may be set to friends only.",
    logged_in_other_location: 'This account signed in somewhere else, which ended this session.',
    server_id_conflict: 'This account is already connected to that world from another device.',
    not_allowed: "This account isn't on the Realm's invite list.",
    not_authenticated: 'Microsoft authentication failed for this join attempt.',
    invalid_tenant: 'The Realm code or ID entered does not match a real Realm.',
    unexpected_packet: 'The Realm sent data this bot did not know how to handle.',
    host_suspended: 'The Realm is temporarily unavailable.',
    resource_pack_problem: 'A resource pack required by the Realm failed to load.',
    incompatible_pack: 'The Realm requires a resource pack this client cannot use.',
    out_of_storage: 'The Realm ran out of storage while setting up the session.',
    invalid_level: 'The Realm reported an invalid world.',
    block_mismatch: "The block data this bot has doesn't line up with what the Realm sent.",
    invalid_heights: 'The Realm sent world height values this bot could not use.',
    invalid_widths: 'The Realm sent world size values this bot could not use.',
    connection_lost: 'The connection to the Realm dropped unexpectedly.',
    zombie_connection: 'The connection stopped responding and was closed.',
    shutdown: 'The Realm shut down while this session was active.',
    server_shutdown: 'The Realm shut down while this session was active.',
    host_disconnected: 'The Realm owner disconnected, which ended this session.',
    loading_state_timeout: 'The world took too long to load and the attempt timed out.',
    resource_pack_loading_failed: 'A resource pack failed to download.',
    kicked: 'This account was kicked from the Realm.',
    kicked_for_exploit: 'This account was kicked for triggering an exploit check.',
    kicked_for_idle: 'This account was kicked for being idle.',
    deny_listed: 'This account is on the Realm\'s block list.',
    expired_token: 'The login token expired before the join finished, try again.',
    nonce_missing: 'The Realm rejected the login handshake, try again.',
    nonce_not_found: 'The Realm rejected the login handshake, try again.',
    nonce_expired: 'The login handshake expired, try again.',
    nonce_not_valid: 'The Realm rejected the login handshake, try again.',
    guest_withough_host: 'The Realm owner was not present, so guests could not join.',
    async_join_task_denied: 'The Realm refused this join request.',
    realms_timeline_required: 'This Realm requires story/timeline data this bot does not send.',
    failed_to_join_experience: 'Joining this experience failed on the Realm side.',
    host_signed_out: 'The Realm owner signed out, ending every active session.',
    script_watchdog_exception: 'The Realm shut down after a script error.',
    script_memory_limit_exceeded: 'The Realm shut down after a script used too much memory.',
    storage_low_during_gameplay: 'The Realm is low on storage.',
    storage_full_during_gameplay: 'The Realm ran out of storage.',
    level_storage_corruption: "The Realm's world storage looks corrupted.",
    editor_mismatch_editor_to_vanilla: 'This world is an editor project and cannot be joined normally.',
    editor_mismatch_vanilla_to_editor: 'This Realm is running in editor mode.',
    not_authenticated_fast_fail: 'Microsoft authentication failed immediately, the linked account may need to be relinked.',
    reason_not_set: 'The Realm closed the connection without giving a reason.',
}

const NETHERNET_PREFIX = 'conn_'
const NETHERNET_TEXT = 'The peer to peer connection to the Realm could not be established.'

const FALLBACK_TEXT = 'The Realm closed the connection and did not give a reason this bot recognizes.'

function describeDisconnect(data) {
    if (!data) return FALLBACK_TEXT
    if (typeof data.message === 'string' && data.message.trim().length > 0) {
        return data.message.trim()
    }

    const reason = typeof data.reason === 'string' ? data.reason : null
    if (!reason) return FALLBACK_TEXT
    if (REASON_TEXT[reason]) return REASON_TEXT[reason]
    if (reason.startsWith(NETHERNET_PREFIX)) return NETHERNET_TEXT

    return FALLBACK_TEXT
}

module.exports = { describeDisconnect, REASON_TEXT }