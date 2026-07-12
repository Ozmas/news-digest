const express = require('express');
const fetch = require('node-fetch');
const xml2js = require('xml2js');
const path = require('path');

const app = express();
const PORT = 3000;

// ===== Site Configurations =====
const SITES = [
  {
    id: 'hachima',
    name: 'はちま起稿',
    shortName: 'はちま',
    rss: 'https://blog.esuteru.com/index.rdf',
    color: '#f472b6',
    gradient: 'linear-gradient(135deg, #f472b6, #fb923c)',
    bgAlpha: 'rgba(244, 114, 182, 0.12)',
  },
  {
    id: 'jin',
    name: '俺的ゲーム速報＠刃',
    shortName: '俺的',
    rss: 'https://jin115.com/feed/',
    color: '#60a5fa',
    gradient: 'linear-gradient(135deg, #60a5fa, #a78bfa)',
    bgAlpha: 'rgba(96, 165, 250, 0.12)',
  },
  {
    id: 'yaraon',
    name: 'やらおん！',
    shortName: 'やらおん',
    rss: 'https://yaruo.com/feed',
    color: '#34d399',
    gradient: 'linear-gradient(135deg, #34d399, #60a5fa)',
    bgAlpha: 'rgba(52, 211, 153, 0.12)',
  },
  {
    id: 'gamespark',
    name: 'GameSpark',
    shortName: 'ゲームスパーク',
    rss: 'https://www.gamespark.jp/rss20/index.rdf',
    color: '#fb923c',
    gradient: 'linear-gradient(135deg, #fb923c, #fbbf24)',
    bgAlpha: 'rgba(251, 146, 60, 0.12)',
  },
  {
    id: 'automaton',
    name: 'AUTOMATON',
    shortName: 'AUTOMATON',
    rss: 'https://automaton-media.com/feed/',
    color: '#a78bfa',
    gradient: 'linear-gradient(135deg, #a78bfa, #f472b6)',
    bgAlpha: 'rgba(167, 139, 250, 0.12)',
  },
];

// ===== Utility: Strip HTML tags =====
function stripHtml(html) {
  return String(html || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

// ===== Utility: Parse RSS XML =====
async function parseRSS(xmlText, site) {
  try {
    const parsed = await xml2js.parseStringPromise(xmlText, {
      explicitArray: false,
      ignoreAttrs: false,
    });

    let items = [];

    // RSS 2.0
    if (parsed.rss && parsed.rss.channel) {
      const channel = parsed.rss.channel;
      items = Array.isArray(channel.item) ? channel.item : [channel.item].filter(Boolean);
    }
    // RSS 1.0 (RDF)
    else if (parsed['rdf:RDF']) {
      const rdf = parsed['rdf:RDF'];
      items = Array.isArray(rdf.item) ? rdf.item : [rdf.item].filter(Boolean);
    }
    // Atom
    else if (parsed.feed && parsed.feed.entry) {
      items = Array.isArray(parsed.feed.entry) ? parsed.feed.entry : [parsed.feed.entry];
    }

    return items.slice(0, 20).map(item => {
      // Title
      const title = typeof item.title === 'object'
        ? (item.title._ || item.title['#text'] || '')
        : (item.title || '');

      // Link
      let link = '';
      if (item.link) {
        if (typeof item.link === 'string') link = item.link;
        else if (item.link.$ && item.link.$.href) link = item.link.$.href;
        else if (typeof item.link === 'object') link = item.link._ || '';
      }
      if (!link && item.guid) {
        link = typeof item.guid === 'object' ? item.guid._ || '' : item.guid;
      }

      // Description / Summary
      const desc =
        item.description || item.summary || item['content:encoded'] || item.content || '';
      const descText = typeof desc === 'object' ? (desc._ || '') : String(desc);

      // Date
      const pubDate =
        item.pubDate || item.published || item.updated || item['dc:date'] || '';
      const pubDateStr = typeof pubDate === 'object' ? (pubDate._ || '') : String(pubDate);

      return {
        siteId: site.id,
        siteName: site.name,
        siteShortName: site.shortName,
        siteColor: site.color,
        siteGradient: site.gradient,
        siteBgAlpha: site.bgAlpha,
        title: stripHtml(title).trim() || '(タイトルなし)',
        description: stripHtml(descText).slice(0, 200),
        link: link.trim(),
        pubDate: pubDateStr.trim(),
      };
    });
  } catch (err) {
    console.error(`[${site.id}] XML parse error:`, err.message);
    return [];
  }
}

// ===== Fetch a single site's RSS =====
async function fetchSiteRSS(site) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (compatible; NewsDigest/1.0)',
    'Accept': 'application/rss+xml, application/xml, text/xml, */*',
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    const res = await fetch(site.rss, { headers, signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    return await parseRSS(text, site);
  } catch (err) {
    console.warn(`[${site.id}] fetch failed: ${err.message}`);
    return [];
  }
}

// ===== Cache =====
let cache = { articles: [], updatedAt: null };
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function refreshCache() {
  console.log('[Cache] Refreshing all sites...');
  const results = await Promise.allSettled(SITES.map(site => fetchSiteRSS(site)));
  const articles = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);

  // Sort by date
  articles.sort((a, b) => {
    const da = new Date(a.pubDate);
    const db = new Date(b.pubDate);
    if (isNaN(da.getTime())) return 1;
    if (isNaN(db.getTime())) return -1;
    return db - da;
  });

  cache = { articles, updatedAt: new Date() };
  console.log(`[Cache] ${articles.length} articles cached from ${new Set(articles.map(a => a.siteId)).size} sites.`);
  return cache;
}

// ===== Routes =====

// Serve static files
app.use(express.static(__dirname));

// API: Get all articles
app.get('/api/articles', async (req, res) => {
  try {
    const now = Date.now();
    const isStale = !cache.updatedAt || (now - cache.updatedAt.getTime()) > CACHE_TTL;

    if (isStale || cache.articles.length === 0) {
      await refreshCache();
    }

    res.json({
      ok: true,
      articles: cache.articles,
      updatedAt: cache.updatedAt,
      sites: SITES.map(s => ({
        id: s.id,
        name: s.name,
        shortName: s.shortName,
        color: s.color,
        gradient: s.gradient,
        bgAlpha: s.bgAlpha,
      })),
    });
  } catch (err) {
    console.error('[API] Error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// API: Force refresh
app.post('/api/refresh', async (req, res) => {
  try {
    await refreshCache();
    res.json({ ok: true, count: cache.articles.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ===== Start =====
app.listen(PORT, () => {
  console.log(`\n🌿 Detox Digest サーバー起動`);
  console.log(`   → http://localhost:${PORT}\n`);
  // Pre-warm cache
  refreshCache().catch(console.error);
});
