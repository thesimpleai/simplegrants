import type { Opportunity } from "../../../src/types";

type RoundDates = Pick<Opportunity, "opens_on" | "closes_at">;
type Conflict = {
  field: "opens_on" | "closes_at";
  saved: string;
  discovered: string;
};
function normaliseClosing(value: string | null) {
  return value && !Number.isNaN(Date.parse(value))
    ? new Date(value).toISOString()
    : null;
}
function conflicts(saved: RoundDates, fresh: RoundDates): Conflict[] {
  const differences: Conflict[] = [];
  if (saved.opens_on && fresh.opens_on && saved.opens_on !== fresh.opens_on)
    differences.push({
      field: "opens_on",
      saved: saved.opens_on,
      discovered: fresh.opens_on,
    });
  const savedClose = normaliseClosing(saved.closes_at),
    freshClose = normaliseClosing(fresh.closes_at);
  if (savedClose && freshClose && savedClose !== freshClose)
    differences.push({
      field: "closes_at",
      saved: savedClose,
      discovered: freshClose,
    });
  return differences;
}
function clearlyLaterRound(saved: RoundDates, fresh: RoundDates, now: Date) {
  const previousClose = normaliseClosing(saved.closes_at);
  if (!previousClose) return false;
  // A date-only opening has no known instant. Require a later Australian
  // calendar day rather than inventing midnight UTC to separate rounds.
  const previousClosingDay = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Melbourne",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(previousClose));
  if (fresh.opens_on && fresh.opens_on > previousClosingDay) return true;
  const freshClose = normaliseClosing(fresh.closes_at);
  return !!(
    freshClose &&
    new Date(previousClose) < now &&
    new Date(freshClose) >= now
  );
}

/** Preserve historical rounds and avoid interpreting a possible date correction as a new cycle. */
export function discoveredRound(
  existing: Opportunity[],
  fresh: RoundDates,
  now: Date,
):
  | { kind: "new"; previous?: Opportunity }
  | { kind: "same" | "review"; existing: Opportunity; conflicts: Conflict[] } {
  if (!existing.length) return { kind: "new" };
  const compatible = existing.filter(
    (row) => conflicts(row, fresh).length === 0,
  );
  if (compatible.length) {
    const score = (row: Opportunity) =>
      (fresh.closes_at &&
      normaliseClosing(row.closes_at) === normaliseClosing(fresh.closes_at)
        ? 4
        : 0) + (fresh.opens_on && row.opens_on === fresh.opens_on ? 2 : 0);
    const selected = [...compatible].sort((a, b) => score(b) - score(a))[0];
    const noDatesEstablished = !fresh.opens_on && !fresh.closes_at;
    return {
      kind: noDatesEstablished || score(selected) === 0 ? "review" : "same",
      existing: selected,
      conflicts: [],
    };
  }
  if (existing.every((row) => clearlyLaterRound(row, fresh, now)))
    return { kind: "new", previous: existing[0] };
  return {
    kind: "review",
    existing: existing[0],
    conflicts: conflicts(existing[0], fresh),
  };
}
