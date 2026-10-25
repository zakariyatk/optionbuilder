# Store screenshots

The Microsoft Store and Google Play images in `design/store`, made from the real app on its recorded market data.

```bash
cd frontend && npm run dev:mock -- --port 5174     # in one terminal
cd scripts/store && npm install
node capture.mjs     # drives the app through each page, saves screens to out/raw
node compose.mjs     # lays them out: out/microsoft-store (1920x1080), out/google-play (1080x1920 + 1024x500 feature graphic)
```

Copy the results to `design/store` when they look right. Headlines and slide order are the `DESK` and `PHONE` lists in `compose.mjs`; the accent is the app's `#7B61FF`.

Restart the mock server before a capture: it keeps saved drafts for as long as it runs.
