// ============================================
// CONSTANTS & CONFIGURATION
// ============================================
const CONFIG = {
    SESSION_DURATION: 8 * 60 * 60 * 1000, // 8 hours
    LOCKOUT_DURATION: 5 * 60 * 1000, // 5 minutes
    MAX_LOGIN_ATTEMPTS: 5,
    DEBOUNCE_DELAY: 500, // ms
    MAX_AUDIT_ENTRIES: 10,
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
    SETTINGS: 'headcountSettings',
    AREAS: 'headcountAreasMaster',
    USERS: 'headcountUsers',
    SESSION: 'headcountSession',
    ATTENDANCE: 'headcountAttendance'
};

// ============================================
// UTILITY FUNCTIONS
// ============================================
const Utils = {
    // Date formatting
    formatDate(date) {
        if (!(date instanceof Date)) date = new Date(date);
        return date.toISOString().split('T')[0];
    },
    
    getTodayString() {
        return this.formatDate(new Date());
    },
    
    formatDateTime(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleString();
    },
    
    // Crypto functions for password hashing
    async generateSalt() {
        const array = new Uint8Array(16);
        crypto.getRandomValues(array);
        return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
    },
    
    async hashPassword(password, salt) {
        const encoder = new TextEncoder();
        const data = encoder.encode(password + salt);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    },
    
    // Random password generator
    generatePassword(length = 12) {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
        let password = '';
        const array = new Uint8Array(length);
        crypto.getRandomValues(array);
        for (let i = 0; i < length; i++) {
            password += chars[array[i] % chars.length];
        }
        return password;
    },
    
    // Safe text content setting (XSS prevention)
    setText(element, text) {
        if (element) {
            element.textContent = text || '';
        }
    },
    
    // Debounce function
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }
};

// ============================================
// STORAGE MANAGEMENT
// ============================================
const Storage = {
    // Settings
    getSettings() {
        const data = localStorage.getItem(STORAGE_KEYS.SETTINGS);
        return data ? JSON.parse(data) : {
            darkMode: false,
            retentionDays: CONFIG.DEFAULT_RETENTION_DAYS
        };
    },
    
    saveSettings(settings) {
        localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
    },
    
    // Areas Master
    getAreas() {
        const data = localStorage.getItem(STORAGE_KEYS.AREAS);
        return data ? JSON.parse(data) : [];
    },
    
    saveAreas(areas) {
        localStorage.setItem(STORAGE_KEYS.AREAS, JSON.stringify(areas));
    },
    
    // Users
    getUsers() {
        const data = localStorage.getItem(STORAGE_KEYS.USERS);
        return data ? JSON.parse(data) : [];
    },
    
    saveUsers(users) {
        localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(users));
    },
    
    // Session
    getSession() {
        const data = localStorage.getItem(STORAGE_KEYS.SESSION);
        return data ? JSON.parse(data) : {
            currentUser: null,
            sessionExpiresAt: null,
            failedLogin: { count: 0, cooldownUntil: null }
        };
    },
    
    saveSession(session) {
        localStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify(session));
    },
    
    // Attendance
    getAttendance() {
        const data = localStorage.getItem(STORAGE_KEYS.ATTENDANCE);
        return data ? JSON.parse(data) : {};
    },
    
    saveAttendance(attendance) {
        localStorage.setItem(STORAGE_KEYS.ATTENDANCE, JSON.stringify(attendance));
    },
    
    getAttendanceForDate(dateString) {
        const allAttendance = this.getAttendance();
        return allAttendance[dateString] || {
            areas: {},
            audit: [],
            updatedAt: null,
            updatedBy: null
        };
    },
    
    saveAttendanceForDate(dateString, data) {
        const allAttendance = this.getAttendance();
        allAttendance[dateString] = data;
        this.saveAttendance(allAttendance);
    }
};

// ============================================
// AUTHENTICATION & SESSION
// ============================================
const Auth = {
    async createUser(username, password, role, assignedAreas = []) {
        const users = Storage.getUsers();
        
        if (users.find(u => u.username === username)) {
            throw new Error('Username already exists');
        }
        
        const salt = await Utils.generateSalt();
        const passwordHash = await Utils.hashPassword(password, salt);
        
        const user = {
            username,
            role,
            salt,
            passwordHash,
            assignedAreas,
            createdAt: Date.now(),
            disabled: false
        };
        
        users.push(user);
        Storage.saveUsers(users);
        return user;
    },
    
    async login(username, password) {
        const session = Storage.getSession();
        
        // Check lockout
        if (session.failedLogin.cooldownUntil && Date.now() < session.failedLogin.cooldownUntil) {
            const remainingMs = session.failedLogin.cooldownUntil - Date.now();
            const remainingMin = Math.ceil(remainingMs / 60000);
            throw new Error(`Account locked. Try again in ${remainingMin} minute(s).`);
        }
        
        const users = Storage.getUsers();
        const user = users.find(u => u.username === username);
        
        if (!user) {
            this.handleFailedLogin();
            throw new Error('Invalid username or password');
        }
        
        if (user.disabled) {
            throw new Error('Account is disabled');
        }
        
        const passwordHash = await Utils.hashPassword(password, user.salt);
        
        if (passwordHash !== user.passwordHash) {
            this.handleFailedLogin();
            throw new Error('Invalid username or password');
        }
        
        // Successful login
        session.currentUser = username;
        session.sessionExpiresAt = Date.now() + CONFIG.SESSION_DURATION;
        session.failedLogin = { count: 0, cooldownUntil: null };
        Storage.saveSession(session);
        
        return user;
    },
    
    handleFailedLogin() {
        const session = Storage.getSession();
        session.failedLogin.count++;
        
        if (session.failedLogin.count >= CONFIG.MAX_LOGIN_ATTEMPTS) {
            session.failedLogin.cooldownUntil = Date.now() + CONFIG.LOCKOUT_DURATION;
        }
        
        Storage.saveSession(session);
    },
    
    logout() {
        const session = Storage.getSession();
        session.currentUser = null;
        session.sessionExpiresAt = null;
        Storage.saveSession(session);
    },
    
    getCurrentUser() {
        const session = Storage.getSession();
        
        if (!session.currentUser) return null;
        
        // Check session expiration
        if (session.sessionExpiresAt && Date.now() > session.sessionExpiresAt) {
            this.logout();
            return null;
        }
        
        const users = Storage.getUsers();
        const user = users.find(u => u.username === session.currentUser);
        
        if (!user || user.disabled) {
            this.logout();
            return null;
        }
        
        return user;
    },
    
    isAdmin() {
        const user = this.getCurrentUser();
        return user && user.role === 'admin';
    },
    
    async resetPassword(username, newPassword) {
        const users = Storage.getUsers();
        const user = users.find(u => u.username === username);
        
        if (!user) throw new Error('User not found');
        
        const salt = await Utils.generateSalt();
        const passwordHash = await Utils.hashPassword(newPassword, salt);
        
        user.salt = salt;
        user.passwordHash = passwordHash;
        
        Storage.saveUsers(users);
    }
};

