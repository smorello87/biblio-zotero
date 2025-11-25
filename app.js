/**
 * Bibliography to Zotero Converter - JavaScript Web Application
 *
 * This application replicates the functionality of omeka_bib_to_zotero.py
 * for use in web browsers.
 */

// ==================== Constants ====================

const DEFAULT_URL = "https://italianamericanimprints.omeka.net/actual-bibliography";

const LLM_SYSTEM_PROMPT =
    "You are a bibliography parser that outputs ONLY valid JSON. " +
    "You convert free-text bibliographic entries (English/Italian) into CSL-JSON items. " +
    "CRITICAL: Your response must be ONLY a JSON object starting with { and ending with }. NO commentary, NO explanations, NO analysis. " +
    "The JSON object must have an 'items' key with an array of bibliography entries. " +
    "If data is missing, omit the field. " +
    "Always set a plausible 'type' (e.g., 'book', 'chapter', 'article-journal', 'article-magazine', 'thesis', 'pamphlet', 'manuscript', 'report'). " +
    "Map editors to the 'editor' array, and authors to the 'author' array with objects {\"family\", \"given\"}. " +
    "For dates like '1940a' set issued.date-parts to [[1940]] and put the suffix 'a' into 'note' (e.g., 'year-suffix: a'). " +
    "For bracketed/uncertain dates like '[1903]' or 'n.d.' use the best available year in 'issued' when possible and add a clarifying note. " +
    "Use 'publisher' and 'publisher-place' for books; 'container-title', 'volume', 'issue', 'page' for articles; use 'title' for work title. " +
    "Keep diacritics; don't invent DOIs/URLs. If multiple places/publishers are separated by ';', you may keep the first and add the rest to 'note'.";

const LLM_USER_TEMPLATE =
    "Convert the following bibliographic entries into CSL-JSON. Return a JSON object with an 'items' key containing an array of CSL-JSON objects, in the SAME order as the input.\n\n" +
    "Entries:\n{entries}\n\n" +
    "Your response must be in this format:\n" +
    "{\n  \"items\": [\n    {\n      \"type\": \"book\",\n      \"title\": \"...\",\n      \"author\": [{\"family\": \"...\", \"given\": \"...\"}],\n      \"editor\": [...],\n      \"issued\": {\"date-parts\": [[1999]]},\n      \"publisher\": \"...\",\n      \"publisher-place\": \"...\",\n      \"container-title\": \"...\",\n      \"volume\": \"...\",\n      \"issue\": \"...\",\n      \"page\": \"...\",\n      \"language\": \"it\"\n    }\n  ]\n}";

const CSL_TYPE_TO_RIS = {
    "book": "BOOK",
    "chapter": "CHAP",
    "article-journal": "JOUR",
    "article-magazine": "MGZN",
    "article-newspaper": "NEWS",
    "thesis": "THES",
    "report": "RPRT",
    "manuscript": "MANU",
    "pamphlet": "PAMP"
};

// ==================== State Management ====================

let state = {
    entries: [],
    parsedItems: [],
    failedEntries: [],
    outputFormat: 'csljson',
    outputFilename: 'zotero_bibliography.json'
};

// ==================== LocalStorage Helpers ====================

const STORAGE_KEY = 'biblio-zotero-api-key';

function saveAPIKey(apiKey) {
    try {
        localStorage.setItem(STORAGE_KEY, apiKey);
        debug('API key saved to localStorage');
    } catch (e) {
        console.error('Failed to save API key:', e);
    }
}

function loadAPIKey() {
    try {
        return localStorage.getItem(STORAGE_KEY) || '';
    } catch (e) {
        console.error('Failed to load API key:', e);
        return '';
    }
}

function clearAPIKey() {
    try {
        localStorage.removeItem(STORAGE_KEY);
        debug('API key cleared from localStorage');
    } catch (e) {
        console.error('Failed to clear API key:', e);
    }
}

// ==================== Utility Functions ====================

function debug(msg) {
    console.log(`[debug] ${msg}`);
    addLog(msg);
}

function addLog(msg, type = 'info') {
    const logContainer = document.getElementById('log-container');
    const logEntry = document.createElement('div');
    logEntry.className = `log-entry ${type}`;
    logEntry.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    logContainer.appendChild(logEntry);
    logContainer.scrollTop = logContainer.scrollHeight;
}

function updateProgress(percent, text) {
    const progressFill = document.getElementById('progress-fill');
    const progressText = document.getElementById('progress-text');
    progressFill.style.width = `${percent}%`;
    progressText.textContent = text;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ==================== Vision OCR Functions ====================

async function renderPdfPageToImage(pdf, pageNum, scale = 1.5) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale });

    // Create canvas
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    // Render page to canvas
    await page.render({
        canvasContext: context,
        viewport: viewport
    }).promise;

    // Convert to base64 PNG
    return canvas.toDataURL('image/png').split(',')[1];
}

async function callVisionModelForOCR(base64Images, apiKey, visionModel) {
    const url = "https://openrouter.ai/api/v1/chat/completions";

    // Build content array with all page images
    const content = [
        {
            type: "text",
            text: `You are extracting bibliography entries from PDF page images.

IMPORTANT INSTRUCTIONS:
1. Extract ALL bibliography entries exactly as they appear
2. Each entry typically starts with an author name (e.g., "Smith, John.") or a ditto mark (—.) for repeated authors
3. Preserve the exact text including years, titles, publishers, and all details
4. Separate each bibliography entry with a blank line
5. Do NOT summarize or paraphrase - extract the exact text
6. If text is unclear, make your best attempt to read it accurately

Output ONLY the extracted bibliography text, nothing else.`
        }
    ];

    // Add all images
    for (let i = 0; i < base64Images.length; i++) {
        content.push({
            type: "image_url",
            image_url: {
                url: `data:image/png;base64,${base64Images[i]}`
            }
        });
    }

    const payload = {
        model: visionModel,
        messages: [
            {
                role: "user",
                content: content
            }
        ],
        temperature: 0,
        max_tokens: 16000
    };

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Vision API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
}

