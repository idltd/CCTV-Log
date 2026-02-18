// app.js — main controller for CCTV SAR PWA
import { camera }                    from './camera.js';
import { loc }                       from './location.js';
import { registry }                  from './registry.js';
import { generateLetter, getSubjectLine } from './sar.js';
import { storage }                   from './storage.js';

// ── State ──────────────────────────────────────────────────────────────────────
const state = {
    section:        'home',
    step:           0,
    photo:          null,   // { data: base64, time: Date }
    location:       null,   // { lat, lng, accuracy, display, road, postcode, town }
    selectedCamera: null,   // camera object from registry or manual entry
};

// ── Navigation ─────────────────────────────────────────────────────────────────
function showSection(id) {
    document.querySelectorAll('.section').forEach(s => s.classList.add('hidden'));
    document.getElementById(`section-${id}`).classList.remove('hidden');
    document.querySelectorAll('.nav-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.section === id));
    state.section = id;
}

function showStep(n) {
    document.querySelectorAll('.step-panel').forEach(p => p.classList.add('hidden'));
    document.getElementById(`step-${n}`).classList.remove('hidden');
    document.querySelectorAll('.steps .step').forEach(s => {
        const sn = parseInt(s.dataset.step);
        s.classList.toggle('active', sn === n);
        s.classList.toggle('done',   sn < n);
    });
    state.step = n;
}

// ── Step 0 : Photograph the camera ────────────────────────────────────────────
function initStep0() {
    const btnPhoto = document.getElementById('btn-take-photo');
    const btnNext  = document.getElementById('btn-step0-next');
    const preview  = document.getElementById('photo-preview');

    btnPhoto.onclick = async () => {
        btnPhoto.disabled = true;
        btnPhoto.textContent = 'Opening camera…';
        try {
            const result = await camera.capture();
            state.photo  = result;

            preview.innerHTML =
                `<img src="${result.data}" alt="Photo of CCTV camera">`;

            // Start GPS acquisition in parallel — results shown below photo
            captureGPS();
            btnNext.disabled = false;
        } catch (e) {
            if (!e.message.includes('Cancelled'))
                setStatus('gps-status', 'Camera error: ' + e.message, 'error');
        } finally {
            btnPhoto.disabled = false;
            btnPhoto.textContent = 'Retake Photo';
        }
    };

    btnNext.onclick = () => {
        showSection('request');
        showStep(1);
        searchRegistry();
    };
}

async function captureGPS() {
    const el = document.getElementById('gps-status');
    setStatus('gps-status', 'Getting your location…', 'info', 0);

    try {
        const coords  = await loc.getPosition();
        const address = await loc.reverseGeocode(coords.lat, coords.lng);
        state.location = { ...coords, ...address };
        const label = address.road || address.town || address.display;
        setStatus('gps-status',
            `Location: ${label} (±${coords.accuracy}m)`, 'success', 0);
    } catch (e) {
        setStatus('gps-status',
            'Location unavailable — you can enter the camera details manually.',
            'warn', 0);
    }
}

// ── Step 1 : Identify camera owner ────────────────────────────────────────────
function initStep1() {
    document.getElementById('btn-step1-back').onclick = () => showStep(0);

    document.getElementById('btn-use-manual').onclick = () => {
        const org = document.getElementById('manual-org').value.trim();
        if (!org) { alert('Please enter an organisation name.'); return; }

        selectCamera({
            id:           'manual',
            lat:          state.location?.lat,
            lng:          state.location?.lng,
            location_desc: state.location?.display || '',
            operator: {
                name:           org,
                ico_reg:        document.getElementById('manual-ico').value.trim(),
                privacy_email:  document.getElementById('manual-email').value.trim(),
                postal_address: document.getElementById('manual-addr').value.trim(),
            },
            manual: true,
        });
    };

    document.getElementById('btn-step1-next').onclick = () => {
        prefillIncidentDateTime();
        showStep(2);
    };
}

async function searchRegistry() {
    const container = document.getElementById('registry-results');
    container.innerHTML = '<p class="hint">Searching registry…</p>';

    await registry.load();

    if (!state.location) {
        container.innerHTML =
            '<p class="hint">No GPS location — enter the camera owner details manually below.</p>';
        return;
    }

    const nearby = registry.nearby(state.location.lat, state.location.lng, 300);

    if (nearby.length === 0) {
        container.innerHTML =
            '<p class="hint">No cameras found within 300 m in the shared registry. ' +
            'Please enter the details manually below.</p>';
        return;
    }

    container.innerHTML = '';
    nearby.forEach(c => {
        const el = document.createElement('div');
        el.className = 'registry-item';
        el.tabIndex  = 0;
        el.innerHTML =
            `<div class="op-name">${c.operator.name}</div>
             <div class="op-meta">
               ${Math.round(c.distance)} m away &middot; ${c.location_desc}
               ${c.operator.ico_reg ? ' &middot; ICO: ' + c.operator.ico_reg : ''}
               ${c.local ? ' &middot; <em>your entry</em>' : ''}
             </div>`;
        el.onclick    = () => selectCamera(c, el);
        el.onkeydown  = e => { if (e.key === 'Enter' || e.key === ' ') selectCamera(c, el); };
        container.appendChild(el);
    });
}

function selectCamera(cam, el) {
    state.selectedCamera = cam;
    document.querySelectorAll('.registry-item').forEach(e => e.classList.remove('selected'));
    if (el) el.classList.add('selected');

    const info = document.getElementById('selected-info');
    info.innerHTML =
        `<strong>Selected:</strong> ${cam.operator.name}` +
        (cam.operator.ico_reg     ? `<br>ICO: ${cam.operator.ico_reg}`          : '') +
        (cam.operator.privacy_email ? `<br>Email: ${cam.operator.privacy_email}` : '') +
        (cam.location_desc        ? `<br>${cam.location_desc}`                   : '');
    info.classList.remove('hidden');

    document.getElementById('btn-step1-next').disabled = false;
}

function prefillIncidentDateTime() {
    if (!state.photo?.time) return;
    const d = state.photo.time;
    document.getElementById('incident-date').value = d.toISOString().slice(0, 10);
    document.getElementById('incident-time').value = d.toTimeString().slice(0, 5);
}

// ── Step 2 : Incident details ──────────────────────────────────────────────────
function initStep2() {
    document.getElementById('btn-step2-back').onclick = () => showStep(1);
    document.getElementById('btn-step2-next').onclick = () => {
        buildAndShowLetter();
        showStep(3);
    };
}

// ── Step 3 : Letter ────────────────────────────────────────────────────────────
function initStep3() {
    document.getElementById('btn-step3-back').onclick = () => showStep(2);

    document.getElementById('btn-new-request').onclick = () => {
        resetWizard();
        showSection('home');
    };

    document.getElementById('btn-mailto').onclick = () => {
        const to      = state.selectedCamera?.operator?.privacy_email || '';
        const subject = document.getElementById('email-subject').value;
        const body    = document.getElementById('letter-text').value;
        // mailto: uses user's own email app — no data passes through any server
        window.location.href =
            `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    };

    document.getElementById('btn-copy-letter').onclick = async () => {
        await copyText(document.getElementById('letter-text').value);
        setStatus('send-status', 'Letter copied to clipboard.', 'success');
    };

    document.getElementById('btn-copy-subject').onclick = async () => {
        await copyText(document.getElementById('email-subject').value);
        setStatus('send-status', 'Subject line copied.', 'success');
    };

    document.getElementById('btn-contribute').onclick = () => {
        if (!state.selectedCamera || !state.location) {
            setStatus('contribute-status', 'No camera data to contribute.', 'warn');
            return;
        }
        // Save locally so it appears in the user's own registry results
        if (state.selectedCamera.manual) {
            registry.saveLocal({
                ...state.selectedCamera,
                lat: state.location.lat,
                lng: state.location.lng,
                location_desc: state.location.display || '',
            });
        }
        // Open a pre-filled GitHub issue for community contribution
        registry.openContributionIssue(state.selectedCamera, state.location);
        setStatus('contribute-status',
            'GitHub opened — your entry will appear after review. It has been saved locally for your next search.',
            'success', 0);
    };
}

function buildAndShowLetter() {
    const profile = storage.getProfile();
    const incidentTime = readIncidentDateTime();
    const description  = document.getElementById('self-description').value;

    const text    = generateLetter({ profile, camera: state.selectedCamera,
        location: state.location, photoTime: state.photo?.time, incidentTime, description });
    const subject = getSubjectLine({ camera: state.selectedCamera,
        location: state.location, incidentTime, photoTime: state.photo?.time });

    document.getElementById('letter-text').value    = text;
    document.getElementById('email-subject').value  = subject;
    storage.saveDraft(text);

    // Show contribute panel only when we have usable data
    const hasGoodData = state.selectedCamera && state.location?.lat;
    document.getElementById('contribute-panel').style.display = hasGoodData ? '' : 'none';

    if (hasGoodData) {
        document.getElementById('contribute-preview').textContent = JSON.stringify({
            lat:           +state.location.lat.toFixed(6),
            lng:           +state.location.lng.toFixed(6),
            location_desc: state.location.display || '',
            operator:      state.selectedCamera.operator,
        }, null, 2);
    }
}

function readIncidentDateTime() {
    const dateVal = document.getElementById('incident-date').value;
    const timeVal = document.getElementById('incident-time').value;
    if (!dateVal) return state.photo?.time || null;
    const dt = new Date(`${dateVal}T${timeVal || '00:00'}`);
    return isNaN(dt) ? (state.photo?.time || null) : dt;
}

function resetWizard() {
    camera.clear();
    state.photo          = null;
    state.location       = null;
    state.selectedCamera = null;

    document.getElementById('photo-preview').innerHTML =
        `<div class="photo-placeholder">
            <span class="ph-icon">📷</span>
            <span>No photo taken yet</span>
         </div>`;
    document.getElementById('btn-take-photo').textContent = 'Take Photo';
    document.getElementById('btn-step0-next').disabled    = true;
    document.getElementById('gps-status').className       = 'status-line hidden';
    document.getElementById('registry-results').innerHTML = '';
    document.getElementById('selected-info').classList.add('hidden');
    document.getElementById('btn-step1-next').disabled    = true;
    document.getElementById('self-description').value     = '';
    document.getElementById('incident-date').value        = '';
    document.getElementById('incident-time').value        = '';
    document.getElementById('letter-text').value          = '';
    document.getElementById('contribute-status').className = 'status-line hidden';

    // Clear manual entry
    ['manual-org','manual-ico','manual-email','manual-addr'].forEach(id => {
        document.getElementById(id).value = '';
    });

    showStep(0);
}

// ── Profile ────────────────────────────────────────────────────────────────────
function initProfile() {
    // Load saved values whenever the section becomes visible
    document.querySelectorAll('.nav-btn').forEach(b => {
        if (b.dataset.section === 'profile') {
            b.addEventListener('click', loadProfileFields);
        }
    });

    document.getElementById('btn-save-profile').onclick = () => {
        storage.saveProfile({
            name:    document.getElementById('profile-name').value.trim(),
            address: document.getElementById('profile-address').value.trim(),
            email:   document.getElementById('profile-email').value.trim(),
        });
        setStatus('profile-saved', 'Saved to this device.', 'success');
    };
}

function loadProfileFields() {
    const p = storage.getProfile();
    document.getElementById('profile-name').value    = p.name    || '';
    document.getElementById('profile-address').value = p.address || '';
    document.getElementById('profile-email').value   = p.email   || '';
}

// ── Utilities ──────────────────────────────────────────────────────────────────
async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
    } catch {
        // Fallback for browsers that block clipboard without HTTPS
        const ta = Object.assign(document.createElement('textarea'), {
            value: text, style: 'position:fixed;opacity:0',
        });
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
    }
}

function setStatus(id, message, type = 'info', timeout = 4000) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = message;
    el.className   = `status-line ${type}`;
    if (timeout > 0) setTimeout(() => el.classList.add('hidden'), timeout);
}

// ── Bootstrap ──────────────────────────────────────────────────────────────────
function init() {
    // Top nav
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.onclick = () => {
            showSection(btn.dataset.section);
            if (btn.dataset.section === 'request') showStep(state.step);
        };
    });

    document.getElementById('btn-start').onclick    = () => { showSection('request'); showStep(0); };
    document.getElementById('btn-go-profile').onclick = () => showSection('profile');

    initStep0();
    initStep1();
    initStep2();
    initStep3();
    initProfile();
    loadProfileFields();

    showSection('home');
    showStep(0);

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
}

document.addEventListener('DOMContentLoaded', init);
