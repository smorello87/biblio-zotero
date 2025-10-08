#!/usr/bin/env python3
"""
Convert bibliographic entries from an Omeka website or local file into Zotero‑importable formats (CSL‑JSON or RIS).

USAGE EXAMPLES
--------------
# Interactive mode (recommended)
python omeka_bib_to_zotero.py

# From URL (CSL‑JSON)
python omeka_bib_to_zotero.py \
  --url https://italianamericanimprints.omeka.net/actual-bibliography \
  --out zotero_bibliography.json --format csljson

# From local file (txt or docx)
python omeka_bib_to_zotero.py \
  --file bibliography.txt \
  --out zotero_bibliography.json --format csljson

# With LLM parsing via OpenAI
OPENAI_API_KEY=sk-... python omeka_bib_to_zotero.py \
  --file bibliography.txt \
  --use-llm openai --model gpt-4o-mini \
  --out zotero_bibliography.json --format csljson

# With LLM parsing via OpenRouter
OPENROUTER_API_KEY=... python omeka_bib_to_zotero.py \
  --url https://italianamericanimprints.omeka.net/actual-bibliography \
  --use-llm openrouter --model openrouter/anthropic/claude-3.5-sonnet \
  --out zotero_bibliography.json --format csljson

# Create RIS instead (also usable by Zotero)
python omeka_bib_to_zotero.py --file bibliography.docx --format ris --out zotero_bibliography.ris

NOTES
-----
• Supports input from URLs (web scraping) or local files (.txt, .docx)
• If you don't provide an API key/LLM, the script will still fetch & split the bibliography into entries and
  produce a very minimal CSL‑JSON/RIS where each citation is preserved verbatim in the `title` field
  (so you can import now and refine later). For high‑quality structured fields (authors, year, title, etc.),
  enable LLM parsing with your OpenAI or OpenRouter key.
• The script expands author ditto marks (e.g., "______.") and em-dashes (———) by repeating the previous author.
• Output files: main output (json/ris) + `failed_entries.txt` for any entries that could not be parsed by the LLM.
• Dependencies: requests, beautifulsoup4, python-docx (optional, for .docx support)

ZOTERO FORMATS
--------------
Zotero can import CSL‑JSON and RIS among other formats. See: https://www.zotero.org/support/kb/importing_standardized_formats

"""
from __future__ import annotations
import argparse
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import List, Dict, Any, Optional

import requests
from bs4 import BeautifulSoup

DEFAULT_URL = "https://italianamericanimprints.omeka.net/actual-bibliography"

# Try to import python-docx for Word file support
try:
    from docx import Document
    DOCX_AVAILABLE = True
except ImportError:
    DOCX_AVAILABLE = False

# -------------- Utilities --------------

def debug(msg: str):
    sys.stderr.write(f"[debug] {msg}\n")


def read_text_file(file_path: str) -> str:
    """Read content from a .txt file."""
    with open(file_path, 'r', encoding='utf-8') as f:
        return f.read()


def read_docx_file(file_path: str) -> str:
    """Read content from a .docx file."""
    if not DOCX_AVAILABLE:
        raise ImportError("python-docx not installed. Install with: pip install python-docx")

    doc = Document(file_path)
    paragraphs = [para.text for para in doc.paragraphs if para.text.strip()]
    return '\n\n'.join(paragraphs)


def read_local_file(file_path: str) -> str:
    """Read content from a local txt or docx file."""
    path = Path(file_path)

    if not path.exists():
        raise FileNotFoundError(f"File not found: {file_path}")

    suffix = path.suffix.lower()

    if suffix == '.txt':
        return read_text_file(file_path)
    elif suffix in ['.docx', '.doc']:
        if suffix == '.doc':
            debug("Warning: .doc format requires conversion. Use .docx if possible.")
        return read_docx_file(file_path)
    else:
        raise ValueError(f"Unsupported file format: {suffix}. Use .txt or .docx")


