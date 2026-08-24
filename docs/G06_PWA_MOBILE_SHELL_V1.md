# G06 Mobile/PWA Foundation V1

Status: source checkpoint in progress. AWS/provider runtime remains paused and Production remains unchanged.

## Owner-approved PWA scope

The installed PWA surface contains exactly three primary destinations:

1. **ลงเวลา (Attendance)**
2. **ลา (Leave)**
3. **โปรไฟล์ (Profile)**

The normal SMS web application retains its existing navigation and administrative/operational pages. The three-page restriction applies only to the installed/standalone PWA shell (or the explicit `?pwa=1` launch mode).

## Installability

- Web App Manifest: `frontend/public/manifest.webmanifest`
- Standalone display mode
- Start URL: `/?pwa=1&page=attendance`
- SMS app icons: 192px, 512px, Apple touch icon
- Safe-area-aware top/bottom mobile chrome
- PWA shortcuts are limited to Attendance, Leave, and Profile.

## Service worker policy

The service worker is intentionally shell-only in V1.

- GET static shell/assets may be cached.
- `/api/*` is explicitly excluded from service-worker caching.
- Non-GET requests are never intercepted/cached.
- No Background Sync.
- No Push.
- No offline Attendance event queue.
- No offline Leave mutation queue.
- Offline shell visibility never implies Attendance or Leave success.

This preserves the existing authority rule: Attendance success exists only after authoritative server-side AttendanceEvent commit.

## Attendance

The PWA reuses the accepted Attendance UX and transient QR camera scanner. The client still cannot choose CHECK_IN/CHECK_OUT and cannot provide biometric PASS claims. QR camera frames stay transient in browser memory and are not uploaded/persisted.

Face/Liveness provider execution remains closed. The PWA does not introduce `/attendance/verification/start` or Attendance event acceptance from the frontend while AWS/provider integration is paused.

## Leave

The PWA reuses the existing authenticated self-service Leave page and existing backend workflow/authority. It does not introduce a new Leave API or bypass the current approval/return/reject/cancel rules.

## Profile

The PWA adds a dedicated Profile surface for:

- display name / email / role / department presentation,
- online/offline status,
- Passkey/security management entry,
- logout.

Passkey/account security remains separate from Attendance Personal Device authority.

## Explicit non-goals for V1

- No Schedule page in PWA.
- No Dashboard in PWA.
- No Employee Master/Admin pages in PWA.
- No trusted biometric provider activation.
- No AWS credential/env change.
- No Preview Attendance runtime flag change.
- No Production deployment/migration/env/data mutation.
- No controlled offline Attendance (`OFFLINE_PENDING`) yet.
