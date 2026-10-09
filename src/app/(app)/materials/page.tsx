import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/current-user";
import { env } from "@/lib/env";
import { listMaterials } from "@/lib/repo";
import { MaterialsView } from "./materials-view";

export const metadata: Metadata = { title: "Materials" };
export const dynamic = "force-dynamic";

export default async function MaterialsPage() {
  const user = await getCurrentUser();
  const materials = user ? await listMaterials(user.id) : [];
  return (
    <MaterialsView
      initialMaterials={materials}
      currentUserId={user?.id ?? ""}
      maxUploadMb={Math.round(env.maxUploadBytes / 1024 / 1024)}
    />
  );
}
