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

test(
  "text cut through by another panel is reported; hidden or veiled text is not",
  { timeout: 120000 },
  async () => {
    const result = await previewMotionScene({
      code: {
        html: `<div class="row" id="cut">Signed by a trusted authority</div><div class="card" id="over">Callout</div>
<div class="row" id="gone">Fully covered line</div><div class="card" id="lid">Lid</div>
<div class="row" id="page">A line on the page behind</div><div id="veil"></div><div class="card" id="dialog">Dialog</div>
<div class="shot r-shot" id="s1"><div class="row" id="old">Outgoing shot text</div></div>
<div class="shot r-shot" id="s2"><div class="card" id="new">New</div></div>`,
        css: `#stage{background:#0b1020;color:#fff}
.row{position:absolute;left:200px;font-size:36px;white-space:nowrap}
.card{position:absolute;background:#1e293b;font-size:30px;padding:20px}
#cut{top:200px}#over{left:130px;top:180px;width:260px;height:60px}
#gone{top:400px}#lid{left:150px;top:380px;width:900px;height:70px}
#page{top:600px}#veil{position:absolute;left:0;top:540px;width:1920px;height:200px;background:rgba(0,0,0,.5)}#dialog{left:130px;top:580px;width:260px;height:60px}
.shot{position:absolute;left:0;top:780px;width:1920px;height:200px}#old{top:70px}#new{left:130px;top:50px;width:260px;height:60px}`,
        js: "1;",
      },
      format: "landscape",
      durationSeconds: 2,
      times: [1],
      auditAt: [1],
    });
    const layout = result.layout.join("\n");
    assert.match(layout, /#cut .* is partly hidden behind #over/);
    assert.doesNotMatch(layout, /#gone/);
    assert.doesNotMatch(layout, /#page/);
    // Two shots on screen during a change are not compared.
    assert.doesNotMatch(layout, /#old/);
  },
);
