import { getAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const GET = (request: Request) => getAuth().handler(request);
export const POST = (request: Request) => getAuth().handler(request);
