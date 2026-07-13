import urllib.request
import xml.etree.ElementTree as ET
import json
import re
from datetime import datetime
import os
import sys

# ===== サイト設定 =====
SITES = [
    {
        "id": "hachima",
        "name": "はちま起稿",
        "shortName": "はちま",
        "rss": "http://blog.esuteru.com/index.rdf",
        "color": "#f472b6",
        "gradient": "linear-gradient(135deg, #f472b6, #fb923c)",
        "bgAlpha": "rgba(244, 114, 182, 0.12)",
    },
    {
        "id": "jin",
        "name": "俺的ゲーム速報＠刃",
        "shortName": "俺的",
        "rss": "http://jin115.com/index.rdf",
        "color": "#60a5fa",
        "gradient": "linear-gradient(135deg, #60a5fa, #a78bfa)",
        "bgAlpha": "rgba(96, 165, 250, 0.12)",
    },
    {
        "id": "getnews",
        "name": "ガジェット通信",
        "shortName": "ガジェ通",
        "rss": "https://getnews.jp/rss",
        "color": "#34d399",
        "gradient": "linear-gradient(135deg, #34d399, #60a5fa)",
        "bgAlpha": "rgba(52, 211, 153, 0.12)",
    },
    {
        "id": "byokan",
        "name": "秒刊SUNDAY",
        "shortName": "秒刊",
        "rss": "https://yukawanet.com/feed/",
        "color": "#fb923c",
        "gradient": "linear-gradient(135deg, #fb923c, #fbbf24)",
        "bgAlpha": "rgba(251, 146, 60, 0.12)",
    },
    {
        "id": "buzzfeed",
        "name": "BuzzFeed Japan",
        "shortName": "BuzzFeed",
        "rss": "https://buzzfeed.com/jp.xml",
        "color": "#a78bfa",
        "gradient": "linear-gradient(135deg, #a78bfa, #f472b6)",
        "bgAlpha": "rgba(167, 139, 250, 0.12)",
    },
    {
        "id": "netlab",
        "name": "ねとらぼ",
        "shortName": "ねとらぼ",
        "rss": "https://rss.itmedia.co.jp/rss/2.0/netlab.xml",
        "color": "#38bdf8",
        "gradient": "linear-gradient(135deg, #38bdf8, #34d399)",
        "bgAlpha": "rgba(56, 189, 248, 0.12)",
    },
    {
        "id": "gigazine",
        "name": "GIGAZINE",
        "shortName": "GIGAZINE",
        "rss": "https://gigazine.net/news/rss_2.0/",
        "color": "#facc15",
        "gradient": "linear-gradient(135deg, #facc15, #fb923c)",
        "bgAlpha": "rgba(250, 204, 21, 0.12)",
    },
    {
        "id": "togetter",
        "name": "Togetter",
        "shortName": "Togetter",
        "rss": "https://togetter.com/rss/recent",
        "color": "#4ade80",
        "gradient": "linear-gradient(135deg, #4ade80, #22d3ee)",
        "bgAlpha": "rgba(74, 222, 128, 0.12)",
    },
    {
        "id": "rocketnews",
        "name": "ロケットニュース24",
        "shortName": "ロケニュー",
        "rss": "https://rocketnews24.com/feed/",
        "color": "#f87171",
        "gradient": "linear-gradient(135deg, #f87171, #fb923c)",
        "bgAlpha": "rgba(248, 113, 113, 0.12)",
    },
]

# ===== ヘルパー関数 =====
def strip_html(text):
    if not text:
        return ""
    text = re.sub(r'<[^>]+>', '', text)
    text = text.replace("&nbsp;", " ")
    text = text.replace("&amp;", "&")
    text = text.replace("&lt;", "<")
    text = text.replace("&gt;", ">")
    text = text.replace("&quot;", '"')
    return text.strip()

