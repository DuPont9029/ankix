// S3 in memoria (path-style) per l'ambiente isolato del trailer: PUT/GET/HEAD/DELETE + CORS.
import http from "node:http";
import { createHash } from "node:crypto";

const PORT = +(process.env.PORT || 9100);
const store = new Map(); // "bucket/key" -> { body, type, etag }

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, HEAD, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Expose-Headers": "ETag",
};

http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const path = decodeURIComponent(url.pathname.slice(1));
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      if (req.method === "OPTIONS") return res.writeHead(204, cors).end();
      const obj = store.get(path);
      if (req.method === "PUT") {
        const body = Buffer.concat(chunks);
        const etag = `"${createHash("md5").update(body).digest("hex")}"`;
        store.set(path, { body, type: req.headers["content-type"] || "application/octet-stream", etag });
        console.log(`PUT ${path} (${body.length} B)`);
        return res.writeHead(200, { ...cors, ETag: etag }).end();
      }
      if (req.method === "DELETE") {
        store.delete(path);
        return res.writeHead(204, cors).end();
      }
      if (req.method === "GET" || req.method === "HEAD") {
        if (!obj) {
          const xml = `<?xml version="1.0" encoding="UTF-8"?><Error><Code>NoSuchKey</Code><Message>The specified key does not exist.</Message><Key>${path}</Key></Error>`;
          return res.writeHead(404, { ...cors, "Content-Type": "application/xml" }).end(req.method === "HEAD" ? undefined : xml);
        }
        const disp = url.searchParams.get("response-content-disposition");
        res.writeHead(200, {
          ...cors,
          "Content-Type": url.searchParams.get("response-content-type") || obj.type,
          "Content-Length": obj.body.length,
          ETag: obj.etag,
          "Last-Modified": new Date().toUTCString(),
          ...(disp ? { "Content-Disposition": disp } : {}),
        });
        return res.end(req.method === "HEAD" ? undefined : obj.body);
      }
      res.writeHead(405, cors).end();
    });
  })
  .listen(PORT, "127.0.0.1", () => console.log(`mock S3 on :${PORT}`));
