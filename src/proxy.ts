import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getAuthState } from "@/lib/supabase/authState";

const PUBLIC_PATHS = ["/login", "/signup", "/invite", "/offline"];
const BACKEND_TIMEOUT_MS = 4000;
/** Tells pages the backend was unreachable, so they don't wait on it a second time. */
const AUTH_STATE_HEADER = "x-coachly-auth";

/** Refreshes the Supabase session cookie and sends signed-out users to /login. */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(BACKEND_TIMEOUT_MS) }) },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          Object.entries(headers ?? {}).forEach(([k, v]) => response.headers.set(k, v));
        },
      },
    },
  );

  const auth = await getAuthState(supabase);
  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + "/"));

  // If the auth server is unreachable, let the page render its "reconnecting" state
  // rather than bouncing a signed-in user to the login screen.
  if (auth.kind === "signed-out" && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = path === "/" ? "" : `?next=${encodeURIComponent(path)}`;
    return NextResponse.redirect(url);
  }
  if (auth.kind === "unavailable") {
    const headers = new Headers(request.headers);
    headers.set(AUTH_STATE_HEADER, "unavailable");
    return NextResponse.next({ request: { headers } });
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|icon|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
