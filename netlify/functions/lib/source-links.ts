import { isIP } from "node:net";
import { safeHttpsUrl } from "./core";
import type { AIRequestBudget } from "./ai-runtime";

export function isGroundingRedirect(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (
      url.protocol === "https:" &&
      url.hostname === "vertexaisearch.cloud.google.com" &&
      url.pathname.startsWith("/grounding-api-redirect/")
    );
  } catch {
    return false;
  }
}
function publicSource(raw: string): string | null {
  const safe = safeHttpsUrl(raw);
  if (!safe) return null;
  const url = new URL(safe);
  if (
    url.port ||
    isIP(url.hostname.replace(/^\[|\]$/g, "")) ||
    /(?:^|\.)(?:localhost|local|internal|invalid|test)$/.test(url.hostname)
  )
    return null;
  return url.href;
}

/** Fetch only Google's known redirect endpoint, never a returned funder page. */
export async function resolveSourceLink(
  raw: string,
  budget?: AIRequestBudget,
): Promise<string | null> {
  let current = publicSource(raw);
  if (!current || !isGroundingRedirect(current)) return current;
  if (budget && budget.remaining() < 2000) return null;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    Math.min(3000, (budget?.remaining() ?? 3750) - 750),
  );
  const signal = budget
    ? AbortSignal.any([controller.signal, budget.signal])
    : controller.signal;
  try {
    for (let hop = 0; hop < 4; hop++) {
      let response = await fetch(current, {
        method: "HEAD",
        redirect: "manual",
        signal,
      });
      if (
        [200, 405, 501].includes(response.status) &&
        !response.headers.get("location")
      ) {
        await response.body?.cancel();
        response = await fetch(current, {
          method: "GET",
          headers: { Range: "bytes=0-0" },
          redirect: "manual",
          signal,
        });
      }
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (![301, 302, 303, 307, 308].includes(response.status) || !location)
        return null;
      const next = publicSource(new URL(location, current).href);
      if (!next) return null;
      if (!isGroundingRedirect(next))
        return new URL(next).hostname === "vertexaisearch.cloud.google.com"
          ? null
          : next;
      if (next === current) return null;
      current = next;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