async function extractPdfWithVision(file, apiKey, visionModel, progressCallback) {
    debug(`Using Vision OCR with model: ${visionModel}`);

    const arrayBuffer = await file.arrayBuffer();
    const typedArray = new Uint8Array(arrayBuffer);
    const pdf = await pdfjsLib.getDocument(typedArray).promise;

    debug(`PDF has ${pdf.numPages} pages`);

    // Process pages in batches (most vision models can handle multiple images)
    const batchSize = 4; // Process 4 pages at a time
    let allText = '';

    for (let i = 0; i < pdf.numPages; i += batchSize) {
        const endPage = Math.min(i + batchSize, pdf.numPages);
        const pageRange = `${i + 1}-${endPage}`;

        if (progressCallback) {
            progressCallback(`Vision OCR: Processing pages ${pageRange} of ${pdf.numPages}...`);
        }
        debug(`Rendering pages ${pageRange} to images...`);

        // Render batch of pages to images
        const base64Images = [];
        for (let pageNum = i + 1; pageNum <= endPage; pageNum++) {
            const base64 = await renderPdfPageToImage(pdf, pageNum);
            base64Images.push(base64);
        }

        debug(`Sending ${base64Images.length} page images to vision model...`);
        addLog(`Vision OCR: Processing pages ${pageRange}...`, 'info');

        try {
            const pageText = await callVisionModelForOCR(base64Images, apiKey, visionModel);
            allText += pageText + '\n\n';
        } catch (error) {
            debug(`Vision OCR error for pages ${pageRange}: ${error.message}`);
            addLog(`Vision OCR error for pages ${pageRange}: ${error.message}`, 'error');
            throw error;
        }

        // Small delay between batches to avoid rate limiting
        if (endPage < pdf.numPages) {
            await sleep(500);
        }
    }

    return allText;
}

// ==================== ISBN Enrichment Functions ====================

function getYearFromItem(item) {
    const issued = item.issued;
    if (issued && typeof issued === 'object') {
        const dateParts = issued['date-parts'];
        if (Array.isArray(dateParts) && dateParts[0] && dateParts[0][0]) {
            const year = parseInt(dateParts[0][0], 10);
            if (!isNaN(year)) return year;
        }
    }
    return null;
}

async function searchOpenLibrary(title, author, year) {
    const params = new URLSearchParams();
    params.set('title', title);
    if (author) params.set('author', author);
    if (year) params.set('first_publish_year', year.toString());
    params.set('limit', '5');

    // Use CORS proxy
    const corsProxy = 'https://corsproxy.io/?';
    const url = `${corsProxy}https://openlibrary.org/search.json?${params.toString()}`;

    try {
        const response = await fetch(url, { timeout: 10000 });
        if (!response.ok) return null;

        const data = await response.json();

        if (data.numFound > 0 && data.docs && data.docs.length > 0) {
            const doc = data.docs[0];
            const result = {};

            // Get ISBNs
            if (doc.isbn && doc.isbn.length > 0) {
                const isbns = doc.isbn;
                const isbn13 = isbns.find(i => i.length === 13);
                const isbn10 = isbns.find(i => i.length === 10);
                result.ISBN = isbn13 || isbn10;
            }

            // Get OCLC numbers
            if (doc.oclc && doc.oclc.length > 0) {
                result.OCLC = Array.isArray(doc.oclc) ? doc.oclc[0] : doc.oclc;
            }

            // Get LCCN
            if (doc.lccn && doc.lccn.length > 0) {
                result['call-number'] = Array.isArray(doc.lccn) ? doc.lccn[0] : doc.lccn;
            }

            // Get page count
            if (doc.number_of_pages_median) {
                result['number-of-pages'] = doc.number_of_pages_median;
            }

            // Get publisher
            if (doc.publisher && doc.publisher.length > 0) {
                result.publisher = Array.isArray(doc.publisher) ? doc.publisher[0] : doc.publisher;
            }

            // Get publisher place
            if (doc.publish_place && doc.publish_place.length > 0) {
                result['publisher-place'] = Array.isArray(doc.publish_place) ? doc.publish_place[0] : doc.publish_place;
            }

            // Get publication year
            if (doc.first_publish_year) {
                result.issued = { 'date-parts': [[doc.first_publish_year]] };
            }

            // Get subjects/keywords (limit to first 5)
            if (doc.subject && doc.subject.length > 0) {
                result.keyword = doc.subject.slice(0, 5).join(', ');
            }

            return Object.keys(result).length > 0 ? result : null;
        }
    } catch (error) {
        debug(`Open Library search error: ${error.message}`);
    }

    return null;
}

