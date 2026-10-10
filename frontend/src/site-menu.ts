/** ADD DOTS site menu in index.html: Products / Solutions open on tap (touch screens have no hover). */
const menus = Array.from(document.querySelectorAll<HTMLElement>('.adnav-menu'));

function setOpen(menu: HTMLElement, open: boolean) {
  menu.classList.toggle('adnav-open', open);
  menu.querySelector('.adnav-trigger')?.setAttribute('aria-expanded', String(open));
}

for (const menu of menus) {
  menu.querySelector('.adnav-trigger')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = !menu.classList.contains('adnav-open');
    menus.forEach((m) => setOpen(m, false));
    setOpen(menu, open);
  });
}

document.addEventListener('click', (e) => {
  menus.forEach((m) => {
    if (!m.contains(e.target as Node)) setOpen(m, false);
  });
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') menus.forEach((m) => setOpen(m, false));
});
