// Server-side PDF check for uploads (Follow-up Engine): the file must parse as
// a PDF with pdf.js, have at least one page and open without a password.
// Nothing in it is executed: pdf.js 6 compiles no code from documents, and XFA
// forms and document scripts stay off.
import { MESSAGES } from '../../public/app/js/core/validation.js';
import { DocumentRejected, type PdfInfo } from './follow-up-service.ts';

const PARSE_TIMEOUT_MS = 20_000;

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
let pdfjs: Promise<PdfJs> | null = null;

export async function inspectPdfWithPdfJs(bytes: Uint8Array): Promise<PdfInfo> {
  pdfjs ??= import('pdfjs-dist/legacy/build/pdf.mjs');
  const { getDocument, PasswordException } = await pdfjs;
  // pdf.js takes ownership of the buffer it is given: parse a copy.
  const task = getDocument({
    data: bytes.slice(),
    enableXfa: false,
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: false,
    verbosity: 0,
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const doc = await Promise.race([
      task.promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('PDF parse timeout')), PARSE_TIMEOUT_MS);
      }),
    ]);
    const pageCount = doc.numPages;
    if (!Number.isInteger(pageCount) || pageCount < 1) {
      throw new DocumentRejected(MESSAGES.documentInvalid);
    }
    // The first page must load too (a header and a page count alone are not a document).
    await doc.getPage(1);
    return { pageCount };
  } catch (error) {
    if (error instanceof DocumentRejected) throw error;
    if (error instanceof PasswordException) throw new DocumentRejected(MESSAGES.documentEncrypted);
    throw new DocumentRejected(MESSAGES.documentInvalid);
  } finally {
    clearTimeout(timer);
    await task.destroy().catch(() => {});
  }
}