async function searchGoogleBooks(title, author) {
    const queryParts = [];
    if (title) queryParts.push(`intitle:${title}`);
    if (author) queryParts.push(`inauthor:${author}`);

    const query = queryParts.join('+');
    const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=5`;

    try {
        const response = await fetch(url, { timeout: 10000 });
        if (!response.ok) return null;

        const data = await response.json();

        if (data.totalItems > 0 && data.items && data.items.length > 0) {
            const volumeInfo = data.items[0].volumeInfo || {};
            const result = {};

            // Get ISBNs from industryIdentifiers
            const identifiers = volumeInfo.industryIdentifiers || [];
            for (const ident of identifiers) {
                if (ident.type === 'ISBN_13') {
                    result.ISBN = ident.identifier;
                    break;
                } else if (ident.type === 'ISBN_10' && !result.ISBN) {
                    result.ISBN = ident.identifier;
                }
            }

            // Get page count
            if (volumeInfo.pageCount) {
                result['number-of-pages'] = volumeInfo.pageCount;
            }

            // Get publisher
            if (volumeInfo.publisher) {
                result.publisher = volumeInfo.publisher;
            }

            // Get publication date/year
            if (volumeInfo.publishedDate) {
                const yearMatch = volumeInfo.publishedDate.match(/^(\d{4})/);
                if (yearMatch) {
                    result.issued = { 'date-parts': [[parseInt(yearMatch[1], 10)]] };
                }
            }

            // Get categories/subjects
            if (volumeInfo.categories && volumeInfo.categories.length > 0) {
                result.keyword = volumeInfo.categories.slice(0, 5).join(', ');
            }

            // Get description/abstract (truncated)
            if (volumeInfo.description) {
                let desc = volumeInfo.description;
                if (desc.length > 500) {
                    desc = desc.substring(0, 497) + '...';
                }
                result.abstract = desc;
            }

            return Object.keys(result).length > 0 ? result : null;
        }
    } catch (error) {
        debug(`Google Books search error: ${error.message}`);
    }

    return null;
}

async function enrichItemsWithISBN(items, progressCallback) {
    const stats = { found: 0, notFound: 0, preIsbn: 0, skipped: 0 };

    // Count books to process
    const books = items.filter(item => item.type === 'book');
    const totalBooks = books.length;

    if (totalBooks === 0) {
        debug('No books to enrich with ISBN');
        return items;
    }

    debug(`Enriching ${totalBooks} books with ISBN/OCLC lookup...`);
    addLog(`Starting ISBN enrichment for ${totalBooks} books...`, 'info');

    let bookIndex = 0;
    for (const item of items) {
        // Only enrich books
        if (item.type !== 'book') {
            stats.skipped++;
            continue;
        }

        bookIndex++;
        const title = item.title || '';
        let author = '';
        if (item.author && Array.isArray(item.author) && item.author.length > 0) {
            author = item.author[0].family || '';
        }

        const year = getYearFromItem(item);

        if (progressCallback) {
            progressCallback(`Enriching book ${bookIndex}/${totalBooks}...`);
        }

        debug(`[${bookIndex}/${totalBooks}] Looking up: ${title.substring(0, 50)}...`);

        // Check if pre-ISBN era (before 1970)
        const isPreIsbn = year !== null && year < 1970;

        let result = null;

        // Search Open Library first
        result = await searchOpenLibrary(title, author, year);

        // If not found and post-1970, try Google Books as fallback
        if (!result && !isPreIsbn) {
            await sleep(200); // Rate limiting
            result = await searchGoogleBooks(title, author);
        }

        // Apply results
        if (result) {
            // Merge metadata (don't overwrite existing values)
            for (const [key, value] of Object.entries(result)) {
                if (!item[key]) {
                    item[key] = value;
                }
            }

            if (isPreIsbn) {
                stats.preIsbn++;
                if (result.OCLC || result['call-number']) {
                    item.note = (item.note || '') + ' [Pre-ISBN publication; OCLC/LCCN found]';
                    stats.found++;
                } else {
                    item.note = (item.note || '') + ' [Pre-ISBN publication (before 1970)]';
                    stats.notFound++;
                }
            } else {
                if (result.ISBN) {
                    stats.found++;
                } else {
                    stats.notFound++;
                }
            }
        } else {
            if (isPreIsbn) {
                stats.preIsbn++;
                item.note = (item.note || '') + ' [Pre-ISBN publication (before 1970)]';
            }
            stats.notFound++;
        }

        // Rate limiting between requests
        await sleep(200);
    }

    debug(`ISBN enrichment complete: ${stats.found} found, ${stats.notFound} not found, ${stats.preIsbn} pre-ISBN books, ${stats.skipped} non-books skipped`);
    addLog(`ISBN enrichment: ${stats.found} found, ${stats.notFound} not found`, 'success');

    return items;
}

// ==================== File Reading Functions ====================

async function readTextFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = (e) => reject(new Error('Failed to read text file'));
        reader.readAsText(file);
    });
}

async function readDocxFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const arrayBuffer = e.target.result;
                const result = await mammoth.extractRawText({ arrayBuffer });
                resolve(result.value);
            } catch (error) {
                reject(new Error('Failed to read DOCX file: ' + error.message));
            }
        };
        reader.onerror = (e) => reject(new Error('Failed to read DOCX file'));
        reader.readAsArrayBuffer(file);
    });
}

async function readPdfFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const arrayBuffer = e.target.result;
                const typedArray = new Uint8Array(arrayBuffer);

                // Load the PDF document
                const pdf = await pdfjsLib.getDocument(typedArray).promise;
                debug(`PDF loaded: ${pdf.numPages} pages`);

                let allText = '';

                // Extract text from each page
                for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
                    const page = await pdf.getPage(pageNum);
                    const textContent = await page.getTextContent();

                    // Combine text items into lines
                    let pageText = '';
                    let lastY = null;

                    for (const item of textContent.items) {
                        if (item.str) {
                            // Check if this is a new line (significant Y change)
                            if (lastY !== null && Math.abs(item.transform[5] - lastY) > 5) {
                                pageText += '\n';
                            }
                            pageText += item.str;
                            lastY = item.transform[5];
                        }
                    }

                    allText += pageText + '\n';
                }

                // Now intelligently split into bibliography entries
                // Bibliography entries typically start with:
                // 1. Author name pattern: "Lastname, Firstname." or
                // 2. Ditto marks: "—." or "———." or "______."
                // 3. Anonymous entries: "Anonymous."

                const lines = allText.split('\n');
                const entries = [];
                let currentEntry = '';

                // Pattern to detect start of a new bibliography entry
                // Matches: "Author, Name. Year" or "—. Year" or "Anonymous. Year"
                const entryStartPattern = /^([A-Z][a-zA-Zà-ÿÀ-ß\-']+,\s+[A-Z]|—+\.?\s|_{3,}\.?\s|Anonymous\.)/;

                for (const line of lines) {
                    const trimmedLine = line.trim();
                    if (!trimmedLine) continue;

                    // Check if this line starts a new entry
                    if (entryStartPattern.test(trimmedLine)) {
                        // Save previous entry if exists
                        if (currentEntry.trim()) {
                            entries.push(currentEntry.trim());
                        }
                        currentEntry = trimmedLine;
                    } else {
                        // Continue current entry (add space to join lines)
                        if (currentEntry) {
                            currentEntry += ' ' + trimmedLine;
                        } else {
                            currentEntry = trimmedLine;
                        }
                    }
                }

                // Don't forget the last entry
                if (currentEntry.trim()) {
                    entries.push(currentEntry.trim());
                }

                debug(`PDF extraction found ${entries.length} bibliography entries`);

                // Check for potential font encoding issues
                // Look for suspicious patterns that indicate font encoding problems
                const sampleText = entries.slice(0, 10).join(' ');
                // Pattern for garbled years: lowercase letters/symbols where years should be
                // e.g., "zffff." or "zf()." instead of "1985." or "1902."
                const suspiciousYearPattern = /\.\s+[a-z][a-z\(\)\[\]]{2,5}[a-zA-Z]?\./g;
                const normalYearPattern = /\.\s+\[?\d{4}[a-z]?\]?\./g;

                const suspiciousMatches = sampleText.match(suspiciousYearPattern) || [];
                const normalYears = sampleText.match(normalYearPattern) || [];

                if (suspiciousMatches.length >= 2 && normalYears.length === 0) {
                    debug('WARNING: PDF may have font encoding issues - years appear garbled');
                    addLog('⚠️ WARNING: This PDF may have font encoding issues. Years and numbers appear as garbled text (e.g., "zffff" instead of "1985"). Consider copying text manually from the PDF viewer or using the "Paste Text" input option.', 'warning');
                }

                // Join with triple newlines to match expected entry separator format
                resolve(entries.join('\n\n\n'));
            } catch (error) {
                reject(new Error('Failed to read PDF file: ' + error.message));
            }
        };
        reader.onerror = (e) => reject(new Error('Failed to read PDF file'));
        reader.readAsArrayBuffer(file);
    });
}

async function readLocalFile(file) {
    const fileName = file.name.toLowerCase();

    if (fileName.endsWith('.txt')) {
        return await readTextFile(file);
    } else if (fileName.endsWith('.docx')) {
        if (typeof mammoth === 'undefined') {
            throw new Error('DOCX support not available. Please include mammoth.js library.');
        }
        return await readDocxFile(file);
    } else if (fileName.endsWith('.pdf')) {
        if (typeof pdfjsLib === 'undefined') {
            throw new Error('PDF support not available. Please include pdf.js library.');
        }
        return await readPdfFile(file);
    } else {
        throw new Error('Unsupported file format. Use .txt, .docx, or .pdf');
    }
}

// ==================== Web Scraping Functions ====================

async function fetchPageText(url) {
    debug(`Fetching bibliography from ${url}`);

    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const html = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Try to find the Bibliography heading
        let bibliographySection = null;
        const headings = doc.querySelectorAll('h1, h2, h3');

        for (const heading of headings) {
            if (heading.textContent.trim().toLowerCase() === 'bibliography') {
                bibliographySection = heading;
                break;
            }
        }

        if (bibliographySection) {
            const texts = [];
            let sibling = bibliographySection.nextElementSibling;

            while (sibling) {
                // Stop at next major heading
                if (sibling.tagName === 'H1' || sibling.tagName === 'H2') {
                    break;
                }

                const text = sibling.textContent;
                if (text && text.trim()) {
                    texts.push(text);
                }

                sibling = sibling.nextElementSibling;
            }

            // Join with triple newlines to separate entries (each <p> is an entry)
            const candidate = texts.join('\n\n\n').trim();
            if (candidate) {
                debug(`Extracted ${texts.length} paragraph elements`);
                return candidate;
            }
        }

        // Fallback: get full page text and slice from first 'Bibliography' occurrence
        const fullText = doc.body.textContent;
        const match = fullText.match(/^\s*Bibliography\s*$/im);

        if (match) {
            return fullText.substring(match.index + match[0].length).trim();
        }

        return fullText.trim();
    } catch (error) {
        if (error.name === 'TypeError' || error.message.includes('Failed to fetch')) {
            throw new Error(
                'CORS error: Unable to fetch URL directly. Please use a CORS proxy or upload the file manually. ' +
                'See the "CORS Solutions" section for details.'
            );
        }
        throw error;
    }
}

// ==================== Entry Processing Functions ====================

function splitEntries(rawText) {
    debug('Splitting into entries...');
    debug(`Input text length: ${rawText.length} characters`);

    // Normalize line endings and non-breaking spaces
    let text = rawText.replace(/\xa0/g, ' ');  // Non-breaking space to regular space
    text = text.replace(/\r\n?/g, '\n');  // Normalize line endings

    // Detect format: if we have blank lines (double newlines), use those as separators
    // Otherwise, split on single newlines (one entry per line)
    let rawBlocks;
    if (text.includes('\n\n')) {
        // Blank lines present - split on them
        rawBlocks = text.split(/\n\n+/);
        debug(`Detected blank-line format, split into ${rawBlocks.length} raw blocks`);
    } else {
        // No blank lines - split on single newlines (one entry per line)
        rawBlocks = text.split(/\n/);
        debug(`Detected single-line format, split into ${rawBlocks.length} raw blocks`);
    }

    const entries = [];
    for (const block of rawBlocks) {
        const trimmed = block.trim();
        if (!trimmed) continue;

        // Join lines within this block with spaces and collapse whitespace
        const entryText = trimmed.replace(/\s+/g, ' ').trim();

        // Filter out obvious non-entries
        if (entryText.toLowerCase().startsWith('search using this query type')) {
            debug(`Skipping: search query type`);
            continue;
        }
        if (/^(home|about|browse|search|contact|map|essays?|collections?)(\s|$)/i.test(entryText)) {
            debug(`Skipping: navigation item - ${entryText.substring(0, 50)}...`);
            continue;
        }
        // Skip very short blocks that don't look like citations
        if (entryText.length < 20 && !/\d{4}/.test(entryText)) {
            debug(`Skipping: too short - ${entryText}`);
            continue;
        }

        entries.push(entryText);
        debug(`Entry ${entries.length}: ${entryText.substring(0, 80)}...`);
    }

    debug(`Found ${entries.length} entries total`);
    return entries;
}

function expandRepeatedAuthors(entries) {
    debug('Expanding author ditto marks...');

    const out = [];
    let prevAuthor = null;

    for (let e of entries) {
        // Detect ditto markers at start
        const dittoMatch = e.match(/^(_{3,}|—{2,}|—)\.?\s/);
        if (dittoMatch && prevAuthor) {
            // Replace ditto with previous author name
            e = e.replace(/^(_{3,}|—{2,}|—)\.?/, prevAuthor + '.');
        }

        // Update prevAuthor for next iteration
        // Try multiple patterns to extract author name:

        // Pattern 1: "Surname, Given [middle]. YEAR" (most common)
        let match = e.match(/^([A-Z][a-zA-Z'\-]+(?:\s+[A-Z]\.?)?,\s+[A-Z][a-zA-Z.\s\-]+?)\.\s+[\[\d]/);
        if (match) {
            prevAuthor = match[1].trim();
        } else {
            // Pattern 2: "Surname, Given [pseudonym]." (with brackets)
            match = e.match(/^([^\.]+?)\s*\[[^\]]+\]\.\s+[\d\[]/);
            if (match) {
                prevAuthor = match[1].trim();
            } else {
                // Pattern 3: Simple "Surname, Given."
                match = e.match(/^([A-Z][^\.]+)\.\s+/);
                if (match) {
                    // Make sure we didn't capture the year
                    let candidate = match[1].trim();
                    // Remove year if present (e.g., "Surname, Given 1940a" -> "Surname, Given")
                    candidate = candidate.replace(/\s+\d{4}[a-z]?$/, '');
                    prevAuthor = candidate;
                }
            }
        }

        out.push(e);
    }

    return out;
}

// ==================== LLM Functions ====================

async function callOpenRouterChat(model, messages, apiKey) {
    const url = "https://openrouter.ai/api/v1/chat/completions";
    const headers = {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
    };
    const payload = {
        "model": model,
        "messages": messages,
        "temperature": 0,
        "response_format": {"type": "json_object"}
    };

    const maxRetries = 3;
    const baseDelay = 2000;  // milliseconds

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 180000);  // 180s timeout

            const response = await fetch(url, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(payload),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                if (response.status === 429 && attempt < maxRetries - 1) {
                    const delay = baseDelay * Math.pow(2, attempt);
                    debug(`Rate limit hit (attempt ${attempt + 1}/${maxRetries}), retrying in ${delay/1000}s...`);
                    addLog(`Rate limit hit, retrying in ${delay/1000}s...`, 'warning');
                    await sleep(delay);
                    continue;
                }
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            return data.choices[0].message.content;
        } catch (error) {
            if ((error.name === 'AbortError' || error.message.includes('timeout')) && attempt < maxRetries - 1) {
                const delay = baseDelay * Math.pow(2, attempt);
                debug(`Request timeout (attempt ${attempt + 1}/${maxRetries}), retrying in ${delay/1000}s...`);
                addLog(`Request timeout, retrying in ${delay/1000}s...`, 'warning');
                await sleep(delay);
            } else {
                throw error;
            }
        }
    }
}

async function batchParseWithLLM(entries, provider, model, apiKey, batchSize = 25) {
    debug(`Starting LLM parsing with ${provider} (${model})`);

    const results = [];
    const failed = [];

    // Only OpenRouter is supported from browser
    const caller = callOpenRouterChat;

    for (let i = 0; i < entries.length; i += batchSize) {
        const batch = entries.slice(i, i + batchSize);
        const batchNum = Math.floor(i / batchSize) + 1;
        const totalBatches = Math.ceil(entries.length / batchSize);

        debug(`Processing batch ${batchNum}/${totalBatches} (${batch.length} entries)`);
        addLog(`Processing batch ${batchNum}/${totalBatches}...`, 'info');

        const progress = (i / entries.length) * 100;
        updateProgress(progress, `Processing batch ${batchNum}/${totalBatches}...`);

        const content = LLM_USER_TEMPLATE.replace(
            '{entries}',
            batch.map(x => `- ${x}`).join('\n')
        );

        const messages = [
            {"role": "system", "content": LLM_SYSTEM_PROMPT},
            {"role": "user", "content": content}
        ];

        try {
            const raw = await caller(model, messages, apiKey);
            debug(`LLM raw response (first 500 chars): ${raw.substring(0, 500)}`);
            const parsed = JSON.parse(raw);
            debug(`Parsed JSON keys: ${Object.keys(parsed).join(', ')}`);

            // Try different possible response structures
            let items = null;
            if (Array.isArray(parsed)) {
                items = parsed;
            } else if (typeof parsed === 'object') {
                // Try common key names
                for (const key of ["items", "output", "bibliography", "entries", "data", "results"]) {
                    if (key in parsed && Array.isArray(parsed[key])) {
                        items = parsed[key];
                        break;
                    }
                }
                // If still no items found, check if the dict itself contains the expected fields
                if (items === null) {
                    for (const value of Object.values(parsed)) {
                        if (Array.isArray(value) && value.length > 0) {
                            items = value;
                            break;
                        }
                    }
                }
            }

            if (!Array.isArray(items)) {
                throw new Error('Unexpected JSON structure from LLM');
            }

            // Handle batch size mismatches
            if (items.length !== batch.length) {
                if (items.length < batch.length) {
                    debug(`Warning: LLM returned ${items.length} items for a batch of ${batch.length}`);
                    addLog(`Warning: LLM returned fewer items than expected`, 'warning');

                    results.push(...items);

                    const missingCount = batch.length - items.length;
                    debug(`Creating stub records for ${missingCount} missing entries`);

                    for (let j = items.length; j < batch.length; j++) {
                        failed.push(batch[j]);
                        results.push({
                            "type": "manuscript",
                            "title": batch[j],
                            "note": "LLM returned incomplete batch; raw citation preserved in title."
                        });
                    }
                } else {
                    debug(`Warning: LLM returned ${items.length} items for a batch of ${batch.length}; truncating.`);
                    results.push(...items.slice(0, batch.length));
                }
            } else {
                results.push(...items);
            }
        } catch (error) {
            debug(`LLM parse failed for batch ${i}-${i + batch.length - 1}: ${error.message}`);
            addLog(`Batch ${batchNum} failed: ${error.message}`, 'error');

            failed.push(...batch);
            for (const e of batch) {
                results.push({
                    "type": "manuscript",
                    "title": e,
                    "note": "LLM parse failed; raw citation placed in title."
                });
            }
        }

        // Delay between batches to avoid rate limiting
        if (i + batchSize < entries.length) {
            await sleep(1000);
        }
    }

    updateProgress(100, 'LLM parsing complete');
    return { items: results, failed };
}

// ==================== Output Functions ====================

function createCSLJSON(items) {
    return JSON.stringify(items, null, 2);
}

function cslToRISRecord(item) {
    const ty = CSL_TYPE_TO_RIS[item.type] || "GEN";
    let lines = [`TY  - ${ty}\n`];

    // Authors
    const roles = [["author", "AU"], ["editor", "ED"]];
    for (const [role, tag] of roles) {
        const people = item[role] || [];
        for (const person of people) {
            const family = person.family || "";
            const given = person.given || "";
            const name = [family, given].filter(x => x).join(", ");
            if (name) {
                lines.push(`${tag}  - ${name}\n`);
            }
        }
    }

    if (item.title) {
        lines.push(`TI  - ${item.title}\n`);
    }
    if (item["container-title"]) {
        lines.push(`JO  - ${item["container-title"]}\n`);
    }
    if (item.publisher) {
        lines.push(`PB  - ${item.publisher}\n`);
    }
    if (item["publisher-place"]) {
        lines.push(`CY  - ${item["publisher-place"]}\n`);
    }

    const issued = item.issued || {};
    let year = null;
    if (typeof issued === 'object') {
        const dateParts = issued["date-parts"];
        if (Array.isArray(dateParts) && dateParts.length > 0 && Array.isArray(dateParts[0]) && dateParts[0].length > 0) {
            year = dateParts[0][0];
        }
    }
    if (year) {
        lines.push(`PY  - ${year}\n`);
    }

    if (item.volume) {
        lines.push(`VL  - ${item.volume}\n`);
    }
    if (item.issue) {
        lines.push(`IS  - ${item.issue}\n`);
    }
    if (item.page) {
        lines.push(`SP  - ${item.page}\n`);
    }
    if (item.language) {
        lines.push(`LA  - ${item.language}\n`);
    }
    if (item.note) {
        lines.push(`N1  - ${item.note}\n`);
    }

    lines.push(`ER  - \n`);
    return lines.join('');
}

function createRIS(items) {
    return items.map(item => cslToRISRecord(item)).join('\n');
}

function createFailedEntriesText(failedEntries) {
    if (failedEntries.length === 0) {
        return null;
    }

    let text = "=".repeat(80) + "\n";
    text += "FAILED BIBLIOGRAPHY ENTRIES\n";
    text += "=".repeat(80) + "\n";
    text += `Total failed entries: ${failedEntries.length}\n`;
    text += `These entries could not be parsed by the LLM and were added as stub records.\n`;
    text += `Consider re-processing them individually or manually adding them to Zotero.\n`;
    text += "=".repeat(80) + "\n\n";

    failedEntries.forEach((entry, idx) => {
        text += `${idx + 1}. ${entry}\n\n`;
        text += "-".repeat(80) + "\n\n";
    });

    return text;
}

function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ==================== UI Event Handlers ====================

function initializeUI() {
    // Input source radio buttons
    const inputSourceRadios = document.querySelectorAll('input[name="input-source"]');
    inputSourceRadios.forEach(radio => {
        radio.addEventListener('change', () => {
            const urlInput = document.getElementById('url-input');
            const fileInput = document.getElementById('file-input');
            const textInput = document.getElementById('text-input');

            // Hide all inputs first
            urlInput.style.display = 'none';
            fileInput.style.display = 'none';
            textInput.style.display = 'none';

            // Show the selected input
            if (radio.value === 'url') {
                urlInput.style.display = 'block';
            } else if (radio.value === 'file') {
                fileInput.style.display = 'block';
            } else if (radio.value === 'text') {
                textInput.style.display = 'block';
            }
        });
    });

    // Output format radio buttons
    const outputFormatRadios = document.querySelectorAll('input[name="output-format"]');
    outputFormatRadios.forEach(radio => {
        radio.addEventListener('change', () => {
            state.outputFormat = radio.value;
            const filenameField = document.getElementById('output-filename-field');
            const currentFilename = filenameField.value;

            // Update filename extension
            if (radio.value === 'csljson') {
                filenameField.value = currentFilename.replace(/\.ris$/, '.json');
            } else {
                filenameField.value = currentFilename.replace(/\.json$/, '.ris');
            }
        });
    });

    // LLM configuration is always visible (no toggle needed)

    // Model select dropdown
    const modelSelect = document.getElementById('model-select');
    const customModelInput = document.getElementById('custom-model-input');

    modelSelect.addEventListener('change', () => {
        if (modelSelect.value === 'other') {
            customModelInput.style.display = 'block';
        } else {
            customModelInput.style.display = 'none';
        }
    });

    // File upload display
    const fileField = document.getElementById('file-field');
    fileField.addEventListener('change', () => {
        const fileLabel = document.querySelector('.file-upload-text');
        const pdfOcrOption = document.getElementById('pdf-ocr-option');

        if (fileField.files.length > 0) {
            const fileName = fileField.files[0].name;
            fileLabel.textContent = fileName;

            // Show PDF OCR option if a PDF is selected
            if (fileName.toLowerCase().endsWith('.pdf')) {
                pdfOcrOption.style.display = 'block';
            } else {
                pdfOcrOption.style.display = 'none';
            }
        } else {
            fileLabel.textContent = 'Choose file...';
            pdfOcrOption.style.display = 'none';
        }
    });

    // Process button
    const processBtn = document.getElementById('process-btn');
    processBtn.addEventListener('click', processEntries);

    // CORS modal
    const corsModal = document.getElementById('cors-modal');
    const corsLearnMore = document.getElementById('cors-learn-more');
    const corsModalClose = document.querySelector('.modal-close');

    corsLearnMore.addEventListener('click', (e) => {
        e.preventDefault();
        corsModal.style.display = 'block';
    });

    corsModalClose.addEventListener('click', () => {
        corsModal.style.display = 'none';
    });

    // About modal
    const aboutModal = document.getElementById('about-modal');
    const aboutLink = document.getElementById('about-link');
    const aboutModalClose = document.getElementById('about-modal-close');

    aboutLink.addEventListener('click', (e) => {
        e.preventDefault();
        aboutModal.style.display = 'block';
    });

    aboutModalClose.addEventListener('click', () => {
        aboutModal.style.display = 'none';
    });

    // Close modals when clicking outside
    window.addEventListener('click', (e) => {
        if (e.target === corsModal) {
            corsModal.style.display = 'none';
        }
        if (e.target === aboutModal) {
            aboutModal.style.display = 'none';
        }
    });

    // Load saved API key on startup
    const savedAPIKey = loadAPIKey();
    const apiKeyField = document.getElementById('api-key-field');
    const rememberCheckbox = document.getElementById('remember-api-key');
    const clearKeyBtn = document.getElementById('clear-api-key-btn');

    if (savedAPIKey) {
        apiKeyField.value = savedAPIKey;
        rememberCheckbox.checked = true;
        clearKeyBtn.style.display = 'inline-block';
        debug('Loaded saved API key from localStorage');
    }

    // Save/clear API key based on checkbox
    rememberCheckbox.addEventListener('change', () => {
        if (rememberCheckbox.checked) {
            const currentKey = apiKeyField.value.trim();
            if (currentKey) {
                saveAPIKey(currentKey);
                clearKeyBtn.style.display = 'inline-block';
            }
        } else {
            clearAPIKey();
            clearKeyBtn.style.display = 'none';
        }
    });

    // Save API key when it changes (if checkbox is checked)
    apiKeyField.addEventListener('input', () => {
        if (rememberCheckbox.checked) {
            const currentKey = apiKeyField.value.trim();
            if (currentKey) {
                saveAPIKey(currentKey);
                clearKeyBtn.style.display = 'inline-block';
            }
        }
    });

    // Clear API key button
    clearKeyBtn.addEventListener('click', () => {
        clearAPIKey();
        apiKeyField.value = '';
        rememberCheckbox.checked = false;
        clearKeyBtn.style.display = 'none';
        alert('Saved API key has been cleared from your browser.');
    });

    // Download buttons (will be set up after processing)
}

async function processEntries() {
    try {
        // Reset state
        state.entries = [];
        state.parsedItems = [];
        state.failedEntries = [];

        // Show progress section
        document.getElementById('progress-section').style.display = 'block';
        document.getElementById('results-section').style.display = 'none';
        document.getElementById('log-container').innerHTML = '';
        updateProgress(0, 'Initializing...');

        // Disable process button
        const processBtn = document.getElementById('process-btn');
        processBtn.disabled = true;

        // Get input source
        const inputSource = document.querySelector('input[name="input-source"]:checked').value;
        let rawText = '';

        if (inputSource === 'url') {
            let url = document.getElementById('url-field').value.trim();
            if (!url) {
                throw new Error('Please enter a URL');
            }

            // Apply CORS proxy if checkbox is checked
            const useCorsProxy = document.getElementById('use-cors-proxy').checked;
            if (useCorsProxy) {
                const corsProxy = 'https://corsproxy.io/?';
                // Only add proxy if not already present
                if (!url.startsWith(corsProxy)) {
                    url = corsProxy + url;
                    debug(`Using CORS proxy: ${url}`);
                }
            }

            updateProgress(10, 'Fetching from URL...');
            rawText = await fetchPageText(url);
        } else if (inputSource === 'file') {
            const fileField = document.getElementById('file-field');
            if (!fileField.files || fileField.files.length === 0) {
                throw new Error('Please select a file');
            }

            const file = fileField.files[0];
            const isPdf = file.name.toLowerCase().endsWith('.pdf');
            const useVisionOcr = document.getElementById('use-vision-ocr')?.checked;

            if (isPdf && useVisionOcr) {
                // Use Vision OCR for PDF
                const apiKey = document.getElementById('api-key-field').value.trim();
                if (!apiKey) {
                    throw new Error('Please enter an OpenRouter API key for Vision OCR');
                }
                const visionModel = document.getElementById('vision-model-select').value;

                updateProgress(10, 'Extracting PDF with Vision AI...');
                addLog(`Using Vision OCR with model: ${visionModel}`, 'info');

                rawText = await extractPdfWithVision(file, apiKey, visionModel, (msg) => {
                    updateProgress(15, msg);
                });

                addLog('Vision OCR extraction complete!', 'success');
            } else {
                updateProgress(10, 'Reading file...');
                rawText = await readLocalFile(file);
            }
        } else if (inputSource === 'text') {
            const textField = document.getElementById('text-field');
            rawText = textField.value.trim();
            if (!rawText) {
                throw new Error('Please paste some bibliography text');
            }
            updateProgress(10, 'Processing pasted text...');
            debug('Using pasted text input');
        }

        // Split entries
        updateProgress(20, 'Splitting entries...');
        let entries = splitEntries(rawText);
        entries = expandRepeatedAuthors(entries);

        // Apply test mode limit if enabled
        const testMode = document.getElementById('test-mode').checked;
        if (testMode) {
            entries = entries.slice(0, 10);
            debug(`Test mode enabled: Limited to 10 entries`);
            addLog('Test mode enabled: Processing only first 10 entries', 'info');
        }

        state.entries = entries;
        debug(`Total entries to process: ${entries.length}`);

        // Get LLM configuration (always required)
        const modelSelect = document.getElementById('model-select');
        let model;

        if (modelSelect.value === 'other') {
            model = document.getElementById('custom-model-field').value.trim();
            if (!model) {
                throw new Error('Please enter a custom model name');
            }
        } else {
            model = modelSelect.value;
        }

        const apiKey = document.getElementById('api-key-field').value.trim();
        const batchSize = parseInt(document.getElementById('batch-size-field').value) || 25;

        if (!apiKey) {
            throw new Error('Please enter an OpenRouter API key');
        }

        // Parse with LLM (always use OpenRouter)
        updateProgress(30, 'Parsing entries with AI...');
        const result = await batchParseWithLLM(entries, 'openrouter', model, apiKey, batchSize);
        state.parsedItems = result.items;
        state.failedEntries = result.failed;

        // ISBN enrichment if enabled
        const enrichIsbn = document.getElementById('enrich-isbn')?.checked;
        if (enrichIsbn) {
            updateProgress(90, 'Enriching books with ISBN lookup...');
            addLog('Starting ISBN/OCLC enrichment...', 'info');
            state.parsedItems = await enrichItemsWithISBN(state.parsedItems, (msg) => {
                updateProgress(92, msg);
            });
        }

        // Generate output
        updateProgress(95, 'Generating output...');
        state.outputFormat = document.querySelector('input[name="output-format"]:checked').value;
        state.outputFilename = document.getElementById('output-filename-field').value;

        // Show results
        updateProgress(100, 'Complete!');
        addLog('Processing complete!', 'success');
        showResults();

    } catch (error) {
        console.error('Error:', error);
        addLog(`Error: ${error.message}`, 'error');
        alert(`Error: ${error.message}`);
    } finally {
        // Re-enable process button
        document.getElementById('process-btn').disabled = false;
    }
}

function showResults() {
    const resultsSection = document.getElementById('results-section');
    const resultsSummary = document.getElementById('results-summary');

    // Build summary
    let summaryHTML = '<h3>Processing Summary</h3><ul>';
    summaryHTML += `<li><strong>Total entries processed:</strong> ${state.entries.length}</li>`;
    summaryHTML += `<li><strong>Successfully parsed:</strong> ${state.parsedItems.length}</li>`;
    summaryHTML += `<li><strong>Failed entries:</strong> ${state.failedEntries.length}</li>`;
    summaryHTML += `<li><strong>Output format:</strong> ${state.outputFormat.toUpperCase()}</li>`;
    summaryHTML += '</ul>';

    if (state.failedEntries.length > 0) {
        summaryHTML += '<p class="warning-text">Some entries could not be parsed and were saved as stub records. ' +
            'Click "Download Failed Entries" to review them.</p>';
    }

    resultsSummary.innerHTML = summaryHTML;

    // Set up download buttons
    const downloadBtn = document.getElementById('download-btn');
    const downloadFailedBtn = document.getElementById('download-failed-btn');

    downloadBtn.onclick = () => {
        let content;
        let mimeType;

        if (state.outputFormat === 'csljson') {
            content = createCSLJSON(state.parsedItems);
            mimeType = 'application/json';
        } else {
            content = createRIS(state.parsedItems);
            mimeType = 'application/x-research-info-systems';
        }

        downloadFile(content, state.outputFilename, mimeType);
    };

    if (state.failedEntries.length > 0) {
        downloadFailedBtn.style.display = 'inline-block';
        downloadFailedBtn.onclick = () => {
            const content = createFailedEntriesText(state.failedEntries);
            downloadFile(content, 'failed_entries.txt', 'text/plain');
        };
    } else {
        downloadFailedBtn.style.display = 'none';
    }

    // Show preview
    const previewContainer = document.getElementById('preview-container');
    const previewContent = document.getElementById('preview-content');

    if (state.parsedItems.length > 0) {
        previewContainer.style.display = 'block';
        const preview = state.parsedItems.slice(0, 5);

        if (state.outputFormat === 'csljson') {
            previewContent.textContent = JSON.stringify(preview, null, 2);
        } else {
            previewContent.textContent = preview.map(item => cslToRISRecord(item)).join('\n');
        }
    }

    resultsSection.style.display = 'block';
    resultsSection.scrollIntoView({ behavior: 'smooth' });
}

// ==================== Initialize ====================

document.addEventListener('DOMContentLoaded', () => {
    initializeUI();
    debug('Application initialized');
});
