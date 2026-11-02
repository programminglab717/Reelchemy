import { test, expect, account } from "./fixtures";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

test("real MP4 downloads resume exact ranges and support private HEAD, evidence and browser cancellation without affecting later downloads", async ({
  page,
  request,
  browser,
}) => {
  const project = await (
    await request.post("/api/projects", {
      data: {
        prompt: "Private resumable download",
        blank: true,
        duration: 5,
        format: "landscape",
      },
    })
  ).json();
  await page.goto("/");
  await page.getByRole("button", { name: project.name, exact: true }).click();
  await page
    .getByRole("button", { name: "Approve & export MP4", exact: true })
    .click();
  await expect(
    page.getByText("Your film is ready.", { exact: true }),
  ).toBeVisible({ timeout: 200000 });
  const jobs = await (
    await request.get(`/api/projects/${project.id}/render`)
  ).json();
  const url = `/api/jobs/${jobs[0].id}/download`;
  const whole = await request.get(url);
  expect(whole.status()).toBe(200);
  expect(whole.headers()["cache-control"]).toBe("private, no-store");
  expect(whole.headers()["x-content-type-options"]).toBe("nosniff");
  expect(whole.headers()["accept-ranges"]).toBe("bytes");
  const bytes = await whole.body();
  expect(bytes.subarray(4, 8).toString()).toBe("ftyp");
  const head = await request.head(url);
  expect(head.status()).toBe(200);
  expect(head.headers()["content-length"]).toBe(String(bytes.length));
  expect((await head.body()).length).toBe(0);
  const split = Math.floor(bytes.length / 2);
  const [first, second, suffix] = await Promise.all([
    request.get(url, { headers: { range: `bytes=0-${split - 1}` } }),
    request.get(url, { headers: { range: `bytes=${split}-` } }),
    request.get(url, { headers: { range: "bytes=-127" } }),
  ]);
  expect(first.status()).toBe(206);
  expect(second.status()).toBe(206);
  expect(first.headers()["content-range"]).toBe(
    `bytes 0-${split - 1}/${bytes.length}`,
  );
  expect(Buffer.concat([await first.body(), await second.body()])).toEqual(
    bytes,
  );
  expect(await suffix.body()).toEqual(bytes.subarray(-127));
  const invalid = await request.get(url, {
    headers: { range: "bytes=0-1,4-5" },
  });
  expect(invalid.status()).toBe(416);
  expect(invalid.headers()["content-range"]).toBe(`bytes */${bytes.length}`);
  expect(invalid.headers()["cache-control"]).toBe("private, no-store");
  const interrupted = await page.evaluate(async (address) => {
    const abort = new AbortController();
    const response = await fetch(address, { signal: abort.signal });
    const reader = response.body!.getReader();
    const first = await reader.read();
    abort.abort();
    await reader.cancel().catch(() => {});
    return { status: response.status, bytes: first.value?.length ?? 0 };
  }, url);
  expect(interrupted.status).toBe(200);
  expect(interrupted.bytes).toBeGreaterThan(0);
  expect(await (await request.get(url)).body()).toEqual(bytes);
  for (const file of ["report.json", "captions.srt", "thumbnail.png"]) {
    const metadata = await request.head(
      `/api/jobs/${jobs[0].id}/evidence/${file}`,
    );
    expect(metadata.status()).toBe(200);
    expect(metadata.headers()["cache-control"]).toBe("private, no-store");
    expect(metadata.headers()["x-content-type-options"]).toBe("nosniff");
  }
  const foreign = await browser.newContext({
    baseURL: process.env.PLAYWRIGHT_BASE_URL,
  });
  try {
    await account(foreign.request, "Private download stranger");
    const hidden = await foreign.request.head(url);
    expect(hidden.status()).toBe(404);
    expect(hidden.headers()["cache-control"]).toBe("private, no-store");
  } finally {
    await foreign.close();
  }
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download MP4", exact: true }).click();
  const download = await downloadEvent;
  expect(await download.failure()).toBeNull();
  expect(
    createHash("sha256")
      .update(await readFile((await download.path())!))
      .digest("hex"),
  ).toBe(createHash("sha256").update(bytes).digest("hex"));
});
