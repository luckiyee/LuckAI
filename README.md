# LuckAI

A lightweight bilingual (EN/FR) local-first chat assistant with optional web search (DuckDuckGo) and local GGUF model support.

Built using Node.js + Express, with an optional local GGUF runner (`node-llama-cpp`) for on-device inference. The web UI is plain vanilla JavaScript and lives in `assets/` and `html/`.

---

## 🔦 Features

- Two-phase fast-first / full answer generation (short answer + background full answer)
- Optional DuckDuckGo HTML search integration for current web context
- Local GGUF runner support (via `node-llama-cpp`) for offline inference
- Compact, configurable UI with typing animations, retry, and inline feedback (thumbs up/down)
- Sanitization layers to strip redirect/uddg lines and avoid leaking raw URLs
- Simple feedback logging (`/api/feedback`) stored in `data/feedback.jsonl`

---

## ⚙️ Requirements

- Node.js 14+
- A GGUF model file (optional) placed in one of these locations or referenced via env var:
  - `./.ollama` or `./.ollama/blobs`
  - Set `LUCKAI_GGUF_PATH` to point to a `.gguf` file
- Optional: `node-llama-cpp` (native bindings) for local inference — may require build tools

---

## Quick start

1. Install dependencies

```bash
npm install
```

2. (Optional) Place a `.gguf` model in `./.ollama` or set the env var:

```powershell
$env:LUCKAI_GGUF_PATH = 'D:\models\your-model.gguf'
```

3. Start the server

```bash
npm start
# or for development
npm run dev
```

4. Open the UI in your browser:

- English: http://localhost:3000/chat
- French:  http://localhost:3000/fr/chat

---

## Environment variables

You can tune behavior via environment variables (or override per-request from the client):

- `PORT` — HTTP port (default: `3000`)
- `JWT_SECRET` — secret for auth tokens
- `LUCKAI_GGUF_PATH` — path to a `.gguf` model file (optional)
- `LUCKAI_GGUF_DIR` — directory to search for models
- `LUCKAI_CTX` — context size for the model (default: 4096)
- `LUCKAI_MAX_TOKENS` — default max tokens for generation (default: 4096)
- `LUCKAI_N_THREADS` — number of threads used by the model
- `LUCKAI_DEBUG` — when set (`1`) enables extra logging

Example (PowerShell):

```powershell
$env:PORT = 3000
$env:LUCKAI_MAX_TOKENS = 4096
npm start
```

---

## API Overview

- POST `/api/chat` — main chat endpoint
  - Body: `{ message, useWebSearch, conversationHistory, temperature, maxTokens, fast }`
  - Returns: `{ answer, pendingFull, fullId, language, usedWeb, sources }`
- GET `/api/chat/full/:id` — poll background full response by `fullId`
- POST `/api/feedback` — record user feedback (body: `{ messageId, feedback:'up'|'down', content, prompt }`)
- GET `/api/feedback/recent` — admin endpoint to fetch recent feedback entries
- GET `/api/local/status` — local GGUF status
- GET `/api/search/test?q=...` — quick DuckDuckGo test

Example chat call (curl):

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Explain the solar system","useWebSearch":false}'
```

Send feedback example:

```bash
curl -X POST http://localhost:3000/api/feedback \
  -H "Content-Type: application/json" \
  -d '{"messageId":"msg-xxx","feedback":"up","content":"Nice answer","prompt":"Explain X"}'
```

Feedback is appended to `data/feedback.jsonl` as newline-delimited JSON.

---

## UI Notes & Behavior

- The UI keeps a short-phase answer visible quickly, and then replaces it with a full version (background polling). If you prefer longer immediate outputs, increase `maxTokens` or set the per-request `maxTokens` via client options.
- Sources are returned by the server but the inline sources UI can be disabled (per user preference); they still appear in the response payload for debugging or future features.
- Typing indicators and retry behavior have been hardened to avoid duplicate/overlapping indicators. Use the **Retry** button on an AI message to re-generate using the original prompt.

---

## Development tips

- Enable debug logs (server): `LUCKAI_DEBUG=1 npm start`
- Client-side debug: set `window.LUCKAI_DEBUG = true` in browser console to see extra console messages
- Per-request tuning: pass `{ maxTokens, temperature, fast }` from the client to control generation

Troubleshooting:
- If the model is unavailable, ensure `node-llama-cpp` is installed and `LUCKAI_GGUF_PATH` points to a valid GGUF file.
- If answers are truncated, increase `LUCKAI_MAX_TOKENS` or pass a higher `maxTokens` in the client request.

### Large model files and Git-friendly workflow

If you have a very large model blob (for example in `.ollama/blobs/sha256-...`) that exceeds GitHub's file size limits, the project supports splitting the blob into 25MB chunks and keeping those chunks in the repo. The server will automatically detect chunk groups (files starting with `sha256-<hash>`) and assemble them into `data/models/sha256-<hash>.gguf` before loading.

How to split a large file into 25MB parts (Node.js):

```bash
node scripts/split-gguf.js path/to/sha256-... 25
```

This produces `path/to/sha256-....part001`, `...part002`, etc. Commit those part files to Git (they will each be <=25MB).

When the server starts, `gguf-runner` will detect the parts and assemble them into `data/models/sha256-<hash>.gguf` automatically. `data/models/` is ignored by default so the assembled output will not be committed to Git.

If you'd rather use OS tools, on UNIX you can also use `split -b 25M <file> <file>.part`.

---

## File structure (important files)

- `server.js` — Express server and API handlers
- `gguf-runner.js` — local GGUF runner and prompt construction
- `assets/js/chat.js` — client-side chat UI logic
- `assets/js/api.js` — client API wrapper
- `assets/css/style.css` — UI styling
- `html/` — static HTML pages for chat and login
- `data/feedback.jsonl` — recorded feedback entries (created automatically)

---

## Contributing

Contributions welcome — please open issues or PRs. Keep changes focused and test on both English and French pages.

Suggested conventions:
- Add tests or manual validation steps for UI changes
- Run `npm install` to keep dependencies up to date

---

## License

MIT © LuckAI Team

---