# LinkedIn AI GTM - Chrome Extension

AI-powered outreach capabilities for LinkedIn — automate messaging, analyze
conversations, and orchestrate outreach campaigns.

> Per `AGENTS.md`, the extension opens as a **full page** (not a popup).
> Clicking the toolbar icon opens `fullpage.html` in a dedicated window.

## Features

- **Dashboard** — overview of conversations, messages to reply, sent/received
  counts, outcomes, last-scrape status, and a configurable scrape button.
- **Messages** — inbox-style view with a left-side contact list and a
  right-side conversation thread.
- **Sequencer** — visual canvas for defining outreach sequences with delays,
  fixed messages, and AI-generated prompts. Supports `{{name}}` style
  placeholders.
- **Scraping** — extracts the conversation list from `linkedin.com/messaging`
  via a registered content script.

## Installation (Chrome / Brave)

### Prerequisites

- Chrome / Brave (or any Manifest V3-compatible browser)
- Node.js 18+ for building

### Build & load

```bash
cd extension
npm install
npm run build
```

The build writes TypeScript output into `extension/dist/`. Copy the static
HTML into place and copy the manifest:

```bash
cp extension/src/fullpage.html extension/dist/
cp extension/manifest.json extension/dist/
```

Then load `extension/dist/` as an unpacked extension:

1. Open `chrome://extensions` (or `brave://extensions`).
2. Enable **Developer mode**.
3. Click **Load unpacked** and select `extension/dist/`.

## Project Structure

```
extension/
├── src/
│   ├── background.ts       # Service worker — opens fullpage.html on icon click,
│   │                       #   routes runtime messages to handlers.
│   ├── fullpage.html       # Full-page UI shell.
│   ├── fullpage.ts         # Full-page UI controller.
│   ├── manifest.json       # (dev convenience — the canonical one is at root)
│   ├── types.ts            # Shared TypeScript types.
│   ├── content/
│   │   ├── main.ts         # Injected into LinkedIn messaging pages.
│   │   └── styles.css
│   ├── handlers/           # Pure message handlers (background-side).
│   │   ├── analysis.ts
│   │   ├── conversations.ts
│   │   ├── dashboard.ts
│   │   └── sequencer.ts
│   ├── modules/            # Full-page UI modules.
│   │   ├── buttons.ts
│   │   ├── dashboard.ts
│   │   ├── messages.ts
│   │   ├── sequencer.ts
│   │   └── tabs.ts
│   └── utils/
│       └── sequencer.ts    # Default sequencer + {{var}} template renderer.
├── manifest.json           # Chrome extension manifest (manifest v3).
├── tsconfig.json
└── package.json
```

## Available Scripts

```bash
npm run build       # Full build: clean → tsc → tailwindcss → copy static files
npm run build:ts    # Compile TypeScript only
npm run build:css   # Compile Tailwind CSS only
npm run build:copy  # Copy HTML / manifest / content CSS into dist/
npm run watch       # Continuous TypeScript compilation
```

The full `npm run build` produces an unpacked-ready extension at
`extension/dist/` containing:

```
dist/
├── background.js           # Service worker
├── fullpage.html           # Full-page UI shell
├── fullpage.css            # Compiled Tailwind output
├── fullpage.js             # Page controller
├── manifest.json
├── content/
│   ├── main.js
│   └── styles.css
├── handlers/               # Message handlers (background-side)
├── modules/                # UI modules (page-side)
└── utils/                  # Shared utilities
```

## Configuration

Copy `.env.local.example` to `.env.local` (which is gitignored) and fill in
your secrets. The values are consumed by Phase 2 / Phase 3 work — the
current Phase 1 extension stores everything locally via `chrome.storage`.

| Variable             | Purpose                                            |
| -------------------- | -------------------------------------------------- |
| `GEMINI_API_KEY`     | Gemini 3.5 key for message analysis (Phase 3).    |
| `DO_GENERATION_MODEL`| Model name on the DigitalOcean inference endpoint. |
| `DO_INFERENCE_URL`   | Override for the inference endpoint URL.           |
| `DO_INFERENCE_TOKEN` | Bearer token for the inference endpoint.           |
| `MONGODB_URI`        | Connection string for the service backend.         |

## Usage

1. Click the extension icon in the toolbar — the full app opens in a window.
2. Visit `https://www.linkedin.com/messaging/`.
3. In the **Dashboard** tab, set the desired scrape count and click **Scrape
   Conversations**.
4. View scraped conversations in the **Messages** tab.
5. Edit and save your outreach sequence in the **Sequencer** tab.

## Troubleshooting

- **Nothing happens when you click the icon** — verify `background.js` is
  loaded as a service worker (check `chrome://extensions` → Service Worker
  link).
- **Scraping reports "No LinkedIn tab found"** — open a LinkedIn messaging
  tab and try again.
- **Module not found at runtime** — ensure you copied `fullpage.html` into
  `dist/` after building.

## License

MIT
