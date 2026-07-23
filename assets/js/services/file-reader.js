import { SOURCE_LIMIT } from '../core/config.js';

export async function readStudyFile(file, onProgress = () => {}) {
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (!['txt', 'pdf'].includes(extension)) {
    throw new Error('Choose a TXT or PDF file.');
  }

  const text = extension === 'txt'
    ? await file.text()
    : await extractPdfText(file, onProgress);

  return {
    extension,
    text: text.trim().slice(0, SOURCE_LIMIT)
  };
}

async function extractPdfText(file, onProgress) {
  const pdfjsLib = await import(
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs'
  );

  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs';

  const pdf = await pdfjsLib.getDocument({
    data: await file.arrayBuffer()
  }).promise;

  const pages = [];
  let extractedCharacters = 0;

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = content.items.map(item => item.str).join(' ');

    pages.push(pageText);
    extractedCharacters += pageText.length;
    onProgress(Math.round((pageNumber / pdf.numPages) * 90));

    if (extractedCharacters >= SOURCE_LIMIT) break;
  }

  return pages.join('\n\n');
}
