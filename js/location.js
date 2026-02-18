// location.js — GPS + Nominatim reverse geocoding (free, no API key, CORS-open)

export const loc = {
    coords: null,
    address: null,

    getPosition() {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                reject(new Error('Geolocation is not supported by this browser'));
                return;
            }
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    this.coords = {
                        lat: pos.coords.latitude,
                        lng: pos.coords.longitude,
                        accuracy: Math.round(pos.coords.accuracy),
                    };
                    resolve(this.coords);
                },
                (err) => reject(new Error(err.message)),
                { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
            );
        });
    },

    async reverseGeocode(lat, lng) {
        // Nominatim usage policy: max 1 req/sec, include a descriptive User-Agent
        const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
        const resp = await fetch(url, {
            headers: {
                'Accept-Language': 'en-GB,en',
                'User-Agent': 'CCTV-SAR-App/1.0 (https://github.com/idltd/CCTV-Log)',
            },
        });
        if (!resp.ok) throw new Error(`Geocode failed: ${resp.status}`);
        const data = await resp.json();

        const a = data.address || {};
        this.address = {
            display: data.display_name || '',
            road:     a.road || a.pedestrian || a.path || '',
            postcode: a.postcode || '',
            town:     a.town || a.city || a.village || a.suburb || '',
            county:   a.county || '',
        };
        return this.address;
    },

    async geocodePostcode(postcode) {
        const q = encodeURIComponent(postcode.trim());
        const url = `https://nominatim.openstreetmap.org/search?q=${q}&countrycodes=gb&format=json&limit=1&addressdetails=1`;
        const resp = await fetch(url, {
            headers: {
                'Accept-Language': 'en-GB,en',
                'User-Agent': 'CCTV-SAR-App/1.0 (https://github.com/idltd/CCTV-Log)',
            },
        });
        if (!resp.ok) throw new Error(`Postcode lookup failed: ${resp.status}`);
        const results = await resp.json();
        if (!results.length) throw new Error('Postcode not found');

        const r = results[0];
        const a = r.address || {};
        this.coords = {
            lat: parseFloat(r.lat),
            lng: parseFloat(r.lon),
            accuracy: 100, // postcode-level accuracy
        };
        this.address = {
            display: `Near ${postcode.toUpperCase()}`,
            road:     a.road || a.pedestrian || a.path || '',
            postcode: a.postcode || postcode.toUpperCase(),
            town:     a.town || a.city || a.village || a.suburb || '',
            county:   a.county || '',
        };
        return { ...this.coords, ...this.address };
    },
};