def parse_rss(xml_text, site):
    try:
        root = ET.fromstring(xml_text)
        # Strip all XML namespaces
        for elem in root.iter():
            if '}' in elem.tag:
                elem.tag = elem.tag.split('}', 1)[1]
    except ET.ParseError as e:
        print(f"[{site['id']}] XML parse error: {e}")
        return []

    items_data = []
    
    # Find all items/entries
    raw_items = root.findall(".//item")
    if not raw_items:
        raw_items = root.findall(".//entry")

    for item in raw_items[:20]:
        title_elem = item.find("title")
        title = ""
        if title_elem is not None:
            title = (title_elem.text or "").strip()
            if not title and len(title_elem) > 0:
                title = "".join(title_elem.itertext()).strip()

        link = ""
        link_elem = item.find("link")
        if link_elem is not None:
            link = (link_elem.text or "").strip()
            if not link:
                link = link_elem.get("href", "")
        if not link:
            guid_elem = item.find("guid")
            if guid_elem is not None:
                link = (guid_elem.text or "").strip()

        desc = ""
        for dtag in ["description", "summary", "encoded", "content"]:
            d = item.find(dtag)
            if d is not None and (d.text or "").strip():
                desc = d.text.strip()
                break
        
        # Extract thumbnail
        thumbnail = ""
        # 1. Check for enclosure or media:thumbnail
        media = item.find(".//{http://search.yahoo.com/mrss/}thumbnail") or item.find(".//thumbnail")
        if media is not None and media.get("url"):
            thumbnail = media.get("url")
        if not thumbnail:
            enc = item.find("enclosure")
            if enc is not None and enc.get("type", "").startswith("image/") and enc.get("url"):
                thumbnail = enc.get("url")
        
        # 2. Extract from description or encoded content if still no thumbnail
        if not thumbnail:
            m = re.search(r'<img[^>]+src=[\"\'](https?://[^\'\">]+)[\"\']', desc, re.IGNORECASE)
            if m:
                thumbnail = m.group(1)

        desc_clean = strip_html(desc)[:200]

        pub_date = ""
        for dtag in ["pubDate", "published", "updated", "date"]:
            d = item.find(dtag)
            if d is not None and d.text:
                pub_date = d.text.strip()
                break

        if not title:
            continue

        items_data.append({
            "siteId": site["id"],
            "siteName": site["name"],
            "siteShortName": site["shortName"],
            "siteColor": site["color"],
            "siteGradient": site["gradient"],
            "siteBgAlpha": site["bgAlpha"],
            "title": title,
            "description": desc_clean,
            "link": link,
            "pubDate": pub_date,
            "thumbnail": thumbnail,
        })

    return items_data

def fetch_site(site):
    url = site["rss"]
    req = urllib.request.Request(
        url,
        headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            'Accept': 'application/rss+xml, application/rdf+xml, application/atom+xml, application/xml, text/xml, */*'
        }
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            raw = response.read()
            xml_text = ""
            for enc in ["utf-8", "shift_jis", "euc-jp", "cp932"]:
                try:
                    xml_text = raw.decode(enc)
                    break
                except UnicodeDecodeError:
                    continue
            else:
                xml_text = raw.decode("utf-8", errors="replace")
        articles = parse_rss(xml_text, site)
        print(f"[{site['id']}] OK: {len(articles)} articles")
        return articles
    except Exception as e:
        print(f"[{site['id']}] FAIL: {e}")
        return []

def sort_key(a):
    s = a.get("pubDate", "")
    if not s:
        return 0.0
    try:
        from email.utils import parsedate_to_datetime
        return parsedate_to_datetime(s).timestamp()
    except Exception:
        pass
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
    except Exception:
        pass
    return 0.0

def build():
    from concurrent.futures import ThreadPoolExecutor
    print("Fetching feeds...")
    with ThreadPoolExecutor(max_workers=10) as executor:
        results = list(executor.map(fetch_site, SITES))
    
    articles = [a for site_articles in results for a in site_articles]
    articles.sort(key=sort_key, reverse=True)
    
    data = {
        "ok": True,
        "articles": articles,
        "updatedAt": datetime.now().isoformat(),
        "sites": [
            {k: v for k, v in s.items() if k != "rss"}
            for s in SITES
        ],
    }

    # Write to articles.json
    with open('articles.json', 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    
    print(f"Build complete! Saved {len(articles)} articles to articles.json.")

if __name__ == '__main__':
    build()
