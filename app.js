// ============================================
// CONSTANTS & CONFIGURATION
// ============================================
const CONFIG = {
    SESSION_DURATION: 8 * 60 * 60 * 1000,
    LOCKOUT_DURATION: 5 * 60 * 1000,
    MAX_LOGIN_ATTEMPTS: 5,
    DEBOUNCE_DELAY: 300,
    MAX_AUDIT_ENTRIES: 10,
    MAX_GLOBAL_DESIGNATION_HISTORY: 100,
    MAX_AREA_DESIGNATION_HISTORY: 50,
    DEFAULT_RETENTION_DAYS: 180,
    DEFAULT_AREAS: [
        'TCF Facilities',
        'Precast S2A',
        'Painting & Sand Blasting',
        'Precast S4A',
        'Precast S4B',
        'Fabrication Area S2A & S4A',
        'Fabrication Area S4B',
        'Common Welding S4A_S2A_S4B',
        'Spool Yard',
        'Old Spool Yard',
        'Spool Yard T58',
        'Spool Yard T63',
        'PWHT'
    ]
};

const STORAGE_KEYS = {
    SETTINGS: 'hc_settings',
    AREAS: 'hc_areas',
    USERS: 'hc_users',
    SESSION: 'hc_session',
    ATTENDANCE: 'hc_attendance',
    DESIGNATION_HISTORY: 'hc_designation_history'
};

// ============================================
// UTILITY FUNCTIONS
// ============================================
const Utils = {
    formatDate(date) {
        if (!(date instanceof Date)) date = new Date(date);
        return date.toISOString().split('T')[0];
    },

    getTodayString() {
        return this.formatDate(new Date());
    },

    formatDateTime(timestamp) {
        return new Date(timestamp).toLocaleString();
    },

    normalizeDesignation(text) {
        return text.trim().replace(/\s+/g, ' ').toLowerCase();
    },

    async generateSalt() {
        const array = new Uint8Array(16);
        crypto.getRandomValues(array);
        return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
    },

    async hashPassword(password, salt) {
        const encoder = new TextEncoder();
        const data = encoder.encode(password + salt);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        return Array.from(new Uint8Array(hashBuffer))
            .map(b => b.toString(16).padStart(2, '0')).join('');
    },

    generatePassword(length = 12) {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
        let pwd = '';
        const arr = new Uint8Array(length);
        crypto.getRandomValues(arr);
        for (let i = 0; i < length; i++) {
            pwd += chars[arr[i] % chars.length];
        }
        return pwd;
    },

    setText(el, text) {
        if (el) el.textContent = text || '';
    },

    debounce(func, wait) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func(...args), wait);
        };
    }
};

// ============================================
// STORAGE MANAGEMENT
// ============================================
const Storage = {
    getSettings() {
        try {
            const d = localStorage.getItem(STORAGE_KEYS.SETTINGS);
            return d ? JSON.parse(d) : { darkMode: false, retentionDays: CONFIG.DEFAULT_RETENTION_DAYS };
        } catch (e) {
            return { darkMode: false, retentionDays: CONFIG.DEFAULT_RETENTION_DAYS };
        }
    },

    saveSettings(s) {
        localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(s));
    },

    getAreas() {
        try {
            const d = localStorage.getItem(STORAGE_KEYS.AREAS);
            const a = d ? JSON.parse(d) : [];
            return Array.isArray(a) ? a : [];
        } catch (e) {
            return [];
        }
    },

    saveAreas(a) {
        localStorage.setItem(STORAGE_KEYS.AREAS, JSON.stringify(Array.isArray(a) ? a : []));
    },

    getUsers() {
        try {
            const d = localStorage.getItem(STORAGE_KEYS.USERS);
            const u = d ? JSON.parse(d) : [];
            return Array.isArray(u) ? u : [];
        } catch (e) {
            return [];
        }
    },

    saveUsers(u) {
        localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(Array.isArray(u) ? u : []));
    },

    getSession() {
        try {
            const d = localStorage.getItem(STORAGE_KEYS.SESSION);
            return d ? JSON.parse(d) : { currentUser: null, expiresAt: null, failedLogin: { count: 0, cooldownUntil: null } };
        } catch (e) {
            return { currentUser: null, expiresAt: null, failedLogin: { count: 0, cooldownUntil: null } };
        }
    },

    saveSession(s) {
        localStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify(s));
    },

    getAttendance() {
        try {
            const d = localStorage.getItem(STORAGE_KEYS.ATTENDANCE);
            const a = d ? JSON.parse(d) : {};
            return a && typeof a === 'object' ? a : {};
        } catch (e) {
            return {};
        }
    },

    saveAttendance(a) {
        localStorage.setItem(STORAGE_KEYS.ATTENDANCE, JSON.stringify(a || {}));
    },

    getAttendanceForDate(dateStr) {
        const all = this.getAttendance();
        if (!all[dateStr]) {
            all[dateStr] = { areas: {}, audit: [], updatedAt: null, updatedBy: null };
        }
        return all[dateStr];
    },

    saveAttendanceForDate(dateStr, data) {
        const all = this.getAttendance();
        all[dateStr] = data;
        this.saveAttendance(all);
    },

    getDesignationHistory() {
        try {
            const d = localStorage.getItem(STORAGE_KEYS.DESIGNATION_HISTORY);
            const h = d ? JSON.parse(d) : { global: [], byArea: {} };
            return h;
        } catch (e) {
            return { global: [], byArea: {} };
        }
    },

    saveDesignationHistory(h) {
        localStorage.setItem(STORAGE_KEYS.DESIGNATION_HISTORY, JSON.stringify(h));
    }
};

