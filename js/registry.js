// registry.js — camera / data-controller registry
//
// Phase 1: fetches a curated cameras.json from GitHub (read-only, public).
// Contributions go via a GitHub Issue (opens browser) — reviewed before merge.
// All lookups are anonymous; no user data is ever sent.
//
// To use your own registry repo, update REGISTRY_URL below.

const REGISTRY_URL =
    'https://raw.githubusercontent.com/idltd/cctv-sar-db/main/cameras.json';

const CACHE_KEY = 'cctv_registry_v1';
const CACHE_TTL = 12 * 60 * 60 * 1000; // 12 hours

// GitHub issue template URL
const ISSUE_BASE =
    'https://github.com/idltd/cctv-sar-db/issues/new?template=camera.yml';

export const registry = {
    cameras: [],

    async load() {
        // Serve from cache immediately, refresh in background
        const cached = this._loadCache();
        if (cached) {
            this.cameras = cached;
            this._fetchRemote().catch(() => {}); // silent background refresh
            return;
        }
        await this._fetchRemote();
    },

    async _fetchRemote() {
        // Skip if URL is still a placeholder
        if (REGISTRY_URL.includes('YOUR_USERNAME')) return; // placeholder not replaced
        const resp = await fetch(REGISTRY_URL, { cache: 'no-store' });
        if (!resp.ok) throw new Error(`Registry fetch: ${resp.status}`);
        const data = await resp.json();
        this.cameras = [...(data.cameras || []), ...this._getLocal()];
        this._saveCache(data.cameras || []);
    },

    _loadCache() {
        try {
            const raw = localStorage.getItem(CACHE_KEY);
            if (!raw) return null;
            const { data, time } = JSON.parse(raw);
            if (Date.now() - time > CACHE_TTL) return null;
            return [...data, ...this._getLocal()];
        } catch { return null; }
    },

    _saveCache(data) {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ data, time: Date.now() }));
    },

    // Haversine distance in metres
    _dist(lat1, lng1, lat2, lng2) {
        const R = 6371000;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2
            + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
            * Math.sin(dLng / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    },

    nearby(lat, lng, radiusM = 300) {
        return this.cameras
            .filter(c => c.lat && c.lng)
            .map(c => ({ ...c, distance: this._dist(lat, lng, c.lat, c.lng) }))
            .filter(c => c.distance <= radiusM)
            .sort((a, b) => a.distance - b.distance);
    },

    // User's own contributions stored locally (shown in results before GitHub merge)
    saveLocal(camera) {
        const local = this._getLocal();
        const entry = { ...camera, id: `local-${Date.now()}`, local: true };
        local.push(entry);
        localStorage.setItem('cctv_local_cameras', JSON.stringify(local));
        this.cameras.push(entry);
    },

    _getLocal() {
        try { return JSON.parse(localStorage.getItem('cctv_local_cameras') || '[]'); }
        catch { return []; }
    },

    // Open a pre-filled GitHub issue for community contribution
    openContributionIssue(camera, location) {
        const title = `Camera: ${camera.operator.name} – ${location?.road || location?.town || ''}`;
        const body = [
            `**Operator name:** ${camera.operator.name}`,
            `**ICO registration:** ${camera.operator.ico_reg || 'Unknown'}`,
            `**Privacy / DPO email:** ${camera.operator.privacy_email || 'Unknown'}`,
            `**Postal address:**\n${camera.operator.postal_address || 'Unknown'}`,
            `**Latitude:** ${location?.lat?.toFixed(6) || ''}`,
            `**Longitude:** ${location?.lng?.toFixed(6) || ''}`,
            `**Location description:** ${camera.location_desc || location?.display || ''}`,
            '',
            '*Submitted anonymously via CCTV SAR app*',
        ].join('\n');

        const url = `${ISSUE_BASE}&title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
        window.open(url, '_blank', 'noopener,noreferrer');
    },
};
