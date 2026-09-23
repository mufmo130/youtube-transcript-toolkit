# youtube-transcript-toolkit

Get the transcript of any YouTube video from Node.js or the command line: plain text, timestamps, paragraphs, **SRT**, **VTT** or JSON. No API key, no browser, no dependencies.

```bash
npx youtube-transcript-toolkit https://youtu.be/jNQXAC9IVRw --format srt
```

```
1
00:00:01,000 --> 00:00:04,000
All right, so here we are, in front of the elephants
...
```
*(timings illustrative)*

## Features

- Works with `watch?v=`, `youtu.be/`, `/shorts/`, `/live/` URLs or a bare video ID
- Picks human-made captions first, falls back to auto-generated
- `--lang ko` uses YouTube's own translation when your language is missing
- Formats: `text`, `timestamped`, `paragraphs` (great for LLMs), `srt`, `vtt`, `json`
- Uses the same mobile InnerTube clients as yt-dlp (no PO token needed for caption lists)
- Zero dependencies, Node 18+

## Install

```bash
npm install youtube-transcript-toolkit
```

## CLI

```bash
youtube-transcript <url|id> [--lang en,ko] [--format text|timestamped|paragraphs|srt|vtt|json]
```

## Library

```js
import { parseRef, playerInfo, chooseTrack, fetchTrack } from 'youtube-transcript-toolkit';
import { normalize, srt, paragraphs } from 'youtube-transcript-toolkit/format';

const http = (url, opts) => fetch(url, opts);
const { id } = parseRef('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
const info = await playerInfo(http, id);
const choice = chooseTrack(info.tracks, info.translationLanguages, { languages: ['en'] });
const segments = normalize(await fetchTrack(http, choice.track, { translateTo: choice.translateTo, ua: info.ua }));

console.log(info.video.title, segments.length);
console.log(srt(segments));
```

Pass your own `http` function to route requests through a proxy (for example with `undici`'s `ProxyAgent`).

## ⚠️ "Sign in to confirm you're not a bot" / HTTP 429

YouTube blocks most **cloud and datacenter IPs** (AWS, GCP, Azure, Vercel, Render…) and rate-limits IPs that make many requests, especially for translated captions. This library runs fine from a home connection, but in production you will need rotating residential proxies, retries across clients and IPs, and pacing for translations.

If you don't want to build and maintain that yourself, there is a hosted version:

### 👉 [YouTube Transcript Extractor on Apify](https://apify.com/lsso/youtube-transcript-extractor)

- Residential proxies and multi-client retries included
- **Playlists and whole channels** in one run
- Translation with automatic fallback, 6 output formats, video metadata
- REST API, Python / JS clients, n8n, Make, Zapier, MCP (Claude, ChatGPT)
- **$5 per 1,000 transcripts**, videos without captions are free

```bash
curl -X POST "https://api.apify.com/v2/acts/lsso~youtube-transcript-extractor/run-sync-get-dataset-items?token=YOUR_APIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"videoUrls":["https://www.youtube.com/@veritasium"],"maxVideos":20,"outputFormats":["text","srt"]}'
```

## How it works

1. `POST /youtubei/v1/player` with an Android / iOS / visionOS client context returns the caption track list (these clients don't require a PO token).
2. The chosen track's `baseUrl` is fetched with `fmt=json3` (optionally `tlang=` for translation); XML formats are parsed as a fallback.
3. Overlapping auto-caption cues are normalised, then rendered to the format you asked for.

Tracks marked with YouTube's `exp=xpe` experiment return an empty body without a BotGuard PO token; the library reports these as `POT_REQUIRED` instead of silently returning nothing.

## Related tools by the same author

- [App Review Insights](https://apify.com/lsso/app-review-insights): App Store + Google Play reviews → why users give 1★, version regressions, feature requests
- [AI Search Visibility Tracker](https://apify.com/lsso/ai-search-visibility-tracker): how often ChatGPT, Perplexity, Gemini and Claude recommend your brand

## License

MIT. Respect YouTube's Terms of Service and the copyright of the content you process.