// ============================================
// DESIGNATION HISTORY & AUTOCOMPLETE
// ============================================
const DesignationMgr = {
    addToHistory(designationLabel, areaName) {
        const norm = Utils.normalizeDesignation(designationLabel);
        const h = Storage.getDesignationHistory();

        // Global history
        h.global = h.global.filter(d => Utils.normalizeDesignation(d) !== norm);
        h.global.unshift(designationLabel);
        h.global = h.global.slice(0, CONFIG.MAX_GLOBAL_DESIGNATION_HISTORY);

        // Area history
        if (!h.byArea[areaName]) h.byArea[areaName] = [];
        h.byArea[areaName] = h.byArea[areaName].filter(d => Utils.normalizeDesignation(d) !== norm);
        h.byArea[areaName].unshift(designationLabel);
        h.byArea[areaName] = h.byArea[areaName].slice(0, CONFIG.MAX_AREA_DESIGNATION_HISTORY);

        Storage.saveDesignationHistory(h);
    },

    getSuggestions(partial, areaName) {
        const norm = Utils.normalizeDesignation(partial);
        const h = Storage.getDesignationHistory();

        let suggestions = [];
        if (areaName && h.byArea[areaName]) {
            suggestions = h.byArea[areaName].filter(d =>
                Utils.normalizeDesignation(d).includes(norm)
            );
        }

        if (suggestions.length < 5) {
            const global = h.global.filter(d =>
                Utils.normalizeDesignation(d).includes(norm) &&
                !suggestions.includes(d)
            );
            suggestions = [...suggestions, ...global].slice(0, 5);
        }

        return suggestions;
    }
};

// ============================================
// AUTHENTICATION
// ============================================
const Auth = {
    async createUser(username, password, role, assignedAreas = []) {
        const users = Storage.getUsers();
        if (users.find(u => u.username === username)) {
            throw new Error('Username already exists');
        }

        const salt = await Utils.generateSalt();
        const hash = await Utils.hashPassword(password, salt);

        users.push({
            username,
            role,
            salt,
            passwordHash: hash,
            assignedAreas,
            createdAt: Date.now(),
            disabled: false
        });

        Storage.saveUsers(users);
    },

    async login(username, password) {
        const sess = Storage.getSession();

        if (sess.failedLogin.cooldownUntil && Date.now() < sess.failedLogin.cooldownUntil) {
            const remaining = Math.ceil((sess.failedLogin.cooldownUntil - Date.now()) / 60000);
            throw new Error(`Account locked. Try again in ${remaining} minute(s).`);
        }

        const users = Storage.getUsers();
        const user = users.find(u => u.username === username);

        if (!user) {
            this._handleFailedLogin();
            throw new Error('Invalid username or password');
        }

        if (user.disabled) {
            throw new Error('Account is disabled');
        }

        const hash = await Utils.hashPassword(password, user.salt);
        if (hash !== user.passwordHash) {
            this._handleFailedLogin();
            throw new Error('Invalid username or password');
        }

        sess.currentUser = username;
        sess.expiresAt = Date.now() + CONFIG.SESSION_DURATION;
        sess.failedLogin = { count: 0, cooldownUntil: null };
        Storage.saveSession(sess);
    },

    _handleFailedLogin() {
        const sess = Storage.getSession();
        sess.failedLogin.count++;
        if (sess.failedLogin.count >= CONFIG.MAX_LOGIN_ATTEMPTS) {
            sess.failedLogin.cooldownUntil = Date.now() + CONFIG.LOCKOUT_DURATION;
        }
        Storage.saveSession(sess);
    },

    logout() {
        const sess = Storage.getSession();
        sess.currentUser = null;
        sess.expiresAt = null;
        Storage.saveSession(sess);
    },

    getCurrentUser() {
        const sess = Storage.getSession();
        if (!sess.currentUser) return null;

        if (sess.expiresAt && Date.now() > sess.expiresAt) {
            this.logout();
            return null;
        }

        const users = Storage.getUsers();
        const user = users.find(u => u.username === sess.currentUser);
        if (!user || user.disabled) {
            this.logout();
            return null;
        }

        return user;
    },

    isAdmin() {
        const u = this.getCurrentUser();
        return u && u.role === 'admin';
    },

    async resetPassword(username, newPassword) {
        const users = Storage.getUsers();
        const user = users.find(u => u.username === username);
        if (!user) throw new Error('User not found');

        const salt = await Utils.generateSalt();
        user.salt = salt;
        user.passwordHash = await Utils.hashPassword(newPassword, salt);
        Storage.saveUsers(users);
    }
};

// ============================================
// AUDIT TRAIL
// ============================================
const Audit = {
    addEntry(dateStr, areaName, designationKey, field, oldVal, newVal) {
        const user = Auth.getCurrentUser();
        if (!user) return;

        const data = Storage.getAttendanceForDate(dateStr);
        data.audit.unshift({
            ts: Date.now(),
            user: user.username,
            area: areaName,
            designationKey,
            field,
            from: oldVal,
            to: newVal
        });

        if (data.audit.length > CONFIG.MAX_AUDIT_ENTRIES) {
            data.audit = data.audit.slice(0, CONFIG.MAX_AUDIT_ENTRIES);
        }

        Storage.saveAttendanceForDate(dateStr, data);
    },

    getEntries(dateStr) {
        return Storage.getAttendanceForDate(dateStr).audit || [];
    }
};

