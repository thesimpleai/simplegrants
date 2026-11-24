import type { Opportunity } from "../../../src/types";
import { profileDateOnly, profileToday } from "../../../src/lib/profile-dates";

type RoundDates = Pick<Opportunity, "opens_on" | "closes_at"> & {
  closing_date?: string | null;
};
type Conflict = {
  field: "opens_on" | "closes_at" | "closing_date";
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
  if (
    saved.closing_date &&
    fresh.closing_date &&
    saved.closing_date !== fresh.closing_date
  )
    differences.push({
      field: "closing_date",
      saved: saved.closing_date,
      discovered: fresh.closing_date,
    });
  return differences;
}
function clearlyLaterRound(saved: RoundDates, fresh: RoundDates, now: Date) {
  const previousClose = normaliseClosing(saved.closes_at);
  // A date-only opening has no known instant. Require a later Australian
  // calendar day rather than inventing midnight UTC to separate rounds.
  const previousClosingDay =
    saved.closing_date ??
    (previousClose ? profileToday(new Date(previousClose)) : null);
  if (!previousClosingDay) return false;
  if (fresh.opens_on && fresh.opens_on > previousClosingDay) return true;
  const freshClose = normaliseClosing(fresh.closes_at);
  const today = profileToday(now);
  const previousExpired = previousClose
    ? new Date(previousClose) < now
    : previousClosingDay < today;
  const freshCurrent = freshClose
    ? new Date(freshClose) >= now
    : !!fresh.closing_date && fresh.closing_date >= today;
  return previousExpired && freshCurrent;
}

function savedDates(row: Opportunity): RoundDates {
  return {
    opens_on: row.opens_on,
    closes_at: row.closes_at,
    closing_date: profileDateOnly(row.provenance?.closing_date),
  };
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
    (row) => conflicts(savedDates(row), fresh).length === 0,
  );
  if (compatible.length) {
    const score = (row: Opportunity) =>
      (fresh.closes_at &&
      normaliseClosing(row.closes_at) === normaliseClosing(fresh.closes_at)
        ? 4
        : 0) +
      (fresh.opens_on && row.opens_on === fresh.opens_on ? 2 : 0) +
      (fresh.closing_date && fresh.closing_date === savedDates(row).closing_date
        ? 1
        : 0);
    const selected = [...compatible].sort((a, b) => score(b) - score(a))[0];
    const noDatesEstablished =
      !fresh.opens_on && !fresh.closes_at && !fresh.closing_date;
    return {
      kind: noDatesEstablished || score(selected) === 0 ? "review" : "same",
      existing: selected,
      conflicts: [],
    };
  }
  if (existing.every((row) => clearlyLaterRound(savedDates(row), fresh, now)))
    return { kind: "new", previous: existing[0] };
  return {
    kind: "review",
    existing: existing[0],
    conflicts: conflicts(savedDates(existing[0]), fresh),
  };
}
