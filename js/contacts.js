/**
 * contacts.js — per-operator SAR contact history.
 *
 * Records when a SAR was sent to each operator. Used to warn the user if they
 * try to send a second SAR to the same operator within a short period, which
 * could be considered "manifestly excessive" under UK GDPR Article 12(5).
 *
 * Data stored in localStorage (small — just timestamps and counts).
 */

const CONTACT_KEY = 'sar_contact_log';

function load() {
    try {
        return JSON.parse(localStorage.getItem(CONTACT_KEY) || '{}');
    } catch {
        return {};
    }
}

function save(log) {
    localStorage.setItem(CONTACT_KEY, JSON.stringify(log));
}

/**
 * Derive a stable key for an operator.
 * Prefers the operator id from the registry (e.g. 'tesco').
 * Falls back to a slugified version of the name.
 */
export function operatorKey(camera) {
    if (camera?.operator?.id) return camera.operator.id;
    const name = camera?.operator?.name || camera?.operatorName || '';
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown';
}

/**
 * Record that a SAR was sent to an operator.
 * @param {string} key    — from operatorKey()
 * @param {string} name   — human-readable operator name
 */
export function recordSARSent(key, name) {
    const log = load();
    const existing = log[key] || { count: 0 };
    log[key] = {
        operatorName: name || key,
        lastSent:     new Date().toISOString(),
        count:        existing.count + 1,
    };
    save(log);
}

/**
 * Check if a SAR has been sent to this operator.
 * @param {string} key — from operatorKey()
 * @returns {{ lastSent: Date, daysSince: number, count: number } | null}
 */
export function getRecentSAR(key) {
    const log = load();
    const entry = log[key];
    if (!entry) return null;

    const lastSent  = new Date(entry.lastSent);
    const daysSince = Math.floor((Date.now() - lastSent.getTime()) / 86_400_000);

    return {
        operatorName: entry.operatorName,
        lastSent,
        daysSince,
        count: entry.count,
    };
}

/** Get all contact history, sorted by lastSent descending. */
export function getAllContacts() {
    const log = load();
    return Object.entries(log)
        .map(([key, v]) => ({ key, ...v, lastSent: new Date(v.lastSent) }))
        .sort((a, b) => b.lastSent - a.lastSent);
}
