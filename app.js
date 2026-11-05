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