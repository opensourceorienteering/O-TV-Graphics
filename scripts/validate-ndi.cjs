/** Opt-in local transport soak. Sends synthetic BGRA only; never captures a user window. */
const ndi = require('@stagetimerio/grandiose');
const fs = require('node:fs');
const { performance } = require('node:perf_hooks');
const seconds = Number(process.argv[2] || 120);
const output = process.argv[3];
if (!Number.isFinite(seconds) || seconds < 1 || seconds > 3600) throw new Error('Duration must be 1–3600 seconds');
(async () => {
  let sender, finder;
  const report = { version: ndi.version(), durationSeconds: seconds, width: 1920, height: 1080, targetFps: 50, sent: 0, received: 0, receiveTimeouts: 0, invalidFrames: 0, alphaSamples: [], sendErrors: 0, memorySamples: [] };
  try {
    sender = await ndi.send({ name: `OL-Grafik synthetic validation ${process.pid}`, clockVideo: true, clockAudio: false });
    finder = await ndi.find({ showLocalSources: true, extraIPs: ['127.0.0.1'] });
    let source;
    for (let i = 0; i < 20 && !source; i++) { await finder.wait(500); source = finder.sources().find(s => s.name === sender.sourcename()); }
    if (!source) throw new Error('Synthetic source was not discovered locally');
    const receiver = await ndi.receive({ source, colorFormat: ndi.COLOR_FORMAT_BGRX_BGRA, bandwidth: ndi.BANDWIDTH_HIGHEST, allowVideoFields: false, name: 'OL-Grafik validation receiver' });
    const data = Buffer.alloc(report.width * report.height * 4);
    for (let y = 0; y < report.height; y++) for (let x = 0; x < report.width; x++) {
      const p = (y * report.width + x) * 4;
      data[p] = 80; data[p + 1] = 160; data[p + 2] = 220;
      data[p + 3] = x < report.width / 3 ? 0 : x < report.width * 2 / 3 ? 128 : 255;
    }
    const frame = { xres: report.width, yres: report.height, frameRateN: 50, frameRateD: 1, fourCC: ndi.FOURCC_BGRA, pictureAspectRatio: 16 / 9, frameFormatType: ndi.FORMAT_TYPE_PROGRESSIVE, lineStrideBytes: report.width * 4, data };
    let running = true;
    const receiveLoop = (async () => {
      while (running) {
        try {
          const video = await receiver.video(1000);
          report.received++;
          if (video.xres !== report.width || video.yres !== report.height || video.data.length < report.width * report.height * 4 || video.fourCC !== ndi.FOURCC_BGRA) report.invalidFrames++;
          else if (report.alphaSamples.length < 3) report.alphaSamples.push([Math.floor(report.width / 6), Math.floor(report.width / 2), Math.floor(report.width * 5 / 6)].map(x => video.data[Math.floor(report.height / 2) * video.lineStrideBytes + x * 4 + 3]));
        } catch { if (running) report.receiveTimeouts++; }
      }
    })();
    const started = performance.now();
    let lastSample = started - 1000;
    while (performance.now() - started < seconds * 1000) {
      try { await sender.video(frame); report.sent++; } catch (error) { report.sendErrors++; if (report.sendErrors > 10) throw error; }
      const now = performance.now();
      if (now - lastSample >= 10000) { report.memorySamples.push({ seconds: Math.round((now - started) / 1000), rssMiB: Math.round(process.memoryUsage().rss / 1024 / 1024) }); lastSample = now; }
    }
    report.elapsedSeconds = (performance.now() - started) / 1000;
    running = false; await receiveLoop;
    report.sentFps = report.sent / report.elapsedSeconds;
    report.receivedFps = report.received / report.elapsedSeconds;
    report.passed = report.sentFps >= 45 && report.received >= report.sent * .90 && !report.sendErrors && !report.invalidFrames && report.alphaSamples.some(s => s[0] <= 5 && Math.abs(s[1] - 128) <= 5 && s[2] >= 250);
    if (output) fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
    await sender.destroy(); await finder.destroy();
    process.exit(report.passed ? 0 : 1);
  } catch (error) { console.error(error); if (sender) await sender.destroy(); if (finder) await finder.destroy(); process.exit(1); }
})();
