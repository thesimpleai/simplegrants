const views = new Set([
  "overview",
  "organisation",
  "opportunities",
  "applications",
  "projects",
  "inbox",
]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Older shared links use opportunity; new links use grant. Reject ambiguity. */
export function opportunityIdFromParams(
  params: URLSearchParams,
): string | null {
  const keys = ["grant", "opportunity"];
  if (keys.some((key) => params.getAll(key).length > 1)) return null;
  const values = keys.flatMap((key) => params.getAll(key));
  if (!values.length || values.some((value) => !uuid.test(value))) return null;
  const ids = new Set(values.map((value) => value.toLowerCase()));
  return ids.size === 1 ? [...ids][0] : null;
}

/** Rebuild only portal query fields; never return an external URL or auth token. */
export function safeAuthReturnPath(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\r\n\u0000]/.test(value)
  )
    return "/";
  try {
    const base = "https://simple-grants.invalid";
    const url = new URL(value, base);
    if (
      url.origin !== base ||
      url.pathname !== "/" ||
      url.username ||
      url.password
    )
      return "/";
    const params = new URLSearchParams();
    const view = url.searchParams.get("view");
    if (url.searchParams.getAll("view").length === 1 && view && views.has(view))
      params.set("view", view);
    for (const key of ["org"]) {
      const field = url.searchParams.get(key);
      if (
        url.searchParams.getAll(key).length === 1 &&
        field &&
        uuid.test(field)
      )
        params.set(key, field.toLowerCase());
    }
    const grant = opportunityIdFromParams(url.searchParams);
    if (grant) params.set("grant", grant);
    return params.size ? `/?${params.toString()}` : "/";
  } catch {
    return "/";
  }
}

/** Hash fragments are never sent to the web host; tokens stay in memory only. */
export function parseAuthConfirmationHash(
  hash: string,
): { tokenHash: string; next: string } | null {
  if (!hash.startsWith("#") || hash.length > 8192) return null;
  const params = new URLSearchParams(hash.slice(1));
  if (
    params.getAll("token_hash").length !== 1 ||
    params.getAll("next").length > 1
  )
    return null;
  if ([...params.keys()].some((key) => key !== "token_hash" && key !== "next"))
    return null;
  const tokenHash = params.get("token_hash");
  if (!tokenHash || !/^[A-Za-z0-9._~+/=-]{20,2048}$/.test(tokenHash))
    return null;
  return { tokenHash, next: safeAuthReturnPath(params.get("next") ?? "/") };
}
