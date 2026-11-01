"use client";
import { useAccountFetch } from "./AccountBoundary";
import { useEffect, useState } from "react";
type Usage = {
  usedBytes: number;
  limitBytes: number;
  remainingBytes: number;
  assetCount: number;
};
function amount(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}
export function MediaStorage({
  projectId,
  assetCount,
}: {
  projectId: string;
  assetCount: number;
}) {
  const accountFetch = useAccountFetch();
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      try {
        const response = await accountFetch("/api/workspace/storage", {
          signal: controller.signal,
        });
        const result = await response.json();
        if (!response.ok)
          throw new Error(result.error || "Could not load media allowance.");
        if (!controller.signal.aborted) {
          setUsage(result);
          setError("");
        }
      } catch (error) {
        if (!controller.signal.aborted)
          setError(
            error instanceof Error
              ? error.message
              : "Could not load media allowance.",
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [projectId, assetCount, refresh, accountFetch]);
  return (
    <section className="media-storage" aria-label="Media storage">
      <div className="media-storage-title">
        <strong>Studio media allowance</strong>
        <button
          type="button"
          className="subtle"
          disabled={loading}
          onClick={() => setRefresh((value) => value + 1)}
          aria-label="Refresh media storage"
        >
          Refresh
        </button>
      </div>
      {usage && (
        <>
          <p role="status" aria-label="Media storage usage">
            {amount(usage.usedBytes)} of {amount(usage.limitBytes)} used ·{" "}
            {usage.assetCount} {usage.assetCount === 1 ? "file" : "files"}
          </p>
          <progress
            aria-label="Uploaded media allowance"
            value={Math.min(usage.usedBytes, usage.limitBytes)}
            max={usage.limitBytes}
          />
        </>
      )}
      {!usage && loading && <p role="status">Checking media allowance…</p>}
      {error && (
        <p role="alert" aria-label="Media storage error">
          {error}
        </p>
      )}
      <small>
        Shared across your projects, including Trash. Processed media can use
        more space than the original upload.
      </small>
    </section>
  );
}
