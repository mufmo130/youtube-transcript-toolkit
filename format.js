// Transcript formatting: plain text, timestamped text, SRT, WebVTT, paragraphs.

function pad(n, w = 2) { return String(n).padStart(w, '0'); }
export function ts(sec, { ms = ',', hours = true } = {}) {
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60), f = Math.round((sec - Math.floor(sec)) * 1000);
    const base = `${pad(m)}:${pad(s)}`;
    return `${hours || h ? `${pad(h)}:` : ''}${base}${ms ? `${ms}${pad(f, 3)}` : ''}`;
}

/** Auto-captions overlap (each cue includes the previous one) — clamp durations to the next start. */
export function normalize(segs) {
    const out = segs.map((s) => ({ ...s }));
    for (let i = 0; i < out.length - 1; i++) {
        const gap = out[i + 1].start - out[i].start;
        if (gap > 0 && (out[i].duration <= 0 || out[i].duration > gap)) out[i].duration = gap;
    }
    return out;
}

export function plainText(segs) { return segs.map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim(); }

export function timestampedText(segs) { return segs.map((s) => `[${ts(s.start, { ms: '', hours: false })}] ${s.text}`).join('\n'); }

export function srt(segs) {
    return segs.map((s, i) => `${i + 1}\n${ts(s.start)} --> ${ts(s.start + Math.max(s.duration, 0.5))}\n${s.text}\n`).join('\n');
}

export function vtt(segs) {
    return `WEBVTT\n\n${segs.map((s) => `${ts(s.start, { ms: '.' })} --> ${ts(s.start + Math.max(s.duration, 0.5), { ms: '.' })}\n${s.text}\n`).join('\n')}`;
}

/** Group cues into readable paragraphs (~ every N seconds or at sentence ends after a minimum length). */
export function paragraphs(segs, { targetSeconds = 60, minChars = 300 } = {}) {
    const out = [];
    let cur = null;
    for (const s of segs) {
        if (!cur) cur = { start: s.start, text: s.text };
        else cur.text += ` ${s.text}`;
        const long = s.start - cur.start >= targetSeconds;
        const sentenceEnd = /[.!?。！？]$/.test(s.text);
        if ((long && (sentenceEnd || cur.text.length > minChars * 2)) || cur.text.length > minChars * 4) {
            out.push({ start: cur.start, end: s.start + s.duration, text: cur.text.replace(/\s+/g, ' ').trim() });
            cur = null;
        }
    }
    if (cur) out.push({ start: cur.start, end: segs.at(-1).start + segs.at(-1).duration, text: cur.text.replace(/\s+/g, ' ').trim() });
    return out;
}

export function wordCount(text) {
    const cjk = (text.match(/[぀-ヿ㐀-鿿가-힯]/g) || []).length;
    const words = (text.replace(/[぀-ヿ㐀-鿿가-힯]/g, ' ').match(/\S+/g) || []).length;
    return words + cjk;
}
