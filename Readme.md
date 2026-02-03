README: Headcount Tracker Application

HOW TO RUN LOCALLY:
1. Save all three files (index.html, styles.css, app.js) in the same folder.
2. Open index.html directly in a web browser (Chrome, Firefox, Safari, Edge).
3. The app runs completely offline using browser localStorage.

HOW TO DEPLOY TO GITHUB PAGES:
1. Create a new GitHub repository.
2. Upload index.html, styles.css, and app.js to the repository root.
3. Go to Settings > Pages.
4. Select the branch (usually 'main') and root folder.
5. Save and wait for deployment (a few minutes).
6. Access via: https://yourusername.github.io/repository-name/

LOGIN & SECURITY:
- First run: Create an admin account with username and password.
- Passwords are stored as salted SHA-256 hashes (NOT plain text).
- Login lockout: 5 failed attempts = 5-minute cooldown.
- Session expires after 8 hours of inactivity.
- IMPORTANT: This is CLIENT-SIDE ONLY security. Anyone with file access can:
  * View localStorage data in browser DevTools
  * Modify the JavaScript to bypass checks
  * Export and read all data
- This is a "practical lock" to deter casual access, NOT true security.
- For sensitive data, use a proper backend with server-side authentication.

PASSWORD RESET / RECOVERY:
If admin forgets password or loses access:
1. Open browser DevTools (F12).
2. Go to Application > Local Storage.
3. Delete the "headcountUsers" key (removes all users).
4. Refresh the page - you'll see "Create Admin" screen again.
5. Note: This does NOT delete attendance data, only users.

DATA STORAGE (localStorage keys):
- headcountSettings: { darkMode, retentionDays }
- headcountAreasMaster: Array of area names
- headcountUsers: Array of user objects with hashed passwords
- headcountSession: Current session data (username, expiry, lockout)
- headcountAttendance: Object with keys as YYYY-MM-DD dates

CSV EXPORT:
- Single day export includes: date, area, present_count, confirmed, updated_at, updated_by
- Total row at bottom sums all present counts
- Range export creates one row per date+area combination
- Files download as: headcount_YYYY-MM-DD.csv or headcount_YYYY-MM-DD_to_YYYY-MM-DD.csv

CONFIRMED CHECKBOX:
- Each area has a "Confirmed" checkbox to mark data entry as complete.
- Cannot confirm if present count is blank/null (shows warning).
- "Confirm All Valid" button confirms only areas with valid numbers.
- Helps prevent missed entries and track completion status.

AUDIT TRAIL:
- Records last 10 changes per date (per-date basis, not global).
- Tracks changes to: present count and confirmed status.
- Shows: timestamp, username, area, field changed, old value, new value.
- View audit via "Show Audit" button on Entry screen.
- Audit entries are stored with each date's attendance data.

DEFAULT AREAS:
On first run, these areas are preloaded:
- TCF Facilities
- Precast S2A
- Painting & Sand Blasting
- Precast S4A
- Precast S4B
- Fabrication Area S2A & S4A
- Fabrication Area S4B
- Common Welding S4A_S2A_S4B
- Spool Yard
- Old Spool Yard
- Spool Yard T58
- Spool Yard T63
- PWHT

ROLES:
- Admin: Can manage users, areas, and view/edit all attendance data.
- User: Can only view/edit attendance for their assigned areas.

MOBILE-FIRST DESIGN:
- Responsive layout optimized for phones and tablets.
- Bottom navigation on mobile, accessible on desktop.
- Large touch targets for easy interaction.
- Light/dark mode support.

DATA RETENTION:
- Default: Keep 180 days of attendance data.
- Configurable in Backup screen.
- Old data can be cleaned manually (shows preview before deletion).

ACCESSIBILITY:
- Proper form labels and ARIA attributes.
- Keyboard navigation support.
- Focus states visible.
- Screen reader friendly.

BACKUP & RESTORE:
- Export: Downloads complete JSON of all app data.
- Import: Restores from JSON backup (validates structure first).
- Use for: moving between devices, disaster recovery, archival.