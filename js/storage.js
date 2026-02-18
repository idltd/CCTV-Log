// storage.js — localStorage wrapper for user profile and draft SAR

const PROFILE_KEY = 'sar_profile';
const DRAFT_KEY   = 'sar_draft';

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
};
