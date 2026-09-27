import "server-only";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "./env";

const globalForS3 = globalThis as unknown as { __ankixS3?: S3Client };

export function getS3(): S3Client {
  if (!globalForS3.__ankixS3) {
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim();
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim();
    globalForS3.__ankixS3 = new S3Client({
      region: env.s3Region,
      endpoint: env.s3Endpoint,
      forcePathStyle: env.s3ForcePathStyle,
      credentials:
        accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined,
      // I provider S3-compatibili (MinIO, R2, Wasabi, Ceph…) spesso non supportano
      // i checksum CRC32 aggiunti di default dall'SDK v3: li usiamo solo se richiesti.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }
  return globalForS3.__ankixS3;
}

export function materialKey(id: string, filename: string): string {
  const safe =
    filename
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(-120) || "file";
  const prefix = env.s3Prefix ? `${env.s3Prefix}/` : "";
  return `${prefix}materials/${id}/${safe}`;
}

export function isMaterialKeyFor(id: string, key: string): boolean {
  const prefix = env.s3Prefix ? `${env.s3Prefix}/` : "";
  const expected = `${prefix}materials/${id}/`;
  return key.startsWith(expected) && !key.slice(expected.length).includes("/") && key.length > expected.length;
}

export async function presignPut(key: string, contentType: string, expiresIn = 900): Promise<string> {
  const cmd = new PutObjectCommand({ Bucket: env.s3Bucket, Key: key, ContentType: contentType });
  return getSignedUrl(getS3(), cmd, { expiresIn });
}

export async function presignGet(key: string, filename: string, expiresIn = 300): Promise<string> {
  const cmd = new GetObjectCommand({
    Bucket: env.s3Bucket,
    Key: key,
    ResponseContentDisposition: contentDisposition(filename, "inline"),
  });
  return getSignedUrl(getS3(), cmd, { expiresIn });
}

export async function putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
  await getS3().send(
    new PutObjectCommand({ Bucket: env.s3Bucket, Key: key, Body: body, ContentType: contentType }),
  );
}

export async function headObject(key: string): Promise<{ size: number } | null> {
  try {
    const res = await getS3().send(new HeadObjectCommand({ Bucket: env.s3Bucket, Key: key }));
    return { size: Number(res.ContentLength ?? 0) };
  } catch (err) {
    const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404 || status === 403) return null;
    throw err;
  }
}

export async function getObjectBytes(key: string): Promise<Uint8Array> {
  const res = await getS3().send(new GetObjectCommand({ Bucket: env.s3Bucket, Key: key }));
  if (!res.Body) throw new Error(`Empty S3 object: ${key}`);
  return res.Body.transformToByteArray();
}

/** Come getObjectBytes, ma restituisce null se l'oggetto non esiste. */
export async function getObjectBytesIfExists(key: string): Promise<Uint8Array | null> {
  try {
    return await getObjectBytes(key);
  } catch (err) {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404) return null;
    throw err;
  }
}

export async function deleteObject(key: string): Promise<void> {
  await getS3().send(new DeleteObjectCommand({ Bucket: env.s3Bucket, Key: key }));
}

/** Header Content-Disposition sicuro anche con caratteri accentati. */
export function contentDisposition(filename: string, type: "inline" | "attachment" = "attachment"): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
