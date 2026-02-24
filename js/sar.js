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

    const name  = profile.name  || '[YOUR NAME]';
    const email = profile.email || '[YOUR EMAIL]';

    const opName    = camera?.operator?.name          || '[DATA CONTROLLER NAME]';
    const opAddr    = camera?.operator?.postal_address || '[DATA CONTROLLER ADDRESS]';
    const icoLine   = camera?.operator?.ico_reg
        ? `ICO Registration No: ${camera.operator.ico_reg}`
        : '';
    const camDesc   = camera?.location_desc || location?.display || '[CAMERA LOCATION]';
    const desc      = description?.trim()   || '[Please describe yourself here — height, build, clothing worn at the time]';

    return `${name}
${email}

${today}


The Data Controller
${opName}
${icoLine ? icoLine + '\n' : ''}${opAddr}


Dear Data Controller,

Re: Subject Access Request — CCTV Footage
    Article 15 UK GDPR / Section 45 Data Protection Act 2018

EVIDENCE OF IDENTITY AND PRESENCE
──────────────────────────────────
At approximately ${incidentTimeStr} on ${incidentDateStr} I photographed
the camera at ${camDesc} from the public area where I was standing.

That photograph — with its embedded timestamp and GPS coordinates —
constitutes evidence both of my physical presence at that location at
that time and of my identity as the data subject in the footage. I am,
by definition, the person your camera recorded.

Under Article 12(6) UK GDPR, a controller may only request additional
identifying information where there are reasonable doubts about the
identity of the data subject. No such doubt exists: the footage and my
photograph are of the same person, at the same place, at the same time.

I am not required to provide — and will not be providing — any identity
documents, driving licence, passport, or other credential. Any demand
for such documents as a condition of processing this request would
constitute a breach of Article 12(6) UK GDPR, which I would report to
the Information Commissioner's Office.

I therefore request, pursuant to Article 15 UK GDPR and Section 45 of
the Data Protection Act 2018, a copy of all CCTV footage in which I
appear at the location and time specified below.

FOOTAGE DETAILS
───────────────
  Camera location : ${camDesc}
  Date            : ${incidentDateStr}
  Time window     : ${fromTime} – ${toTime} (approximately)
  My appearance   : ${desc}

YOUR OBLIGATIONS
────────────────
You are required to:

  • Respond within one calendar month of receiving this request
  • Provide the data free of charge (unless the request is manifestly
    unfounded or excessive)
  • Supply the footage in a commonly used, machine-readable format
  • If the footage no longer exists or has been overwritten, confirm
    this in writing
  • If you are not the data controller responsible for this camera,
    forward this request to the correct controller and inform me of
    their identity

The exemptions in Schedule 2 of the Data Protection Act 2018 are
unlikely to apply to a specific, evidence-backed request by a data
subject for footage of themselves.

Please acknowledge receipt in writing and contact me at the email above
if you require any further information to locate the relevant footage.

If you fail to respond within the statutory period, or refuse this
request without adequate legal justification, I reserve the right to
lodge a complaint with the Information Commissioner's Office
(ico.org.uk) and to apply to the court for an order compelling
disclosure under Section 167 of the Data Protection Act 2018.

Yours faithfully,

${name}`;
}

export function getSubjectLine({ camera, location, incidentTime, photoTime }) {
    const d = incidentTime || photoTime;
    const dateStr   = d ? d.toLocaleDateString('en-GB') : new Date().toLocaleDateString('en-GB');
    const opName    = camera?.operator?.name || '';
    const locShort  = camera?.location_desc || location?.road || location?.town || 'CCTV Camera';
    const controller = opName ? `${opName} – ` : '';
    return `Subject Access Request – CCTV Footage – ${controller}${locShort} – ${dateStr}`;
}
