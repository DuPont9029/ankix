// Sanificazione lato browser per le anteprime (stessa whitelist del server).
const ALLOWED = new Set([
  "B", "STRONG", "I", "EM", "U", "S", "SUB", "SUP", "BR", "P", "UL", "OL", "LI",
  "CODE", "MARK", "SMALL", "SPAN", "TABLE", "THEAD", "TBODY", "TR", "TH", "TD",
]);
const DROP_WITH_CONTENT = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "TEMPLATE", "NOSCRIPT", "SVG", "MATH"]);

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function walk(node: Node): string {
  let out = "";
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      out += escapeText(child.textContent ?? "");
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const tag = (child as Element).tagName.toUpperCase();
      if (DROP_WITH_CONTENT.has(tag)) return;
      const inner = walk(child);
      if (!ALLOWED.has(tag)) {
        out += inner;
      } else if (tag === "BR") {
        out += "<br>";
      } else {
        const t = tag.toLowerCase();
        out += `<${t}>${inner}</${t}>`;
      }
    }
  });
  return out;
}

export function sanitizeClient(html: string): string {
  if (typeof window === "undefined") return escapeText(html);
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  return walk(doc.body);
}
