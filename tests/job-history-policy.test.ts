import { test } from "node:test";
import assert from "node:assert/strict";
import {
  jobHistoryPolicy,
  jobDocumentReservationBytes,
  maximumIndexedJobs,
  JobHistoryLimit,
} from "../src/lib/job-history-policy";
test("history limits admit native report capacity and keep full plus retired records within portable census bounds", () => {
  const p = jobHistoryPolicy({});
  assert(p.studioBytes >= jobDocumentReservationBytes);
  assert(p.serviceBytes >= p.studioBytes);
  assert(p.serviceJobs + p.serviceRetired <= maximumIndexedJobs);
  assert.equal(
    jobHistoryPolicy({
      REELCHEMY_JOB_STUDIO_BYTES: String(jobDocumentReservationBytes),
      REELCHEMY_JOB_SERVICE_BYTES: String(jobDocumentReservationBytes),
    }).studioBytes,
    jobDocumentReservationBytes,
  );
  for (const env of [
    { REELCHEMY_JOB_STUDIO_BYTES: "1" },
    { REELCHEMY_JOB_SERVICE_BYTES: "8388607" },
    { REELCHEMY_JOB_STUDIO_BYTES: "8589934592" },
    { REELCHEMY_JOB_STUDIO_COUNT: "20001" },
    { REELCHEMY_JOB_SERVICE_COUNT: "20001" },
    { REELCHEMY_JOB_STUDIO_RETIRED: "80001" },
    { REELCHEMY_JOB_STUDIO_COUNT: "1e3" },
    { REELCHEMY_JOB_SERVICE_RETIRED: "1.5" },
    { REELCHEMY_JOB_STUDIO_COUNT: "0" },
    { REELCHEMY_JOB_SERVICE_RETIRED: "9007199254740992" },
  ])
    assert.throws(() => jobHistoryPolicy(env));
});
test("shared history refusals contain no private studio figures or internal storage names", () => {
  const error = new JobHistoryLimit("service", "bytes");
  assert(!/workspace|sqlite|\d/.test(error.message));
  assert.equal(error.code, "JOB_HISTORY_LIMIT");
});
