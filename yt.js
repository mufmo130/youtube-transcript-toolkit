// YouTube access layer: InnerTube player (mobile clients, no PO token needed), caption fetching,
// playlist / channel expansion. All requests go through `http` (a fetch-like function that may use a proxy).

const KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
const WEB_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

// Client versions follow yt-dlp / YouTube.js (2026). Mobile + visionOS players return caption URLs without a PO token.
export const CLIENTS = {
    ANDROID: { id: 3, client: { clientName: 'ANDROID', clientVersion: '21.26.364', androidSdkVersion: 30, hl: 'en', gl: 'US' }, ua: 'com.google.android.youtube/21.26.364 (Linux; U; Android 11) gzip' },
    IOS: { id: 5, client: { clientName: 'IOS', clientVersion: '21.26.4', deviceMake: 'Apple', deviceModel: 'iPhone16,2', hl: 'en', gl: 'US' }, ua: 'com.google.ios.youtube/21.26.4 (iPhone16,2; U; CPU iOS 18_5 like Mac OS X;)' },
    VISIONOS: { id: 101, client: { clientName: 'VISIONOS', clientVersion: '1.02', deviceMake: 'Apple', deviceModel: 'RealityDevice17,1', hl: 'en', gl: 'US' }, ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15' },
    ANDROID_VR: { id: 28, client: { clientName: 'ANDROID_VR', clientVersion: '1.65.10', androidSdkVersion: 32, hl: 'en', gl: 'US' }, ua: 'com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip' },
};
const CLIENT_ORDER = ['ANDROID', 'IOS', 'VISIONOS', 'ANDROID_VR'];

export class YtError extends Error {
    constructor(message, { code, retryable = false, status } = {}) { super(message); this.code = code; this.retryable = retryable; this.status = status; }
}

/* ---------------- URL parsing ---------------- */
export function parseRef(raw) {
    const s = String(raw || '').trim();
    if (!s) return null;
    if (/^[\w-]{11}$/.test(s)) return { type: 'video', id: s };
    if (/^(PL|UU|LL|OL|RD|FL)[\w-]{10,}$/.test(s)) return { type: 'playlist', id: s };
    if (/^UC[\w-]{22}$/.test(s)) return { type: 'channel', id: s };
    if (/^@[\w.-]+$/.test(s)) return { type: 'channel', handle: s };
    let u;
    try { u = new URL(s.includes('://') ? s : `https://${s}`); } catch { return null; }
    const host = u.hostname.replace(/^(www|m|music)\./, '');
    if (host === 'youtu.be') { const id = u.pathname.slice(1).split('/')[0]; return /^[\w-]{11}$/.test(id) ? { type: 'video', id } : null; }
    if (!/(^|\.)youtube(-nocookie)?\.com$/.test(host)) return null;
    const list = u.searchParams.get('list');
    const v = u.searchParams.get('v');
    if (u.pathname === '/watch' && v && /^[\w-]{11}$/.test(v)) return { type: 'video', id: v };
    if (u.pathname === '/playlist' && list) return { type: 'playlist', id: list };
    const m = u.pathname.match(/^\/(shorts|embed|live|v)\/([\w-]{11})/);
    if (m) return { type: 'video', id: m[2] };
    const ch = u.pathname.match(/^\/(channel\/(UC[\w-]{22})|(@[\w.-]+)|c\/([^/]+)|user\/([^/]+))/);
    if (ch) return ch[2] ? { type: 'channel', id: ch[2] } : { type: 'channel', handle: ch[3] || ch[4] || ch[5], path: u.pathname.split('/').slice(0, 2).join('/') };
    return null;
}

/* ---------------- InnerTube player ---------------- */
async function innertube(http, endpoint, body, ua, extraHeaders = {}) {
    const res = await http(`https://www.youtube.com/youtubei/v1/${endpoint}?key=${KEY}&prettyPrint=false`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': ua, 'accept-language': 'en-US,en;q=0.9', connection: 'close', ...extraHeaders },
        body: JSON.stringify(body),
    });
    const text = await res.text();
    if (res.status === 429 || res.status === 403) throw new YtError(`YouTube rate limit (HTTP ${res.status})`, { code: 'RATE_LIMIT', retryable: true, status: res.status });
    if (!res.ok) throw new YtError(`YouTube HTTP ${res.status}: ${text.slice(0, 200)}`, { code: 'HTTP', retryable: res.status >= 500, status: res.status });
    try { return JSON.parse(text); } catch { throw new YtError('YouTube returned non-JSON', { code: 'BAD_JSON', retryable: true }); }
}