// ============================================
// ATTENDANCE WITH DESIGNATIONS
// ============================================
const Attendance = {
    getAreaData(dateStr, areaName) {
        const data = Storage.getAttendanceForDate(dateStr);
        return data.areas[areaName] || { rows: [] };
    },

    getRow(dateStr, areaName, designationKey) {
        const area = this.getAreaData(dateStr, areaName);
        return area.rows.find(r => r.designationKey === designationKey);
    },

    addOrUpdateRow(dateStr, areaName, designationLabel) {
        const user = Auth.getCurrentUser();
        if (!user) return;

        const designationKey = Utils.normalizeDesignation(designationLabel);
        const data = Storage.getAttendanceForDate(dateStr);

        if (!data.areas[areaName]) {
            data.areas[areaName] = { rows: [] };
        }

        let row = data.areas[areaName].rows.find(r => r.designationKey === designationKey);
        if (!row) {
            row = {
                designationKey,
                designationLabel,
                present: null,
                confirmed: false,
                updatedAt: null,
                updatedBy: null
            };
            data.areas[areaName].rows.push(row);
            DesignationMgr.addToHistory(designationLabel, areaName);
        }

        data.updatedAt = Date.now();
        data.updatedBy = user.username;
        Storage.saveAttendanceForDate(dateStr, data);

        return row;
    },

    updateRow(dateStr, areaName, designationKey, updates) {
        const user = Auth.getCurrentUser();
        if (!user) return;

        const data = Storage.getAttendanceForDate(dateStr);
        if (!data.areas[areaName]) return;

        const row = data.areas[areaName].rows.find(r => r.designationKey === designationKey);
        if (!row) return;

        const oldRow = { ...row };

        if ('present' in updates && updates.present !== oldRow.present) {
            Audit.addEntry(dateStr, areaName, designationKey, 'present', oldRow.present, updates.present);
        }

        if ('confirmed' in updates && updates.confirmed !== oldRow.confirmed) {
            Audit.addEntry(dateStr, areaName, designationKey, 'confirmed', oldRow.confirmed, updates.confirmed);
        }

        Object.assign(row, updates, { updatedAt: Date.now(), updatedBy: user.username });
        data.updatedAt = Date.now();
        data.updatedBy = user.username;

        Storage.saveAttendanceForDate(dateStr, data);
    },

    deleteRow(dateStr, areaName, designationKey) {
        const data = Storage.getAttendanceForDate(dateStr);
        if (!data.areas[areaName]) return;

        const idx = data.areas[areaName].rows.findIndex(r => r.designationKey === designationKey);
        if (idx >= 0) {
            data.areas[areaName].rows.splice(idx, 1);
            Storage.saveAttendanceForDate(dateStr, data);
        }
    },

    getAreaTotals(dateStr, areaName) {
        const area = this.getAreaData(dateStr, areaName);
        const total = area.rows.reduce((sum, r) => sum + (typeof r.present === 'number' ? r.present : 0), 0);
        const confirmed = area.rows.filter(r => r.confirmed).length;
        return { total, confirmed, rows: area.rows.length };
    },

    getGrandTotal(dateStr, areas) {
        return areas.reduce((sum, areaName) => {
            const { total } = this.getAreaTotals(dateStr, areaName);
            return sum + total;
        }, 0);
    }
};

// ============================================
// UI UTILITIES
// ============================================
const UI = {
    showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        Utils.setText(toast, message);
        container?.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    },

    showModal(title, bodyHTML, buttons = []) {
        const container = document.getElementById('modal-container');
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';

        const modal = document.createElement('div');
        modal.className = 'modal';

        const header = document.createElement('div');
        header.className = 'modal-header';
        const h3 = document.createElement('h3');
        Utils.setText(h3, title);
        header.appendChild(h3);

        const closeBtn = document.createElement('button');
        closeBtn.className = 'icon-btn';
        Utils.setText(closeBtn, '✕');
        closeBtn.onclick = () => overlay.remove();
        header.appendChild(closeBtn);

        const body = document.createElement('div');
        body.className = 'modal-body';
        body.innerHTML = bodyHTML;

        const footer = document.createElement('div');
        footer.className = 'modal-footer';

        buttons.forEach(btn => {
            const button = document.createElement('button');
            button.className = `btn ${btn.className || 'btn-secondary'}`;
            Utils.setText(button, btn.text);
            button.onclick = () => {
                if (btn.onClick) btn.onClick();
                if (btn.closeOnClick !== false) overlay.remove();
            };
            footer.appendChild(button);
        });

        modal.appendChild(header);
        modal.appendChild(body);
        modal.appendChild(footer);
        overlay.appendChild(modal);
        container?.appendChild(overlay);

        return overlay;
    },

    confirm(message, onConfirm) {
        this.showModal('Confirm', `<p>${message}</p>`, [
            { text: 'Cancel', className: 'btn-secondary' },
            { text: 'Confirm', className: 'btn-primary', onClick: onConfirm }
        ]);
    },

    switchScreen(screenId) {
        document.querySelectorAll('.screen').forEach(s => s.style.display = 'none');
        const screen = document.getElementById(screenId);
        if (screen) screen.style.display = 'block';
    },

    switchView(viewId) {
        document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
        const view = document.getElementById(`${viewId}-view`);
        if (view) view.style.display = 'block';

        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        const navBtn = document.querySelector(`.nav-btn[data-view="${viewId}"]`);
        if (navBtn) navBtn.classList.add('active');
    }
};

