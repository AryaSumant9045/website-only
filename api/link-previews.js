const fs = require('fs');
const path = require('path');

module.exports = async (req, res) => {
  const file = path.join(process.cwd(), 'public', 'links', 'links.json');
  let urls = [];
  try { urls = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) {}
  if (!Array.isArray(urls)) urls = [];
  const clean = urls.filter(value => typeof value === 'string' && /^https?:\\/\\//i.test(value)).slice(0, 30);
  const previews = await Promise.all(clean.map(async url => {
    try {
      const response = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; VelvetPreview/1.0)' }, signal: AbortSignal.timeout(7000) });
      const type = response.headers.get('content-type') || '';
      if (!response.ok || !type.includes('text/html')) return { url, title: url, image: null };
      const html = (await response.text()).slice(0, 500000);
      const getMeta = (key) => {
        const safe = key.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&');
        const patterns = [new RegExp('<meta[^>]+(?:property|name)=\"' + safe + '\"[^>]+content=\"([^\"]+)', 'i'), new RegExp('<meta[^>]+content=\"([^\"]+)\"[^>]+(?:property|name)=\"' + safe + '\"', 'i')];
        for (const re of patterns) { const m = html.match(re); if (m) return m[1].replace(/&amp;/g, '&'); }
        return null;
      };
      const rawImage = getMeta('og:image') || getMeta('twitter:image');
      let image = null;
      if (rawImage) { try { const u = new URL(rawImage, url); if (u.protocol === 'http:' || u.protocol === 'https:') image = u.href; } catch (_) {} }
      const title = getMeta('og:title') || getMeta('twitter:title') || ((html.match(/<title[^>]*>([\\s\\S]*?)<\\/title>/i) || [])[1] || '').replace(/<[^>]+>/g, '').trim() || url;
      return { url, title, image };
    } catch (_) { return { url, title: url, image: null }; }
  }));
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
  res.status(200).json(previews);
};