import mammoth from 'mammoth/mammoth.browser.js';

export function textFromHTML(html) {
  const document = new DOMParser().parseFromString(html, 'text/html');
  document.querySelectorAll('script,style,nav,header,footer,form').forEach(node => node.remove());
  const heading = [...document.querySelectorAll('h1,h2,h3')].find(node => node.textContent.trim().toLowerCase() === 'bibliography');
  const blocks = [];
  if (heading) {
    for (let node = heading.nextElementSibling; node && !['H1', 'H2'].includes(node.tagName); node = node.nextElementSibling) {
      const paragraphs = node.querySelectorAll('p,li');
      blocks.push(...(paragraphs.length ? [...paragraphs] : [node]).map(p => p.textContent.trim()).filter(Boolean));
    }
  }
  if (!blocks.length) blocks.push(...[...document.querySelectorAll('main p,article p,#content p')].map(p => p.textContent.trim()).filter(Boolean));
  return blocks.length ? blocks.join('\n\n') : document.body.textContent.trim();
}

export async function readFile(file, { vision, firstPage, lastPage, signal, ocr, onProgress, onText }) {
  if (!file) throw new Error('Choose a bibliography file.');
  if (file.size > 5 * 1024 * 1024) throw new Error('Choose a file smaller than 5 MB.');
  const extension = file.name.split('.').pop().toLowerCase();
  if (extension === 'txt') return file.text();
  if (extension === 'docx') return (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value;
  if (['png', 'jpg', 'jpeg'].includes(extension)) {
    if (!vision) throw new Error('Enable Vision OCR to read an image.');
    onProgress('Reading image with Vision OCR…');
    signal.throwIfAborted();
    const source = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('The image could not be read.'));
      reader.readAsDataURL(file);
    });
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => {
        const scale = Math.min(1, 2400 / Math.max(element.naturalWidth, element.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(element.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(element.naturalHeight * scale));
        canvas.getContext('2d').drawImage(element, 0, 0, canvas.width, canvas.height);
        const compressed = canvas.toDataURL('image/jpeg', .82);
        canvas.width = canvas.height = 0;
        if (compressed.length > 7000000) reject(new Error('This image is too detailed to send safely. Try a smaller image.'));
        else resolve(compressed);
      };
      element.onerror = () => reject(new Error('The image could not be decoded.'));
      element.src = source;
    });
    const result = await ocr(image);
    onText(result);
    return result;
  }
  if (extension !== 'pdf') throw new Error('Choose a TXT, DOCX, PDF, PNG, or JPG file.');
  const pdfjs = await import('pdfjs-dist/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.mjs', import.meta.url).href;
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false }).promise;
  let text = '';
  try {
    const end = lastPage || pdf.numPages;
    if (!Number.isInteger(firstPage) || firstPage < 1 || !Number.isInteger(end) || end > pdf.numPages || end < firstPage) throw new Error(`Choose a page range between 1 and ${pdf.numPages}.`);
    for (let pageNumber = firstPage; pageNumber <= end; pageNumber++) {
      signal.throwIfAborted();
      onProgress(`${vision ? 'Reading scanned' : 'Extracting'} page ${pageNumber} of ${end}…`);
      const page = await pdf.getPage(pageNumber);
      let pageText;
      if (vision) {
        const viewport = page.getViewport({ scale: 1.5 });
        if (viewport.width * viewport.height > 16000000) throw new Error('This PDF page is too large to render. Try a smaller document.');
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        const render = page.render({ canvasContext: canvas.getContext('2d'), viewport });
        const cancel = () => render.cancel();
        signal.addEventListener('abort', cancel, { once: true });
        try {
          await render.promise;
          signal.throwIfAborted();
          pageText = await ocr(canvas.toDataURL('image/jpeg', .85));
        } finally { signal.removeEventListener('abort', cancel); canvas.width = canvas.height = 0; }
      } else {
        const content = await page.getTextContent();
        const lines = [];
        let line = '', lastY;
        for (const item of content.items) {
          if (!('str' in item)) continue;
          const y = item.transform[5];
          if (lastY !== undefined && Math.abs(y - lastY) > 5 && line) { lines.push(line.trim()); line = ''; }
          line += item.str + ' ';
          if (item.hasEOL) { lines.push(line.trim()); line = ''; }
          lastY = y;
        }
        if (line.trim()) lines.push(line.trim());
        pageText = lines.join('\n');
      }
      text += `${text ? '\n\n' : ''}${pageText}`;
      onText(text);
      page.cleanup();
    }
    if (!text.trim()) throw new Error('No text was found. Enable Vision OCR for scanned pages.');
    return text;
  } finally { await pdf.destroy(); }
}
