// storage.js — localStorage wrapper for user profile and draft SAR

const PROFILE_KEY = 'sar_profile';
const DRAFT_KEY   = 'sar_draft';
const WIZARD_KEY  = 'sar_wizard_state';

export const storage = {
    getProfile() {
        try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}'); }
        catch { return {}; }
    },

    saveProfile(profile) {
        localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    },

    saveDraft(text) {
        localStorage.setItem(DRAFT_KEY, text);
    },

    getDraft() {
        return localStorage.getItem(DRAFT_KEY) || '';
    },

    clearDraft() {
        localStorage.removeItem(DRAFT_KEY);
    },

    saveWizardState(state) {
        localStorage.setItem(WIZARD_KEY, JSON.stringify(state));
    },

    getWizardState() {
        try { return JSON.parse(localStorage.getItem(WIZARD_KEY) || 'null'); }
        catch { return null; }
    },

    clearWizardState() {
        localStorage.removeItem(WIZARD_KEY);
    },
};
