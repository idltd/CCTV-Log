/**
 * log.js — IndexedDB wrapper for the on-device incident log.
 *
 * Each incident represents one CCTV camera encounter:
 *   - captured in the field (status: 'captured')
 *   - SAR sent (status: 'sent')
 *
 * All data stays on-device. Nothing is transmitted.
 */

const DB_NAME    = 'cctv_log';
const DB_VERSION = 1;
const STORE      = 'incidents';

let _dbPromise = null;

function openDB() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);

        req.onupgradeneeded = e => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE)) {
                const store = db.createObjectStore(STORE, { keyPath: 'id' });
                store.createIndex('capturedAt', 'capturedAt', { unique: false });
                store.createIndex('status',     'status',     { unique: false });
            }
        };

        req.onsuccess = e => resolve(e.target.result);
        req.onerror   = e => {
            _dbPromise = null; // allow retry
            reject(e.target.error);
        };
    });
    return _dbPromise;
}

function tx(mode, fn) {
    return openDB().then(db => new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        t.onerror = e => reject(e.target.error);
        resolve(fn(t.objectStore(STORE)));
    }));
}

function req2promise(idbReq) {
    return new Promise((resolve, reject) => {
        idbReq.onsuccess = e => resolve(e.target.result);
        idbReq.onerror   = e => reject(e.target.error);
    });
}

export const incidentLog = {

    /** Add a new incident. Returns the generated id. */
    async add(incident) {
        const entry = {
            id:              crypto.randomUUID(),
            capturedAt:      new Date().toISOString(),
            thumbnail:       null,
            lat:             null,
            lng:             null,
            locationDisplay: '',
            camera:          null,
            incidentDate:    '',
            incidentTime:    '',
            selfDescription: '',
            status:          'captured',
            sarSentAt:       null,
            letterText:      null,
            subjectLine:     null,
            ...incident,
        };
        await tx('readwrite', store => req2promise(store.put(entry)));
        return entry.id;
    },

    /** Merge changes into an existing incident. */
    async update(id, changes) {
        const existing = await this.get(id);
        if (!existing) throw new Error(`Incident ${id} not found`);
        await tx('readwrite', store => req2promise(store.put({ ...existing, ...changes })));
    },

    /** Get a single incident by id. Returns undefined if not found. */
    async get(id) {
        return tx('readonly', store => req2promise(store.get(id)));
    },

    /** Get all incidents, sorted newest first. */
    async getAll() {
        const all = await tx('readonly', store => req2promise(store.getAll()));
        return all.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
    },

    /** Delete an incident. */
    async remove(id) {
        await tx('readwrite', store => req2promise(store.delete(id)));
    },

    /** Count incidents by status. */
    async counts() {
        const all = await this.getAll();
        return {
            captured: all.filter(i => i.status === 'captured').length,
            sent:     all.filter(i => i.status === 'sent').length,
            total:    all.length,
        };
    },
};
