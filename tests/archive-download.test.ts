import { test } from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import { archiveDownload } from "../src/lib/archive-download";
import { MAX_ARCHIVE_BYTES } from "../src/lib/timeline-limits";

test("editable downloads retain exact ZIP bytes and enforce their declared size", async () => {
  const bytes = zipSync({ "project.json": strToU8('{"format":"reelchemy"}') });
  const blob = await archiveDownload(
    new Response(bytes, {
      headers: {
        "content-type": "application/zip",
        "content-length": String(bytes.length),
      },
    }),
  );
  const decoded = await archiveDownload(
    new Response(bytes, {
      headers: {
        "content-type": "application/zip",
        "content-encoding": "gzip",
        "content-length": "1",
      },
    }),
  );
  assert.deepEqual(
    Buffer.from(await decoded.arrayBuffer()),
    Buffer.from(bytes),
  );
  assert.equal(blob.type, "application/zip");
  assert.deepEqual(Buffer.from(await blob.arrayBuffer()), Buffer.from(bytes));
  await assert.rejects(
    archiveDownload(
      new Response(bytes, {
        headers: {
          "content-type": "application/zip",
          "content-length": String(bytes.length + 1),
        },
      }),
    ),
    /incomplete/,
  );
});
test("server errors, HTML and incomplete successes never become downloaded archives", async () => {
  await assert.rejects(
    archiveDownload(
      Response.json(
        { error: "A retained asset is unavailable. Retry after recovery." },
        { status: 400 },
      ),
    ),
    /retained asset is unavailable/,
  );
  await assert.rejects(
    archiveDownload(new Response("upstream gateway", { status: 503 })),
    /could not be downloaded/,
  );
  for (const response of [
    Response.json({ error: "Not a ZIP" }),
    new Response("<html>Sign in</html>", {
      headers: { "content-type": "text/html" },
    }),
  ])
    await assert.rejects(archiveDownload(response), /did not return.*ZIP/);
  for (const bytes of [new Uint8Array(), new Uint8Array(40)])
    await assert.rejects(
      archiveDownload(
        new Response(bytes, { headers: { "content-type": "application/zip" } }),
      ),
      /incomplete/,
    );
});
test("oversized declarations and actual streaming bodies close before they can become files", async () => {
  let cancelled = 0;
  const declared = new Response(
    new ReadableStream({
      cancel() {
        cancelled++;
      },
    }),
    {
      headers: {
        "content-type": "application/zip",
        "content-length": String(MAX_ARCHIVE_BYTES + 1),
      },
    },
  );
  await assert.rejects(archiveDownload(declared), /download limit/);
  assert.equal(cancelled, 1);
  let produced = 0;
  const streamed = new Response(
    new ReadableStream({
      pull(controller) {
        produced++;
        controller.enqueue(new Uint8Array(1024 * 1024));
      },
      cancel() {
        cancelled++;
      },
    }),
    { headers: { "content-type": "application/zip" } },
  );
  await assert.rejects(archiveDownload(streamed), /download limit/);
  assert.equal(cancelled, 2);
  assert(produced <= MAX_ARCHIVE_BYTES / (1024 * 1024) + 2);
});
test("error-body admission is independent and interrupted streams cannot produce archives", async () => {
  let cancelled = false;
  const oversizedError = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(16001));
      },
      cancel() {
        cancelled = true;
      },
    }),
    { status: 500 },
  );
  await assert.rejects(
    archiveDownload(oversizedError),
    /could not be downloaded/,
  );
  assert.equal(cancelled, true);
  const interrupted = new Response(
    new ReadableStream({
      start(controller) {
        controller.error(new Error("Synthetic interrupted transport"));
      },
    }),
    { headers: { "content-type": "application/zip" } },
  );
  await assert.rejects(archiveDownload(interrupted), /interrupted transport/);
});
