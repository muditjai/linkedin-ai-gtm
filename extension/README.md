# LinkedIn AI GTM - Chrome Extension

AI-powered outreach capabilities for LinkedIn - automate messaging, analyze conversations, and orchestrate outreach campaigns.

## Features

- **Dashboard** - Overview of conversations, messages to reply, sent/received counts, and outcomes
- **Messages** - Inbox-style view of ongoing conversations
- **Sequencer** - Visual canvas for defining outreach sequences with delays and AI-generated messages
- **Scraping** - Extract conversations from LinkedIn messages page

## Installation on Brave Browser

### Prerequisites

- [Brave Browser](https://brave.com/) installed
- Node.js 18+ for building

### Build and Load

1. Navigate to extension directory:
   ```bash
   cd extension
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the extension:
   ```bash
   npm run build
   ```

4. Copy static files to dist:
   ```bash
   cp manifest.json popup.html popup.css dist/
   cp src/content/styles.css dist/content/
   ```

5. Update manifest paths (the build doesn't do this automatically):
   ```bash
   # Edit dist/manifest.json to change:
   # "service_worker": "src/background.ts" -> "service_worker": "background.js"
   # "js": ["src/content/main.ts"] -> "js": ["content/main.js"]
   # "css": ["src/content/styles.css"] -> "css": ["content/styles.css"]
   ```

6. Update popup.html script src:
   ```bash
   sed -i 's|src/popup.ts|popup.js|g' dist/popup.html
   ```

7. Open **Brave Browser** and navigate to:
   ```
   brave://extensions
   ```

8. Enable **Developer mode** (toggle in top-right corner)

9. Click **Load unpacked**

10. Select the `extension/dist` folder

11. The extension icon will appear in your browser toolbar

### Development Mode (Auto-Reload)

For continuous development:

1. Build with watch mode:
   ```bash
   npm run watch
   ```

2. In Brave, click the **Reload** button on the extension card after making changes

## Project Structure

```
extension/
├── src/                       # TypeScript source
│   ├── background.ts           # Background service worker
│   ├── popup.ts               # Main popup controller
│   ├── types.ts              # Type definitions
│   ├── content/              # Content scripts
│   │   ├── main.ts
│   │   └── styles.css
│   ├── handlers/             # Message handlers
│   │   ├── conversations.ts
│   │   ├── sequencer.ts
│   │   ├── dashboard.ts
│   │   └── analysis.ts
│   ├── modules/              # Popup UI modules
│   │   ├── tabs.ts
│   │   ├── buttons.ts
│   │   ├── dashboard.ts
│   │   ├── sequencer.ts
│   │   └── messages.ts
│   └── utils/               # Utilities
│       └── sequencer.ts
├── dist/                     # Compiled output (after build)
├── manifest.json              # Extension manifest
├── popup.html               # Popup UI
├── popup.css                # Popup styles
├── package.json             # Dependencies
└── tsconfig.json           # TypeScript config
```

## Available Scripts

```bash
npm run build    # Build TypeScript to JavaScript
npm run watch   # Watch mode for development
```

## Usage

1. Click the extension icon in the browser toolbar
2. Go to **Dashboard** and click "Scrape Conversations" (while on LinkedIn)
3. View scraped conversations in **Messages** tab
4. Create outreach sequences in **Sequencer** tab
5. Execute sequences to automate outreach

## Troubleshooting

**Extension not loading?**

- Check for errors in `brave://extensions`
- Open DevTools on extension popup (right-click > Inspect)
- Check console for errors

**Scraping not working?**

- Ensure you're on LinkedIn messages page: `https://www.linkedin.com/messaging/`
- LinkedIn may have updated DOM - check selector names in content script

**Storage issues?**

- Extension storage is isolated - data won't persist across uninstalls

## License

MIT