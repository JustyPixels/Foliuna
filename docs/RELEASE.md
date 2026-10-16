# Windows release candidate

Maintainer: [JustyPixels](https://github.com/JustyPixels). Downloads and support
use [GitHub releases](https://github.com/JustyPixels/Foliuna/releases) and
[GitHub Issues](https://github.com/JustyPixels/Foliuna/issues).

## Install and open

Download the Windows x64 Setup executable from the release page and run it.
It installs for your Windows account and creates a Start menu entry. Launch
**Foliuna** from Start. Node.js and a development terminal are not required.

Alternatively, extract the **entire** Windows ZIP to a writable folder and
double-click `Foliuna.exe`. Keep its resources and other bundled files beside
it. The ZIP is portable as an application folder; settings and encrypted keys
still live in `%APPDATA%\Foliuna`, not beside the executable.

Version 0.5.0-rc.1 is an **unsigned prerelease**. Windows may show an unknown
publisher warning. A SHA-256 checksum detects differing bytes but does not
replace a publisher signature. Certificate signing is still a stable-release
requirement; no certificate, private signing key or signing service is supplied.

To compare a downloaded asset with `SHA256SUMS.txt`:

```powershell
Get-FileHash .\Foliuna-0.5.0-rc.1-Windows-x64-Setup.exe -Algorithm SHA256
```

Target: Windows 10/11 x64. Local verification uses Windows 10 build 19045;
Windows 11, ARM64 and other operating systems have not been locally tested.
Windows credential persistence uses DPAPI and has no plaintext fallback.

## Existing library, upgrades and backups

Close Foliuna normally before upgrading or copying a library. Install the new
version over the old app, or extract a new ZIP into a separate folder. Do not
mix files from different versions. Settings keep the same profile and native
archive-folder selection. Uninstall does not delete the profile or your chosen
archive folder. This release does not automatically update itself.

Back up the **entire archive folder**, including `.foliuna/collections.json`,
the SQLite database and all media/sidecars. Dot folders must be included.
Copy only while the app is closed. Individual media sidecars preserve source
history but do not contain collection membership. The profile contains settings
and encrypted keys; keys are tied to the Windows account and may need re-entry
on another computer. Do not publish profile files in support reports.

The database stays at schema v3, media sidecars at v1 and collection snapshots
at v1. Existing v1/v2 databases migrate transactionally; newer unknown schemas
are refused. To restore a moved library, choose its root in Settings. If the
index is unavailable, retain a backup and import verified sidecars through
Gallery; collection memberships remain pending until their media is indexed.
Older releases may not support the current database. Restore an entire backup
to a separate folder when testing a downgrade; do not edit schema numbers.

## Build and verification

Use Node 24.18+ in the 24.x line on Windows, with the committed lockfile:

```powershell
npm ci
npm run check
npm run package:win
npm run test:packaged
```

The package command stages only compiled files, minimal public metadata, icon
and licenses in `work/package`. Electron Builder 26.15.3 builds per-user NSIS
and ZIP assets into `release/`, without publishing. Tests, source, developer
dependencies, traces, profiles and libraries are outside the staging folder.
The Windows workflow repeats these checks and uploads unsigned CI artifacts;
it has read-only repository permissions and does not publish releases.

`verify-package.mjs` checks the actual executable fuses, embedded ASAR header
hash, every packaged file/block hash and allowed file paths, then generates
`package-verification.json` and `SHA256SUMS.txt`. Packaged smoke checks use
only explicitly requested loopback browser debugging and a temporary demo
profile. They do not enable the disabled Node inspector or modify production
fuses. `--demo` is also available to users; `--user-data-dir=<absolute-path>`
selects a separate profile for troubleshooting. Normal launch enables neither.

The original leaf icon is committed. `npm run icon` regenerates its PNG/ICO
using the development Electron software renderer. Regeneration is optional.
Repeat builds are checked at the packaged payload level; byte-identical NSIS,
ZIP timestamps and signed executable output are not promised.

Fuses disable RunAsNode, NODE_OPTIONS, Node inspection and extra file-protocol
privileges, enable cookie encryption, and require the integrity-checked ASAR.
Main and viewer remain sandboxed with context isolation and no Node integration;
the viewer has no preload. Remote sites are never embedded in privileged views.
See [Electron fuses](https://www.electronjs.org/docs/latest/tutorial/fuses),
[ASAR integrity](https://github.com/electron/electron/blob/main/docs/tutorial/asar-integrity.md)
and the [stable builder documentation](https://www.electron.build/v26/).

## Release gate and remaining validation

Before publishing: run checks above, inspect current dependency advisories,
verify Authenticode signing status, review the staged file list and checksums,
test the installed executable in an isolated profile, and attach only the
installer, ZIP, checksums and verification reports. Tag the matching source
commit. Do not attach traces, work directories, credential files or libraries.

Authenticated live site access still needs a real key entered **locally in
Settings**, never in chat or GitHub. Physical exFAT/power-loss recovery,
maximum-size libraries, full Flash compatibility and every video codec remain
unverified. Default tests use fixtures and do not contact booru APIs.

On 2026-10-16, the dependency audit after the compiler update reported no
critical/high/low advisories and eight moderate dependency entries stemming
from unpatched `sprintf-js` through the optional proxy support in builder's
download tooling. Those tools are excluded from the packaged application.
The production-only audit and final commands are recorded in LOG.md. Do not
downgrade the packager automatically in response to npm's proposed fix.

Rule34's [API terms](https://api.rule34.xxx/) were rechecked for this candidate:
no ads/paywalls and no multiple-key rotation. The client has neither ads nor
paywalls, keeps one saved key per connection, and honors server cooldowns.
The e621 help page could not be fetched by the documentation browser during
this review; the maintained server source and existing API policy references
are linked in BOORUS.md. The queue remains serial with at least 1.1 seconds
between starts, 24 posts per page, bounded media concurrency and no automatic
retries. A release does not imply provider endorsement.