/** Player response with metadata + caption tracks. Tries mobile clients in order. */
export async function playerInfo(http, videoId, { clients = CLIENT_ORDER } = {}) {
    let last;
    for (const name of clients) {
        const c = CLIENTS[name];
        try {
            const json = await innertube(http, 'player', { context: { client: c.client }, videoId, contentCheckOk: true, racyCheckOk: true }, c.ua, { 'x-youtube-client-name': String(c.id), 'x-youtube-client-version': c.client.clientVersion });
            const ps = json.playabilityStatus || {};
            const reason = ps.reason || ps.messages?.join(' ') || '';
            if (ps.status === 'LOGIN_REQUIRED' && /bot|sign in/i.test(reason)) throw new YtError(`Bot check on this IP (${name})`, { code: 'BOT_CHECK', retryable: true });
            if (ps.status === 'LOGIN_REQUIRED') throw new YtError(`Sign-in required (private or age-restricted video): ${reason}`, { code: 'LOGIN_REQUIRED' });
            if (ps.status === 'ERROR') throw new YtError(reason || 'Video unavailable', { code: 'UNAVAILABLE' });
            if (ps.status === 'UNPLAYABLE' && /not available|unavailable/i.test(reason)) throw new YtError(reason, { code: 'UNAVAILABLE', retryable: true });
            const vd = json.videoDetails || {};
            const tl = json.captions?.playerCaptionsTracklistRenderer || {};
            return {
                client: name,
                ua: c.ua,
                status: ps.status,
                video: {
                    id: vd.videoId || videoId,
                    title: vd.title || '',
                    channel: vd.author || '',
                    channelId: vd.channelId || '',
                    durationSeconds: Number(vd.lengthSeconds) || 0,
                    viewCount: Number(vd.viewCount) || null,
                    description: vd.shortDescription || '',
                    keywords: vd.keywords || [],
                    isLive: !!vd.isLiveContent,
                    thumbnail: (vd.thumbnail?.thumbnails || []).slice(-1)[0]?.url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
                },
                tracks: (tl.captionTracks || []).map((t) => ({
                    languageCode: t.languageCode, name: t.name?.simpleText || t.name?.runs?.map((r) => r.text).join('') || t.languageCode,
                    kind: t.kind === 'asr' ? 'auto' : 'manual', baseUrl: t.baseUrl, isTranslatable: !!t.isTranslatable,
                    // exp=xpe / xpv marks YouTube's PO-token experiment: the track body is empty without a BotGuard token.
                    needsPoToken: /[?&]exp=(xpe|xpv)/.test(t.baseUrl || ''),
                })),
                translationLanguages: (tl.translationLanguages || []).map((l) => l.languageCode),
            };
        } catch (e) {
            last = e;
            if (e.code === 'LOGIN_REQUIRED' || e.code === 'UNAVAILABLE' && !e.retryable) throw e;
            // BOT_CHECK / RATE_LIMIT / transient → try next client
        }
    }
    throw last || new YtError('All clients failed', { code: 'ALL_CLIENTS', retryable: true });
}

