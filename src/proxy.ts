import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Defense-in-depth CORS for the Capacitor Android shell calling these routes
// cross-origin (see src/lib/apiUrl.ts). The primary mechanism that makes
// cross-origin auth/cookies work is Capacitor's CapacitorHttp/CapacitorCookies
// bridge (capacitor.config.ts) - it routes requests through native networking,
// which isn't subject to browser CORS/SameSite rules at all. This just keeps
// the same routes working for any client that does go through a real
// WebView/browser fetch (local dev against a deployed API, a future iOS
// WKWebView build without the native bridge enabled, etc).
const ALLOWED_ORIGINS = ["capacitor://localhost", "http://localhost", "https://localhost"];

const CORS_HEADERS = {
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Credentials": "true",
};

export function proxy(request: NextRequest) {
  const origin = request.headers.get("origin") ?? "";
  const isAllowedOrigin = ALLOWED_ORIGINS.includes(origin);

  if (request.method === "OPTIONS") {
    return NextResponse.json(
      {},
      {
        headers: {
          ...(isAllowedOrigin && { "Access-Control-Allow-Origin": origin }),
          ...CORS_HEADERS,
        },
      },
    );
  }

  const response = NextResponse.next();
  if (isAllowedOrigin) response.headers.set("Access-Control-Allow-Origin", origin);
  Object.entries(CORS_HEADERS).forEach(([key, value]) => response.headers.set(key, value));
  return response;
}

export const config = {
  matcher: "/api/:path*",
};
