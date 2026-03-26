# ClipSave Downloader

A sleek, minimalistic web interface for downloading videos and audio powered by `yt-dlp` and `ffmpeg`.

**Supported platforms:**
- YouTube
- TikTok
- Instagram
- X (Twitter)
- *And [1000+ more sites](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md) supported natively by yt-dlp...*

---

## One-Click Deployment

Deploy your own instance for free in seconds!

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy)

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template)

*Note: For Railway and Render, the included `render.yaml` and `railway.toml` will automatically configure the Docker container and health checks.*

---

## Local Development (Docker)

The absolute easiest way to run this locally without polluting your system is via Docker:

```bash
docker build -t clipsave .
docker run -p 10000:10000 clipsave
```

Then open `http://localhost:10000` in your browser.

## Local Development (Native)

If you have Node.js, Python 3, yt-dlp, and ffmpeg already installed:

```bash
# 1. Install dependencies
npm install

# 2. Run the server
npm start
```
Server runs on `http://localhost:3000` by default.

## Environment Variables

| Variable | Description |
|---|---|
| `PORT` | Web server port (Default: 3000 locally, 10000 in Docker) |
| `YTDLP_COOKIES` | Paste the exact contents of a `cookies.txt` (Netscape format) here to bypass age restrictions or download from private accounts. |
| `YT_DLP_PATH` | Path to yt-dlp binary (auto-detected usually) |
| `FFMPEG_PATH` | Path to ffmpeg binary (auto-detected usually) |
# clipsave2
# clipsave2
# random1
# random1
# random1
# random1