def fetch_page_text(url: str) -> str:
    """Fetch page HTML and return text beginning at the Bibliography heading.
    Tries to be robust across Omeka Classic themes.
    """
    r = requests.get(url, timeout=30)
    r.raise_for_status()
    html = r.text
    soup = BeautifulSoup(html, "html.parser")

    # Try to find the H1 heading containing 'Bibliography'
    h1 = None
    for tag in soup.find_all(["h1", "h2", "h3"]):
        if tag.get_text(strip=True).lower() == "bibliography":
            h1 = tag
            break
    if h1:
        texts = []
        # Collect following siblings until next heading of same/higher level
        for sib in h1.next_siblings:
            if getattr(sib, "name", None) in {"h1", "h2"}:
                break
            # Collect paragraphs and plain strings
            if hasattr(sib, "get_text"):
                t = sib.get_text("\n", strip=False)
            else:
                t = str(sib)
            if t:
                texts.append(t)
        candidate = "\n".join(texts).strip()
        if candidate:
            return candidate

    # Fallback: use full page text and slice from first 'Bibliography' occurrence
    full = soup.get_text("\n", strip=False)
    m = re.search(r"^\s*Bibliography\s*$", full, flags=re.IGNORECASE | re.MULTILINE)
    if m:
        return full[m.end():].strip()
    return full.strip()


def split_entries(raw_text: str) -> List[str]:
    """
    Split into individual bibliographic entries with improved handling
    of line breaks within entries.

    Improvements over original:
    - Uses the natural triple-newline separators from HTML
    - Preserves line breaks within entries by joining them with spaces
    - More robust filtering of non-entry text
    """
    # Normalize line endings and non-breaking spaces
    text = raw_text.replace('\xa0', ' ')  # Non-breaking space to regular space
    text = re.sub(r'\r\n?', '\n', text)  # Normalize line endings

    # The HTML source uses triple newlines to separate entries
    # Each entry may have internal line breaks (single or double newlines)
    # So we split on triple newlines and join internal lines with spaces
    raw_blocks = re.split(r'\n\n\n+', text)

    entries = []
    for block in raw_blocks:
        block = block.strip()
        if not block:
            continue

        # Join lines within this block with spaces and collapse whitespace
        entry_text = re.sub(r'\s+', ' ', block).strip()

        # Filter out obvious non-entries
        if entry_text.lower().startswith("search using this query type"):
            continue
        if re.match(r'^(home|about|browse|search|contact|map|essays?|collections?)(\s|$)', entry_text, re.IGNORECASE):
            continue
        # Skip very short blocks that don't look like citations
        if len(entry_text) < 20 and not re.search(r'\d{4}', entry_text):
            continue

        entries.append(entry_text)

    return entries


def expand_repeated_authors(entries: List[str]) -> List[str]:
    """
    Replace author ditto marks with the previous author name.

    Improvements over original:
    - Correctly extracts only the author name (not accumulated years)
    - Handles various author name formats
    - More robust pattern matching
    """
    out = []
    prev_author: Optional[str] = None

    for e in entries:
        # Detect ditto markers at start
        ditto_match = re.match(r'^(_{3,}|—{2,}|—)\.?\s', e)
        if ditto_match:
            if prev_author:
                # Replace ditto with previous author name
                e = re.sub(r'^(_{3,}|—{2,}|—)\.?', prev_author + '.', e, count=1)

        # Update prev_author for next iteration
        # Try multiple patterns to extract author name:

        # Pattern 1: "Surname, Given [middle]. YEAR" (most common)
        m = re.match(r'^([A-Z][a-zA-Z\'\-]+(?:\s+[A-Z]\.?)?,\s+[A-Z][a-zA-Z\.\s\-]+?)\.\s+[\[\d]', e)
        if m:
            prev_author = m.group(1).strip()
        else:
            # Pattern 2: "Surname, Given [pseudonym]." (with brackets)
            m = re.match(r'^([^\.]+?)\s*\[[^\]]+\]\.\s+[\d\[]', e)
            if m:
                prev_author = m.group(1).strip()
            else:
                # Pattern 3: Simple "Surname, Given."
                m = re.match(r'^([A-Z][^\.]+)\.\s+', e)
                if m:
                    # Make sure we didn't capture the year
                    candidate = m.group(1).strip()
                    # Remove year if present (e.g., "Surname, Given 1940a" -> "Surname, Given")
                    candidate = re.sub(r'\s+\d{4}[a-z]?$', '', candidate)
                    prev_author = candidate

        out.append(e)

    return out

# -------------- LLM parsing --------------