// ============================================
// EXPORT FUNCTIONS
// ============================================
const Exports = {
    exportDetailed(dateStr) {
        const areas = Storage.getAreas();
        const attendance = Storage.getAttendance()[dateStr] || { areas: {} };

        let csv = 'date,area,designation,present,confirmed,updated_at,updated_by\n';

        areas.forEach(areaName => {
            const areaData = attendance.areas[areaName] || { rows: [] };
            areaData.rows.forEach(row => {
                const present = row.present !== null ? row.present : '';
                const confirmed = row.confirmed ? 'true' : 'false';
                const updatedAt = row.updatedAt ? Utils.formatDateTime(row.updatedAt) : '';
                const updatedBy = row.updatedBy || '';
                csv += `${dateStr},"${areaName}","${row.designationLabel}",${present},${confirmed},"${updatedAt}","${updatedBy}"\n`;
            });
        });

        this._downloadCSV(csv, `headcount_detailed_${dateStr}.csv`);
    },

    exportAreaSummary(dateStr) {
        const areas = Storage.getAreas();
        const attendance = Storage.getAttendance()[dateStr] || { areas: {} };

        let csv = 'date,area,present_total,rows_total,rows_confirmed,status,last_updated\n';

        areas.forEach(areaName => {
            const areaData = attendance.areas[areaName] || { rows: [] };
            const { total, confirmed, rows } = Attendance.getAreaTotals(dateStr, areaName);

            let status = 'NOT_STARTED';
            if (rows > 0) {
                status = confirmed === rows ? 'CONFIRMED' : 'IN_PROGRESS';
            }

            const lastUpdated = areaData.rows.length > 0
                ? Math.max(...areaData.rows.map(r => r.updatedAt || 0))
                : null;

            const lastUpdatedStr = lastUpdated ? Utils.formatDateTime(lastUpdated) : '';

            csv += `${dateStr},"${areaName}",${total},${rows},${confirmed},"${status}","${lastUpdatedStr}"\n`;
        });

        this._downloadCSV(csv, `headcount_area_summary_${dateStr}.csv`);
    },

    exportDesignationSummary(dateStr) {
        const areas = Storage.getAreas();
        const attendance = Storage.getAttendance()[dateStr] || { areas: {} };

        const designationMap = {};

        areas.forEach(areaName => {
            const areaData = attendance.areas[areaName] || { rows: [] };
            areaData.rows.forEach(row => {
                const key = row.designationLabel;
                if (!designationMap[key]) {
                    designationMap[key] = { total: 0, count: 0, areas: new Set() };
                }
                if (row.present) {
                    designationMap[key].total += row.present;
                    designationMap[key].count++;
                }
                designationMap[key].areas.add(areaName);
            });
        });

        let csv = 'date,designation,present_total,total_rows,areas_count\n';

        Object.entries(designationMap).forEach(([designation, data]) => {
            csv += `${dateStr},"${designation}",${data.total},${data.count},${data.areas.size}\n`;
        });

        this._downloadCSV(csv, `headcount_designation_summary_${dateStr}.csv`);
    },

    _downloadCSV(content, filename) {
        const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.href = url;
        link.download = filename;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }
};

// ============================================
// VIEW CONTROLLERS
// ============================================
const HomeView = {
    init() {
        const dateInput = document.getElementById('home-date');
        if (dateInput) {
            dateInput.value = Utils.getTodayString();
            dateInput.addEventListener('change', () => this.render());
        }

        const editBtn = document.getElementById('home-edit-today-btn');
        if (editBtn) {
            editBtn.addEventListener('click', () => {
                const ed = document.getElementById('entry-date');
                if (ed) ed.value = Utils.getTodayString();
                UI.switchView('entry');
                EntryView.render();
            });
        }

        this.render();
    },

    render() {
        const user = Auth.getCurrentUser();
        if (!user) return;

        const dateStr = document.getElementById('home-date')?.value || Utils.getTodayString();
        const areas = user.role === 'admin' ? Storage.getAreas() : user.assignedAreas;

        const totalPresent = Attendance.getGrandTotal(dateStr, areas);
        Utils.setText(document.getElementById('home-total-present'), totalPresent);

        let confirmedCount = 0;
        let totalAreas = 0;
        const unconfirmedList = document.getElementById('home-unconfirmed-list');
        if (unconfirmedList) {
            unconfirmedList.innerHTML = '';

            areas.forEach(areaName => {
                const { total, confirmed, rows } = Attendance.getAreaTotals(dateStr, areaName);
                if (rows > 0) {
                    totalAreas++;
                    confirmedCount += confirmed;

                    if (confirmed < rows) {
                        const chip = document.createElement('div');
                        chip.className = 'unconfirmed-chip';
                        Utils.setText(chip, `${areaName} (${confirmed}/${rows})`);
                        unconfirmedList.appendChild(chip);
                    }
                }
            });

            if (unconfirmedList.children.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'unconfirmed-empty';
                Utils.setText(empty, 'All areas confirmed');
                unconfirmedList.appendChild(empty);
            }
        }

        Utils.setText(document.getElementById('home-confirmed-count'), `${confirmedCount} / ${totalAreas || areas.length}`);

        const tbody = document.querySelector('#home-table tbody');
        if (tbody) {
            tbody.innerHTML = '';
            areas.forEach(areaName => {
                const { total, confirmed, rows } = Attendance.getAreaTotals(dateStr, areaName);
                const area = Attendance.getAreaData(dateStr, areaName);
                const lastUpdate = area.rows.length > 0
                    ? Math.max(...area.rows.map(r => r.updatedAt || 0))
                    : null;

                const row = tbody.insertRow();
                Utils.setText(row.insertCell(), areaName);
                Utils.setText(row.insertCell(), total);
                Utils.setText(row.insertCell(), rows > 0 ? `${confirmed}/${rows}` : '-');
                Utils.setText(row.insertCell(), lastUpdate ? Utils.formatDateTime(lastUpdate) : '-');
            });
        }
    }
};