// ============================================
// AUDIT TRAIL
// ============================================
const Audit = {
    addEntry(dateString, area, field, oldValue, newValue) {
        const user = Auth.getCurrentUser();
        if (!user) return;
        
        const attendanceData = Storage.getAttendanceForDate(dateString);
        
        const entry = {
            ts: Date.now(),
            user: user.username,
            area,
            field,
            from: oldValue,
            to: newValue
        };
        
        attendanceData.audit.unshift(entry);
        
        // Keep only last 10 entries
        if (attendanceData.audit.length > CONFIG.MAX_AUDIT_ENTRIES) {
            attendanceData.audit = attendanceData.audit.slice(0, CONFIG.MAX_AUDIT_ENTRIES);
        }
        
        Storage.saveAttendanceForDate(dateString, attendanceData);
    },
    
    getEntries(dateString) {
        const attendanceData = Storage.getAttendanceForDate(dateString);
        return attendanceData.audit || [];
    }
};

// ============================================
// ATTENDANCE MANAGEMENT
// ============================================
const Attendance = {
    getAreaData(dateString, areaName) {
        const attendanceData = Storage.getAttendanceForDate(dateString);
        return attendanceData.areas[areaName] || {
            presentCount: null,
            confirmed: false,
            updatedAt: null,
            updatedBy: null
        };
    },
    
    updateArea(dateString, areaName, updates) {
        const user = Auth.getCurrentUser();
        if (!user) return;
        
        const attendanceData = Storage.getAttendanceForDate(dateString);
        const oldData = attendanceData.areas[areaName] || {
            presentCount: null,
            confirmed: false,
            updatedAt: null,
            updatedBy: null
        };
        
        // Track changes for audit
        if ('presentCount' in updates && updates.presentCount !== oldData.presentCount) {
            Audit.addEntry(dateString, areaName, 'presentCount', oldData.presentCount, updates.presentCount);
        }
        
        if ('confirmed' in updates && updates.confirmed !== oldData.confirmed) {
            Audit.addEntry(dateString, areaName, 'confirmed', oldData.confirmed, updates.confirmed);
        }
        
        attendanceData.areas[areaName] = {
            ...oldData,
            ...updates,
            updatedAt: Date.now(),
            updatedBy: user.username
        };
        
        attendanceData.updatedAt = Date.now();
        attendanceData.updatedBy = user.username;
        
        Storage.saveAttendanceForDate(dateString, attendanceData);
    },
    
    getTotalPresent(dateString, areas = null) {
        const attendanceData = Storage.getAttendanceForDate(dateString);
        const areasToCount = areas || Object.keys(attendanceData.areas);
        
        return areasToCount.reduce((total, areaName) => {
            const areaData = attendanceData.areas[areaName];
            if (areaData && typeof areaData.presentCount === 'number') {
                return total + areaData.presentCount;
            }
            return total;
        }, 0);
    },
    
    getConfirmedCount(dateString, areas = null) {
        const attendanceData = Storage.getAttendanceForDate(dateString);
        const areasToCount = areas || Object.keys(attendanceData.areas);
        
        return areasToCount.reduce((count, areaName) => {
            const areaData = attendanceData.areas[areaName];
            if (areaData && areaData.confirmed) {
                return count + 1;
            }
            return count;
        }, 0);
    },
    
    getUnconfirmedAreas(dateString, areas) {
        const attendanceData = Storage.getAttendanceForDate(dateString);
        return areas.filter(areaName => {
            const areaData = attendanceData.areas[areaName];
            return !areaData || !areaData.confirmed;
        });
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
        container.appendChild(toast);
        
        setTimeout(() => {
            toast.remove();
        }, 3000);
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
        container.appendChild(overlay);
        
        return { overlay, modal, body };
    },
    
    confirm(message, onConfirm) {
        this.showModal('Confirm', `<p>${message}</p>`, [
            { text: 'Cancel', className: 'btn-secondary' },
            { text: 'Confirm', className: 'btn-primary', onClick: onConfirm }
        ]);
    },
    
    switchScreen(screenId) {
        document.querySelectorAll('.screen').forEach(screen => {
            screen.style.display = 'none';
        });
        const targetScreen = document.getElementById(screenId);
        if (targetScreen) {
            targetScreen.style.display = 'block';
        }
    },
    
    switchView(viewId) {
        document.querySelectorAll('.view').forEach(view => {
            view.style.display = 'none';
        });
        const targetView = document.getElementById(`${viewId}-view`);
        if (targetView) {
            targetView.style.display = 'block';
        }
        
        // Update nav buttons
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        const activeBtn = document.querySelector(`.nav-btn[data-view="${viewId}"]`);
        if (activeBtn) {
            activeBtn.classList.add('active');
        }
    }
};