LLM_SYSTEM_PROMPT = (
    "You convert free-text bibliographic entries (English/Italian) into CSL-JSON items that Zotero can import. "
    "Return ONLY valid JSON with no commentary. If data is missing, omit the field. "
    "Always set a plausible 'type' (e.g., 'book', 'chapter', 'article-journal', 'article-magazine', 'thesis', 'pamphlet', 'manuscript', 'report'). "
    "Map editors to the 'editor' array, and authors to the 'author' array with objects {\"family\", \"given\"}. "
    "For dates like '1940a' set issued.date-parts to [[1940]] and put the suffix 'a' into 'note' (e.g., 'year-suffix: a'). "
    "For bracketed/uncertain dates like '[1903]' or 'n.d.' use the best available year in 'issued' when possible and add a clarifying note. "
    "Use 'publisher' and 'publisher-place' for books; 'container-title', 'volume', 'issue', 'page' for articles; use 'title' for work title. "
    "Keep diacritics; don't invent DOIs/URLs. If multiple places/publishers are separated by ';', you may keep the first and add the rest to 'note'."
)

LLM_USER_TEMPLATE = (
    "Convert the following bibliographic entries into CSL-JSON. Return a JSON object with an 'items' key containing an array of CSL-JSON objects, in the SAME order as the input.\n\n"
    "Entries:\n{entries}\n\n"
    "Your response must be in this format:\n"
    "{{\n  \"items\": [\n    {{\n      \"type\": \"book\",\n      \"title\": \"...\",\n      \"author\": [{{\"family\": \"...\", \"given\": \"...\"}}],\n      \"editor\": [...],\n      \"issued\": {{\"date-parts\": [[1999]]}},\n      \"publisher\": \"...\",\n      \"publisher-place\": \"...\",\n      \"container-title\": \"...\",\n      \"volume\": \"...\",\n      \"issue\": \"...\",\n      \"page\": \"...\",\n      \"language\": \"it\"\n    }}\n  ]\n}}"
)


def call_openai_chat(model: str, messages: List[Dict[str, str]], api_key: str) -> str:
    url = "https://api.openai.com/v1/chat/completions"
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {
        "model": model,
        "messages": messages,
        "temperature": 0,
        "response_format": {"type": "json_object"}
    }

    # Retry with exponential backoff
    max_retries = 3
    base_delay = 2

    for attempt in range(max_retries):
        try:
            r = requests.post(url, headers=headers, json=payload, timeout=180)
            r.raise_for_status()
            data = r.json()
            return data["choices"][0]["message"]["content"]
        except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as e:
            if attempt < max_retries - 1:
                delay = base_delay * (2 ** attempt)  # Exponential backoff: 2s, 4s, 8s
                debug(f"Request timeout/connection error (attempt {attempt + 1}/{max_retries}), retrying in {delay}s...")
                time.sleep(delay)
            else:
                raise
        except requests.exceptions.HTTPError as e:
            # Rate limit errors (429) should be retried
            if e.response.status_code == 429 and attempt < max_retries - 1:
                delay = base_delay * (2 ** attempt)
                debug(f"Rate limit hit (attempt {attempt + 1}/{max_retries}), retrying in {delay}s...")
                time.sleep(delay)
            else:
                raise


def call_openrouter_chat(model: str, messages: List[Dict[str, str]], api_key: str) -> str:
    url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {
        "model": model,
        "messages": messages,
        "temperature": 0,
        "response_format": {"type": "json_object"}
    }

    # Retry with exponential backoff
    max_retries = 3
    base_delay = 2

    for attempt in range(max_retries):
        try:
            r = requests.post(url, headers=headers, json=payload, timeout=180)
            r.raise_for_status()
            data = r.json()
            return data["choices"][0]["message"]["content"]
        except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as e:
            if attempt < max_retries - 1:
                delay = base_delay * (2 ** attempt)  # Exponential backoff: 2s, 4s, 8s
                debug(f"Request timeout/connection error (attempt {attempt + 1}/{max_retries}), retrying in {delay}s...")
                time.sleep(delay)
            else:
                raise
        except requests.exceptions.HTTPError as e:
            # Rate limit errors (429) should be retried
            if e.response.status_code == 429 and attempt < max_retries - 1:
                delay = base_delay * (2 ** attempt)
                debug(f"Rate limit hit (attempt {attempt + 1}/{max_retries}), retrying in {delay}s...")
                time.sleep(delay)
            else:
                raise


