# Releasing Corkly

Installers are built in the cloud by GitHub Actions (a Mac and a Windows machine) and uploaded to
**GitHub Releases** at https://github.com/adtoba/corkly/releases. Installed copies check that page
and update themselves.

## One-time setup

1. Create a **public** repo at https://github.com/new named `corkly` (owner `adtoba`).
   It has to be public so the installed app can see new releases (your code can live in a separate
   private repo later if you prefer — ask and we'll split it).
2. In this folder, run:

   ```bash
   npm install                 # picks up electron-updater and refreshes package-lock.json
   mkdir -p .github/workflows && mv build/release.yml .github/workflows/release.yml
   git init
   git add .
   git commit -m "Corkly 1.0.0"
   git branch -M main
   git remote add origin https://github.com/adtoba/corkly.git
   git push -u origin main
   ```

3. In the repo on GitHub: **Settings → Actions → General → Workflow permissions →
   "Read and write permissions"** → Save.

## Shipping a version

```bash
npm version patch        # 1.0.0 → 1.0.1 (use "minor" for 1.1.0); also creates the git tag v1.0.1
git push --follow-tags   # pushing the tag starts the build
```

Watch it under the repo's **Actions** tab (about 10 minutes). When both jobs are green, the release page has:

- `Corkly-1.0.1-mac-universal.dmg` — what Mac users download (Apple Silicon + Intel in one)
- `Corkly-Setup-1.0.1.exe` — what Windows users download
- `*.zip`, `*.blockmap`, `latest*.yml` — used by auto-update; leave them there

For your very first release, the version is already 1.0.0, so just tag it:
`git tag v1.0.0 && git push --tags`.

Share this link: **https://github.com/adtoba/corkly/releases/latest**

## Updates

- **Windows** downloads updates in the background and shows a "Restart & update" note.
- **Mac** shows a "new version — Download" note that opens the release page, because macOS only lets
  *signed* apps replace themselves. Once the Mac app is signed (below), set `"macSigned": true` in
  `src/config.json` and Mac updates install themselves too.
- Settings → **Check for updates** checks on demand.

## Signing (removes the "unverified developer" warnings)

The app works unsigned, but people see a warning the first time (instructions for getting past it are
included in every release's notes automatically).

**Mac — Apple Developer Program ($99/year):**
1. Join at https://developer.apple.com/programs/ and create a **Developer ID Application** certificate.
2. Export it from Keychain Access as a `.p12`, then `base64 -i cert.p12 | pbcopy`.
3. Add these repo secrets (Settings → Secrets and variables → Actions):
   `MAC_CERT_P12_BASE64`, `MAC_CERT_PASSWORD`, `APPLE_ID`,
   `APPLE_APP_SPECIFIC_PASSWORD` (from https://account.apple.com → App-Specific Passwords), `APPLE_TEAM_ID`.
4. Set `"macSigned": true` in `src/config.json`. The next release is signed and notarized.

**Windows (optional):** a code-signing certificate (or Azure Trusted Signing) removes the SmartScreen
warning. Add `WIN_CERT_P12_BASE64` and `WIN_CERT_PASSWORD` secrets if you get a `.pfx`.

## Building locally (no upload)

```bash
npm run dist:mac    # on a Mac → dist/Corkly-<version>-mac-universal.dmg
npm run dist:win    # on Windows → dist/Corkly-Setup-<version>.exe
```
