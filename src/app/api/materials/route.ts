import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, HttpError, readJson, requireUser } from "@/lib/http";
import { MaterialMeta, validateFile } from "@/lib/materials";
import { getMaterial, insertMaterial, listMaterials } from "@/lib/repo";
import { headObject, isMaterialKeyFor } from "@/lib/s3";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const user = await requireUser();
  return NextResponse.json({ materials: await listMaterials(user.id) });
});

const FinalizeBody = MaterialMeta.extend({
  id: z.uuid(),
  key: z.string().min(1).max(512),
  filename: z.string().trim().min(1).max(255),
  mimeType: z.string().max(100),
});

// Registra un materiale dopo il caricamento diretto su S3 tramite URL prefirmato.
export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const body = FinalizeBody.parse(await readJson(req));
  if (!isMaterialKeyFor(body.id, body.key)) throw new HttpError(400, "Invalid file key.");
  if (await getMaterial(body.id)) throw new HttpError(409, "Material already registered.");

  const head = await headObject(body.key);
  if (!head) throw new HttpError(400, "The file was not found in the bucket. Please upload it again.");
  const mimeType = validateFile(body.filename, body.mimeType, head.size);

  const material = {
    id: body.id,
    title: body.title,
    subject: body.subject,
    filename: body.filename,
    mimeType,
    sizeBytes: head.size,
    uploadedBy: user.name,
    uploadedById: user.id,
    isPublic: body.isPublic,
    createdAt: Date.now(),
    s3Key: body.key,
  };
  await insertMaterial(material);
  const { s3Key: _key, ...publicMaterial } = material;
  void _key;
  return NextResponse.json({ material: publicMaterial }, { status: 201 });
});