/** Pick the best track for the wanted languages. Returns { track, translateTo } or null. */
export function chooseTrack(tracks, translationLanguages, { languages = [], preferManual = true, allowTranslate = true, allowAuto = true } = {}) {
    const usable = tracks.filter((t) => allowAuto || t.kind === 'manual');
    if (!usable.length) return null;
    const rank = (t) => (preferManual ? (t.kind === 'manual' ? 0 : 1) : (t.kind === 'auto' ? 0 : 1));
    const norm = (c) => String(c || '').toLowerCase();
    for (const want of languages.map(norm)) {
        const exact = usable.filter((t) => norm(t.languageCode) === want || norm(t.languageCode).split('-')[0] === want.split('-')[0]).sort((a, b) => rank(a) - rank(b));
        if (exact[0]) return { track: exact[0], translateTo: null };
    }
    const best = [...usable].sort((a, b) => rank(a) - rank(b))[0];
    if (languages.length && allowTranslate) {
        const src = usable.find((t) => t.isTranslatable) || best;
        const tl = translationLanguages.map(norm);
        for (const want of languages.map(norm)) {
            const hit = tl.find((c) => c === want) || tl.find((c) => c.split('-')[0] === want.split('-')[0]);
            if (hit && src) return { track: src, translateTo: translationLanguages[tl.indexOf(hit)] };
        }
    }
    return languages.length ? { track: best, translateTo: null, fallback: true } : { track: best, translateTo: null };
}

function decodeEntities(str) {
    return String(str || '').replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|nbsp);/gi, (m, e) => {
        const l = e.toLowerCase();
        if (l[0] === '#') return String.fromCodePoint(l[1] === 'x' ? parseInt(l.slice(2), 16) : parseInt(l.slice(1), 10));
        return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[l] || m;
    });
}

/** Parse either json3 or the XML timedtext formats (srv1/srv3) into [{ start, duration, text }]. */
export function parseCaptions(text) {
    const trimmed = text.trim();
    const segs = [];
    if (trimmed.startsWith('{')) {
        const json = JSON.parse(trimmed);
        for (const ev of json.events || []) {
            if (!ev.segs) continue;
            const t = ev.segs.map((s) => s.utf8 || '').join('').replace(/\s+/g, ' ').trim();
            if (!t) continue;
            segs.push({ start: (ev.tStartMs || 0) / 1000, duration: (ev.dDurationMs || 0) / 1000, text: t });
        }
        return segs;
    }
    if (trimmed.startsWith('<')) {
        // srv3: <p t="ms" d="ms">text or <s>..</s></p>; srv1: <text start="s" dur="s">text</text>
        for (const m of trimmed.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/g)) {
            const t = Number(/\bt="(\d+)"/.exec(m[1])?.[1] || 0), d = Number(/\bd="(\d+)"/.exec(m[1])?.[1] || 0);
            const txt = decodeEntities(m[2].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
            if (txt) segs.push({ start: t / 1000, duration: d / 1000, text: txt });
        }
        if (!segs.length) for (const m of trimmed.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)) {
            const st = Number(/\bstart="([\d.]+)"/.exec(m[1])?.[1] || 0), d = Number(/\bdur="([\d.]+)"/.exec(m[1])?.[1] || 0);
            const txt = decodeEntities(m[2].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
            if (txt) segs.push({ start: st, duration: d, text: txt });
        }
        return segs;
    }
    throw new YtError(`Unrecognised caption format: ${trimmed.slice(0, 80)}`, { code: 'BAD_FORMAT', retryable: true });
}

/** Download a caption track as segments [{ start, duration, text }]. */
export async function fetchTrack(http, track, { translateTo, ua = CLIENTS.ANDROID.ua } = {}) {
    const u = new URL(track.baseUrl);
    u.searchParams.set('fmt', 'json3');
    if (translateTo) u.searchParams.set('tlang', translateTo);
    const res = await http(u.toString(), { headers: { 'user-agent': ua, connection: 'close' } });
    const text = await res.text();
    if (res.status === 429) throw new YtError(translateTo ? `Translation rate limit (429) for ${translateTo}` : 'Caption rate limit (429)', { code: translateTo ? 'TRANSLATE_RATE_LIMIT' : 'RATE_LIMIT', retryable: true, status: 429 });
    if (!res.ok) throw new YtError(`Caption HTTP ${res.status}`, { code: 'HTTP', retryable: res.status >= 500, status: res.status });
    if (!text) {
        if (track.needsPoToken) throw new YtError('YouTube requires a PO token for this caption track (empty body)', { code: 'POT_REQUIRED', retryable: false });
        throw new YtError('Empty caption response (IP flagged)', { code: 'EMPTY', retryable: true });
    }
    return parseCaptions(text);
}