def batch_parse_with_llm(entries: List[str], provider: Optional[str], model: Optional[str], batch_size: int = 25) -> List[Dict[str, Any]]:
    """Return a list of CSL-JSON dicts; entries that fail parsing fall back to a minimal stub."""
    results: List[Dict[str, Any]] = []
    failed: List[str] = []

    if not provider or not model:
        # Minimal stub parse
        for e in entries:
            results.append({
                "type": "manuscript",
                "title": e,
                "note": "Raw citation preserved in title; enable --use-llm to parse into structured fields."
            })
        return results

    if provider == "openai":
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise SystemExit("OPENAI_API_KEY not set")
        caller = lambda msgs: call_openai_chat(model, msgs, api_key)
    elif provider == "openrouter":
        api_key = os.getenv("OPENROUTER_API_KEY")
        if not api_key:
            raise SystemExit("OPENROUTER_API_KEY not set")
        caller = lambda msgs: call_openrouter_chat(model, msgs, api_key)
    else:
        raise SystemExit("--use-llm must be one of: openai, openrouter")

    for i in range(0, len(entries), batch_size):
        batch = entries[i:i+batch_size]
        content = LLM_USER_TEMPLATE.format(entries="\n".join(f"- {x}" for x in batch))
        messages = [
            {"role": "system", "content": LLM_SYSTEM_PROMPT},
            {"role": "user", "content": content}
        ]
        try:
            raw = caller(messages)
            parsed = json.loads(raw)

            # Try different possible response structures
            items = None
            if isinstance(parsed, list):
                items = parsed
            elif isinstance(parsed, dict):
                # Try common key names
                for key in ["items", "output", "bibliography", "entries", "data", "results"]:
                    if key in parsed and isinstance(parsed[key], list):
                        items = parsed[key]
                        break
                # If still no items found, check if the dict itself contains the expected fields
                if items is None:
                    # Maybe the response is wrapped in a single key - try to get any list value
                    for value in parsed.values():
                        if isinstance(value, list) and value:
                            items = value
                            break

            if not isinstance(items, list):
                debug(f"Raw LLM response structure: {list(parsed.keys()) if isinstance(parsed, dict) else type(parsed).__name__}")
                debug(f"First 200 chars of raw response: {raw[:200]}")
                raise ValueError("Unexpected JSON structure from LLM")

            # Handle batch size mismatches
            if len(items) != len(batch):
                if len(items) < len(batch):
                    # LLM returned fewer items than expected
                    debug(f"Warning: LLM returned {len(items)} items for a batch of {len(batch)}")
                    # Add the items we got
                    results.extend(items)
                    # Create stubs for missing entries
                    missing_count = len(batch) - len(items)
                    debug(f"Creating stub records for {missing_count} missing entries")
                    for j in range(len(items), len(batch)):
                        failed.append(batch[j])
                        results.append({
                            "type": "manuscript",
                            "title": batch[j],
                            "note": "LLM returned incomplete batch; raw citation preserved in title. Consider re-processing individually."
                        })
                else:
                    # LLM returned more items than expected (truncate)
                    debug(f"Warning: LLM returned {len(items)} items for a batch of {len(batch)}; truncating to match.")
                    results.extend(items[:len(batch)])
            else:
                # Perfect match
                results.extend(items)

        except Exception as exc:
            debug(f"LLM parse failed for batch {i}-{i+len(batch)-1}: {exc}")
            failed.extend(batch)
            for e in batch:
                results.append({
                    "type": "manuscript",
                    "title": e,
                    "note": "LLM parse failed; raw citation placed in title."
                })
        time.sleep(1.0)  # Increased from 0.7s to reduce rate limiting

    if failed:
        # Write failed entries to a detailed file
        with open("failed_entries.txt", "w", encoding="utf-8") as fh:
            fh.write("=" * 80 + "\n")
            fh.write("FAILED BIBLIOGRAPHY ENTRIES\n")
            fh.write("=" * 80 + "\n")
            fh.write(f"Total failed entries: {len(failed)}\n")
            fh.write(f"These entries could not be parsed by the LLM and were added as stub records.\n")
            fh.write(f"Consider re-processing them individually or manually adding them to Zotero.\n")
            fh.write("=" * 80 + "\n\n")

            for idx, entry in enumerate(failed, 1):
                fh.write(f"{idx}. {entry}\n\n")
                fh.write("-" * 80 + "\n\n")

        debug(f"Wrote {len(failed)} failed entries to failed_entries.txt")

    return results

