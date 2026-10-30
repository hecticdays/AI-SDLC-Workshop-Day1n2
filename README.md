# Complete Setup Guide: Todo App Development with GitHub Copilot

## Implemented Build: Persons 3, 4 and 5

**Last updated:** 2026-10-30. This branch includes runnable Next.js 16 / React 19 / Tailwind 4 implementations of subtasks/progress, templates, tags/search, JSON/CSV portability and passkey authentication (PRPs 05-09 and 11). The remaining walkthrough also describes the full target app; it is not evidence that every other owner's feature or production deployment is complete.

From the repository folder, with Node.js 22+ and npm installed, run the normal authenticated app in PowerShell:

```powershell
npm install
$env:JWT_SECRET = & node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64url'))"
$env:APP_ORIGIN = 'http://localhost:3000'
$env:WEBAUTHN_RP_ID = 'localhost'
$env:DATABASE_PATH = 'todos.db'
npm run dev
```

Open http://localhost:3000 and register a passkey. `JWT_SECRET` must be private and at least 32 bytes; the expression generates one without printing it. These variables apply to this terminal session. For repeat local runs or production, provision the same private secret through untracked environment configuration/secret management; generating a new secret invalidates existing sessions. Keep `DEMO_MODE` unset for normal authentication. Use `localhost`, not `127.0.0.1`, for passkey setup: Chromium rejects IP RP IDs. If using another port, set `APP_ORIGIN` to that exact origin.

For the optional sign-in-free demo only:

```bash
npm install
npm run dev:demo
```

