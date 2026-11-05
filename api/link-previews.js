const fs = require('fs');
const path = require('path');

function decode(value) {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function metaContent(html, key) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const name = (tag.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i) || [])[1];
    const content = (tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i) || [])[1];
    if (name && content && name.toLowerCase() === key.toLowerCase()) return decode(content);
  }
  return null;
}

module.exports = async (req, res) => {
  const file = path.join(process.cwd(), 'public', 'links', 'links.json');
  let urls = [];
  try { urls = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) {}
  if (!Array.isArray(urls)) urls = [];

  const clean = urls
    .filter(value => typeof value === 'string')
    .map(value => value.trim())
    .filter(value => {
      try { return ['http:', 'https:'].includes(new URL(value).protocol); }
      catch (_) { return false; }
    })
    .slice(0, 30);

  const previews = await Promise.all(clean.map(async url => {
    const pageUrl = new URL(url);
    const siteIcon = `https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(pageUrl.origin)}&sz=256`;
    try {
      const response = await fetch(url, {
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; VelvetPreview/1.0)' },
        signal: AbortSignal.timeout(7000)
      });
      const type = response.headers.get('content-type') || '';
      if (!response.ok || !type.includes('text/html')) return { url, title: url, image: siteIcon };

      const html = (await response.text()).slice(0, 500000);
      const titleTag = (html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
      const title = metaContent(html, 'og:title') ||
        metaContent(html, 'twitter:title') ||
        decode(titleTag.replace(/<[^>]+>/g, '').trim()) || url;

      // Do not pull explicit-media thumbnails from the currently configured adult-content host.
      const restrictedPreviewHost = pageUrl.hostname === 'elitebabes.com' || pageUrl.hostname.endsWith('.elitebabes.com');
      const rawImage = restrictedPreviewHost ? null :
        (metaContent(html, 'og:image') || metaContent(html, 'twitter:image'));
      let image = null;
      if (rawImage) {
        try {
          const candidate = new URL(rawImage, url);
          if (candidate.protocol === 'http:' || candidate.protocol === 'https:') image = candidate.href;
        } catch (_) {}
      }
      return { url, title, image: image || siteIcon };
    } catch (_) {
      return { url, title: url, image: siteIcon };
    }
  }));

  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
  res.status(200).json(previews);
};
