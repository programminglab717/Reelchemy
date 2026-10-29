export function byteRange(
  header: string | null,
  size: number,
): { start: number; end: number } | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!m || (!m[1] && !m[2])) throw new Error("Invalid byte range");
  const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  const end = m[1]
    ? m[2]
      ? Math.min(size - 1, Number(m[2]))
      : size - 1
    : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= size ||
    end < start ||
    (!m[1] && Number(m[2]) === 0)
  )
    throw new Error("Invalid byte range");
  return { start, end };
}