// ============================================
// CSV EXPORT
// ============================================
const CSVExport = {
    exportSingleDay(dateString) {
        const areas = Storage.getAreas();
        const attendanceData = Storage.getAttendanceForDate(dateString);
        
        let csv = 'date,area,present_count,confirmed,updated_at,updated_by\n';
        
        let totalPresent = 0;
        
        areas.forEach(areaName => {
            const areaData = attendanceData.areas[areaName] || {
                presentCount: null,
                confirmed: false,
                updatedAt: null,
                updatedBy: null
            };
            
            const presentCount = areaData.presentCount !== null ? areaData.presentCount : '';
            const confirmed = areaData.confirmed ? 'true' : 'false';
            const updatedAt = areaData.updatedAt ? Utils.formatDateTime(areaData.updatedAt) : '';
            const updatedBy = areaData.updatedBy || '';
            
            csv += `${dateString},"${areaName}",${presentCount},${confirmed},"${updatedAt}","${updatedBy}"\n`;
            
            if (typeof areaData.presentCount === 'number') {
                totalPresent += areaData.presentCount;
            }
        });
        
        csv += `${dateString},TOTAL,${totalPresent},,,\n`;
        
        this.downloadCSV(csv, `headcount_${dateString}.csv`);
    },
    
    exportDateRange(fromDate, toDate) {
        const areas = Storage.getAreas();
        const allAttendance = Storage.getAttendance();
        
        let csv = 'date,area,present_count,confirmed,updated_at,updated_by\n';
        
        const startDate = new Date(fromDate);
        const endDate = new Date(toDate);
        
        for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
            const dateString = Utils.formatDate(d);
            const attendanceData = allAttendance[dateString] || { areas: {} };
            
            areas.forEach(areaName => {
                const areaData = attendanceData.areas[areaName] || {
                    presentCount: null,
                    confirmed: false,
                    updatedAt: null,
                    updatedBy: null
                };
                
                const presentCount = areaData.presentCount !== null ? areaData.presentCount : '';
                const confirmed = areaData.confirmed ? 'true' : 'false';
                const updatedAt = areaData.updatedAt ? Utils.formatDateTime(areaData.updatedAt) : '';
                const updatedBy = areaData.updatedBy || '';
                
                csv += `${dateString},"${areaName}",${presentCount},${confirmed},"${updatedAt}","${updatedBy}"\n`;
            });
        }
        
        this.downloadCSV(csv, `headcount_${fromDate}_to_${toDate}.csv`);
    },
    
    downloadCSV(csvContent, filename) {
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
};

// ============================================
// VIEW CONTROLLERS
// ============================================
const HomeView = {
    init() {
        const dateInput = document.getElementById('home-date');
        dateInput.value = Utils.getTodayString();
        dateInput.addEventListener('change', () => this.render());
        
        document.getElementById('home-edit-today-btn').addEventListener('click', () => {
            document.getElementById('entry-date').value = Utils.getTodayString();
            UI.switchView('entry');
            EntryView.render();
        });
        
        document.getElementById('home-export-today-btn').addEventListener('click', () => {
            const date = document.getElementById('home-date').value;
            CSVExport.exportSingleDay(date);
            UI.showToast('CSV exported successfully', 'success');
        });
        
        this.render();
    },
    
    render() {
        const user = Auth.getCurrentUser();
        if (!user) return;
        
        const dateString = document.getElementById('home-date').value;
        const areas = user.role === 'admin' ? Storage.getAreas() : user.assignedAreas;
        
        // Total present
        const totalPresent = Attendance.getTotalPresent(dateString, areas);
        Utils.setText(document.getElementById('home-total-present'), totalPresent);
        
        // Confirmed count
        const confirmedCount = Attendance.getConfirmedCount(dateString, areas);
        Utils.setText(document.getElementById('home-confirmed-count'), `${confirmedCount} / ${areas.length}`);
        
        // Unconfirmed list
        const unconfirmedAreas = Attendance.getUnconfirmedAreas(dateString, areas);
        const unconfirmedList = document.getElementById('home-unconfirmed-list');
        unconfirmedList.innerHTML = '';
        
        if (unconfirmedAreas.length === 0) {
            const emptyMsg = document.createElement('div');
            emptyMsg.className = 'unconfirmed-empty';
            Utils.setText(emptyMsg, 'All areas confirmed');
            unconfirmedList.appendChild(emptyMsg);
        } else {
            unconfirmedAreas.forEach(areaName => {
                const chip = document.createElement('div');
                chip.className = 'unconfirmed-chip';
                Utils.setText(chip, areaName);
                unconfirmedList.appendChild(chip);
            });
        }
        
        // Area status table
        const tbody = document.querySelector('#home-table tbody');
        tbody.innerHTML = '';
        
        areas.forEach(areaName => {
            const areaData = Attendance.getAreaData(dateString, areaName);
            const row = tbody.insertRow();
            
            const cellArea = row.insertCell();
            Utils.setText(cellArea, areaName);
            
            const cellPresent = row.insertCell();
            Utils.setText(cellPresent, areaData.presentCount !== null ? areaData.presentCount : '-');
            
            const cellConfirmed = row.insertCell();
            Utils.setText(cellConfirmed, areaData.confirmed ? '✓' : '✗');
            
            const cellUpdated = row.insertCell();
            Utils.setText(cellUpdated, areaData.updatedAt ? Utils.formatDateTime(areaData.updatedAt) : '-');
        });
    }
};

