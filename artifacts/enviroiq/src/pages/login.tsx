import { Redirect } from "wouter";

/**
 * Legacy `/login` route — pre-Clerk migration. Redirect to Clerk's `/sign-in`
 * page, preserving any `?from=…` deep-link as `?redirect_url=…` so users land
 * on their original target page after authenticating.
 */
export default function Login() {
  const params = new URLSearchParams(window.location.search);
  const from = params.get("from");
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
  const target = from
    ? `/sign-in?redirect_url=${encodeURIComponent(basePath + from)}`
    : "/sign-in";
  return <Redirect to={target} replace />;
}
