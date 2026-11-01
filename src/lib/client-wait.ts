export function clientWait(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(new DOMException("Request cancelled", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}