const EntryView = {
    debounceTimers: {},
    
    init() {
        const dateInput = document.getElementById('entry-date');
        dateInput.value = Utils.getTodayString();
        dateInput.addEventListener('change', () => this.render());
        
        document.getElementById('entry-save-btn').addEventListener('click', () => {
            UI.showToast('Saved', 'success');
        });
        
        document.getElementById('entry-confirm-all-btn').addEventListener('click', () => {
            this.confirmAll();
        });
        
        document.getElementById('entry-clear-all-btn').addEventListener('click', () => {
            UI.confirm('Clear all entries for this date? This cannot be undone.', () => {
                this.clearAll();
            });
        });
        
        document.getElementById('entry-show-audit-btn').addEventListener('click', () => {
            this.showAudit();
        });
        
        document.getElementById('audit-close-btn').addEventListener('click', () => {
            document.getElementById('audit-drawer').style.display = 'none';
        });
        
        this.render();
    },
    
    render() {
        const user = Auth.getCurrentUser();
        if (!user) return;
        
        const dateString = document.getElementById('entry-date').value;
        const areas = user.role === 'admin' ? Storage.getAreas() : user.assignedAreas;
        
        const container = document.getElementById('entry-areas-container');
        container.innerHTML = '';
        
        areas.forEach(areaName => {
            const areaData = Attendance.getAreaData(dateString, areaName);
            
            const card = document.createElement('div');
            card.className = 'entry-area-card';
            
            const header = document.createElement('div');
            header.className = 'entry-area-header';
            Utils.setText(header, areaName);
            card.appendChild(header);
            
            const content = document.createElement('div');
            content.className = 'entry-area-content';
            
            const inputGroup = document.createElement('div');
            inputGroup.className = 'entry-input-group';
            
            const label = document.createElement('label');
            Utils.setText(label, 'Present Count');
            inputGroup.appendChild(label);
            
            const input = document.createElement('input');
            input.type = 'number';
            input.min = '0';
            input.step = '1';
            input.value = areaData.presentCount !== null ? areaData.presentCount : '';
            input.addEventListener('input', () => {
                this.debouncedSave(dateString, areaName, 'presentCount', input.value === '' ? null : parseInt(input.value));
            });
            inputGroup.appendChild(input);
            
            const warning = document.createElement('div');
            warning.className = 'entry-warning';
            warning.style.display = 'none';
            inputGroup.appendChild(warning);
            
            content.appendChild(inputGroup);
            
            const checkboxGroup = document.createElement('div');
            checkboxGroup.className = 'entry-checkbox-group';
            
            const checkLabel = document.createElement('label');
            Utils.setText(checkLabel, 'Confirmed');
            checkboxGroup.appendChild(checkLabel);
            
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'entry-checkbox';
            checkbox.checked = areaData.confirmed;
            checkbox.addEventListener('change', () => {
                const currentValue = input.value === '' ? null : parseInt(input.value);
                if (checkbox.checked && currentValue === null) {
                    checkbox.checked = false;
                    Utils.setText(warning, 'Cannot confirm without a present count');
                    warning.style.display = 'block';
                    setTimeout(() => {
                        warning.style.display = 'none';
                    }, 3000);
                } else {
                    warning.style.display = 'none';
                    Attendance.updateArea(dateString, areaName, { confirmed: checkbox.checked });
                    UI.showToast('Saved', 'success');
                }
            });
            checkboxGroup.appendChild(checkbox);
            
            content.appendChild(checkboxGroup);
            card.appendChild(content);
            
            if (areaData.updatedAt) {
                const footer = document.createElement('div');
                footer.className = 'entry-area-footer';
                Utils.setText(footer, `Last updated: ${Utils.formatDateTime(areaData.updatedAt)} by ${areaData.updatedBy}`);
                card.appendChild(footer);
            }
            
            container.appendChild(card);
        });
    },
    
    debouncedSave(dateString, areaName, field, value) {
        const key = `${dateString}-${areaName}-${field}`;
        
        if (this.debounceTimers[key]) {
            clearTimeout(this.debounceTimers[key]);
        }
        
        this.debounceTimers[key] = setTimeout(() => {
            Attendance.updateArea(dateString, areaName, { [field]: value });
            UI.showToast('Saved', 'success');
        }, CONFIG.DEBOUNCE_DELAY);
    },
    
    confirmAll() {
        const user = Auth.getCurrentUser();
        if (!user) return;
        
        const dateString = document.getElementById('entry-date').value;
        const areas = user.role === 'admin' ? Storage.getAreas() : user.assignedAreas;
        
        let confirmedCount = 0;
        
        areas.forEach(areaName => {
            const areaData = Attendance.getAreaData(dateString, areaName);
            if (areaData.presentCount !== null) {
                Attendance.updateArea(dateString, areaName, { confirmed: true });
                confirmedCount++;
            }
        });
        
        this.render();
        UI.showToast(`Confirmed ${confirmedCount} area(s)`, 'success');
    },
    
    clearAll() {
        const user = Auth.getCurrentUser();
        if (!user) return;
        
        const dateString = document.getElementById('entry-date').value;
        const areas = user.role === 'admin' ? Storage.getAreas() : user.assignedAreas;
        
        areas.forEach(areaName => {
            Attendance.updateArea(dateString, areaName, {
                presentCount: null,
                confirmed: false
            });
        });
        
        this.render();
        UI.showToast('All entries cleared', 'success');
    },
    
    showAudit() {
        const dateString = document.getElementById('entry-date').value;
        const entries = Audit.getEntries(dateString);
        
        const auditList = document.getElementById('audit-list');
        auditList.innerHTML = '';
        
        if (entries.length === 0) {
            const emptyMsg = document.createElement('div');
            Utils.setText(emptyMsg, 'No audit entries for this date');
            auditList.appendChild(emptyMsg);
        } else {
            entries.forEach(entry => {
                const entryDiv = document.createElement('div');
                entryDiv.className = 'audit-entry';
                
                const timeDiv = document.createElement('div');
                timeDiv.className = 'audit-entry-time';
                Utils.setText(timeDiv, Utils.formatDateTime(entry.ts));
                entryDiv.appendChild(timeDiv);
                
                const detailDiv = document.createElement('div');
                detailDiv.className = 'audit-entry-detail';
                Utils.setText(detailDiv, `${entry.user} changed ${entry.area} ${entry.field}: ${entry.from} → ${entry.to}`);
                entryDiv.appendChild(detailDiv);
                
                auditList.appendChild(entryDiv);
            });
        }
        
        document.getElementById('audit-drawer').style.display = 'block';
    }
};

