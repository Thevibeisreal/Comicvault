# ComicVault Web

A mobile-browser-first website. Users only paste a URL and press **Download comic PDF**. The website server retrieves publicly accessible page images and creates a standard PDF with pages ordered vertically for continuous scrolling in a PDF reader.

## Deploy online (no app/server installation on your phone)

1. Create a private repository on GitHub and upload the contents of this folder.
2. Create a web service on Render and connect that repository.
3. Render can detect `render.yaml`; use the configured Node service.
4. Wait for deployment, then open the Render URL on your Android phone.
5. Paste a supported comic URL and tap Download comic PDF.

The included `render.yaml` provisions persistent storage for temporary images. Hosting may require a paid plan; provider pricing and policies can change. Do not publish this app without adding authentication if you want the service private.

## What the importer supports today
- ComicFury / `*.thecomicseries.com`: attempts to enumerate a public `/archive/` and collect the main image from each numbered comic page (up to 300 entries).
- Other sites: a best-effort single-page extractor that looks for public `img` elements and social preview images. This is not a universal crawler.
- PDF output: one PDF, one comic image per PDF page, suitable for continuous vertical scrolling in standard PDF viewers.

## Important limitations
There is no reliable universal method to download every comic from every site. Webtoon, Comix.to and other large platforms may use dynamic rendering, API endpoints, signed URLs, login gates, or technical protections. They need their own compliant connector, and some may not permit downloading. This build does not bypass logins, paywalls, DRM, CAPTCHAs, anti-bot protections, or other access controls.
The service downloads only content reachable through ordinary public web requests. Use it only for works you own or have permission to archive and respect creators' terms and copyright.

## Local developer test
Requires Node.js 20+:
```
npm install
npm start
```
Then open http://localhost:3000. This local step is for development only; the intended end-user experience is the hosted URL in a phone browser.