const EntryView = {
    debounceTimers: {},

    init() {
        const dateInput = document.getElementById('entry-date');
        if (dateInput) {
            dateInput.value = Utils.getTodayString();
            dateInput.addEventListener('change', () => this.render());
        }

        const saveBtn = document.getElementById('entry-save-btn');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => {
                UI.showToast('Saved', 'success');
            });
        }

        const confirmBtn = document.getElementById('entry-confirm-all-btn');
        if (confirmBtn) {
            confirmBtn.addEventListener('click', () => this.confirmAll());
        }

        const clearBtn = document.getElementById('entry-clear-all-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                UI.confirm('Clear all entries for this date?', () => this.clearAll());
            });
        }

        const auditBtn = document.getElementById('entry-show-audit-btn');
        if (auditBtn) {
            auditBtn.addEventListener('click', () => this.showAudit());
        }

        const auditCloseBtn = document.getElementById('audit-close-btn');
        if (auditCloseBtn) {
            auditCloseBtn.addEventListener('click', () => {
                const drawer = document.getElementById('audit-drawer');
                if (drawer) drawer.style.display = 'none';
            });
        }

        this.render();
    },

    render() {
        const user = Auth.getCurrentUser();
        if (!user) return;

        const dateStr = document.getElementById('entry-date')?.value || Utils.getTodayString();
        const areas = user.role === 'admin' ? Storage.getAreas() : user.assignedAreas;

        const container = document.getElementById('entry-areas-container');
        if (!container) return;

        container.innerHTML = '';

        areas.forEach(areaName => {
            const card = document.createElement('div');
            card.className = 'entry-area-card';

            const header = document.createElement('div');
            header.className = 'entry-area-header';
            Utils.setText(header, areaName);
            card.appendChild(header);

            const areaData = Attendance.getAreaData(dateStr, areaName);
            const rows = areaData.rows || [];

            const table = document.createElement('table');
            table.className = 'entry-area-table';

            const thead = table.createTHead();
            const headerRow = thead.insertRow();
            ['Designation', 'Present', 'Confirm', 'Updated'].forEach(label => {
                const th = document.createElement('th');
                Utils.setText(th, label);
                headerRow.appendChild(th);
            });

            const tbody = table.createTBody();
            rows.forEach(row => {
                const tr = tbody.insertRow();

                const tdDesig = tr.insertCell();
                Utils.setText(tdDesig, row.designationLabel);

                const tdPresent = tr.insertCell();
                const inputPresent = document.createElement('input');
                inputPresent.type = 'number';
                inputPresent.min = '0';
                inputPresent.value = row.present !== null ? row.present : '';
                inputPresent.addEventListener('change', () => {
                    const val = inputPresent.value === '' ? null : parseInt(inputPresent.value);
                    Attendance.updateRow(dateStr, areaName, row.designationKey, { present: val });
                    UI.showToast('Saved', 'success');
                });
                tdPresent.appendChild(inputPresent);

                const tdConfirm = tr.insertCell();
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.checked = row.confirmed;
                checkbox.addEventListener('change', () => {
                    if (checkbox.checked && (row.present === null || row.present === '')) {
                        checkbox.checked = false;
                        UI.showToast('Cannot confirm without a present count', 'warning');
                        return;
                    }
                    Attendance.updateRow(dateStr, areaName, row.designationKey, { confirmed: checkbox.checked });
                    UI.showToast('Saved', 'success');
                });
                tdConfirm.appendChild(checkbox);

                const tdUpdated = tr.insertCell();
                Utils.setText(tdUpdated, row.updatedAt ? Utils.formatDateTime(row.updatedAt) : '-');
            });

            card.appendChild(table);

            const addSection = document.createElement('div');
            addSection.className = 'entry-add-section';

            const inputLabel = document.createElement('input');
            inputLabel.type = 'text';
            inputLabel.placeholder = 'Add designation...';
            inputLabel.className = 'entry-designation-input';

            const suggestions = document.createElement('div');
            suggestions.className = 'entry-suggestions';
            suggestions.style.display = 'none';

            inputLabel.addEventListener('input', () => {
                const sugg = DesignationMgr.getSuggestions(inputLabel.value, areaName);
                suggestions.innerHTML = '';
                if (inputLabel.value && sugg.length > 0) {
                    sugg.forEach(s => {
                        const div = document.createElement('div');
                        div.className = 'entry-suggestion-item';
                        Utils.setText(div, s);
                        div.addEventListener('click', () => {
                            inputLabel.value = s;
                            suggestions.style.display = 'none';
                            Attendance.addOrUpdateRow(dateStr, areaName, s);
                            this.render();
                        });
                        suggestions.appendChild(div);
                    });
                    suggestions.style.display = 'block';
                } else {
                    suggestions.style.display = 'none';
                }
            });

            inputLabel.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && inputLabel.value.trim()) {
                    Attendance.addOrUpdateRow(dateStr, areaName, inputLabel.value.trim());
                    inputLabel.value = '';
                    suggestions.style.display = 'none';
                    this.render();
                }
            });

            addSection.appendChild(inputLabel);
            addSection.appendChild(suggestions);
            card.appendChild(addSection);

            const clearBtn = document.createElement('button');
            clearBtn.className = 'btn btn-danger btn-sm';
            Utils.setText(clearBtn, 'Clear Area');
            clearBtn.addEventListener('click', () => {
                UI.confirm(`Clear all entries for ${areaName}?`, () => {
                    rows.forEach(r => Attendance.deleteRow(dateStr, areaName, r.designationKey));
                    this.render();
                });
            });
            card.appendChild(clearBtn);

            container.appendChild(card);
        });
    },

    confirmAll() {
        const user = Auth.getCurrentUser();
        if (!user) return;

        const dateStr = document.getElementById('entry-date')?.value || Utils.getTodayString();
        const areas = user.role === 'admin' ? Storage.getAreas() : user.assignedAreas;

        let count = 0;
        areas.forEach(areaName => {
            const areaData = Attendance.getAreaData(dateStr, areaName);
            (areaData.rows || []).forEach(row => {
                if (!row.confirmed && row.present !== null && row.present !== '') {
                    Attendance.updateRow(dateStr, areaName, row.designationKey, { confirmed: true });
                    count++;
                }
            });
        });

        this.render();
        UI.showToast(`Confirmed ${count} row(s)`, 'success');
    },

    clearAll() {
        const user = Auth.getCurrentUser();
        if (!user) return;

        const dateStr = document.getElementById('entry-date')?.value || Utils.getTodayString();
        const areas = user.role === 'admin' ? Storage.getAreas() : user.assignedAreas;

        areas.forEach(areaName => {
            const areaData = Attendance.getAreaData(dateStr, areaName);
            const rowKeys = (areaData.rows || []).map(r => r.designationKey);
            rowKeys.forEach(key => Attendance.deleteRow(dateStr, areaName, key));
        });

        this.render();
        UI.showToast('All entries cleared', 'success');
    },

    showAudit() {
        const dateStr = document.getElementById('entry-date')?.value || Utils.getTodayString();
        const entries = Audit.getEntries(dateStr);

        const list = document.getElementById('audit-list');
        if (!list) return;

        list.innerHTML = '';
        if (entries.length === 0) {
            const empty = document.createElement('div');
            Utils.setText(empty, 'No audit entries');
            list.appendChild(empty);
        } else {
            entries.forEach(entry => {
                const div = document.createElement('div');
                div.className = 'audit-entry';
                Utils.setText(div, `${Utils.formatDateTime(entry.ts)} - ${entry.user} changed ${entry.area} (${entry.designationKey}): ${entry.field} ${entry.from} → ${entry.to}`);
                list.appendChild(div);
            });
        }

        const drawer = document.getElementById('audit-drawer');
        if (drawer) drawer.style.display = 'block';
    }
};