const ExportView = {
    init() {
        const singleDate = document.getElementById('export-single-date');
        const rangeFrom = document.getElementById('export-range-from');
        const rangeTo = document.getElementById('export-range-to');
        
        singleDate.value = Utils.getTodayString();
        rangeFrom.value = Utils.getTodayString();
        rangeTo.value = Utils.getTodayString();
        
        singleDate.addEventListener('change', () => this.updateSingleSummary());
        rangeFrom.addEventListener('change', () => this.updateRangeSummary());
        rangeTo.addEventListener('change', () => this.updateRangeSummary());
        
        document.getElementById('export-single-btn').addEventListener('click', () => {
            const date = singleDate.value;
            CSVExport.exportSingleDay(date);
            UI.showToast('CSV exported successfully', 'success');
        });
        
        document.getElementById('export-range-btn').addEventListener('click', () => {
            const from = rangeFrom.value;
            const to = rangeTo.value;
            if (from > to) {
                UI.showToast('Invalid date range', 'error');
                return;
            }
            CSVExport.exportDateRange(from, to);
            UI.showToast('CSV exported successfully', 'success');
        });
        
        this.updateSingleSummary();
        this.updateRangeSummary();
    },
    
    updateSingleSummary() {
        const date = document.getElementById('export-single-date').value;
        const total = Attendance.getTotalPresent(date);
        const areas = Storage.getAreas();
        const confirmed = Attendance.getConfirmedCount(date, areas);
        
        const summary = document.getElementById('export-single-summary');
        summary.innerHTML = `<p>Date: ${date}<br>Total Present: ${total}<br>Confirmed Areas: ${confirmed} / ${areas.length}</p>`;
    },
    
    updateRangeSummary() {
        const from = document.getElementById('export-range-from').value;
        const to = document.getElementById('export-range-to').value;
        
        if (from > to) {
            document.getElementById('export-range-summary').innerHTML = '<p>Invalid date range</p>';
            return;
        }
        
        const startDate = new Date(from);
        const endDate = new Date(to);
        const dayCount = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
        
        const summary = document.getElementById('export-range-summary');
        summary.innerHTML = `<p>From: ${from}<br>To: ${to}<br>Days: ${dayCount}</p>`;
    }
};

const BackupView = {
    init() {
        const retentionInput = document.getElementById('retention-days-input');
        const settings = Storage.getSettings();
        retentionInput.value = settings.retentionDays;
        
        document.getElementById('backup-export-btn').addEventListener('click', () => {
            this.exportBackup();
        });
        
        document.getElementById('backup-import-btn').addEventListener('click', () => {
            this.importBackup();
        });
        
        document.getElementById('retention-update-btn').addEventListener('click', () => {
            const days = parseInt(retentionInput.value);
            if (days < 1 || days > 730) {
                UI.showToast('Retention days must be between 1 and 730', 'error');
                return;
            }
            settings.retentionDays = days;
            Storage.saveSettings(settings);
            UI.showToast('Retention days updated', 'success');
            this.updateRetentionInfo();
        });
        
        document.getElementById('retention-clean-btn').addEventListener('click', () => {
            UI.confirm('Delete old attendance data? This cannot be undone.', () => {
                this.cleanOldData();
            });
        });
        
        this.updateRetentionInfo();
    },
    
    exportBackup() {
        const backup = {
            version: 1,
            exportedAt: Date.now(),
            settings: Storage.getSettings(),
            areas: Storage.getAreas(),
            users: Storage.getUsers(),
            attendance: Storage.getAttendance()
        };
        
        const json = JSON.stringify(backup, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `headcount_backup_${Utils.getTodayString()}.json`;
        link.click();
        URL.revokeObjectURL(url);
        
        UI.showToast('Backup exported successfully', 'success');
    },
    
    importBackup() {
        const fileInput = document.getElementById('backup-import-input');
        const file = fileInput.files[0];
        
        if (!file) {
            UI.showToast('Please select a file', 'error');
            return;
        }
        
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const backup = JSON.parse(e.target.result);
                
                // Validate backup structure
                if (!backup.version || !backup.settings || !backup.areas || !backup.users || !backup.attendance) {
                    throw new Error('Invalid backup file format');
                }
                
                UI.confirm('Import backup? This will overwrite all existing data.', () => {
                    Storage.saveSettings(backup.settings);
                    Storage.saveAreas(backup.areas);
                    Storage.saveUsers(backup.users);
                    Storage.saveAttendance(backup.attendance);
                    
                    UI.showToast('Backup imported successfully. Reloading...', 'success');
                    setTimeout(() => {
                        window.location.reload();
                    }, 1500);
                });
            } catch (error) {
                UI.showToast('Failed to import backup: ' + error.message, 'error');
            }
        };
        reader.readAsText(file);
    },
    
    updateRetentionInfo() {
        const settings = Storage.getSettings();
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - settings.retentionDays);
        
        const allAttendance = Storage.getAttendance();
        const oldDates = Object.keys(allAttendance).filter(date => new Date(date) < cutoffDate);
        
        const info = document.getElementById('retention-info');
        Utils.setText(info, `Currently keeping ${settings.retentionDays} days of data. ${oldDates.length} date(s) can be cleaned.`);
    },
    
    cleanOldData() {
        const settings = Storage.getSettings();
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - settings.retentionDays);
        
        const allAttendance = Storage.getAttendance();
        let deletedCount = 0;
        
        Object.keys(allAttendance).forEach(date => {
            if (new Date(date) < cutoffDate) {
                delete allAttendance[date];
                deletedCount++;
            }
        });
        
        Storage.saveAttendance(allAttendance);
        UI.showToast(`Cleaned ${deletedCount} old date(s)`, 'success');
        this.updateRetentionInfo();
    }
};