/* ---------------- playlist / channel expansion (WEB browse) ---------------- */
const WEB_CTX = { client: { clientName: 'WEB', clientVersion: '2.20250312.04.00', hl: 'en', gl: 'US' } };

function* walk(obj) {
    if (!obj || typeof obj !== 'object') return;
    yield obj;
    for (const v of Object.values(obj)) if (v && typeof v === 'object') yield* walk(v);
}

async function browse(http, body) {
    return innertube(http, 'browse', { context: WEB_CTX, ...body }, WEB_UA, { origin: 'https://www.youtube.com', referer: 'https://www.youtube.com/' });
}

function collectVideos(json, out, seen) {
    let token = null;
    for (const node of walk(json)) {
        const r = node.playlistVideoRenderer || node.richItemRenderer?.content?.videoRenderer || node.gridVideoRenderer || node.reelItemRenderer;
        if (r?.videoId && !seen.has(r.videoId)) {
            seen.add(r.videoId);
            out.push({ id: r.videoId, title: r.title?.runs?.map((x) => x.text).join('') || r.title?.simpleText || r.headline?.simpleText || '' });
        }
        const l = node.lockupViewModel;
        if (l?.contentId && /^[\w-]{11}$/.test(l.contentId) && (l.contentType || '').includes('VIDEO') && !seen.has(l.contentId)) {
            seen.add(l.contentId);
            out.push({ id: l.contentId, title: l.metadata?.lockupMetadataViewModel?.title?.content || '' });
        }
        if (node.continuationCommand?.token && !token) token = node.continuationCommand.token;
    }
    return token;
}

export async function playlistVideos(http, playlistId, max = 500, first = null) {
    const out = []; const seen = new Set();
    let json = await browse(http, first || { browseId: `VL${playlistId}` });
    let token = collectVideos(json, out, seen);
    let guard = 0;
    while (token && out.length < max && guard++ < 60) {
        json = await browse(http, { continuation: token });
        const before = out.length;
        token = collectVideos(json, out, seen);
        if (out.length === before) break;
    }
    return out.slice(0, max);
}

export async function resolveChannelId(http, ref) {
    if (ref.id) return ref.id;
    const handle = String(ref.handle || '').replace(/^@/, '');
    const paths = [...new Set([ref.path, `/@${handle}`, `/c/${handle}`, `/user/${handle}`].filter(Boolean))];
    for (const path of paths) {
        const res = await http(`https://www.youtube.com${path}`, { headers: { 'user-agent': WEB_UA, 'accept-language': 'en' } });
        if (!res.ok) continue;
        const html = await res.text();
        const m = html.match(/"externalId":"(UC[\w-]{22})"/) || html.match(/<meta itemprop="identifier" content="(UC[\w-]{22})"/) || html.match(/channel\/(UC[\w-]{22})/) || html.match(/"channelId":"(UC[\w-]{22})"/);
        if (m) return m[1];
    }
    throw new YtError(`Could not resolve channel ${ref.handle || ref.path}`, { code: 'CHANNEL' });
}

export async function channelVideos(http, ref, max = 500) {
    const id = await resolveChannelId(http, ref);
    // Channel "Videos" tab (newest first); continuation pages follow the same parser as playlists.
    return playlistVideos(http, id, max, { browseId: id, params: 'EgZ2aWRlb3PyBgQKAjoA' });
}
