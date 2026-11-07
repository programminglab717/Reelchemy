import { test } from "node:test";
import assert from "node:assert/strict";
import { previewMotionScene, contactSheet } from "../src/motion/preflight";
import { postgresIndexScene } from "../src/motion/examples/postgres-index";
import sharp from "sharp";

test(
  "scene previews report errors, empty and frozen frames, and layout problems",
  { timeout: 120000 },
  async () => {
    const broken = await previewMotionScene({
      code: {
        html: `<div id="tiny">tiny caption</div><div id="clip">This sentence is far too long for its narrow box</div>
<div id="a">Overlapping title</div><div id="b">Overlapping label</div><div id="off">Off stage</div>`,
        css: `#stage{background:#000;color:#fff}
#tiny{position:absolute;left:200px;top:200px;font-size:12px}
#clip{position:absolute;left:200px;top:300px;width:200px;white-space:nowrap;overflow:hidden;font-size:30px}
#a,#b{position:absolute;left:600px;top:600px;font-size:40px}
#off{position:absolute;left:1850px;top:500px;font-size:40px;white-space:nowrap}`,
        js: `setTimeout(() => { throw new Error("late failure"); }, 1000);`,
      },
      format: "landscape",
      durationSeconds: 3,
      times: [0, 1.5, 3],
      auditAt: [1.5],
    });
    assert(broken.loaded);
    assert(broken.errors.some((e) => e.includes("late failure")));
    // Nothing moves.
    assert(broken.frames.slice(1).every((f) => f.change! < 0.01));
    const layout = broken.layout.join("\n");
    assert.match(layout, /#tiny .* 12px/);
    assert.match(layout, /#clip .* overflows/);
    assert.match(layout, /#a .* overlaps text #b/);
    assert.match(layout, /#off .* outside the stage/);

    const empty = await previewMotionScene({
      code: { html: "", css: "#stage{background:#000}", js: "1;" },
      format: "portrait",
      durationSeconds: 2,
      times: [1],
    });
    assert(empty.frames[0].detail < 1);
    const sheet = await sharp(await contactSheet(empty.frames)).metadata();
    assert.equal(sheet.width, 540);
    assert.equal(sheet.height, 960);

    const syntax = await previewMotionScene({
      code: { html: "", css: "", js: "this is not javascript" },
      format: "square",
      durationSeconds: 2,
      times: [0.5],
    });
    assert(syntax.errors.some((e) => /SyntaxError|Unexpected/.test(e)));
  },
);

test(
  "the reference scene meets its own checks: no errors or layout notes, and it keeps moving",
  { timeout: 120000 },
  async () => {
    const times = Array.from({ length: 9 }, (_, i) => (15 * i) / 8);
    const result = await previewMotionScene({
      code: postgresIndexScene,
      format: "landscape",
      durationSeconds: 15,
      times,
      auditAt: times.slice(2),
    });
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.layout, []);
    assert(result.frames.slice(1, -1).every((f) => f.change! > 0.1));
    assert(result.frames.slice(1).every((f) => f.detail > 5));
  },
);
