# Privacy Policy for Splash

**Effective Date:** November 27, 2026

Splash ("the Extension") is an open-source Chrome New Tab extension developed at [github.com/Mitscherlich/splash](https://github.com/Mitscherlich/splash). We respect your privacy and built Splash to operate **100% locally inside your browser**.

## 1. Summary

- **No data collection:** Splash does not collect, transmit, sell, rent, or share any personal information, browsing history, open tabs, notes, or usage analytics.
- **No external servers or telemetry:** Splash makes zero network requests to developer-controlled or third-party servers.
- **No remote code:** All JavaScript, CSS, and assets are bundled directly inside the extension package.

## 2. Chrome Permissions & Local Data Usage

Splash requests only the permissions required for its terminal New Tab features:

| Permission | Purpose | Data Handling |
| --- | --- | --- |
| `tabs` | List open browser tabs (`ls`), switch to a tab by ID (`cd`), and open URLs in a new tab (`open`). | Read and used strictly in memory on your device; never persisted or sent externally. |
| `history` | Rank local browsing history by frecency to provide autojump-style URL autocomplete suggestions for `open`. | Read strictly on-device when computing local suggestions; never logged, stored remotely, or shared. |
| `search` | Route non-URL `open <query>` commands to your browser's configured default search engine via `chrome.search.query`. | Handled directly by Chrome and your chosen search provider, just like typing in Chrome's address bar. |
| `storage` | Persist command history, local notes (`note`), and configuration (`/etc/splash.d/config`) in `chrome.storage.local`, and synchronize updates across open Splash tabs. | Stored exclusively on your local device via `chrome.storage.local`. |

## 3. Data Retention & Deletion

All persisted data (command history, notes, and configuration) lives solely in Chrome's local extension storage (`chrome.storage.local`) on your device. You can delete all data at any time by:

- Removing individual notes via `note rm <id>`, or
- Clearing the extension's site/storage data in Chrome, or
- Uninstalling Splash from `chrome://extensions`.

## 4. Chrome Web Store User Data Policy Compliance

Splash's use of information received from Chrome APIs adheres strictly to the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq/), including the Limited Use requirements. Because no data leaves your browser, Splash never uses or transfers user data for advertising, profiling, or any purpose other than providing its single-purpose New Tab shell.

## 5. Changes to This Policy

If a future version changes how data is handled, this policy will be updated in the repository along with the effective date before any release is published.

## 6. Contact

If you have questions or privacy concerns, please open an issue at:
https://github.com/Mitscherlich/splash/issues
