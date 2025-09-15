export function chunkText(s: string, target = 1600): string[] {
    const parts: string[] = [];
    let buf = '';
    for (const line of s.split(/\n+/)) {
        const candidate = buf ? buf + '\n' + line : line;
        if (candidate.length > target) {
            if (buf.trim()) parts.push(buf.trim());
            buf = line;
            if (buf.length > target) {
                // hard split long line
                for (let i = 0; i < buf.length; i += target) {
                    parts.push(buf.slice(i, i + target).trim());
                }
                buf = '';
            }
        } else {
            buf = candidate;
        }
    }
    if (buf.trim()) parts.push(buf.trim());
    return parts.filter(Boolean);
}

export function cosine(a: number[], b: number[]) {
    let dot = 0,
        na = 0,
        nb = 0;
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
        const ai = a[i];
        const bi = b[i];
        dot += ai * bi;
        na += ai * ai;
        nb += bi * bi;
    }
    return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-8);
}

export function mmr(queryVec: number[], docVecs: number[][], k = 12, lambda = 0.7): number[] {
    const selected: number[] = [];
    const candidates = new Set(docVecs.map((_, i) => i));
    while (selected.length < k && candidates.size) {
        let bestIdx = -1,
            bestScore = -Infinity;
        for (const i of candidates) {
            const rel = cosine(queryVec, docVecs[i]);
            let div = 0;
            for (const j of selected) div = Math.max(div, cosine(docVecs[i], docVecs[j]));
            const score = lambda * rel - (1 - lambda) * div;
            if (score > bestScore) {
                bestScore = score;
                bestIdx = i;
            }
        }
        selected.push(bestIdx);
        candidates.delete(bestIdx);
    }
    return selected;
}