# -------------- Output Writers --------------

def write_csl_json(items: List[Dict[str, Any]], out_path: str):
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(items, fh, ensure_ascii=False, indent=2)


# Minimal RIS mapper — expects reasonably-structured CSL JSON
CSL_TYPE_TO_RIS = {
    "book": "BOOK",
    "chapter": "CHAP",
    "article-journal": "JOUR",
    "article-magazine": "MGZN",
    "article-newspaper": "NEWS",
    "thesis": "THES",
    "report": "RPRT",
    "manuscript": "MANU",
    "pamphlet": "PAMP",
}


def _ris_line(tag: str, value: str) -> str:
    return f"{tag}  - {value}\n"


def csl_to_ris_record(item: Dict[str, Any]) -> str:
    ty = CSL_TYPE_TO_RIS.get(item.get("type", ""), "GEN")
    lines = [_ris_line("TY", ty)]

    # Authors
    for role, tag in (("author", "AU"), ("editor", "ED")):
        for p in item.get(role, []) or []:
            fam = p.get("family") or ""
            giv = p.get("given") or ""
            name = ", ".join([x for x in (fam, giv) if x])
            if name:
                lines.append(_ris_line(tag, name))

    if item.get("title"):
        lines.append(_ris_line("TI", item["title"]))
    if item.get("container-title"):
        lines.append(_ris_line("JO", item["container-title"]))
    if item.get("publisher"):
        lines.append(_ris_line("PB", item["publisher"]))
    if item.get("publisher-place"):
        lines.append(_ris_line("CY", item["publisher-place"]))

    issued = item.get("issued", {})
    year = None
    if isinstance(issued, dict):
        dps = issued.get("date-parts")
        if isinstance(dps, list) and dps and isinstance(dps[0], list) and dps[0]:
            year = dps[0][0]
    if year:
        lines.append(_ris_line("PY", str(year)))

    if item.get("volume"):
        lines.append(_ris_line("VL", str(item["volume"])))
    if item.get("issue"):
        lines.append(_ris_line("IS", str(item["issue"])))
    if item.get("page"):
        lines.append(_ris_line("SP", str(item["page"])))

    if item.get("language"):
        lines.append(_ris_line("LA", item["language"]))
    if item.get("note"):
        lines.append(_ris_line("N1", item["note"]))

    lines.append(_ris_line("ER", ""))
    return "".join(lines)


def write_ris(items: List[Dict[str, Any]], out_path: str):
    with open(out_path, "w", encoding="utf-8") as fh:
        for it in items:
            fh.write(csl_to_ris_record(it))

# -------------- Interactive prompts --------------

def prompt_input_source() -> tuple[str, Optional[str]]:
    """Prompt for input source (URL or local file)."""
    print("\nChoose input source:")
    print("  1. URL (web scraping)")
    print("  2. Local file (.txt or .docx)")
    choice = input("Enter choice (1 or 2): ").strip()

    if choice == "2":
        # Local file
        print("\nEnter the path to your bibliography file:")
        print("Supported formats: .txt, .docx")
        file_path = input("File path: ").strip()
        return ("file", file_path)
    else:
        # URL
        default = DEFAULT_URL
        print(f"\nEnter source URL (press Enter for default):")
        print(f"Default: {default}")
        user_input = input("URL: ").strip()
        url = user_input if user_input else default
        return ("url", url)


def prompt_output_format() -> str:
    """Prompt for output format."""
    print("\nChoose output format:")
    print("  1. CSL-JSON (default, recommended for Zotero)")
    print("  2. RIS")
    choice = input("Enter choice (1 or 2): ").strip()
    return "ris" if choice == "2" else "csljson"


def prompt_output_file(fmt: str) -> str:
    """Prompt for output file path."""
    default_ext = ".json" if fmt == "csljson" else ".ris"
    default_name = f"zotero_bibliography{default_ext}"
    print(f"\nEnter output file path (press Enter for default):")
    print(f"Default: {default_name}")
    user_input = input("Output file: ").strip()
    return user_input if user_input else default_name


def prompt_use_llm() -> Optional[str]:
    """Prompt whether to use LLM parsing."""
    print("\nUse LLM for structured parsing? (improves quality)")
    print("  1. No LLM (basic extraction, raw text in notes)")
    print("  2. OpenAI")
    print("  3. OpenRouter")
    choice = input("Enter choice (1, 2, or 3): ").strip()
    if choice == "2":
        return "openai"
    elif choice == "3":
        return "openrouter"
    else:
        return None


