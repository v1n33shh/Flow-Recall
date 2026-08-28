// In the web deployment this is unset, so paths stay relative (same-origin,
// unchanged behavior). In the Capacitor build the shell is served from
// capacitor://localhost with no Next.js server behind it, so every API call
// must be pointed at the live deployment that actually runs the route
// handlers, Prisma, and the AI/payment provider calls.
const API_ORIGIN = process.env.NEXT_PUBLIC_API_URL || (typeof window !== "undefined" && window.location.origin.includes("localhost") && !window.location.origin.includes("capacitor") ? "" : "https://www.flowrecall.app");

export function apiUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${API_ORIGIN}${path}`;
}

// Cross-origin requests need explicit credentials so the NextAuth session
// cookie is sent/stored; same-origin (web) requests ignore this harmlessly.
export const API_FETCH_CREDENTIALS: RequestCredentials | undefined = API_ORIGIN
  ? "include"
  : undefined;
