// registry.js — camera / data-controller registry (Supabase + PostGIS backend)
//
// Geo queries run server-side: only cameras within the search radius are returned.
// Contributions POST directly to pending_cameras — no GitHub account required.
// All reads use the anon publishable key (read-only by RLS policy).
// Personal data never leaves the device.

const SUPABASE_URL  = 'https://lyijydkwitjxbcxurkep.supabase.co';
const SUPABASE_ANON = 'sb_publishable_76OCkNOt11LlRioAKBwFFg_tBDUKVO6';

const CACHE_KEY = 'cctv_registry_v3';
const CACHE_TTL = 12 * 60 * 60 * 1000; // 12 hours

export const registry = {

    // load() is now a no-op — geo queries happen inside nearby()
    async load() {},

    // Returns cameras within radiusM metres of lat/lng, with operator details embedded.
    // Tries Supabase first; falls back to the local cache when offline.
    async nearby(lat, lng, radiusM = 300) {
        try {
            const results = await this._fetchFromSupabase(lat, lng, radiusM);
            this._saveCache(results);
            return [...results, ...this._getLocal()];
        } catch {
            const cached = this._loadCache();
            if (cached) {
                return [...this._distFilter(cached, lat, lng, radiusM), ...this._getLocal()];
            }
            return this._getLocal();
        }
    },

    async _fetchFromSupabase(lat, lng, radiusM) {
        const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/cameras_within`, {
            method: 'POST',
            headers: {
                'apikey':         SUPABASE_ANON,
                'Authorization':  `Bearer ${SUPABASE_ANON}`,
                'Content-Type':   'application/json',
            },
            body: JSON.stringify({ user_lat: lat, user_lng: lng, radius_m: radiusM }),
        });
        if (!resp.ok) throw new Error(`Supabase RPC: ${resp.status}`);
        const rows = await resp.json();
        // Normalise to the shape the rest of the app expects
        return rows.map(r => ({
            id:            r.id,
            lat:           r.lat,
            lng:           r.lng,
            location_desc: r.location_desc,
            distance:      r.distance_m,
            operator_id:   r.operator_id,
            operator: {
                name:           r.operator_name,
                ico_reg:        r.ico_reg        || '',
                privacy_email:  r.privacy_email  || '',
                postal_address: r.postal_address || '',
            },
        }));
    },

    _loadCache() {
        try {
            const raw = localStorage.getItem(CACHE_KEY);
            if (!raw) return null;
            const { data, time } = JSON.parse(raw);
            if (Date.now() - time > CACHE_TTL) return null;
            return data;
        } catch { return null; }
    },

    _saveCache(data) {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ data, time: Date.now() }));
    },

    // Haversine — used only for offline cache fallback
    _dist(lat1, lng1, lat2, lng2) {
        const R = 6371000;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2
            + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
            * Math.sin(dLng / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    },

    _distFilter(cameras, lat, lng, radiusM) {
        return cameras
            .map(c => ({ ...c, distance: this._dist(lat, lng, c.lat, c.lng) }))
            .filter(c => c.distance <= radiusM)
            .sort((a, b) => a.distance - b.distance);
    },

    // User's own manually-entered cameras — stored locally, appear immediately
    saveLocal(camera) {
        const local = this._getLocal();
        const entry = { ...camera, id: `local-${Date.now()}`, local: true };
        local.push(entry);
        localStorage.setItem('cctv_local_cameras', JSON.stringify(local));
        return entry;
    },

    _getLocal() {
        try { return JSON.parse(localStorage.getItem('cctv_local_cameras') || '[]'); }
        catch { return []; }
    },

    // Returns all operators with their camera count, for the registry browser.
    async browse() {
        const resp = await fetch(
            `${SUPABASE_URL}/rest/v1/operators` +
            `?select=name,ico_reg,cameras(count)&order=name.asc`, {
            headers: {
                'apikey':        SUPABASE_ANON,
                'Authorization': `Bearer ${SUPABASE_ANON}`,
            },
        });
        if (!resp.ok) throw new Error(`Registry browse: ${resp.status}`);
        const rows = await resp.json();
        return rows.map(r => ({
            name:         r.name,
            ico_reg:      r.ico_reg || '',
            camera_count: r.cameras?.[0]?.count ?? 0,
        }));
    },

    // Submit a camera contribution to Supabase pending_cameras.
    // No GitHub account required — reviewed in the Supabase dashboard.
    async submitContribution(camera, location) {
        const body = {
            lat:            +(location?.lat?.toFixed(6) ?? 0),
            lng:            +(location?.lng?.toFixed(6) ?? 0),
            location_desc:  camera.location_desc || location?.display || '',
            operator_name:  camera.operator?.name          || '',
            ico_reg:        camera.operator?.ico_reg        || null,
            privacy_email:  camera.operator?.privacy_email  || null,
            postal_address: camera.operator?.postal_address || null,
        };
        const resp = await fetch(`${SUPABASE_URL}/rest/v1/pending_cameras`, {
            method: 'POST',
            headers: {
                'apikey':        SUPABASE_ANON,
                'Authorization': `Bearer ${SUPABASE_ANON}`,
                'Content-Type':  'application/json',
                'Prefer':        'return=minimal',
            },
            body: JSON.stringify(body),
        });
        if (!resp.ok) throw new Error(`Contribution submit: ${resp.status}`);
    },
};