def prompt_model(provider: Optional[str]) -> Optional[str]:
    """Prompt for model name based on provider."""
    if not provider:
        return None

    if provider == "openai":
        default = "gpt-4o-mini"
        print(f"\nEnter OpenAI model name (press Enter for default):")
        print(f"Default: {default}")
        print("Options: gpt-4o-mini, gpt-4o, gpt-3.5-turbo, etc.")
    else:  # openrouter
        default = "openrouter/anthropic/claude-3.5-sonnet"
        print(f"\nEnter OpenRouter model name (press Enter for default):")
        print(f"Default: {default}")
        print("Options: openrouter/anthropic/claude-3.5-sonnet, openrouter/openai/gpt-4o, etc.")

    user_input = input("Model: ").strip()
    return user_input if user_input else default


def prompt_api_key(provider: Optional[str]) -> Optional[str]:
    """Prompt for API key if not set in environment."""
    if not provider:
        return None

    env_var = "OPENAI_API_KEY" if provider == "openai" else "OPENROUTER_API_KEY"
    existing = os.getenv(env_var)

    if existing:
        print(f"\n{env_var} already set in environment.")
        use_existing = input("Use existing key? (Y/n): ").strip().lower()
        if use_existing != "n":
            return existing

    print(f"\nEnter {env_var}:")
    return input("API Key: ").strip()


def prompt_max_entries() -> Optional[int]:
    """Prompt for max entries (for testing)."""
    print("\nLimit number of entries to process? (useful for testing)")
    print("Press Enter to process all entries")
    user_input = input("Max entries: ").strip()
    if user_input:
        try:
            return int(user_input)
        except ValueError:
            print("Invalid number, processing all entries")
    return None


# -------------- Main --------------

def main():
    ap = argparse.ArgumentParser(description="Convert Omeka bibliography page or local file to Zotero-importable file.")
    ap.add_argument("--url", default=None, help="Source URL (Omeka bibliography page)")
    ap.add_argument("--file", default=None, help="Local file path (.txt or .docx)")
    ap.add_argument("--out", default=None, help="Output file path (e.g., zotero_bibliography.json / .ris)")
    ap.add_argument("--format", choices=["csljson", "ris"], default=None, help="Output format (default: csljson)")
    ap.add_argument("--use-llm", choices=["openai", "openrouter"], default=None, help="Use an LLM to parse entries into structured fields")
    ap.add_argument("--model", default=None, help="Model name for the chosen LLM provider")
    ap.add_argument("--max", type=int, default=None, help="Process only the first N entries (for testing)")
    args = ap.parse_args()

    # Determine input source
    if args.url:
        source_type = "url"
        source_path = args.url
    elif args.file:
        source_type = "file"
        source_path = args.file
    else:
        # Interactive prompt for input source
        source_type, source_path = prompt_input_source()

    fmt = args.format or prompt_output_format()
    out_path = args.out or prompt_output_file(fmt)
    provider = args.use_llm if args.use_llm is not None else prompt_use_llm()
    model = args.model or prompt_model(provider)

    # Handle API key
    if provider:
        api_key = prompt_api_key(provider)
        if api_key:
            env_var = "OPENAI_API_KEY" if provider == "openai" else "OPENROUTER_API_KEY"
            os.environ[env_var] = api_key

    max_entries = args.max if args.max is not None else prompt_max_entries()

    # Fetch content based on source type
    if source_type == "url":
        debug(f"Fetching bibliography from {source_path}")
        raw = fetch_page_text(source_path)
    else:  # file
        debug(f"Reading bibliography from file: {source_path}")
        raw = read_local_file(source_path)

    debug("Splitting into entries…")
    entries = split_entries(raw)
    entries = expand_repeated_authors(entries)

    if max_entries:
        entries = entries[:max_entries]

    debug(f"Total entries: {len(entries)}")

    items = batch_parse_with_llm(entries, provider=provider, model=model)

    if fmt == "csljson":
        write_csl_json(items, out_path)
    else:
        write_ris(items, out_path)

    debug(f"Wrote {len(items)} items to {out_path}")


if __name__ == "__main__":
    main()
