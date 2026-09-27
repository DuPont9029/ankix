import { NextResponse } from "next/server";
import { handle, HttpError, requireUser } from "@/lib/http";
import { MaterialMeta, validateFile } from "@/lib/materials";
import { insertMaterial, newId } from "@/lib/repo";
import { materialKey, putObject } from "@/lib/s3";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Caricamento tramite server: usato come alternativa se il bucket non consente CORS dal browser.
export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new HttpError(400, "Invalid upload request.");
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "No file received.");
  const meta = MaterialMeta.parse({ title: form.get("title"), subject: form.get("subject") });
  const mimeType = validateFile(file.name, file.type, file.size);

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength !== file.size) throw new HttpError(400, "The file arrived incomplete. Please try again.");

  const id = newId();
  const key = materialKey(id, file.name);
  await putObject(key, bytes, mimeType);

  const material = {
    id,
    title: meta.title,
    subject: meta.subject,
    filename: file.name,
    mimeType,
    sizeBytes: bytes.byteLength,
    uploadedBy: user.name,
    uploadedById: user.id,
    createdAt: Date.now(),
    s3Key: key,
  };
  await insertMaterial(material);
  const { s3Key: _key, ...publicMaterial } = material;
  void _key;
  return NextResponse.json({ material: publicMaterial }, { status: 201 });
});