const ExportView = {
    init() {
        const dateInput = document.getElementById('export-single-date');
        if (dateInput) {
            dateInput.value = Utils.getTodayString();
        }

        const detailedBtn = document.getElementById('export-detailed-btn');
        if (detailedBtn) {
            detailedBtn.addEventListener('click', () => {
                const date = dateInput?.value || Utils.getTodayString();
                Exports.exportDetailed(date);
                UI.showToast('Exported detailed CSV', 'success');
            });
        }

        const areaBtn = document.getElementById('export-area-summary-btn');
        if (areaBtn) {
            areaBtn.addEventListener('click', () => {
                const date = dateInput?.value || Utils.getTodayString();
                Exports.exportAreaSummary(date);
                UI.showToast('Exported area summary CSV', 'success');
            });
        }

        const desigBtn = document.getElementById('export-designation-summary-btn');
        if (desigBtn) {
            desigBtn.addEventListener('click', () => {
                const date = dateInput?.value || Utils.getTodayString();
                Exports.exportDesignationSummary(date);
                UI.showToast('Exported designation summary CSV', 'success');
            });
        }
    }
};

const BackupView = {
    init() {
        const retentionInput = document.getElementById('retention-days-input');
        if (retentionInput) {
            const settings = Storage.getSettings();
            retentionInput.value = settings.retentionDays;
        }

        const exportBtn = document.getElementById('backup-export-btn');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => this.exportBackup());
        }

        const importBtn = document.getElementById('backup-import-btn');
        if (importBtn) {
            importBtn.addEventListener('click', () => this.importBackup());
        }

        const updateBtn = document.getElementById('retention-update-btn');
        if (updateBtn) {
            updateBtn.addEventListener('click', () => {
                const days = parseInt(retentionInput?.value || 180);
                if (days < 1 || days > 730) {
                    UI.showToast('Invalid retention days', 'error');
                    return;
                }
                const settings = Storage.getSettings();
                settings.retentionDays = days;
                Storage.saveSettings(settings);
                UI.showToast('Retention updated', 'success');
                this.updateRetentionInfo();
            });
        }

        const cleanBtn = document.getElementById('retention-clean-btn');
        if (cleanBtn) {
            cleanBtn.addEventListener('click', () => {
                UI.confirm('Delete old data?', () => this.cleanOldData());
            });
        }

        this.updateRetentionInfo();
    },

    exportBackup() {
        const backup = {
            version: 1,
            exportedAt: Date.now(),
            settings: Storage.getSettings(),
            areas: Storage.getAreas(),
            users: Storage.getUsers(),
            attendance: Storage.getAttendance(),
            designationHistory: Storage.getDesignationHistory()
        };

        const json = JSON.stringify(backup, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.href = url;
        link.download = `headcount_backup_${Utils.getTodayString()}.json`;
        link.click();
        URL.revokeObjectURL(url);

        UI.showToast('Backup exported', 'success');
    },

    importBackup() {
        const input = document.getElementById('backup-import-input');
        if (!input?.files[0]) {
            UI.showToast('Select a file', 'error');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const backup = JSON.parse(e.target.result);
                if (!backup.version || !backup.settings) {
                    throw new Error('Invalid backup');
                }

                UI.confirm('Overwrite all data?', () => {
                    Storage.saveSettings(backup.settings);
                    Storage.saveAreas(backup.areas || []);
                    Storage.saveUsers(backup.users || []);
                    Storage.saveAttendance(backup.attendance || {});
                    if (backup.designationHistory) {
                        Storage.saveDesignationHistory(backup.designationHistory);
                    }

                    UI.showToast('Imported. Reloading...', 'success');
                    setTimeout(() => window.location.reload(), 1500);
                });
            } catch (err) {
                UI.showToast('Import failed: ' + err.message, 'error');
            }
        };
        reader.readAsText(input.files[0]);
    },

    updateRetentionInfo() {
        const settings = Storage.getSettings();
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - settings.retentionDays);

        const att = Storage.getAttendance();
        const oldCount = Object.keys(att).filter(d => new Date(d) < cutoffDate).length;

        const info = document.getElementById('retention-info');
        if (info) {
            Utils.setText(info, `Keeping ${settings.retentionDays} days. ${oldCount} date(s) can be cleaned.`);
        }
    },

    cleanOldData() {
        const settings = Storage.getSettings();
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - settings.retentionDays);

        const att = Storage.getAttendance();
        let deleted = 0;

        Object.keys(att).forEach(d => {
            if (new Date(d) < cutoffDate) {
                delete att[d];
                deleted++;
            }
        });

        Storage.saveAttendance(att);
        UI.showToast(`Cleaned ${deleted} date(s)`, 'success');
        this.updateRetentionInfo();
    }
};

