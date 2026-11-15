/** A phase is queued once; polls retrieve its result without calling Gemini again. */
export async function requestAIPhase(
  payload: Record<string, unknown>,
  accessToken: string,
  ensureCurrent: () => void,
): Promise<Response> {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
    "X-Simple-Grants-Async": "1",
  };
  ensureCurrent();
  let response = await fetch("/api/ai", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(45000),
  });
  ensureCurrent();
  if (response.status !== 202) return response;
  const job = await response.json();
  if (
    !job ||
    typeof job.jobId !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(job.jobId) ||
    job.orgId !== payload.orgId
  )
    throw new Error("Invalid AI job response");
  const deadline = Date.now() + 150000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    ensureCurrent();
    response = await fetch(
      `/api/ai-jobs?${new URLSearchParams({ orgId: job.orgId, jobId: job.jobId })}`,
      {
        headers: { Authorization: headers.Authorization },
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      },
    );
    ensureCurrent();
    if (response.status !== 202) return response;
    const pending = await response.json();
    if (
      pending?.jobId !== job.jobId ||
      pending?.orgId !== job.orgId ||
      pending.pending !== true
    )
      throw new Error("Invalid AI job response");
  }
  throw new DOMException("AI step timed out", "TimeoutError");
}
