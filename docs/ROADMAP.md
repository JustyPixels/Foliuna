# Foliuna roadmap

## 1 — Foundation and discovery (completed)

- [x] Consistent Foliuna product identity; recreate unavailable starter.
- [x] Local Electron + React + TypeScript application and build scripts.
- [x] Sandboxed local renderer, narrow preload API, authorized/validated IPC and structured errors.
- [x] e621/e926 adapters, descriptive User-Agent, paced serial queue, timeout/body bound and provider cooldown handling.
- [x] Tag searches, source choice, numbered pagination, categorized post details, plain-text descriptions and canonical source opening.
- [x] Non-destructive versioned SQLite schema for assets, sources, categorized tags and collections.
- [x] Unit/component/database/IPC tests and actual Electron desktop verification. The former offline demo was removed at user request.
- [x] Development instructions, append-only log, README and architecture/roadmap docs.

Consult LOG.md for actual verification outcomes. Checkmarks describe implementation, not a public release guarantee.

### 0.2.1 — e621-only discovery and image viewing

- [x] Use e621 for all live API traffic, default to safe-only rating:s, and offer an explicit all-ratings filter.
- [x] Preserve existing e926 archive identities and encrypted files without making live e926 requests or rewriting provenance.
- [x] Fix reproduced ERR_BLOCKED_BY_ORB via same-origin validated media routes with no credential forwarding or relaxed browser security.
- [x] Show uncropped thumbnails, sample-first details, explicit full-resolution image selection, visible failures and retry.
- [x] Verify portrait/landscape image proportions in Electron and actual safe e621 thumbnail/sample/original delivery in an isolated opt-in check.

## 2 — Credentials, explicit downloads and durable archiving (implemented)

- [x] Per-provider username/API key settings, Windows account encryption, write-only key entry, test connection and removal.
- [x] Main-only HTTPS Authorization headers, no key forwarding to CDN/media URLs, no plaintext fallback or anonymous fallback for locked entries.
- [x] Native library-folder selection, write/hard-link support check, exclusive library lock and explicit per-post download/cancellation.
- [x] Re-fetch snapshots and stream allowlisted originals with size/MIME/signature/provider-MD5 verification and SHA-256 calculation.
- [x] SHA-256 deduplication across providers, categorized tags and immutable capture history in SQLite schema v2.
- [x] Version-1 portable `.foliuna.json` sidecars adjacent to media, merging provenance on duplicates.
- [x] Persistent journal, cleanup of incomplete streams, idempotent recovery of completed transfers, no overwrite of conflicting media, and safe shutdown.
- [x] Real local HTTP media fixtures plus credential, transfer, cancellation, migration, no-overwrite and recovery tests; actual Windows encrypted-save/restart/remove verification.

Publication now has an exclusive-copy fallback when hard links are unavailable; physical exFAT/power-loss behavior remains unverified. Replaced original bytes for an existing source identity are preserved/rejected rather than versioned. No real user key was available to prove authenticated live provider access; a key may not resolve an HTTP 403. Hardware-failure recovery and release hardening remain unverified. See LOG.md for actual command results.

### 0.2.2 — Browsing and playback improvements

- [x] Previous/next details without closing, including loading the next page at the boundary.
- [x] Shared cropped/aligned and natural-proportion flowing grids; saved display preferences.
- [x] Resizable media window, Fullscreen/F11, Escape and close-to-details behavior; no privileged bridge in the viewer.
- [x] Bounded API cache/coalescing, two CDN transfers, verified-byte cache/ranges, lazy visible images, video-on-play and provider cooldowns.
- [x] Saved pages/infinite-scroll setting, one page at a time, duplicate filtering and explicit retry after failures.
- [x] Debounced cached site tag-prefix autocomplete with keyboard selection.
- [x] Video grid indicators and WebM/MP4 playback controls; animated original GIFs when visible.
- [x] Bundled Ruffle SWF playback on a separate local origin with networking/script access blocked; compatibility remains file-dependent.
- [x] Tag Add/Exclude/Favorite popup and persistent local favorite tags/artists.
- [x] Read-only sanitized account details, site favorite tags/artists and favorite-post browsing using saved credentials.
- [x] App-styled scrollbars with high-contrast support.

These controls are now shared with the phase 3 Gallery; Collections is phase 4. Real account authentication is still unverified without a user key. Large videos buffer before playback; unsupported codecs/Flash features and externally dependent SWFs may fail. See LOG.md for actual verification.

## 3 — Offline gallery (implemented in 0.3.0)

- [x] Browse archived media and preserved source metadata with zero provider dependency.
- [x] Parameterized exact tag/category/source/rating/provider/type/ID queries, source-consistent matching and SHA-256 asset grouping; documented grammar in GALLERY.md.
- [x] Local tag recommendations, safe-only default, 24-item paging/infinite scrolling and shared layout/detail/favorite/viewer controls.
- [x] Lazy, sandbox-generated PNG thumbnail cache, local image/GIF/video/isolated SWF playback and bounded verified local media routes/ranges.
- [x] Explicit schema-v1 sidecar import, idempotent capture-history merging and index reconstruction after a library move/lost database; invalid/unknown files are preserved and reported.
- [x] Explicit moved/missing/corrupt-file checking, hash-verified canonical recovery without deleting candidates, missing-sidecar regeneration and retained metadata for lost originals.
- [x] Verified no-overwrite exclusive-copy fallback for filesystems without hard links; forced unsupported-filesystem/concurrent-publication tests. Actual exFAT devices and power-loss behavior are unverified.
- [x] Revision workflow: earlier bytes remain immutable and visible in Gallery; different bytes for the same provider/post are refused. Choose a separate archive folder to keep another revision. No silent replacement or destructive repair.
- [x] Unit/component/desktop coverage with networking denied, including local image/video/GIF/Flash, restore, cached thumbnails, local suggestions, reconciliation, viewer and restart. Consult LOG.md for final commands/results.

