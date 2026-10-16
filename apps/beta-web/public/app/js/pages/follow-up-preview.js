// /follow-up/{id}/preview · "Pregledaj ponudu": the salesperson sees the PDF
// as the customer will, through the signed-in API. Nothing is recorded: the
// customer's views are counted only on the public link.
import { api, ApiError } from '../core/api.js';
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { goBack } from '../ui/navigation.js';
import { MobilePageHeader } from '../ui/screen.js';
import { renderPdf } from '../../../viewer/pdf-pages.js';

const offerId = decodeURIComponent(window.location.pathname.split('/')[2] ?? '');
const back = `/follow-up/${encodeURIComponent(offerId)}`;
const root = document.getElementById('screen');
const header = MobilePageHeader({ title: 'Pregled ponude', onBack: () => goBack(back) });
const status = h('p', { class: 'rv-screen__loading', role: 'status' }, 'Učitavanje ponude...');
const pages = h('div', { class: 'fu-pages' });
root.replaceChildren(
  header.element,
  h(
    'main',
    { class: 'rv-screen__body rv-screen__body--wide' },
    h(
      'p',
      { class: 'fu-preview__bar' },
      icon('info'),
      h('span', {}, 'Vaš pregled: ne bilježi se kao pregled kupca.'),
    ),
    status,
    pages,
  ),
);

function fail(message) {
  status.textContent = message;
  status.classList.add('rv-screen__error');
}

try {
  const [offer, bytes] = await Promise.all([
    api.followUpOffer(offerId),
    api.followUpDocument(offerId),
  ]);
  document.title = `Renvara · ${offer.title}`;
  header.heading.textContent = offer.title;
  await renderPdf(pages, bytes, { label: 'Stranica ponude' });
  status.remove();
} catch (error) {
  fail(
    error instanceof ApiError
      ? error.message
      : 'Ponudu trenutno nije moguće prikazati. Pokušajte ponovno.',
  );
  if (!(error instanceof ApiError)) console.error(error);
}
