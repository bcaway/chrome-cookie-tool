# Chrome Web Store Listing — BCA Absence Sync Cookie Tool

> Last Updated: 2026-09-25

## Store Listing

**Extension Name** [REQUIRED]
BCA Absence Sync Cookie Tool

**Short Description** [REQUIRED]
Automatically syncs Google Docs session credentials to your BCA Absence Sync Google Sheets pipeline.

**Detailed Description** [REQUIRED]
BCA Absence Sync Cookie Tool seamlessly keeps your BCA class cancellation sync pipeline running 24/7 without requiring your computer to stay on constantly.

When school cancellation documents require active domain sign-in (such as Google Workspace accounts), server-side automations can lose access when sessions expire. This tool bridges that gap:

- Automatically detects active Google Docs session cookies while you use your browser.
- Periodically sends updated session tokens directly to your personal Google Apps Script Web App.
- Allows immediate manual synchronization with one click.
- Features configurable sync schedules and optional security tokens.

How to use:
1. Deploy your BCA Absence Sync Google Apps Script as a Web App (Deploy > New deployment > Web app).
2. Open this extension's settings and paste your Web App URL.
3. Click "Sync Cookie Now" to test the connection.
4. The extension will automatically refresh your cloud script in the background while you work.

Privacy note:
All credentials are sent exclusively to your private Google Apps Script Web App URL. No data is collected by third parties or sent to external servers.

**Category** [REQUIRED]
Productivity

**Single Purpose** [REQUIRED]
Synchronizes Google Docs session cookies to a user-configured Google Apps Script Web App endpoint for absence data extraction.

**Primary Language** [REQUIRED]
English

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|---|---|---|---|
| Store Icon [REQUIRED] | 128×128 PNG | ✅ Ready | icons/icon-128.png |
| Screenshot 1 [REQUIRED] | 1280×800 or 640×400 | ⬜ Not created | |
| Screenshot 2 [RECOMMENDED] | 1280×800 or 640×400 | ⬜ Not created | |

### Screenshot Notes
- Screenshot 1: Extension popup open showing successful sync status and cookie count.
- Screenshot 2: Expanded configuration panel showing the Web App URL input and auto-sync options.

## Permissions Justification

| Permission | Type | Justification |
|---|---|---|
| `cookies` | permissions | Required to read Google Docs session cookies for the published school class cancellation document. |
| `storage` | permissions | Required to save user configuration locally (Apps Script Web App URL, secret key, sync intervals). |
| `alarms` | permissions | Required to schedule periodic background sync operations while the browser is running. |
| `https://docs.google.com/*` | host_permissions | Required to read session cookies necessary for accessing domain-protected published Google Docs. |
| `https://*.google.com/*` | host_permissions | Required to read root Google authentication session cookies (e.g. SID, HSID, SSID) for Google Docs access. |
| `https://script.google.com/*` | host_permissions | Required to send HTTP POST requests with updated cookie credentials to the user's Google Apps Script Web App. |
| `https://script.googleusercontent.com/*` | host_permissions | Required to follow Google Apps Script Web App HTTP redirects when receiving sync responses. |

## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** Yes

| Data Type | Collected? | Transmitted Off-Device? | Purpose | Shared with Third Parties? |
|---|---|---|---|---|
| Authentication info | Yes | Yes (to user's script only) | Google Docs session cookies forwarded strictly to the user's self-hosted Google Apps Script endpoint | No |
| Personally identifiable info | No | No | N/A | No |
| Health info | No | No | N/A | No |
| Financial info | No | No | N/A | No |
| Personal communications | No | No | N/A | No |
| Location | No | No | N/A | No |
| Web history | No | No | N/A | No |
| User activity | No | No | N/A | No |
| Website content | No | No | N/A | No |

### Data Use Certification
- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

## Distribution
**Visibility**: Unlisted
**Regions**: All regions

## Developer Info
**Publisher Name** [REQUIRED]: BCAway
**Contact Email** [REQUIRED]: admin@bcaway.org

## Version History

| Version | Date | Changes | Status |
|---|---|---|---|
| 1.0.0 | 2026-09-25 | Initial release with background alarm sync and popup UI | Draft |