const AdminView = {
    init() {
        const createBtn = document.getElementById('admin-create-user-btn');
        if (createBtn) {
            createBtn.addEventListener('click', () => this.showCreateUserModal());
        }

        const areaBtn = document.getElementById('admin-add-area-btn');
        if (areaBtn) {
            areaBtn.addEventListener('click', () => this.showAddAreaModal());
        }

        this.render();
    },

    render() {
        this.renderUsersTable();
        this.renderAreasTable();
    },

    renderUsersTable() {
        const tbody = document.querySelector('#admin-users-table tbody');
        if (!tbody) return;

        tbody.innerHTML = '';
        Storage.getUsers().forEach(user => {
            const row = tbody.insertRow();
            Utils.setText(row.insertCell(), user.username);
            Utils.setText(row.insertCell(), user.role);
            Utils.setText(row.insertCell(), user.assignedAreas.join(', ') || 'All');
            Utils.setText(row.insertCell(), user.disabled ? 'Disabled' : 'Active');

            const actions = row.insertCell();
            const resetBtn = document.createElement('button');
            resetBtn.className = 'btn btn-secondary btn-sm';
            Utils.setText(resetBtn, 'Reset Pwd');
            resetBtn.addEventListener('click', () => this.resetPassword(user.username));
            actions.appendChild(resetBtn);

            const toggleBtn = document.createElement('button');
            toggleBtn.className = 'btn btn-secondary btn-sm';
            Utils.setText(toggleBtn, user.disabled ? 'Enable' : 'Disable');
            toggleBtn.addEventListener('click', () => this.toggleUser(user.username));
            actions.appendChild(toggleBtn);
        });
    },

    renderAreasTable() {
        const tbody = document.querySelector('#admin-areas-table tbody');
        if (!tbody) return;

        tbody.innerHTML = '';
        Storage.getAreas().forEach(area => {
            const row = tbody.insertRow();
            Utils.setText(row.insertCell(), area);

            const actions = row.insertCell();
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'btn btn-danger btn-sm';
            Utils.setText(deleteBtn, 'Delete');
            deleteBtn.addEventListener('click', () => this.deleteArea(area));
            actions.appendChild(deleteBtn);
        });
    },

    showCreateUserModal() {
        const areas = Storage.getAreas();
        let areasHTML = '<div class="area-select">';
        areas.forEach(area => {
            areasHTML += `<label><input type="checkbox" value="${area}"> ${area}</label>`;
        });
        areasHTML += '</div>';

        const bodyHTML = `
            <div class="form-group">
                <label>Username:</label>
                <input type="text" id="new-username" autocomplete="off">
            </div>
            <div class="form-group">
                <label>Role:</label>
                <select id="new-role">
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                </select>
            </div>
            <div class="form-group">
                <label>Assigned Areas:</label>
                ${areasHTML}
            </div>
            <div id="create-error" class="error-message"></div>
        `;

        UI.showModal('Create User', bodyHTML, [
            { text: 'Cancel', className: 'btn-secondary' },
            {
                text: 'Create',
                className: 'btn-primary',
                closeOnClick: false,
                onClick: async () => {
                    const username = document.getElementById('new-username')?.value.trim();
                    const role = document.getElementById('new-role')?.value;
                    const errorDiv = document.getElementById('create-error');

                    const selected = Array.from(document.querySelectorAll('#new-username').parentElement?.parentElement?.querySelectorAll('input[type="checkbox"]:checked') || [])
                        .map(c => c.value);

                    if (!username) {
                        Utils.setText(errorDiv, 'Username required');
                        return;
                    }

                    try {
                        const tempPwd = Utils.generatePassword();
                        await Auth.createUser(username, tempPwd, role, selected);

                        document.querySelector('.modal-overlay')?.remove();

                        UI.showModal('User Created', `
                            <p>Username: ${username}</p>
                            <p>Temp Password: <code>${tempPwd}</code></p>
                        `, [
                            { text: 'OK', className: 'btn-primary' }
                        ]);

                        this.render();
                    } catch (err) {
                        Utils.setText(errorDiv, err.message);
                    }
                }
            }
        ]);
    },

    resetPassword(username) {
        const tempPwd = Utils.generatePassword();
        UI.confirm(`Reset password for ${username}?`, async () => {
            await Auth.resetPassword(username, tempPwd);
            UI.showModal('Password Reset', `
                <p>Username: ${username}</p>
                <p>New Temp Password: <code>${tempPwd}</code></p>
            `, [
                { text: 'OK', className: 'btn-primary' }
            ]);
        });
    },

    toggleUser(username) {
        const users = Storage.getUsers();
        const user = users.find(u => u.username === username);
        if (user) {
            user.disabled = !user.disabled;
            Storage.saveUsers(users);
            UI.showToast(`User ${user.disabled ? 'disabled' : 'enabled'}`, 'success');
            this.render();
        }
    },

    showAddAreaModal() {
        const bodyHTML = `
            <div class="form-group">
                <label>Area Name:</label>
                <input type="text" id="new-area-name" autocomplete="off">
            </div>
            <div id="add-area-error" class="error-message"></div>
        `;

        UI.showModal('Add Area', bodyHTML, [
            { text: 'Cancel', className: 'btn-secondary' },
            {
                text: 'Add',
                className: 'btn-primary',
                closeOnClick: false,
                onClick: () => {
                    const name = document.getElementById('new-area-name')?.value.trim();
                    const errorDiv = document.getElementById('add-area-error');

                    if (!name) {
                        Utils.setText(errorDiv, 'Name required');
                        return;
                    }

                    const areas = Storage.getAreas();
                    if (areas.includes(name)) {
                        Utils.setText(errorDiv, 'Already exists');
                        return;
                    }

                    areas.push(name);
                    Storage.saveAreas(areas);

                    document.querySelector('.modal-overlay')?.remove();
                    UI.showToast('Area added', 'success');
                    this.render();
                }
            }
        ]);
    },

    deleteArea(area) {
        UI.confirm(`Delete "${area}"?`, () => {
            const areas = Storage.getAreas();
            const idx = areas.indexOf(area);
            if (idx >= 0) {
                areas.splice(idx, 1);
                Storage.saveAreas(areas);
                UI.showToast('Area deleted', 'success');
                this.render();
            }
        });
    }
};

