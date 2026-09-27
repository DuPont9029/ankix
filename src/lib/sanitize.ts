import "server-only";
import sanitizeHtml from "sanitize-html";

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "b", "strong", "i", "em", "u", "s", "sub", "sup", "br", "p", "ul", "ol", "li",
    "code", "mark", "small", "span", "table", "thead", "tbody", "tr", "th", "td",
  ],
  allowedAttributes: {},
  disallowedTagsMode: "discard",
};

/** HTML consentito nei campi delle card: solo formattazione, nessun attributo/script. */
export function sanitizeField(value: string): string {
  return sanitizeHtml(value.trim(), OPTIONS).trim();
}

/** Tag Anki: niente spazi, gerarchie con "::". */
export function sanitizeTag(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^\p{L}\p{N}_:\-.]/gu, "")
    .replace(/:{3,}/g, "::")
    .replace(/^:+|:+$/g, "")
    .slice(0, 80);
}

export function sanitizeTags(values: string[]): string[] {
  return [...new Set(values.map(sanitizeTag).filter(Boolean))].slice(0, 12);
}