Limits: current schema is v3 after the multi-booru migration; sidecars retain their v1 envelope. Scans skip links/dot folders, cover at most eight nested levels and 100,000 entries, and report up to 50 individual issues. Sidecars are capped at 16 MiB; originals remain capped at 100 MiB. Very large sessions retain loaded cards; virtualized scrolling, hardware-level recovery guarantees and full codec/Flash compatibility are not claimed.

## 0.3.1 — Multiple boorus (implemented before Collections)

- [x] Built-in e621, Danbooru, Gelbooru, Rule34.xxx, Safebooru, AIBooru, Yande.re and Konachan.
- [x] Custom public HTTPS Danbooru/Gelbooru JSON connections with site/API bases, safe-rating mapping, explicit media origins and encrypted per-connection credentials.
- [x] Provider-aware search, pagination, details, source links, media/viewer routes and downloads; strict renderer isolation retained.
- [x] Scoped Basic/query API authentication, DNS address pinning/private-network rejection, serial pacing/cooldowns and bounded caches.
- [x] Transactional SQLite v3 upgrade; canonical/raw source snapshots, portable custom provenance and offline restore without the connection installed.
- [x] Mocked adapter/network/IPC/credential/archive tests and isolated Windows multi-provider UI/restart journey.

See BOORUS.md and LOG.md for API sources, compatibility and actual verification. Authenticated live Rule34/Gelbooru/custom access remains unverified without real keys; account details/site favorites still use e621 only. XML-only APIs and modified/non-compatible engines are unsupported.

## 4 — Collections (implemented in 0.4.0)

- [x] Named local collections with create/rename/delete and saved-asset membership.
- [x] SHA-256 identity, offline collection search/paging and shared grid/details/viewer.
- [x] Atomic authoritative .foliuna/collections.json plus recoverable SQLite projection.
- [x] Unknown/missing memberships retained through full-library copying and index restoration.
- [x] Deleting a collection preserves original media, sidecars and source history.
- [x] Unit/component and zero-network Windows restart/restore journeys; see COLLECTIONS.md.

## 5 — Windows release candidate (0.5.0-rc.1)

- [x] Shorter UI copy and compact shared controls; preserve actionable errors and security guidance.
- [x] Linear result deduplication, one-pass columns, memoized cards and retained lazy thumbnails.
- [x] Clean-staged x64 NSIS installer and ZIP, leaf icon and licenses.
- [x] Hardened Electron fuses, embedded ASAR integrity, file/block verification and SHA-256 manifests.
- [x] Maintainer JustyPixels, GitHub-only releases/contact and descriptive API identification.
- [x] Dependency advisory review, backup/update/uninstall/migration documentation and pinned Windows CI.
- [ ] Certificate signing for a stable release; candidate binaries are unsigned.
- [ ] Real-key authenticated provider validation entered locally in Settings.
- [ ] Windows 11/ARM64, physical exFAT/power-loss and maximum-size library validation.

Actual local/packaged/installer verification and publishing outcomes are recorded in LOG.md.
Configurable blacklists, automatic updates, other encrypted credential backends and extra providers
require separately scoped increments. Avoid sync, telemetry, cloud accounts, plugins and automatic
scraping until the search-to-archive loop is validated in everyday use.

## Android testing preview and public showcase

- [x] Capacitor 8/Kotlin platform boundary sharing React, provider definitions, artwork and compatibility fixtures with Windows.
- [x] Eight built-ins/custom Danbooru/Gelbooru, Keystore credentials, native paced/checked network/media, isolated bundled WebView.
- [x] Private SQLite archive, explicit foreground transfers, SHA-256 deduplication, immutable history, portable sidecars, recovery and offline Collections.
- [x] Mobile tabs/touch grids, details navigation, sample/full-size, GIF/video, fullscreen return, Back and rotation.
- [x] Explicit SAF snapshot export, exclusion of profile secrets/settings, and actual Windows importer reconstruction of Gallery/Collections.
- [x] API 26/36 emulator and authorized physical Moto g14 API 34 testing; Windows regressions/packaging retained.
- [x] README icon/screenshots, responsive showcase with real safe tag-search artwork, release-derived download links, pinned Android/Pages workflows.
- [x] Publish Android 0.1.0-preview.1 debug APK/checksum/verification notes after final source/CI checks; retain existing Windows release.
- [x] Confirm deployed GitHub Pages project-path and real release links.

The preview uses io.github.justypixels.foliuna.preview and disposable debug signing. Export before uninstalling or changing certificates. No production signing secrets, Play submission, Flash on Android, floating Android windows, background downloads, incoming Android libraries or synchronization. Authenticated live provider access and broad device/storage testing remain unverified.

## Viewing and presentation polish

- [x] Full-page details, true system fullscreen, keyboard/swipe navigation, custom video controls and a Windows title bar.
- [x] Real safe e621 forest search screenshots, credited artwork rotation, scroll motion and reduced-motion/pause controls; user-facing demo removed.

- [x] Publish Windows 0.5.0-rc.2 and Android 0.1.0-preview.2 with full-page/system-fullscreen viewing and the credited real-search website.
