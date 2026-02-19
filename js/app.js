// app.js — main controller for CCTV SAR PWA
import { camera }                        from './camera.js';
import { loc }                           from './location.js';
import { registry }                      from './registry.js';
import { generateLetter, getSubjectLine } from './sar.js';
import { storage }                       from './storage.js';
import { incidentLog }                   from './log.js';
import { operatorKey, recordSARSent, getRecentSAR } from './contacts.js';

// ── State ──────────────────────────────────────────────────────────────────────
const state = {
    section:           'home',
    step:              0,
    photo:             null,    // { data: base64, time: Date }
    location:          null,    // { lat, lng, accuracy, display, road, postcode, town }
    selectedCamera:    null,    // camera object from registry or manual entry
    currentIncidentId: null,    // set when editing an existing incident from My Log
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

// ── Thumbnail generation ───────────────────────────────────────────────────────
function generateThumbnail(base64) {
    return new Promise(resolve => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.getElementById('thumb-canvas');
            const maxW = 320;
            const scale = Math.min(1, maxW / img.width);
            canvas.width  = Math.round(img.width  * scale);
            canvas.height = Math.round(img.height * scale);
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL('image/jpeg', 0.5));
        };
        img.onerror = () => resolve(null);
        img.src = base64;
    });
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

            // Start GPS acquisition in parallel
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
        // Allow saving to log immediately — camera selection is optional
        document.getElementById('btn-save-to-log').disabled = false;
    };

    document.getElementById('btn-postcode-search').onclick = searchByPostcode;
    document.getElementById('postcode-input').addEventListener('keydown', e => {
        if (e.key === 'Enter') searchByPostcode();
    });
}

async function captureGPS() {
    setStatus('gps-status', 'Getting your location…', 'info', 0);

    let coords;
    try {
        coords = await loc.getPosition();
    } catch (e) {
        // GPS itself unavailable (denied or unsupported)
        setStatus('gps-status',
            'Location unavailable — enter a postcode below to search the registry.',
            'warn', 0);
        document.getElementById('postcode-fallback').classList.remove('hidden');
        if (state.step === 1) searchRegistry();
        return;
    }

    // GPS coords obtained — try to reverse-geocode for a human-readable address.
    // If offline, skip gracefully and store the raw coords so Save to Log still works.
    try {
        const address = await loc.reverseGeocode(coords.lat, coords.lng);
        state.location = { ...coords, ...address };
        const label = address.road || address.town || address.display;
        setStatus('gps-status',
            `Location: ${label} (±${coords.accuracy}m)`, 'success', 0);
        document.getElementById('postcode-fallback').classList.add('hidden');
    } catch (e) {
        // Geocode failed (likely offline) — keep the raw coords so the capture
        // can still be saved to the log and processed later.
        state.location = {
            ...coords,
            display: `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`,
            road: '', postcode: '', town: '',
        };
        setStatus('gps-status',
            `GPS: ${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)} — no address (offline?)`,
            'warn', 0);
        if (state.step === 1) searchRegistry();
    }
}

async function searchByPostcode() {
    const input    = document.getElementById('postcode-input');
    const postcode = input.value.trim();
    if (!postcode) return;

    if (!navigator.onLine) {
        setStatus('gps-status', 'No internet — postcode lookup unavailable offline.', 'warn', 0);
        return;
    }

    const btn = document.getElementById('btn-postcode-search');
    btn.disabled = true;
    btn.textContent = 'Searching…';
    setStatus('gps-status', `Looking up ${postcode.toUpperCase()}…`, 'info', 0);

    try {
        const result = await loc.geocodePostcode(postcode);
        state.location = result;
        setStatus('gps-status', `Location: Near ${postcode.toUpperCase()}`, 'success', 0);
        document.getElementById('postcode-fallback').classList.add('hidden');
        if (state.step === 1) searchRegistry();
    } catch (e) {
        setStatus('gps-status', 'Postcode not found — try a different postcode.', 'warn', 0);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Search';
    }
}

