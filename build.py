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
    with ThreadPoolExecutor(max_workers=5) as executor:
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