Open the URL printed by Next.js (normally http://127.0.0.1:3000). Demo mode binds to loopback, uses a separate `demo.db`, and seeds sample todos/subtasks/tags once. Changes persist across restarts. It bypasses sign-in **only** when `NODE_ENV=development`, `DEMO_MODE=true`, and `DATABASE_PATH=demo.db`; it cannot activate in a production build. Do not expose demo mode publicly or use it for private data.

### Delivered

- User-owned tag create/edit/delete, native and hex color inputs, confirmation, duplicate-name validation, multi-tag selection, and per-task attach/detach.
- SQLite foreign keys, cascading associations, idempotent attachment, transactional task/tag creation, and ownership checks on both association endpoints.
- Title/subtask search with a 300ms debounce and immediate clear; priority/tag/completion filters and inclusive Singapore-date bounds combined with AND.
- Saved filter preview, apply/delete, corrupted-storage handling, storage-error feedback, and per-account browser storage keys.
- Filtered section counts, distinct empty states, deleted-tag fallback, keyboard-accessible native dialogs, responsive layout, and light/dark themes.
- Visible active-filter summary, independent tag-filter clearing, cached debounced filtering, partial-update preservation, and transactional edit/import tag helpers.

Tag uniqueness and import reuse share trimmed names and SQLite `NOCASE` (ASCII case folding); non-ASCII case variants are not normalized. Tag text switches between black and white for WCAG AA contrast rather than forcing white text on pale custom colors. Presets remain browser-local but are additionally account-scoped so shared-browser accounts do not share saved views.

- **Person 3:** Owned subtask create/rename/toggle/delete, cascading parent deletion, independent completion and client-safe rounded progress; optimistic toggles reconcile with server state and pending controls prevent competing mutations. Templates support full CRUD, draft checklists, manager/category filtering and quick use. Each use atomically creates a fresh unchecked todo/checklist, without tags or a live template link; positive relative offsets resolve on the server, and recurrence/reminders require an offset.
- **Person 5 (portability):** Strict version-1 JSON export/transactional restore preserves historical metadata and checklist array order with fresh todo/subtask IDs, canonical UTC due dates, tag reuse/deduplication and rollback. Notification stamps reset without triggering completion/recurrence/notification actions. CSV uses `csv-stringify` with quoting and formula escaping; JSON remains the relational backup format.
- **Person 5 (auth):** SimpleWebAuthn 13 registration/login and recent-auth additional-passkey enrollment; browser/account/operation-bound SQLite attempts with 300-second expiry and atomic consumption, required user verification, login/logout UI and Next.js 16 `proxy.ts` protection of `/` and `/calendar`. API ownership checks remain independent of page redirects.

### Integration and Remaining Limits

- **Task tags:** The full task editor submits tag selections with task details through ownership-checked, atomic replacement. Duplicate IDs are collapsed and an empty selection clears tags. Optimistic creation/editing preserves selected tags under active filters; the independent Task tags dialog remains available.
- **Other owners:** Todo storage and supporting create/update/delete routes now exist for the integrated flows; this update does not certify full Person 1/2, recurring-successor/notification or calendar delivery. Client mutations refresh the nested searchable collection. The main UI remains in `app/page.tsx` per repository convention.
- **Logout/recovery:** Logout clears this browser's cookies only; there is no server-side revocation of copied JWTs. Account recovery is not implemented. Adding another passkey requires recent `authTime` within five minutes; sign in again if the session is older.
- **Backup boundary:** Templates and saved filter presets are excluded. CSV is one-way and omits tag/checklist relations. Imports intentionally add copies rather than merging todos; tags reuse the importing user's matching names/colors.
- **Import resources:** No hard size limit, per PRP 09. Files over 10 MiB show a progress warning, but complete-document parsing and synchronous writes still require upstream request/resource limits before deployment.
- **Rate limits:** Per-browser by default. IP buckets apply only with `AUTH_TRUST_PROXY=true` and valid forwarded IPs; enable this only behind a trusted proxy that strips/overwrites client forwarding headers and prevents untrusted direct access. This is not a global abuse barrier; distinct account/conflict errors also permit username enumeration.
- **Deployment:** Use HTTPS, exact public `APP_ORIGIN`, matching hostname `WEBAUTHN_RP_ID`, a stable private JWT secret of at least 32 bytes, and stable private persistent SQLite via `DATABASE_PATH`. Ephemeral/read-only/serverless storage is not a persistence plan; coordinate writers/instances around the actual SQLite deployment. Never deploy demo mode or Playwright test secrets. No production audit or real-device compatibility certification is claimed.
- **Existing databases:** The baseline creates missing tables, not a full migration system. A pre-existing case-sensitive tags table needs a coordinated migration and duplicate-name resolution before adopting the case-insensitive contract.

### Verification

```bash
npm test
npm run test:coverage
npm run typecheck
npm run lint
npm run build
npx playwright install chromium
npm run test:e2e
```

**Recorded combined verification (2026-10-30):** `npm test` passes 35 unit/DB tests. `npm run test:coverage` reports 87.53% line, 89.25% branch and 88.73% function coverage on loaded `lib/**`, not whole-app coverage. `npm run build` succeeds with Next.js 16.4.3. `npx playwright test` passes all 62 desktop/mobile cases: 32 prior Person 4 cases plus 30 new cases for subtasks/templates/portability/authentication. These are supplied implementation-run results; the documentation-only refresh does not rerun them or claim every aspirational acceptance criterion.

Unit/DB tests cover filters, timezone boundaries, presets, tags, subtasks/progress, template snapshots/rollback, historical import validation/rollback, CSV safety, auth attempts/tokens and the demo guard. Playwright adds virtual-authenticator ceremonies, API isolation, retryable UI, JSON/CSV downloads and relational restoration to the existing tag/search workflows. Tests use `.person4-e2e.db` and test-only signing configuration, independent of `todos.db` and `demo.db`; suites provision their own sessions rather than depending on test-file order. Screenshots/traces are written under `test-results/` (gitignored).

**Person 4 completion:** Verified on 2026-10-30 with 13 Person 4 unit tests and 38 desktop/mobile browser cases; all 21 shared unit tests also pass. This includes full-editor tag save/cancel/clear with reload persistence, tag-filter visibility during delayed creation, failed-save rollback/retry, modal focus, AA tag-text contrast, deleted-tag presets, storage-full errors, exact debounce timing, immediate cross-feature refresh, 60-task cascade integrity, all-filter performance under 100ms for 1000 todos, and average warm tag CRUD latency under 300ms. `EVALUATION.md` and the assigned PRPs record the completed acceptance criteria. Search intentionally covers todo/subtask titles, not tag names, resolving the older evaluation checklist in favor of PRP 08.

---

This walkthrough will guide you from zero to running the Todo App with GitHub Copilot assistance.

Reference : https://ai-sdlc-workshop-day1-production.up.railway.app/login

---

## Table of Contents
1. [Install Visual Studio Code](#1-install-visual-studio-code)
2. [Install GitHub Copilot](#2-install-github-copilot)
3. [Install Node.js](#3-install-nodejs)
4. [Clone and Setup Todo App](#4-clone-and-setup-todo-app)
5. [Run the Application](#5-run-the-application)
6. [Use GitHub Copilot with PRPs](#6-use-github-copilot-with-prps)
7. [Verify Core Features](#7-verify-core-features)
8. [Troubleshooting](#troubleshooting)

---

## 1. Install Visual Studio Code

### Windows
1. Visit https://code.visualstudio.com/
2. Click **"Download for Windows"**
3. Run the downloaded installer (`VSCodeSetup-x64-*.exe`)
4. Follow installation wizard:
   - ✅ Accept license agreement
   - ✅ Check "Add to PATH" option
   - ✅ Check "Create a desktop icon" (optional)
   - ✅ Check "Register Code as an editor for supported file types"
5. Click **"Install"**
6. Launch VS Code after installation

### macOS
1. Visit https://code.visualstudio.com/
2. Click **"Download for Mac"**
3. Open the downloaded `.zip` file
4. Drag **Visual Studio Code.app** to Applications folder
5. Launch from Applications or Spotlight (Cmd+Space, type "Visual Studio Code")

### Linux (Ubuntu/Debian)
```bash
# Update package index
sudo apt update

# Install dependencies
sudo apt install software-properties-common apt-transport-https wget

# Import Microsoft GPG key
wget -q https://packages.microsoft.com/keys/microsoft.asc -O- | sudo apt-key add -

# Add VS Code repository
sudo add-apt-repository "deb [arch=amd64] https://packages.microsoft.com/repos/vscode stable main"

# Install VS Code
sudo apt update
sudo apt install code

# Launch VS Code
code
```

### Verify Installation
Open terminal/command prompt and run:
```bash
code --version
```
You should see version information like:
```
1.95.0
912bb683695358a54ae0c670461738984cbb5b95
x64
```

---

## 2. Install GitHub Copilot

### Prerequisites
- GitHub account (create at https://github.com if needed)
- GitHub Copilot subscription (free trial available)

### Step 1: Enable GitHub Copilot for Your Account
1. Visit https://github.com/settings/copilot
2. Click **"Start free trial"** or **"Get access to GitHub Copilot"**
3. Choose plan:
   - **Individual**: $10/month (30-day free trial)
   - **Business**: $19/user/month
   - **Free for students**: Apply at https://education.github.com/
4. Complete payment setup (if applicable)
5. Enable Copilot for your account

### Step 2: Install Copilot Extension in VS Code
1. Open **Visual Studio Code**
2. Click **Extensions** icon in sidebar (or press `Ctrl+Shift+X` / `Cmd+Shift+X`)
3. Search for **"GitHub Copilot"**
4. Find extension by **GitHub** (verified publisher)
5. Click **"Install"**
6. Also install **"GitHub Copilot Chat"** extension (for chat functionality)

### Step 3: Sign in to GitHub
1. After installation, VS Code will prompt to sign in
2. Click **"Sign in to GitHub"**
3. Browser opens → Click **"Authorize Visual Studio Code"**
4. Return to VS Code
5. Bottom right should show "GitHub Copilot: Ready" status

### Verify Copilot Installation
1. Create a new file: `test.js`
2. Type: `// function to add two numbers`
3. Press `Enter`
4. Copilot should suggest a function (shown in gray text)
5. Press `Tab` to accept suggestion

If you see suggestions, Copilot is working! ✅

---

## 3. Install Node.js

The Todo App requires **Node.js 20+** and **npm**.

### Windows
1. Visit https://nodejs.org/
2. Download **"LTS"** version (recommended)
3. Run installer (`node-v20.x.x-x64.msi`)
4. Follow wizard:
   - ✅ Accept license
   - ✅ Keep default installation path
   - ✅ Install npm package manager
   - ✅ Install necessary tools (check box for native modules)
5. Click **"Finish"**

### macOS
**Option 1: Official Installer**
1. Visit https://nodejs.org/
2. Download **"LTS"** version
3. Open `.pkg` file and follow installer

**Option 2: Using Homebrew**
```bash
# Install Homebrew if not already installed
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install Node.js
brew install node@20

# Verify
node --version
npm --version
```

### Linux (Ubuntu/Debian)
```bash
# Install Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify installation
node --version
npm --version
```

### Verify Node.js Installation
Open terminal and run:
```bash
node --version  # Should show v20.x.x or higher
npm --version   # Should show 10.x.x or higher
```

---

## 4. Clone and Setup Todo App

### Option A: Clone from Git (if using version control)
```bash
# Navigate to your projects folder
cd ~/Projects  # or C:\Projects on Windows

# Clone repository (replace with actual repo URL)
git clone <your-repo-url> todo-app
cd todo-app
```

### Option B: Setup Existing Project
If you already have the project folder:
```bash
# Navigate to project directory
cd /path/to/todo-app
```

### Install Dependencies
```bash
# Install all npm packages (this may take a few minutes)
npm install
```

You should see output like:
```
added 345 packages, and audited 346 packages in 45s
```

### Project Structure Verification
Ensure you have these key files:
```
todo-app/
├── .github/
│   ├── copilot-instructions.md    ← Copilot will read this
│   └── PRPs/
│       └── todo-app-core-features.md  ← Product requirements
├── app/
│   ├── page.tsx
│   ├── layout.tsx
│   └── api/
├── lib/
│   ├── db.ts
│   ├── auth.ts
│   └── timezone.ts
├── package.json
├── next.config.ts
└── README.md
```

---

## 5. Run the Application

### Start Development Server
Use the normal-app environment setup at the top of this guide first (`JWT_SECRET`, `APP_ORIGIN` and `WEBAUTHN_RP_ID`). Keep the same private secret between restarts when sessions should remain valid.

```bash
npm run dev
```

Expected output:
```
   ▲ Next.js 16.4.3
  - Local:        http://localhost:3000
  - Environments: .env.local

 ✓ Starting...
 ✓ Ready in 1.5s
```

### Access the Application
1. Open browser
2. Navigate to: **http://localhost:3000**
3. You should see the **Login** page

### First-Time Setup
1. **Register a new account**:
   - Enter username (e.g., "testuser")
   - Click "Register"
   - Follow WebAuthn prompt (use fingerprint/face ID/PIN)
   
2. **Create your first todo**:
   - Enter todo title: "Test my first todo"
   - Click "Add"
   - Todo appears in list ✅

### Stop the Server
Press `Ctrl+C` in the terminal running `npm run dev`

---

## 6. Use GitHub Copilot with PRPs

Now that everything is installed, let's use Copilot with the Product Requirement Prompts!

### Step 1: Open Project in VS Code
```bash
# From project directory
code .
```

### Step 2: Verify Copilot Instructions Loaded
1. Open **GitHub Copilot Chat** (Ctrl+Alt+I / Cmd+Alt+I)
2. Type: `What timezone should I use for date operations?`
3. Copilot should mention **Singapore timezone** and reference `lib/timezone.ts`
   - If it does, the instructions are working! ✅

### Step 3: Reference PRPs in Chat

#### Example 1: Ask About Features
```
@workspace What are the acceptance criteria for the recurring todos feature?
```

Copilot will reference `.github/PRPs/todo-app-core-features.md` and list:
- Can create recurring todo with pattern
- Completing recurring todo creates next instance
- Next instance has correct due date
- etc.

#### Example 2: Implement New Feature
```
Using the PRP for the tag system, help me add a new color picker for tag creation
```

Copilot will:
1. Read PRP section on tags
2. Understand technical constraints (hex colors, unique names)
3. Suggest implementation following project patterns

#### Example 3: Debug Using PRPs
```
I'm getting an error with recurring todos. Check the PRP requirements and help me fix it.
```

Copilot will:
1. Review recurring todo specifications
2. Check your code against PRP constraints
3. Suggest fixes aligned with requirements

### Step 4: Use Copilot Inline Suggestions

**Scenario**: Add a new API route for todo statistics

1. Create file: `app/api/stats/route.ts`
2. Type comment:
   ```typescript
   // GET endpoint to return todo statistics following project auth pattern
   ```
3. Press Enter
4. Copilot suggests code following:
   - Session authentication pattern
   - Singapore timezone handling
   - Database query structure from `lib/db.ts`
5. Press `Tab` to accept suggestions

### Step 5: Ask Copilot to Generate Code from PRP

Open Copilot Chat and try:
```
Using the PRP for export/import feature, generate the import validation logic
```

Copilot will create code that:
- Validates JSON structure
- Checks required fields (todos, subtasks, tags)
- Handles ID remapping
- Preserves relationships

---

## 7. Verify Core Features

Use this checklist to verify the app is working correctly.

### ✅ Authentication
```bash
# Open http://localhost:3000/login
1. Register with username: "copilot-test-user"
2. Verify WebAuthn prompt appears
3. Complete registration
4. Logout and login again
5. Verify session persists after page reload
```

### ✅ Todo CRUD
```
1. Create todo: "Buy groceries"
2. Set priority: High
3. Set due date: Tomorrow 2:00 PM
4. Edit todo title to: "Buy groceries and cook"
5. Toggle completion checkbox
6. Delete todo
```

### ✅ Recurring Todos
```
1. Create todo: "Daily standup"
2. Check "Repeat" checkbox
3. Select "Daily" pattern
4. Set due date: Tomorrow 9:00 AM
5. Complete the todo
6. Verify new instance created for next day
```

### ✅ Subtasks
```
1. Create todo: "Prepare presentation"
2. Click to expand subtasks
3. Add subtask: "Create slides"
4. Add subtask: "Rehearse speech"
5. Check first subtask
6. Verify progress shows "1/2 completed (50%)"
```

### ✅ Tags
```
1. Click "Manage Tags" button
2. Create tag: "work" (color: #3B82F6)
3. Create tag: "urgent" (color: #EF4444)
4. Assign both tags to a todo
5. Filter by "work" tag
6. Verify only tagged todos shown
```

### ✅ Templates
```
1. Create todo with desired settings
2. Click "Save as Template"
3. Enter name: "Meeting Task"
4. Add subtasks before saving
5. Later, click "Use Template"
6. Verify new todo created with all settings
```

### ✅ Reminders
```
1. Click "Enable Notifications" (grant permission)
2. Create todo with due date in 20 minutes
3. Set reminder: "15 minutes before"
4. Wait 5 minutes
5. Browser notification should appear
```

### ✅ Calendar View
```
1. Navigate to http://localhost:3000/calendar
2. Verify current month displayed
3. Create todos with different due dates
4. Verify todos appear on correct calendar cells
5. Click prev/next month buttons
```

### ✅ Search & Filter
```
1. Create multiple todos
2. Type in search box: "meeting"
3. Verify filtered results
4. Select priority filter: "High"
5. Verify combined filters work
```

### ✅ Export/Import
```
1. Create several todos with tags and subtasks
2. Click "Export Todos"
3. Verify JSON file downloads
4. Delete all todos
5. Click "Import Todos" and select file
6. Verify todos restored with all metadata
```

---

## Troubleshooting

### Copilot Not Working

**Problem**: No suggestions appearing

**Solutions**:
1. Check Copilot status bar (bottom right)
   - Should say "GitHub Copilot: Ready"
2. Sign out and sign in again:
   - Click Accounts icon (bottom left)
   - Sign out of GitHub
   - Sign in again
3. Restart VS Code
4. Check subscription at https://github.com/settings/copilot

**Problem**: Copilot ignoring instructions

**Solutions**:
1. Verify `.github/copilot-instructions.md` exists
2. Reload VS Code window (Ctrl+Shift+P → "Reload Window")
3. Use `@workspace` in chat for better context
4. Be specific: "Following the project's auth pattern..."

---

### Node.js / npm Issues

**Problem**: `npm install` fails

**Solutions**:
```bash
# Clear npm cache
npm cache clean --force

# Delete node_modules and package-lock.json
rm -rf node_modules package-lock.json

# Reinstall
npm install
```

**Problem**: Port 3000 already in use

**Solutions**:
```bash
# Option 1: Kill process on port 3000
# Windows
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# macOS/Linux
lsof -ti:3000 | xargs kill -9

# Option 2: Use different port
npm run dev -- -p 3001
```

---

### Database Issues

**Problem**: Database locked or corrupted

**Solutions**:
```bash
# Stop dev server (Ctrl+C)

# Delete database file
rm todos.db

# Restart server (recreates database)
npm run dev
```

**Problem**: Missing holidays

**Solutions**:
```bash
# Run seed script
npx tsx scripts/seed-holidays.ts
```

---

### WebAuthn / Authentication Issues

**Problem**: WebAuthn not working in browser

**Solutions**:
1. Use supported browser:
   - ✅ Chrome/Edge (recommended)
   - ✅ Firefox
   - ✅ Safari
2. Enable HTTPS or use localhost (required for WebAuthn)
3. Check browser supports WebAuthn:
   - Visit: https://webauthn.io
   - Test if authentication works

**Problem**: Can't login after registration

**Solutions**:
1. Clear browser data (cookies, localStorage)
2. Delete `todos.db` and re-register
3. Check browser console for errors (F12)

---

### Playwright Testing Issues

**Problem**: Tests fail to run

**Solutions**:
```bash
# Install Playwright browsers
npx playwright install

# Run with headed mode to see what's happening
npx playwright test --headed

# Run specific test
npx playwright test tests/01-authentication.spec.ts
```

---

## Next Steps

Now that everything is set up, you can:

### 1. Explore with Copilot Chat
```
@workspace Show me how to add a new priority level called "urgent"
```

### 2. Implement New Features
```
Using the PRP format, help me add a "notes" field to todos
```

### 3. Fix Bugs
```
I'm getting undefined for authenticator.counter. Check the copilot instructions and fix it.
```

### 4. Run Tests
```bash
# Run all tests
npx playwright test

# View test report
npx playwright show-report
```

### 5. Build for Production
```bash
# Create production build
npm run build

# Start production server
npm start
```

---

## Additional Resources

- **VS Code Docs**: https://code.visualstudio.com/docs
- **GitHub Copilot Docs**: https://docs.github.com/en/copilot
- **Next.js Docs**: https://nextjs.org/docs
- **Playwright Docs**: https://playwright.dev/
- **WebAuthn Guide**: https://webauthn.guide/

---

## Quick Reference Commands

```bash
# Development
npm run dev          # Start dev server
npm run build        # Production build
npm start            # Start production server
npm run lint         # Run ESLint

# Testing
npx playwright test                    # Run all tests
npx playwright test --ui              # Interactive mode
npx playwright test --headed          # See browser
npx playwright show-report            # View results

# Database
npx tsx scripts/seed-holidays.ts      # Seed holidays
sqlite3 todos.db                       # Inspect database

# Copilot
Ctrl+Alt+I (Cmd+Alt+I)                # Open Copilot Chat
Ctrl+I (Cmd+I)                        # Inline Copilot
Tab                                    # Accept suggestion
Esc                                    # Dismiss suggestion
```

---

## Success Criteria

You've successfully completed setup when:

- ✅ VS Code installed and running
- ✅ GitHub Copilot active (shows suggestions)
- ✅ Copilot Chat responds with project-specific answers
- ✅ Todo app running on http://localhost:3000
- ✅ Can register/login with WebAuthn
- ✅ Can create and manage todos
- ✅ Tests pass with `npx playwright test`
- ✅ Copilot references PRPs when asked about features

---

**Congratulations!** 🎉 You're now ready to develop the Todo App with GitHub Copilot assistance.

For questions or issues, refer to the troubleshooting section or ask Copilot Chat:
```
@workspace I'm having trouble with [describe issue]
```