// ── Step 1 : Identify camera owner ────────────────────────────────────────────
function initStep1() {
    document.getElementById('btn-step1-back').onclick = () => showStep(0);

    document.getElementById('btn-use-manual').onclick = () => {
        const org = document.getElementById('manual-org').value.trim();
        if (!org) { alert('Please enter an organisation name.'); return; }

        selectCamera({
            id:            'manual',
            lat:           state.location?.lat,
            lng:           state.location?.lng,
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

    document.getElementById('btn-save-to-log').onclick = () => saveCaptureToLog();
}

async function searchRegistry() {
    const container = document.getElementById('registry-results');
    container.innerHTML = '<p class="hint">Searching registry…</p>';

    if (!state.location) {
        container.innerHTML = `
            <p class="hint">GPS unavailable — enter the postcode where the camera is:</p>
            <div class="postcode-row" style="margin:8px 0 4px">
                <input type="text" id="step1-postcode" placeholder="e.g. SE1 7EH"
                       maxlength="8" style="text-transform:uppercase">
                <button class="btn btn-secondary" id="step1-postcode-btn">Search</button>
            </div>
            <p class="hint" style="margin-top:6px">Or enter details manually below.</p>`;

        const btn = document.getElementById('step1-postcode-btn');
        const doSearch = async () => {
            const input = document.getElementById('step1-postcode');
            const pc = input.value.trim();
            if (!pc) return;
            if (!navigator.onLine) {
                container.insertAdjacentHTML('afterbegin',
                    '<p class="hint" style="color:var(--error)">No internet — use Save to Log and search later.</p>');
                return;
            }
            btn.disabled = true;
            btn.textContent = 'Searching…';
            try {
                state.location = await loc.geocodePostcode(pc);
                await searchRegistry();
            } catch {
                btn.disabled = false;
                btn.textContent = 'Search';
                container.insertAdjacentHTML('afterbegin',
                    '<p class="hint" style="color:var(--error)">Postcode not found — try again.</p>');
            }
        };
        btn.onclick = doSearch;
        document.getElementById('step1-postcode').addEventListener('keydown', e => {
            if (e.key === 'Enter') doSearch();
        });
        return;
    }

    let nearby;
    try {
        nearby = await registry.nearby(state.location.lat, state.location.lng, 300);
    } catch (e) {
        // Network error — likely offline. Capture is already safe to save to log.
        container.innerHTML =
            '<p class="hint">No internet connection — the registry cannot be searched right now. ' +
            'Use <strong>Save to Log</strong> below to store this capture and identify the ' +
            'operator later when you\'re back online.</p>';
        return;
    }

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
        el.onclick   = () => selectCamera(c, el);
        el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') selectCamera(c, el); };
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

    document.getElementById('btn-step1-next').disabled    = false;
    document.getElementById('btn-save-to-log').disabled   = false;
}

function prefillIncidentDateTime() {
    if (!state.photo?.time) return;
    const dateField = document.getElementById('incident-date');
    const timeField = document.getElementById('incident-time');
    // Only prefill empty fields — never overwrite values the user (or a restore) has set
    if (dateField.value && timeField.value) return;
    const d = state.photo.time;
    // Use local date to avoid UTC midnight causing an off-by-one on the date
    const pad = n => String(n).padStart(2, '0');
    if (!dateField.value)
        dateField.value = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    if (!timeField.value)
        timeField.value = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
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

    document.getElementById('btn-mark-sent').onclick = () => markIncidentSent();

    document.getElementById('btn-contribute').onclick = async () => {
        if (!state.selectedCamera || !state.location) {
            setStatus('contribute-status', 'No camera data to contribute.', 'warn');
            return;
        }
        if (state.selectedCamera.manual) {
            registry.saveLocal({
                ...state.selectedCamera,
                lat:           state.location.lat,
                lng:           state.location.lng,
                location_desc: state.location.display || '',
            });
        }
        const btn = document.getElementById('btn-contribute');
        btn.disabled = true;
        try {
            await registry.submitContribution(state.selectedCamera, state.location);
            setStatus('contribute-status',
                'Thank you — submitted for review. Saved locally for your next search.',
                'success', 0);
        } catch {
            setStatus('contribute-status',
                'Submission failed — saved locally only. Please try again later.',
                'warn', 0);
        } finally {
            btn.disabled = false;
        }
    };
}

function buildAndShowLetter() {
    const profile      = storage.getProfile();
    const incidentTime = readIncidentDateTime();
    const description  = document.getElementById('self-description').value;

    const text    = generateLetter({ profile, camera: state.selectedCamera,
        location: state.location, photoTime: state.photo?.time, incidentTime, description });
    const subject = getSubjectLine({ camera: state.selectedCamera,
        location: state.location, incidentTime, photoTime: state.photo?.time });

    document.getElementById('letter-text').value   = text;
    document.getElementById('email-subject').value = subject;
    storage.saveDraft(text);

    // If we're reviewing an existing incident, update its letter
    if (state.currentIncidentId) {
        incidentLog.update(state.currentIncidentId, { letterText: text, subjectLine: subject })
            .catch(() => {});
    }

    // SAR warning check
    checkSARWarning(state.selectedCamera);

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

function checkSARWarning(cam) {
    const warning = document.getElementById('sar-warning');
    if (!cam) { warning.classList.add('hidden'); return; }

    const key    = operatorKey(cam);
    const recent = getRecentSAR(key);
    if (!recent) { warning.classList.add('hidden'); return; }

    warning.textContent =
        `You sent a SAR to ${recent.operatorName} ${recent.daysSince} day${recent.daysSince === 1 ? '' : 's'} ago ` +
        `(${recent.count} total). Operators can treat repeat requests within a short period ` +
        `as excessive under UK GDPR Article 12(5). Only proceed if the previous request ` +
        `was not resolved.`;
    warning.classList.remove('hidden');
}

// ── Log: save current capture ──────────────────────────────────────────────────
async function saveCaptureToLog() {
    const btn = document.getElementById('btn-save-to-log');
    btn.disabled = true;
    btn.textContent = 'Saving…';

    try {
        const thumbnail = state.photo?.data
            ? await generateThumbnail(state.photo.data)
            : null;

        const now = state.photo?.time || new Date();
        const incident = {
            capturedAt:      now.toISOString(),
            thumbnail,
            lat:             state.location?.lat || null,
            lng:             state.location?.lng || null,
            locationDisplay: state.location?.display || state.location?.road || '',
            camera:          state.selectedCamera,
            incidentDate:    now.toISOString().slice(0, 10),
            incidentTime:    now.toTimeString().slice(0, 5),
            selfDescription: '',
            status:          'captured',
        };

        await incidentLog.add(incident);
        await updateHomeSummary();

        setStatus('gps-status', 'Saved to My Log!', 'success', 3000);

        resetWizard();
        showSection('home');
    } catch (e) {
        setStatus('gps-status', 'Could not save: ' + e.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Save to Log';
    }
}

// ── Log: mark sent ─────────────────────────────────────────────────────────────
async function markIncidentSent() {
    const letterText  = document.getElementById('letter-text').value;
    const subjectLine = document.getElementById('email-subject').value;
    const cam         = state.selectedCamera;

    // Record to contact log
    if (cam) {
        const key  = operatorKey(cam);
        const name = cam.operator?.name || key;
        recordSARSent(key, name);
    }

    // If editing an existing incident, update it
    if (state.currentIncidentId) {
        await incidentLog.update(state.currentIncidentId, {
            status:      'sent',
            sarSentAt:   new Date().toISOString(),
            letterText,
            subjectLine,
        }).catch(() => {});
    } else {
        // Create a new incident record for this immediate send
        const thumbnail = state.photo?.data
            ? await generateThumbnail(state.photo.data)
            : null;
        const now = state.photo?.time || new Date();
        await incidentLog.add({
            capturedAt:      now.toISOString(),
            thumbnail,
            lat:             state.location?.lat || null,
            lng:             state.location?.lng || null,
            locationDisplay: state.location?.display || '',
            camera:          cam,
            incidentDate:    document.getElementById('incident-date').value,
            incidentTime:    document.getElementById('incident-time').value,
            selfDescription: document.getElementById('self-description').value,
            status:          'sent',
            sarSentAt:       new Date().toISOString(),
            letterText,
            subjectLine,
        }).catch(() => {});
    }

    await updateHomeSummary();

    setStatus('sent-status', 'Marked as sent — saved to My Log.', 'success', 0);
    document.getElementById('btn-mark-sent').disabled = true;
    document.getElementById('btn-mark-sent').textContent = '✓ Sent';
}

// ── Log: render list ───────────────────────────────────────────────────────────
async function initLog() {
    const incidents = await incidentLog.getAll();
    renderIncidentList(incidents);
}

function renderIncidentList(incidents) {
    const list  = document.getElementById('log-list');
    const empty = document.getElementById('log-empty');

    list.innerHTML = '';

    if (incidents.length === 0) {
        empty.classList.remove('hidden');
        return;
    }
    empty.classList.add('hidden');

    incidents.forEach(inc => {
        const opName  = inc.camera?.operator?.name || 'Unknown operator';
        const locText = inc.locationDisplay || 'Location unknown';
        const timeStr = relativeTime(inc.capturedAt);
        const isPending = inc.status === 'captured';

        const card = document.createElement('div');
        card.className = 'incident-item';
        card.innerHTML = `
            <div class="incident-thumb">
                ${inc.thumbnail
                    ? `<img src="${inc.thumbnail}" alt="CCTV camera photo">`
                    : '📷'}
            </div>
            <div class="incident-body">
                <div class="incident-op">${escHtml(opName)}</div>
                <div class="incident-loc">${escHtml(locText)}</div>
                <div class="incident-meta">
                    <span class="badge ${isPending ? 'badge-captured' : 'badge-sent'}">
                        ${isPending ? 'Pending' : 'Sent ✓'}
                    </span>
                    <span style="font-size:0.78em;color:var(--muted)">${escHtml(timeStr)}</span>
                </div>
            </div>
            <div class="incident-actions">
                ${isPending
                    ? `<button class="btn btn-primary" data-id="${inc.id}">Process →</button>`
                    : `<button class="btn btn-secondary" data-id="${inc.id}">View</button>`}
                <button class="btn btn-secondary btn-delete" data-id="${inc.id}"
                        style="color:var(--error-text)">Delete</button>
            </div>`;

        card.querySelector(isPending ? '.btn-primary' : '.btn-secondary:not(.btn-delete)')
            .onclick = () => openIncidentForProcessing(inc.id);

        card.querySelector('.btn-delete').onclick = async () => {
            if (!confirm(`Delete this incident (${opName})?`)) return;
            await incidentLog.remove(inc.id);
            await updateHomeSummary();
            await initLog();
        };

        list.appendChild(card);
    });
}

async function openIncidentForProcessing(id) {
    const inc = await incidentLog.get(id);
    if (!inc) return;

    state.currentIncidentId = id;
    state.selectedCamera    = inc.camera || null;
    // Restore location from stored coords regardless of whether camera is known
    state.location = (inc.lat && inc.lng)
        ? { lat: inc.lat, lng: inc.lng, display: inc.locationDisplay || '' }
        : null;
    state.photo = inc.capturedAt
        ? { data: inc.thumbnail, time: new Date(inc.capturedAt) }
        : null;

    // Restore step-2 fields; clear first so prefill can run if values are absent
    document.getElementById('incident-date').value    = inc.incidentDate    || '';
    document.getElementById('incident-time').value    = inc.incidentTime    || '';
    document.getElementById('self-description').value = inc.selfDescription || '';
    // Fill date/time from photo timestamp when not stored (older records)
    prefillIncidentDateTime();

    // Restore step-1 display and enable navigation
    if (inc.camera) {
        selectCamera(inc.camera, null);
    } else {
        // No camera yet — user can still go Back and pick one, or go forward
        document.getElementById('btn-step1-next').disabled  = false;
        document.getElementById('btn-save-to-log').disabled = false;
    }

    // Restore letter if it was already generated
    if (inc.letterText) {
        document.getElementById('letter-text').value   = inc.letterText;
        document.getElementById('email-subject').value = inc.subjectLine || '';
        checkSARWarning(inc.camera);
        showSection('request');
        showStep(3);
    } else {
        showSection('request');
        showStep(2);
    }
}

// ── Home: log summary strip ────────────────────────────────────────────────────
async function updateHomeSummary() {
    const counts  = await incidentLog.counts();
    const summary = document.getElementById('home-log-summary');
    if (counts.total === 0) {
        summary.classList.add('hidden');
    } else {
        document.getElementById('home-pending-count').textContent = counts.captured;
        document.getElementById('home-sent-count').textContent    = counts.sent;
        summary.classList.remove('hidden');
    }
}

// ── Wizard reset ───────────────────────────────────────────────────────────────
function resetWizard() {
    camera.clear();
    state.photo             = null;
    state.location          = null;
    state.selectedCamera    = null;
    state.currentIncidentId = null;

    storage.clearWizardState();

    document.getElementById('photo-preview').innerHTML =
        `<div class="photo-placeholder">
            <span class="ph-icon">📷</span>
            <span>No photo taken yet</span>
         </div>`;
    document.getElementById('btn-take-photo').textContent  = 'Take Photo';
    document.getElementById('btn-step0-next').disabled     = true;
    document.getElementById('gps-status').className        = 'status-line hidden';
    document.getElementById('postcode-fallback').classList.add('hidden');
    document.getElementById('postcode-input').value        = '';
    document.getElementById('registry-results').innerHTML  = '';
    document.getElementById('selected-info').classList.add('hidden');
    document.getElementById('btn-step1-next').disabled     = true;
    document.getElementById('btn-save-to-log').disabled    = true;
    document.getElementById('self-description').value      = '';
    document.getElementById('incident-date').value         = '';
    document.getElementById('incident-time').value         = '';
    document.getElementById('letter-text').value           = '';
    document.getElementById('contribute-status').className = 'status-line hidden';
    document.getElementById('sar-warning').classList.add('hidden');
    document.getElementById('btn-mark-sent').disabled      = false;
    document.getElementById('btn-mark-sent').textContent   = '✓ Mark as Sent';
    document.getElementById('sent-status').className       = 'status-line hidden';

    ['manual-org','manual-ico','manual-email','manual-addr'].forEach(id => {
        document.getElementById(id).value = '';
    });

    showStep(0);
}

// ── Profile ────────────────────────────────────────────────────────────────────
function initProfile() {
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

function relativeTime(isoString) {
    const d    = new Date(isoString);
    const now  = new Date();
    const diff = now - d;
    const mins  = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days  = Math.floor(diff / 86400000);

    if (mins < 2)   return 'Just now';
    if (mins < 60)  return `${mins} min ago`;
    if (hours < 24) {
        const t = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        return `Today ${t}`;
    }
    if (days === 1) return 'Yesterday';
    if (days < 7)   return `${days} days ago`;
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function escHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ── Bootstrap ──────────────────────────────────────────────────────────────────
async function init() {
    // Top nav
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.onclick = async () => {
            showSection(btn.dataset.section);
            if (btn.dataset.section === 'request') showStep(state.step);
            if (btn.dataset.section === 'log') {
                await initLog();
            }
        };
    });

    // Home buttons
    document.getElementById('btn-capture').onclick    = () => { showSection('request'); showStep(0); };
    document.getElementById('btn-go-profile').onclick = () => showSection('profile');
    document.getElementById('home-view-log').onclick  = async e => {
        e.preventDefault();
        showSection('log');
        document.querySelectorAll('.nav-btn').forEach(b =>
            b.classList.toggle('active', b.dataset.section === 'log'));
        await initLog();
    };

    initStep0();
    initStep1();
    initStep2();
    initStep3();
    initProfile();
    loadProfileFields();

    showSection('home');
    showStep(0);

    // Load log counts for home summary
    await updateHomeSummary();

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
}

document.addEventListener('DOMContentLoaded', init);
