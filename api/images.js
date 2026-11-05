const fs = require('fs');
const path = require('path');
module.exports = (req, res) => {
  const imageDir = path.join(process.cwd(), 'public', 'images');
  const allowed = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
  try {
    const images = fs.readdirSync(imageDir, { withFileTypes: true })
      .filter(entry => entry.isFile() && allowed.has(path.extname(entry.name).toLowerCase()))
      .map(entry => '/images/' + encodeURIComponent(entry.name));
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    res.status(200).json(images);
  } catch (error) { res.status(200).json([]); }
};
