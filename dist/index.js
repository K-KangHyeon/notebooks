import axios from "axios";
import * as cheerio from "cheerio";
import he from "he";
import { writeFileSync } from "node:fs";
function normalizeTitle(raw) {
    const decoded = he.decode(raw);
    return decoded.replace(/\s+/g, " ").trim().toLowerCase();
}
function parsePrice(text) {
    const digits = (text || "").replace(/[^0-9]/g, "");
    if (!digits)
        return null;
    return Number(digits);
}
async function fetchKreamTrending() {
    // NOTE: KREAM may block automated requests or require JS; this may return an error page
    const url = "https://kream.co.kr/search?tab=50";
    const res = await axios.get(url, {
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
            Referer: "https://kream.co.kr/",
        },
        timeout: 20000,
        validateStatus: () => true,
    });
    const html = res.data;
    const $ = cheerio.load(html);
    const items = [];
    // Heuristic selectors: may not work if content is client-rendered
    $("a[href*='/products/']").each((_, el) => {
        const anchor = $(el);
        const href = anchor.attr("href");
        const urlAbs = href?.startsWith("http") ? href : `https://kream.co.kr${href}`;
        const title = normalizeTitle(anchor.text());
        const nearbyText = anchor.parent().text();
        const price = parsePrice(nearbyText);
        if (title && price && href) {
            items.push({ source: "kream", title, price, url: urlAbs });
        }
    });
    return items;
}
async function searchMustit(keyword) {
    const searchUrl = `https://m.web.mustit.co.kr/search?kw=${encodeURIComponent(keyword)}`;
    const res = await axios.get(searchUrl, {
        headers: {
            "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
            Referer: "https://m.web.mustit.co.kr/",
        },
        timeout: 20000,
        validateStatus: () => true,
    });
    const html = res.data;
    const $ = cheerio.load(html);
    const items = [];
    $("a[href*='/m/product/']").each((_, el) => {
        const anchor = $(el);
        const href = anchor.attr("href");
        const urlAbs = href?.startsWith("http") ? href : `https://m.web.mustit.co.kr${href}`;
        const title = normalizeTitle(anchor.text());
        const price = parsePrice(anchor.parent().text());
        if (title && price && href) {
            items.push({ source: "mustit", title, price, url: urlAbs });
        }
    });
    return items;
}
function titleSimilarity(a, b) {
    if (a === b)
        return 1;
    const setA = new Set(a.split(" "));
    const setB = new Set(b.split(" "));
    let inter = 0;
    for (const tok of setA)
        if (setB.has(tok))
            inter++;
    const union = new Set([...setA, ...setB]).size;
    return union ? inter / union : 0;
}
function toCsvValue(value) {
    const s = value === undefined || value === null ? "" : String(value);
    const escaped = s.replace(/"/g, '""');
    return `"${escaped}"`;
}
async function main() {
    const kreamItems = await fetchKreamTrending();
    console.log(`KREAM items scraped: ${kreamItems.length}`);
    // Build mapping by title for fuzzy matching
    const results = [];
    for (const ki of kreamItems.slice(0, 20)) {
        const mustitCandidates = await searchMustit(ki.title);
        let best = null;
        let bestSim = 0;
        for (const mi of mustitCandidates) {
            const sim = titleSimilarity(ki.title, mi.title);
            if (sim > bestSim) {
                best = mi;
                bestSim = sim;
            }
        }
        const row = {
            titleKream: ki.title,
            priceKream: ki.price,
            kreamUrl: ki.url,
            // only include optional fields when present
            ...(best && { titleMustit: best.title, priceMustit: best.price, mustitUrl: best.url, diff: best.price - ki.price, similarity: bestSim }),
        };
        results.push(row);
    }
    const headers = [
        { id: "titleKream", title: "kream_title" },
        { id: "priceKream", title: "kream_price" },
        { id: "kreamUrl", title: "kream_url" },
        { id: "titleMustit", title: "mustit_title" },
        { id: "priceMustit", title: "mustit_price" },
        { id: "mustitUrl", title: "mustit_url" },
        { id: "diff", title: "price_diff_mustit_minus_kream" },
        { id: "similarity", title: "title_similarity" },
    ];
    const headerRow = headers.map((h) => toCsvValue(h.title)).join(",");
    const lines = [headerRow];
    for (const r of results) {
        const rowValues = headers.map((h) => toCsvValue(r[h.id]));
        lines.push(rowValues.join(","));
    }
    writeFileSync("price_comparison.csv", lines.join("\n"), { encoding: "utf8" });
    console.log("Wrote price_comparison.csv");
}
main().catch((err) => {
    console.error("Error:", err?.response?.status || err);
    process.exit(1);
});