const AdminView = {
    init() {
        document.getElementById('admin-create-user-btn').addEventListener('click', () => {
            this.showCreateUserModal();
        });
        
        document.getElementById('admin-add-area-btn').addEventListener('click', () => {
            this.showAddAreaModal();
        });
        
        this.render();
    },
    
    render() {
        this.renderUsersTable();
        this.renderAreasTable();
    },
    
    renderUsersTable() {
        const users = Storage.getUsers();
        const tbody = document.querySelector('#admin-users-table tbody');
        tbody.innerHTML = '';
        
        users.forEach(user => {
            const row = tbody.insertRow();
            
            const cellUsername = row.insertCell();
            Utils.setText(cellUsername, user.username);
            
            const cellRole = row.insertCell();
            Utils.setText(cellRole, user.role);
            
            const cellAreas = row.insertCell();
            Utils.setText(cellAreas, user.assignedAreas.join(', ') || 'All');
            
            const cellStatus = row.insertCell();
            Utils.setText(cellStatus, user.disabled ? 'Disabled' : 'Active');
            
            const cellActions = row.insertCell();
            
            const resetBtn = document.createElement('button');
            resetBtn.className = 'btn btn-secondary';
            resetBtn.style.marginRight = '8px';
            Utils.setText(resetBtn, 'Reset Password');
            resetBtn.onclick = () => this.resetUserPassword(user.username);
            cellActions.appendChild(resetBtn);
            
            const toggleBtn = document.createElement('button');
            toggleBtn.className = 'btn btn-secondary';
            toggleBtn.style.marginRight = '8px';
            Utils.setText(toggleBtn, user.disabled ? 'Enable' : 'Disable');
            toggleBtn.onclick = () => this.toggleUserStatus(user.username);
            cellActions.appendChild(toggleBtn);
            
            const editBtn = document.createElement('button');
            editBtn.className = 'btn btn-secondary';
            Utils.setText(editBtn, 'Edit');
            editBtn.onclick = () => this.showEditUserModal(user.username);
            cellActions.appendChild(editBtn);
        });
    },
    
    renderAreasTable() {
        const areas = Storage.getAreas();
        const tbody = document.querySelector('#admin-areas-table tbody');
        tbody.innerHTML = '';
        
        areas.forEach(areaName => {
            const row = tbody.insertRow();
            
            const cellName = row.insertCell();
            Utils.setText(cellName, areaName);
            
            const cellActions = row.insertCell();
            
            const renameBtn = document.createElement('button');
            renameBtn.className = 'btn btn-secondary';
            renameBtn.style.marginRight = '8px';
            Utils.setText(renameBtn, 'Rename');
            renameBtn.onclick = () => this.renameArea(areaName);
            cellActions.appendChild(renameBtn);
            
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'btn btn-danger';
            Utils.setText(deleteBtn, 'Delete');
            deleteBtn.onclick = () => this.deleteArea(areaName);
            cellActions.appendChild(deleteBtn);
        });
    },
    
    showCreateUserModal() {
        const areas = Storage.getAreas();
        
        let areasHTML = '<div class="area-select-list">';
        areas.forEach(area => {
            areasHTML += `
                <div class="area-select-item">
                    <input type="checkbox" id="area-${area}" value="${area}">
                    <label for="area-${area}">${area}</label>
                </div>
            `;
        });
        areasHTML += '</div>';
        
        const bodyHTML = `
            <div class="modal-form-group">
                <label>Username:</label>
                <input type="text" id="new-user-username" autocomplete="off">
            </div>
            <div class="modal-form-group">
                <label>Role:</label>
                <select id="new-user-role">
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                </select>
            </div>
            <div class="modal-form-group">
                <label>Assigned Areas:</label>
                ${areasHTML}
            </div>
            <div id="create-user-error" class="error-message"></div>
        `;
        
        UI.showModal('Create User', bodyHTML, [
            { text: 'Cancel', className: 'btn-secondary' },
            {
                text: 'Create',
                className: 'btn-primary',
                closeOnClick: false,
                onClick: async () => {
                    const username = document.getElementById('new-user-username').value.trim();
                    const role = document.getElementById('new-user-role').value;
                    
                    const selectedAreas = [];
                    areas.forEach(area => {
                        const checkbox = document.getElementById(`area-${area}`);
                        if (checkbox && checkbox.checked) {
                            selectedAreas.push(area);
                        }
                    });
                    
                    const errorDiv = document.getElementById('create-user-error');
                    
                    if (!username) {
                        Utils.setText(errorDiv, 'Username is required');
                        return;
                    }
                    
                    if (role === 'user' && selectedAreas.length === 0) {
                        Utils.setText(errorDiv, 'Please select at least one area for user role');
                        return;
                    }
                    
                    try {
                        const tempPassword = Utils.generatePassword();
                        await Auth.createUser(username, tempPassword, role, role === 'admin' ? [] : selectedAreas);
                        
                        document.querySelector('.modal-overlay').remove();
                        
                        UI.showModal('User Created', `
                            <p>User created successfully!</p>
                            <p><strong>Username:</strong> ${username}</p>
                            <p><strong>Temporary Password:</strong></p>
                            <div class="temp-password-display">${tempPassword}</div>
                            <p style="color: var(--danger);">⚠️ Save this password now. It will not be shown again.</p>
                        `, [
                            { text: 'OK', className: 'btn-primary' }
                        ]);
                        
                        this.render();
                    } catch (error) {
                        Utils.setText(errorDiv, error.message);
                    }
                }
            }
        ]);
    },
    
    showEditUserModal(username) {
        const users = Storage.getUsers();
        const user = users.find(u => u.username === username);
        if (!user) return;
        
        const areas = Storage.getAreas();
        
        let areasHTML = '<div class="area-select-list">';
        areas.forEach(area => {
            const checked = user.assignedAreas.includes(area) ? 'checked' : '';
            areasHTML += `
                <div class="area-select-item">
                    <input type="checkbox" id="edit-area-${area}" value="${area}" ${checked}>
                    <label for="edit-area-${area}">${area}</label>
                </div>
            `;
        });
        areasHTML += '</div>';
        
        const bodyHTML = `
            <div class="modal-form-group">
                <label>Username:</label>
                <input type="text" value="${username}" disabled>
            </div>
            <div class="modal-form-group">
                <label>Role:</label>
                <select id="edit-user-role">
                    <option value="user" ${user.role === 'user' ? 'selected' : ''}>User</option>
                    <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option>
                </select>
            </div>
            <div class="modal-form-group">
                <label>Assigned Areas:</label>
                ${areasHTML}
            </div>
        `;
        
        UI.showModal('Edit User', bodyHTML, [
            { text: 'Cancel', className: 'btn-secondary' },
            {
                text: 'Save',
                className: 'btn-primary',
                onClick: () => {
                    const role = document.getElementById('edit-user-role').value;
                    
                    const selectedAreas = [];
                    areas.forEach(area => {
                        const checkbox = document.getElementById(`edit-area-${area}`);
                        if (checkbox && checkbox.checked) {
                            selectedAreas.push(area);
                        }
                    });
                    
                    user.role = role;
                    user.assignedAreas = role === 'admin' ? [] : selectedAreas;
                    
                    Storage.saveUsers(users);
                    UI.showToast('User updated', 'success');
                    this.render();
                }
            }
        ]);
    },
    
    async resetUserPassword(username) {
        const tempPassword = Utils.generatePassword();
        
        UI.confirm(`Reset password for ${username}?`, async () => {
            await Auth.resetPassword(username, tempPassword);
            
            UI.showModal('Password Reset', `
                <p>Password reset successfully!</p>
                <p><strong>Username:</strong> ${username}</p>
                <p><strong>New Temporary Password:</strong></p>
                <div class="temp-password-display">${tempPassword}</div>
                <p style="color: var(--danger);">⚠️ Save this password now. It will not be shown again.</p>
            `, [
                { text: 'OK', className: 'btn-primary' }
            ]);
        });
    },
    
    toggleUserStatus(username) {
        const users = Storage.getUsers();
        const user = users.find(u => u.username === username);
        if (!user) return;
        
        user.disabled = !user.disabled;
        Storage.saveUsers(users);
        UI.showToast(`User ${user.disabled ? 'disabled' : 'enabled'}`, 'success');
        this.render();
    },
    
    showAddAreaModal() {
        const bodyHTML = `
            <div class="modal-form-group">
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
                    const areaName = document.getElementById('new-area-name').value.trim();
                    const errorDiv = document.getElementById('add-area-error');
                    
                    if (!areaName) {
                        Utils.setText(errorDiv, 'Area name is required');
                        return;
                    }
                    
                    const areas = Storage.getAreas();
                    if (areas.includes(areaName)) {
                        Utils.setText(errorDiv, 'Area already exists');
                        return;
                    }
                    
                    areas.push(areaName);
                    Storage.saveAreas(areas);
                    
                    document.querySelector('.modal-overlay').remove();
                    UI.showToast('Area added', 'success');
                    this.render();
                }
            }
        ]);
    },
    
    renameArea(oldName) {
        const bodyHTML = `
            <div class="modal-form-group">
                <label>Current Name:</label>
                <input type="text" value="${oldName}" disabled>
            </div>
            <div class="modal-form-group">
                <label>New Name:</label>
                <input type="text" id="rename-area-name" value="${oldName}">
            </div>
            <div id="rename-area-error" class="error-message"></div>
        `;
        
        UI.showModal('Rename Area', bodyHTML, [
            { text: 'Cancel', className: 'btn-secondary' },
            {
                text: 'Rename',
                className: 'btn-primary',
                closeOnClick: false,
                onClick: () => {
                    const newName = document.getElementById('rename-area-name').value.trim();
                    const errorDiv = document.getElementById('rename-area-error');
                    
                    if (!newName) {
                        Utils.setText(errorDiv, 'Area name is required');
                        return;
                    }
                    
                    if (newName === oldName) {
                        document.querySelector('.modal-overlay').remove();
                        return;
                    }
                    
                    const areas = Storage.getAreas();
                    if (areas.includes(newName)) {
                        Utils.setText(errorDiv, 'Area name already exists');
                        return;
                    }
                
                // Update areas master
                const index = areas.indexOf(oldName);
                areas[index] = newName;
                Storage.saveAreas(areas);
                
                // Update users' assigned areas
                const users = Storage.getUsers();
                users.forEach(user => {
                    const areaIndex = user.assignedAreas.indexOf(oldName);
                    if (areaIndex !== -1) {
                        user.assignedAreas[areaIndex] = newName;
                    }
                });
                Storage.saveUsers(users);
                
                // Update attendance data
                const allAttendance = Storage.getAttendance();
                Object.keys(allAttendance).forEach(date => {
                    const dayData = allAttendance[date];
                    if (dayData.areas[oldName]) {
                        dayData.areas[newName] = dayData.areas[oldName];
                        delete dayData.areas[oldName];
                    }
                });
                Storage.saveAttendance(allAttendance);
                
                document.querySelector('.modal-overlay').remove();
                UI.showToast('Area renamed', 'success');
                this.render();
            }
        }
    ]);
},

deleteArea(areaName) {
    UI.confirm(`Delete area "${areaName}"? Historical data will be preserved but the area will be removed from the master list.`, () => {
        const areas = Storage.getAreas();
        const index = areas.indexOf(areaName);
        areas.splice(index, 1);
        Storage.saveAreas(areas);
        
        // Remove from users' assigned areas
        const users = Storage.getUsers();
        users.forEach(user => {
            const areaIndex = user.assignedAreas.indexOf(areaName);
            if (areaIndex !== -1) {
                user.assignedAreas.splice(areaIndex, 1);
            }
        });
        Storage.saveUsers(users);
        
        UI.showToast('Area deleted', 'success');
        this.render();
    });
}
};
// ============================================
// APP INITIALIZATION
// ============================================
const App = {
init() {
this.checkFirstRun();
this.setupTheme();
this.setupNavigation();
this.setupLogout();
// Check if user is logged in
    const user = Auth.getCurrentUser();
    if (user) {
        this.showMainApp();
    } else {
        UI.switchScreen('login-screen');
    }
    
    this.setupLoginForm();
},

checkFirstRun() {
    const users = Storage.getUsers();
    if (users.length === 0) {
        // First run - show create admin screen
        const areas = Storage.getAreas();
        if (areas.length === 0) {
            Storage.saveAreas(CONFIG.DEFAULT_AREAS);
        }
        UI.switchScreen('create-admin-screen');
        this.setupCreateAdminForm();
    }
},

setupCreateAdminForm() {
    document.getElementById('create-admin-btn').addEventListener('click', async () => {
        const username = document.getElementById('admin-username').value.trim();
        const password = document.getElementById('admin-password').value;
        const confirmPassword = document.getElementById('admin-password-confirm').value;
        const errorDiv = document.getElementById('admin-error');
        
        Utils.setText(errorDiv, '');
        
        if (!username || !password) {
            Utils.setText(errorDiv, 'Username and password are required');
            return;
        }
        
        if (password !== confirmPassword) {
            Utils.setText(errorDiv, 'Passwords do not match');
            return;
        }
        
        if (password.length < 6) {
            Utils.setText(errorDiv, 'Password must be at least 6 characters');
            return;
        }
        
        try {
            await Auth.createUser(username, password, 'admin');
            UI.showToast('Admin account created', 'success');
            UI.switchScreen('login-screen');
        } catch (error) {
            Utils.setText(errorDiv, error.message);
        }
    });
},

setupLoginForm() {
    document.getElementById('login-btn').addEventListener('click', () => {
        this.handleLogin();
    });
    
    document.getElementById('login-password').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            this.handleLogin();
        }
    });
},

async handleLogin() {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    const errorDiv = document.getElementById('login-error');
    
    Utils.setText(errorDiv, '');
    
    if (!username || !password) {
        Utils.setText(errorDiv, 'Username and password are required');
        return;
    }
    
    try {
        await Auth.login(username, password);
        this.showMainApp();
    } catch (error) {
        Utils.setText(errorDiv, error.message);
    }
},

showMainApp() {
    UI.switchScreen('app-screen');
    
    const user = Auth.getCurrentUser();
    if (user && user.role === 'admin') {
        document.getElementById('admin-nav-btn').style.display = 'flex';
    }
    
    // Initialize views
    HomeView.init();
    EntryView.init();
    ExportView.init();
    BackupView.init();
    
    if (user && user.role === 'admin') {
        AdminView.init();
    }
    
    // Show home view by default
    UI.switchView('home');
},

setupNavigation() {
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const view = btn.dataset.view;
            UI.switchView(view);
            
            // Refresh view data
            if (view === 'home') HomeView.render();
            if (view === 'entry') EntryView.render();
            if (view === 'export') {
                ExportView.updateSingleSummary();
                ExportView.updateRangeSummary();
            }
            if (view === 'backup') BackupView.updateRetentionInfo();
            if (view === 'admin') AdminView.render();
        });
    });
},

setupLogout() {
    document.getElementById('logout-btn').addEventListener('click', () => {
        UI.confirm('Are you sure you want to logout?', () => {
            Auth.logout();
            window.location.reload();
        });
    });
},

setupTheme() {
    const settings = Storage.getSettings();
    if (settings.darkMode) {
        document.body.setAttribute('data-theme', 'dark');
        Utils.setText(document.getElementById('theme-toggle'), '☀️');
    }
    
    document.getElementById('theme-toggle').addEventListener('click', () => {
        const settings = Storage.getSettings();
        settings.darkMode = !settings.darkMode;
        Storage.saveSettings(settings);
        
        if (settings.darkMode) {
            document.body.setAttribute('data-theme', 'dark');
            Utils.setText(document.getElementById('theme-toggle'), '☀️');
        } else {
            document.body.removeAttribute('data-theme');
            Utils.setText(document.getElementById('theme-toggle'), '🌙');
        }
    });
}
};
// Start the application when DOM is ready
if (document.readyState === 'loading') {
document.addEventListener('DOMContentLoaded', () => App.init());
} else {
App.init();
}