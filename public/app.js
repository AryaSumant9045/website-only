const ageGate = document.getElementById('ageGate');
const enterBtn = document.getElementById('enterBtn');
const menuBtn = document.getElementById('menuBtn');
const nav = document.querySelector('.desktop-nav');

if (sessionStorage.getItem('velvet-age-confirmed') === 'yes') ageGate.classList.add('hidden');
enterBtn.addEventListener('click', () => {
  sessionStorage.setItem('velvet-age-confirmed', 'yes');
  ageGate.classList.add('hidden');
});
menuBtn.addEventListener('click', () => nav.classList.toggle('open'));
nav.querySelectorAll('a').forEach(link => link.addEventListener('click', () => nav.classList.remove('open')));

document.getElementById('newsletterForm').addEventListener('submit', event => {
  event.preventDefault();
  document.getElementById('formMessage').textContent = 'Thanks — newsletter signup is a visual demo and is not connected to a mailing service yet.';
});

// Load every supported image stored in public/images via the Vercel API.
const uploadedGallery = document.getElementById('uploadedGallery');
if (uploadedGallery) {
  fetch('/api/images')
    .then(response => { if (!response.ok) throw new Error('Gallery unavailable'); return response.json(); })
    .then(images => {
      if (!images.length) return;
      uploadedGallery.innerHTML = '';
      images.forEach(src => {
        const item = document.createElement('a'); item.className = 'uploaded-image';
        item.href = src; item.target = '_blank'; item.rel = 'noopener';
        const image = document.createElement('img'); image.src = src; image.alt = 'Gallery upload'; image.loading = 'lazy';
        item.appendChild(image); uploadedGallery.appendChild(item);
      });
    })
    .catch(() => { uploadedGallery.innerHTML = '<p class="gallery-empty">Gallery is temporarily unavailable.</p>'; });
}


// Render previews for URLs listed in public/links/links.json.
const linkGallery = document.getElementById('linkGallery');
if (linkGallery) {
  fetch('/api/link-previews')
    .then(response => { if (!response.ok) throw new Error('Link previews unavailable'); return response.json(); })
    .then(items => {
      if (!items.length) return;
      linkGallery.innerHTML = '';
      items.forEach(item => {
        const card = document.createElement('a');
        card.className = 'link-preview-card'; card.href = item.url;
        card.target = '_blank'; card.rel = 'noopener noreferrer';
        const preview = document.createElement('div'); preview.className = 'link-preview-media';
        if (item.image) { const img = document.createElement('img'); img.src = item.image; img.alt = item.title || 'Link preview'; img.loading = 'lazy'; img.onerror = () => { preview.innerHTML = '<span>Preview image unavailable</span>'; }; preview.appendChild(img); }
        else { preview.innerHTML = '<span>Preview image unavailable</span>'; }
        card.appendChild(preview);
        const title = document.createElement('strong'); title.textContent = item.title || item.url;
        const url = document.createElement('span'); url.textContent = item.url;
        card.append(title, url); linkGallery.appendChild(card);
      });
    })
    .catch(() => { linkGallery.innerHTML = '<p class="gallery-empty">Link previews are temporarily unavailable.</p>'; });
}
