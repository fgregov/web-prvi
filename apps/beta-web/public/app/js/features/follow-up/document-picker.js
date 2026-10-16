// DocumentPicker: "Attach new document" on /follow-up/new. Picks one PDF
// (tap, or drop on a desktop), checks type and size here, then uploads it at
// once with progress, so "Spremi i generiraj link" only links what the server
// has already validated and stored privately. Value = the upload's id.
import { api, ApiError } from '../../core/api.js';
import { DEFAULT_MAX_DOCUMENT_BYTES, documentFileError, MESSAGES } from '../../core/validation.js';
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { pagesLabel, sizeLabel } from './format.js';

/** Errors that mean "pick another file" (the server checked the content). */
const REJECTED = new Set([
  MESSAGES.documentUnsupported,
  MESSAGES.documentTooLarge,
  MESSAGES.documentEmpty,
  MESSAGES.documentInvalid,
  MESSAGES.documentEncrypted,
]);

/**
 * @param {{ maxBytes?: number, onPicked?: (file: File) => void, onError?: (message: string) => void }} [options]
 */
export function DocumentPicker({
  maxBytes = DEFAULT_MAX_DOCUMENT_BYTES,
  onPicked = () => {},
  onError = () => {},
} = {}) {
  // { file, state: 'uploading'|'done'|'failed', progress, uploadId, pageCount }
  let current = null;
  let pending = null;

  const input = h('input', {
    class: 'fu-file__input',
    type: 'file',
    accept: 'application/pdf,.pdf',
  });
  const limitMb = Math.round(maxBytes / 1024 / 1024);
  const drop = h(
    'label',
    { class: 'fu-file__drop' },
    icon('upload'),
    h('strong', {}, 'Odaberi PDF dokument'),
    h('small', {}, `Samo PDF, najviše ${limitMb} MB`),
  );
  const name = h('p', { class: 'fu-file__name' });
  const meta = h('p', { class: 'fu-file__meta' });
  const state = h('p', { class: 'fu-file__state', role: 'status', 'aria-live': 'polite' });
  const bar = h('div', { class: 'fu-file__bar' });
  const progress = h(
    'div',
    {
      class: 'fu-file__progress',
      role: 'progressbar',
      'aria-label': 'Učitavanje dokumenta',
      'aria-valuemin': '0',
      'aria-valuemax': '100',
    },
    bar,
  );
  const replace = h('label', { class: 'rv-btn rv-btn--soft fu-file__replace' }, 'Zamijeni');
  const retry = h(
    'button',
    {
      type: 'button',
      class: 'rv-btn rv-btn--soft',
      onClick: () => current && upload(current.file),
    },
    'Pokušaj ponovno',
  );
  const remove = h(
    'button',
    { type: 'button', class: 'rv-btn rv-btn--ghost', onClick: () => clear() },
    'Ukloni',
  );
  const card = h(
    'div',
    { class: 'fu-file__card', hidden: true },
    h('span', { class: 'fu-file__icon', 'aria-hidden': 'true' }, icon('file')),
    h('div', {}, name, meta, state, progress),
    h('div', { class: 'fu-file__actions' }, retry, replace, remove),
  );
  const element = h('div', { class: 'fu-file' }, input, drop, card);

  // createForm gives the input its id after this returns; the labels follow it.
  queueMicrotask(() => {
    drop.htmlFor = input.id;
    replace.htmlFor = input.id;
  });

  function render() {
    drop.hidden = Boolean(current);
    card.hidden = !current;
    if (!current) return;
    name.textContent = current.file.name || 'ponuda.pdf';
    meta.textContent = [
      `PDF · ${sizeLabel(current.file.size)}`,
      current.pageCount ? pagesLabel(current.pageCount) : null,
    ]
      .filter(Boolean)
      .join(' · ');
    const percent = Math.round((current.progress ?? 0) * 100);
    state.className = `fu-file__state${current.state === 'done' ? ' is-done' : ''}${
      current.state === 'failed' ? ' is-failed' : ''
    }`;
    state.replaceChildren(
      current.state === 'uploading'
        ? h('span', {}, `Učitavanje dokumenta... ${percent}%`)
        : current.state === 'done'
          ? h('span', {}, icon('check'), ' Dokument je uspješno učitan.')
          : h('span', {}, icon('alert'), ` ${MESSAGES.documentUploadFailed}`),
    );
    progress.hidden = current.state !== 'uploading';
    progress.setAttribute('aria-valuenow', String(percent));
    bar.style.width = `${percent}%`;
    retry.hidden = current.state !== 'failed';
  }

  function changed() {
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function clear() {
    current = null;
    pending = null;
    input.value = '';
    render();
    changed();
  }

  async function upload(file) {
    const mine = { file, state: 'uploading', progress: 0, uploadId: '', pageCount: null };
    current = mine;
    render();
    pending = api.uploadOfferDocument(file, (fraction) => {
      if (current !== mine) return;
      mine.progress = fraction;
      render();
    });
    try {
      const result = await pending;
      if (current !== mine) return;
      Object.assign(mine, {
        state: 'done',
        progress: 1,
        uploadId: result.uploadId,
        pageCount: result.pageCount,
      });
      render();
      changed();
    } catch (error) {
      if (current !== mine) return;
      const message =
        error instanceof ApiError
          ? error.status === 413
            ? MESSAGES.documentTooLarge
            : error.status === 415
              ? MESSAGES.documentUnsupported
              : (error.errors?.document ?? (error.status === 422 ? error.message : null))
          : null;
      if (message && REJECTED.has(message)) {
        // The content was refused: another file is needed.
        current = null;
        input.value = '';
        render();
      } else {
        mine.state = 'failed';
        render();
      }
      changed(); // first: the form clears a field's error on change
      onError(message ?? MESSAGES.documentUploadFailed);
    } finally {
      if (current === mine) pending = null;
    }
  }

  function take(file) {
    if (!file) return;
    const problem = documentFileError(file, maxBytes);
    input.value = ''; // the same file can be picked again after a refusal
    if (problem) {
      onError(problem);
      return;
    }
    onPicked(file);
    upload(file);
  }

  input.addEventListener('change', (event) => {
    event.stopPropagation(); // the picker reports its own change once uploaded
    take(input.files?.[0]);
  });

  // Desktop: drop a PDF on the picker.
  element.addEventListener('dragover', (event) => {
    if (!event.dataTransfer?.types?.includes('Files')) return;
    event.preventDefault();
    element.classList.add('is-dragging');
  });
  element.addEventListener('dragleave', () => element.classList.remove('is-dragging'));
  element.addEventListener('drop', (event) => {
    event.preventDefault();
    element.classList.remove('is-dragging');
    take(event.dataTransfer?.files?.[0]);
  });

  return {
    element,
    focusTarget: input,
    read: () => (current?.state === 'done' ? current.uploadId : ''),
    write() {
      /* a document can only be picked by the user */
    },
    /** True while a file is on its way to the server. */
    uploading: () => current?.state === 'uploading',
    /** Resolves when the current upload has finished (either way). */
    settled: () =>
      pending
        ? pending.then(
            () => {},
            () => {},
          )
        : Promise.resolve(),
    /** The server no longer has the upload (e.g. it expired): upload the same file again. */
    failed() {
      if (current) {
        current.state = 'failed';
        current.uploadId = '';
        render();
      }
    },
  };
}
