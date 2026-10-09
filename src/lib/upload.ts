"use client";

import { ApiClientError, api } from "./client";
import type { Material } from "./types";

type XhrResult = { status: number; body: string };

function xhr(
  method: string,
  url: string,
  body: XMLHttpRequestBodyInit,
  headers: Record<string, string>,
  onProgress: (fraction: number) => void,
): Promise<XhrResult> {
  return new Promise((resolve) => {
    const req = new XMLHttpRequest();
    req.open(method, url);
    for (const [k, v] of Object.entries(headers)) req.setRequestHeader(k, v);
    req.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    req.onload = () => resolve({ status: req.status, body: req.responseText });
    req.onerror = () => resolve({ status: 0, body: "" });
    req.onabort = () => resolve({ status: 0, body: "" });
    req.send(body);
  });
}

function parseError(body: string, status: number): string {
  try {
    const data = JSON.parse(body) as { error?: string };
    if (data.error) return data.error;
  } catch {
    /* risposta non JSON */
  }
  if (status === 413) return "File too large for the server.";
  return status === 0 ? "Connection lost during the upload." : `Upload failed (error ${status}).`;
}

/**
 * Carica un file direttamente sul bucket S3 con URL prefirmato; se il bucket
 * non accetta la richiesta dal browser (es. CORS non configurato) ripiega sul caricamento via server.
 */
export async function uploadMaterial(
  file: File,
  meta: { title: string; subject: string; isPublic: boolean },
  onProgress: (fraction: number) => void,
): Promise<Material> {
  const presign = await api<{ id: string; key: string; url: string; contentType: string }>("/api/materials/presign", {
    method: "POST",
    json: { filename: file.name, mimeType: file.type, size: file.size },
  });

  const direct = await xhr("PUT", presign.url, file, { "Content-Type": presign.contentType }, onProgress);
  if (direct.status >= 200 && direct.status < 300) {
    const { material } = await api<{ material: Material }>("/api/materials", {
      method: "POST",
      json: { id: presign.id, key: presign.key, filename: file.name, mimeType: presign.contentType, ...meta },
    });
    return material;
  }

  console.warn(`[upload] direct upload to S3 failed (status ${direct.status}), falling back to the server.`);
  onProgress(0);
  const form = new FormData();
  form.append("file", file);
  form.append("title", meta.title);
  form.append("subject", meta.subject);
  form.append("isPublic", String(meta.isPublic));
  const viaServer = await xhr("POST", "/api/materials/upload", form, {}, onProgress);
  if (viaServer.status === 201) {
    return (JSON.parse(viaServer.body) as { material: Material }).material;
  }
  throw new ApiClientError(viaServer.status, parseError(viaServer.body, viaServer.status));
}
