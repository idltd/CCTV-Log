// sar.js — SAR letter generator for CCTV footage requests
//
// Legal basis: Article 15 UK GDPR + Section 45 Data Protection Act 2018
// The photograph of the camera serves as timestamped evidence of presence.

function fmtDate(d) {
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}
function fmtDateShort(d) {
    return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
function fmtTime(d) {
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
function addMinutes(d, m) { return new Date(d.getTime() + m * 60000); }

export function generateLetter({ profile, camera, location, photoTime, incidentTime, description }) {
    const today      = fmtDate(new Date());
    const incident   = incidentTime || photoTime || null;
    const incidentDateStr = incident ? fmtDateShort(incident) : '[DATE]';
    const incidentTimeStr = incident ? fmtTime(incident) : '[TIME]';
    const fromTime   = incident ? fmtTime(addMinutes(incident, -30)) : '[FROM]';
    const toTime     = incident ? fmtTime(addMinutes(incident,  30)) : '[TO]';

    const name    = profile.name    || '[YOUR NAME]';
    const address = profile.address || '[YOUR ADDRESS]';
    const email   = profile.email   || '[YOUR EMAIL]';

    const opName    = camera?.operator?.name          || '[DATA CONTROLLER NAME]';
    const opAddr    = camera?.operator?.postal_address || '[DATA CONTROLLER ADDRESS]';
    const icoLine   = camera?.operator?.ico_reg
        ? `ICO Registration No: ${camera.operator.ico_reg}`
        : '';
    const camDesc   = camera?.location_desc || location?.display || '[CAMERA LOCATION]';
    const desc      = description?.trim()   || '[Please describe yourself here — height, build, clothing worn at the time]';

    return `${name}
${address}
${email}

${today}


The Data Controller
${opName}
${icoLine ? icoLine + '\n' : ''}${opAddr}


Dear Data Controller,

Re: Subject Access Request — CCTV Footage
    Article 15 UK GDPR / Section 45 Data Protection Act 2018

I am writing to exercise my right of access to personal data under Article 15 of the UK General Data Protection Regulation (UK GDPR) and Section 45 of the Data Protection Act 2018.

I request a copy of any CCTV footage in which I appear, captured at the location and time specified below.

FOOTAGE DETAILS
───────────────
  Camera location : ${camDesc}
  Date            : ${incidentDateStr}
  Time window     : ${fromTime} – ${toTime} (approximately)
  My appearance   : ${desc}

EVIDENCE OF PRESENCE
────────────────────
At approximately ${incidentTimeStr} on ${incidentDateStr} I photographed the above camera from the public area where I was standing. I retain this photograph, together with a copy of this email, as a record of my presence at the location at that time.

YOUR OBLIGATIONS
────────────────
I understand that you are required to:

  • Respond within one calendar month of receiving this request
  • Provide the data free of charge (unless the request is manifestly
    unfounded or excessive)
  • Supply the footage in a commonly used, machine-readable format
  • If the footage no longer exists or has been overwritten, confirm
    this in writing
  • If you are not the data controller responsible for this camera,
    forward this request to the correct controller and inform me of
    their identity

Please contact me at the address or email above if you require any further information to locate the relevant footage.

Yours faithfully,

${name}`;
}

export function getSubjectLine({ camera, location, incidentTime, photoTime }) {
    const d = incidentTime || photoTime;
    const dateStr  = d ? d.toLocaleDateString('en-GB') : new Date().toLocaleDateString('en-GB');
    const locShort = camera?.location_desc
        || location?.road
        || location?.town
        || 'CCTV Camera';
    return `Subject Access Request – CCTV Footage – ${locShort} – ${dateStr}`;
}
