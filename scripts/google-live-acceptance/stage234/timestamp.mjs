// Prisma Date objects must not pass through Date.parse(Date.toString()), which
// loses fractional seconds. Only Date or canonical UTC ISO strings are accepted.
export function timestampMillis(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value !== "string") return Number.NaN;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/.exec(
    value,
  );
  if (!match) return Number.NaN;
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) return Number.NaN;
  const canonical = `${match[1]}.${(match[2] ?? "").padEnd(3, "0")}Z`;
  return new Date(millis).toISOString() === canonical ? millis : Number.NaN;
}
