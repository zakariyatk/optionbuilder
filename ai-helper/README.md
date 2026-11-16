# AddStock AI helper (runs on your PC)

The **AI Trade** page can ask Claude to review a chart in two ways:

| Source in the page | Where Claude is called | Credentials |
|---|---|---|
| **Server** | The site's PHP backend (`api/lib/ai.php`) | `anthropic_api_key` in the server's config. Paid per analysis. |
| **This PC** | This helper, on `127.0.0.1:8787` | Your own Anthropic login from the `ant` CLI. Nothing is stored on the server. |

Both use the same prompt and answer format: `api/lib/ai_trade_spec.json`.

## One-time setup

1. Install [Node.js](https://nodejs.org) 20 or newer.
2. Install the Anthropic CLI (`ant`): on Windows, download the release for your system from
   [github.com/anthropics/anthropic-cli/releases](https://github.com/anthropics/anthropic-cli/releases)
   and put `ant.exe` on your PATH (or, with Go installed, `go install github.com/anthropics/anthropic-cli/v2/cmd/ant@latest`).
   Then sign in; it opens your browser:

   ```bash
   ant auth login
   ```

   Check it with `ant auth status`. The helper reads that login automatically (from `%APPDATA%\Anthropic`).
   Instead of a login you can set `ANTHROPIC_API_KEY`, but an exported key always wins over the login.
3. Install the helper's one dependency:

   ```bash
   cd ai-helper
   npm install
   ```

## Every time you want "This PC" analyses

```bash
cd ai-helper
npm start
```

Keep that window open. In AddStock, open **AI Trade**, set **Claude via** to **This PC**, and press **Analyse with Claude**. Each analysis prints one line in the window (symbol, signal, tokens used).

## Settings (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `AI_MODEL` | `claude-opus-5-5` (from the spec) | Another model, e.g. `claude-sonnet-5-5` |
| `AI_HELPER_PORT` | `8787` | Port; the page expects 8787 |
| `AI_HELPER_ORIGINS` | none | Extra page origins allowed to call the helper, comma-separated |

The helper listens on `127.0.0.1` only, and answers only `https://optionbuilder.adddots.com` and the local dev server, so other websites can't use your login.
