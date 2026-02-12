# HFL Loads Viewer (Static Astro)

This project is a static web app that reads `loads::all` from Upstash Redis and refreshes every 10 seconds in browser-side JavaScript.

## Local setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Optional: override the default read-only Upstash credentials:
   ```bash
   cp .env.example .env
   ```
3. Start local dev:
   ```bash
   npm run dev
   ```

## Build static assets

```bash
npm run build
```

The static output is generated in `dist/` as plain HTML/CSS/JS.

## Automated free deployment (GitHub Pages)

This repo includes a GitHub Actions workflow at `.github/workflows/deploy.yml` that builds and deploys automatically to GitHub Pages on every push to `main`.

1. Push this repository to GitHub.
2. In GitHub, open `Settings` -> `Pages`.
3. Under `Build and deployment`, set `Source` to `GitHub Actions`.
4. Push to `main` (or run the workflow manually in `Actions`).

GitHub Pages hosting and the workflow are free for public repositories.

## Notes

- If `loads::all` is missing or empty, the app shows: `No loads found. Contact HFL.`
- Data refresh interval is 10 seconds.
- The Upstash token used here is read-only and visible to the browser because this is a fully static app.
