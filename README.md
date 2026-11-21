# Vault Dashboard

A dashboard for your vault, built for students: an overview page, a tasks board, a calendar, a link graph, your Canvas assignments, a review queue, and optional AI agents that can propose changes to your notes.

**Desktop only.** Nothing is changed in your notes without your approval.

## What it does

- **Dashboard**: widgets for recent notes, folders, progress and charts. Arrange them on the Customize page.
- **Tasks board and calendar**: tasks are plain notes in a `Tasks/` folder (frontmatter: `status`, `due`, `project`, …). Drag cards between *todo / doing / done*; see due dates on the calendar.
- **Link graph**: your notes and how they connect, using Obsidian's own link data.
- **Canvas (read-only)**: shows your Canvas LMS assignments and due dates. You paste an access token from Canvas (*Account > Settings > + New Access Token*) in the plugin settings.
- **Theme editor**: wallpaper, glass, colours, fonts and motion for the dashboard, and optionally for all of Obsidian (with a one-click "Turn off").
- **Claude page**: shows claude.ai in an embedded webview inside the dashboard.
- **AI agents (optional, off by default)**: chat with agents defined as Markdown files in `.claude/agents/`, running on **Claude Code** or **Gemini CLI**. Agents can only use the plugin's `vault` tools, and every change they want to make lands in the **Review queue** for you to approve, edit or reject.
- **Spark (optional)**: a small pixel helper in the corner of the window that opens a chat with your agents and now and then says a line from `RANDOM WORDS.csv`.

## Requirements

- Obsidian 1.5.0 or newer, on **desktop** (Windows is what the plugin is developed and tested on).
- For the AI agents only, one of these set up on your own computer:
  - [Claude Code](https://docs.claude.com/en/docs/claude-code) signed in with your Claude account, or
  - [Gemini CLI](https://github.com/google-gemini/gemini-cli) with your own API key (for example `GEMINI_API_KEY`).

  **The plugin never stores, asks for or sends AI keys or logins.** The default paths of the two programs can be changed in the settings.

## Install

### With BRAT (before it is in the community list)
1. Install the **BRAT** plugin from Community plugins.
2. In BRAT choose *Add Beta plugin* and enter this repository's address.
3. Enable **Vault Dashboard** under Settings > Community plugins.

### Manually
1. Download `main.js`, `manifest.json` and `styles.css` from the latest release.
2. Put them in `<your vault>/.obsidian/plugins/notioninvault-dashboard/`.
3. Reload Obsidian and enable **Vault Dashboard**.

Then click the dashboard icon in the left ribbon, or run the command **Open dashboard**.

## Turning on the AI agents

Settings > Vault Dashboard > **Enable AI agents**. This starts everything without a restart; turning it off stops the server, Spark and any running agent process. Vaults that already used the agents before this switch existed keep them on.

## Disclosures

This plugin does the following. Everything marked *agents* only happens after you turn on **Enable AI agents**.

- **Network use**
  - **Canvas** (only if you add a Canvas address and token): requests go to the Canvas address *you* entered (for example `https://myschool.instructure.com`), read-only, using your token.
  - **claude.ai**: the Claude page shows `https://claude.ai` in an embedded webview when you open that page. Your sign-in is kept in the webview's own storage.
  - No analytics, no telemetry, no other servers. Currently no Google services are contacted (a Google Tasks sync may be added later and would be opt-in and listed here).
- **Local HTTP server (agents)**: a tool server on `127.0.0.1` (a random free port) protected by a bearer token. It is reachable only from your own computer and exists so Claude Code or Gemini CLI can use the vault tools. It stops when you turn agents off or unload the plugin.
- **Programs started (agents)**: when you chat with an agent, the plugin starts `claude.exe` (Claude Code) or `node …/gemini.js` (Gemini CLI) as a child process, limited to the plugin's vault tools (their own file, shell and web tools are switched off). The process is stopped when you close the chat or disable the plugin.
- **Files written in your vault root (agents)**: `CLAUDE.md`, `.mcp.json`, `.claude/settings.json`, `.claude/vault-mcp.json`, `.claude/agent-template.md`, `.claude/agents/secretary.md`, `.gemini/settings.json`, and, if Spark's random comments are on, `RANDOM WORDS.csv`. `.mcp.json` and `.gemini/settings.json` contain the local server address and token. Existing files are merged, not overwritten, and invalid ones are backed up as `.bak`. Turning agents off does not delete these files.
- **Files written by the dashboard itself**: task notes in `Tasks/` when you create tasks, wallpaper images you choose, and the plugin's own `data.json`.
- **Data stored in `data.json`** (in the plugin folder inside your vault): layout and theme, your Canvas address and **Canvas token in plain text**, the local server token (agents) and the Review queue (agents). Keep that folder out of places you do not trust (public repositories, shared sync).
- **Your notes** are only sent anywhere when *you* attach them to the claude.ai page or chat with an agent, and then they go to your own Claude Code / Gemini CLI setup, under its own terms.

## Development

```
npm install
npm run dev      # rebuilds main.js on save
npm test         # node --test (Node 24 runs the .ts tests directly)
npm run build    # production main.js
```

Source is in `src/` (`service.ts` data layer, `ui/` pages, `agent/` tool server, proposals and engines, `spark/` helper); styles in `styles.css`, scoped under `.vd-root`. `main.js` is not committed: releases attach `main.js`, `manifest.json` and `styles.css`.

Releasing: bump `version` in `manifest.json` and `package.json`, add it to `versions.json`, commit, then push a tag equal to the version (for example `0.4.0`). The GitHub workflow runs the tests, builds and creates the release.

## License

MIT, see [LICENSE](LICENSE).
