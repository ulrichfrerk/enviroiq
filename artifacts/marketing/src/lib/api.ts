/**
 * Base URL for the EnviroIQ API server.
 * In Replit (dev + prod) the marketing site and api-server share an origin —
 * /api/* is proxied to the api-server by the edge. So we use relative URLs
 * by default. Override with VITE_API_BASE_URL only if the marketing site is
 * hosted on a domain separate from the API.
 */
export const API_BASE: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

export const apiUrl = (path: string): string => {
  const p = path.startsWith("/") ? path : `/${path}`;
  return API_BASE ? `${API_BASE}${p}` : p;
};
