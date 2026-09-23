#!/usr/bin/env node
// youtube-transcript-toolkit CLI
// Usage: npx youtube-transcript-toolkit <url|id> [--lang en] [--format text|srt|vtt|json|timestamped|paragraphs]
import { parseRef, playerInfo, chooseTrack, fetchTrack } from './yt.js';
import { normalize, plainText, timestampedText, srt, vtt, paragraphs } from './format.js';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const input = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1]?.startsWith('--') !== true);
if (!input) {
    console.error('Usage: youtube-transcript <url|videoId> [--lang en] [--format text|srt|vtt|json|timestamped|paragraphs]');
    process.exit(1);
}
const ref = parseRef(input);
if (!ref || ref.type !== 'video') { console.error('Please pass a single YouTube video URL or ID (playlists/channels: see README).'); process.exit(1); }

const http = (url, o) => fetch(url, o);
try {
    const info = await playerInfo(http, ref.id);
    const langs = (opt('lang', '') || '').split(',').filter(Boolean);
    const choice = chooseTrack(info.tracks, info.translationLanguages, { languages: langs });
    if (!choice) throw new Error('No captions available for this video.');
    const segs = normalize(await fetchTrack(http, choice.track, { translateTo: choice.translateTo, ua: info.ua }));
    const fmt = opt('format', 'text');
    const out = { text: () => plainText(segs), srt: () => srt(segs), vtt: () => vtt(segs), timestamped: () => timestampedText(segs),
        paragraphs: () => paragraphs(segs).map((p) => p.text).join('\n\n'), json: () => JSON.stringify({ video: info.video, language: choice.translateTo || choice.track.languageCode, segments: segs }, null, 2) }[fmt];
    if (!out) throw new Error(`Unknown format ${fmt}`);
    process.stdout.write(out() + '\n');
} catch (e) {
    console.error(`Error: ${e.message}`);
    if (e.code === 'BOT_CHECK' || e.code === 'RATE_LIMIT') {
        console.error('\nYouTube is blocking this IP (common on cloud servers / after many requests).');
        console.error('For reliable, large-scale use (residential proxies, retries, playlists & channels), use the hosted version:');
        console.error('  https://apify.com/lsso/youtube-transcript-extractor');
    }
    process.exit(2);
}
