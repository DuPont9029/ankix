import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

// Controllo "ottimistico" della presenza del cookie di sessione: la validazione vera
// (firma, scadenza, dominio email, codice di classe) avviene nelle pagine e nelle API.
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (pathname === "/login" || pathname.startsWith("/api/auth/")) return NextResponse.next();
  if (getSessionCookie(request)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Your session has expired: please sign in again." }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  if (pathname !== "/") url.searchParams.set("next", pathname + search);
  return NextResponse.redirect(url);
}

export const config = {
  // Gli upload (materiali e registrazioni degli esami) sono esclusi: il proxy bufferizza (e tronca oltre 10 MB) il body delle richieste.
  // Le route verificano comunque la sessione autonomamente, come tutte le API.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|logo.svg|robots.txt|api/materials/upload|api/exams/transcribe).*)"],
};