// ============================================
// APP INITIALIZATION
// ============================================
const App = {
    init() {
        // CRITICAL FIRST-RUN CHECK
        if (this.checkFirstRun()) {
            return; // STOP HERE - do not proceed
        }

        // Setup UI basics
        this.setupTheme();
        this.setupNavigation();
        this.setupLogout();

        // Check if already logged in
        const user = Auth.getCurrentUser();
        if (user) {
            this.showMainApp();
        } else {
            UI.switchScreen('login-screen');
            this.setupLoginForm();
        }
    },

    checkFirstRun() {
        const users = Storage.getUsers();
        const hasAdmin = users.some(u => u.role === 'admin' && !u.disabled);

        if (users.length === 0 || !hasAdmin) {
            // First run: no users or no admin
            const areas = Storage.getAreas();
            if (areas.length === 0) {
                Storage.saveAreas(CONFIG.DEFAULT_AREAS);
            }

            this.setupTheme();
            this.setupLogout();

            UI.switchScreen('create-admin-screen');
            this.setupCreateAdminForm();

            return true; // Signal that we handled first run
        }

        return false;
    },

    setupCreateAdminForm() {
        const btn = document.getElementById('create-admin-btn');
        if (!btn) return;

        btn.addEventListener('click', async () => {
            const username = document.getElementById('admin-username')?.value.trim();
            const password = document.getElementById('admin-password')?.value;
            const confirm = document.getElementById('admin-password-confirm')?.value;
            const errorDiv = document.getElementById('admin-error');

            Utils.setText(errorDiv, '');

            if (!username || !password) {
                Utils.setText(errorDiv, 'Username and password required');
                return;
            }

            if (password !== confirm) {
                Utils.setText(errorDiv, 'Passwords do not match');
                return;
            }

            if (password.length < 6) {
                Utils.setText(errorDiv, 'Password must be 6+ characters');
                return;
            }

            try {
                await Auth.createUser(username, password, 'admin');
                document.getElementById('admin-username').value = '';
                document.getElementById('admin-password').value = '';
                document.getElementById('admin-password-confirm').value = '';

                UI.showToast('Admin created', 'success');
                UI.switchScreen('login-screen');
                this.setupLoginForm();
            } catch (err) {
                Utils.setText(errorDiv, err.message);
            }
        });
    },

    setupLoginForm() {
        const btn = document.getElementById('login-btn');
        if (btn) {
            btn.addEventListener('click', () => this.handleLogin());
        }

        const pwd = document.getElementById('login-password');
        if (pwd) {
            pwd.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') this.handleLogin();
            });
        }
    },

    async handleLogin() {
        const username = document.getElementById('login-username')?.value.trim();
        const password = document.getElementById('login-password')?.value;
        const errorDiv = document.getElementById('login-error');

        Utils.setText(errorDiv, '');

        if (!username || !password) {
            Utils.setText(errorDiv, 'Username and password required');
            return;
        }

        try {
            await Auth.login(username, password);
            document.getElementById('login-username').value = '';
            document.getElementById('login-password').value = '';
            this.showMainApp();
        } catch (err) {
            Utils.setText(errorDiv, err.message);
        }
    },

    showMainApp() {
        UI.switchScreen('app-screen');
        this.setupNavigation();
        this.setupLogout();

        const user = Auth.getCurrentUser();
        const adminBtn = document.getElementById('admin-nav-btn');
        if (adminBtn) {
            adminBtn.style.display = (user && user.role === 'admin') ? 'flex' : 'none';
        }

        HomeView.init();
        EntryView.init();
        ExportView.init();
        BackupView.init();

        if (user && user.role === 'admin') {
            AdminView.init();
        }

        UI.switchView('home');
    },

    setupNavigation() {
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const view = btn.dataset.view;
                UI.switchView(view);

                if (view === 'home') HomeView.render();
                if (view === 'entry') EntryView.render();
                if (view === 'admin') AdminView.render();
            });
        });
    },

    setupLogout() {
        const btn = document.getElementById('logout-btn');
        if (btn) {
            btn.addEventListener('click', () => {
                UI.confirm('Logout?', () => {
                    Auth.logout();
                    window.location.reload();
                });
            });
        }
    },

    setupTheme() {
        const toggle = document.getElementById('theme-toggle');
        if (!toggle) return;

        const settings = Storage.getSettings();
        if (settings.darkMode) {
            document.body.setAttribute('data-theme', 'dark');
            Utils.setText(toggle, '☀️');
        } else {
            Utils.setText(toggle, '🌙');
        }

        toggle.addEventListener('click', () => {
            const s = Storage.getSettings();
            s.darkMode = !s.darkMode;
            Storage.saveSettings(s);

            if (s.darkMode) {
                document.body.setAttribute('data-theme', 'dark');
                Utils.setText(toggle, '☀️');
            } else {
                document.body.removeAttribute('data-theme');
                Utils.setText(toggle, '🌙');
            }
        });
    }
};

// Start app when DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => App.init());
} else {
    App.init();
}
