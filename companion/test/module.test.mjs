import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { once } from "node:events";
import Module from "../src/main.js";
const require = createRequire(new URL("../../package.json", import.meta.url));
const { Server } = require("socket.io");

function harness() {
  const instance = Object.create(Module.prototype);
  const output = {};
  for (const [method, key] of Object.entries({
    setActionDefinitions: "actions",
    setFeedbackDefinitions: "feedbacks",
    setVariableDefinitions: "definitions",
    setVariableValues: "variables",
  }))
    instance[method] = (value) => {
      output[key] = value;
    };
  instance.setPresetDefinitions = (structure, presets) => {
    output.structure = structure;
    output.presets = presets;
  };
  instance.checkFeedbacks = () => {};
  instance.updateStatus = (status, message) => {
    output.status = { status, message };
  };
  instance.log = (level, message) => {
    output.log = { level, message };
  };
  return { instance, output };
}
const state = {
  eventId: "race",
  eventName: "Stage 1",
  onAir: [{ key: "results", label: "Results table", name: "H21", step: 2, since: 1 }],
  otherOnAir: 0,
  prepared: { key: "free-text", label: "Free text", name: "Welcome" },
  favorites: [{ id: "fav-1", label: "H21 results", key: "results", graphic: "Results table" }],
  output: { web: true, ndi: false },
  data: { ok: true },
};

test("Companion module connects, receives tally, shows favourites and clears stale state on disconnect", async () => {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push([req.method, req.url]);
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"ok":true}');
  });
  const io = new Server(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  const { instance, output } = harness();
  let connection;
  io.of("/control").on("connection", (socket) => {
    connection = socket;
    socket.emit("state", state);
  });
  try {
    await instance.init({ host: "127.0.0.1", port, wsPort: port });
    for (let i = 0; i < 100 && output.variables?.event_name !== "Stage 1"; i++)
      await new Promise((r) => setTimeout(r, 10));
    assert.equal(output.variables.event_name, "Stage 1");
    assert.equal(output.variables.on_air, "Results table: H21");
    assert.equal(output.variables.prepared, "Free text: Welcome");
    assert.equal(output.feedbacks.on_air.callback({ options: { graphic: "results" } }), true);
    assert.equal(output.feedbacks.favorite_on_air.callback({ options: { favorite: "fav-1" } }), true);
    assert.equal(output.presets["show_fav-1"].steps[0].down[0].options.favorite, "fav-1");
    await output.actions.favorite_show.callback({ options: { favorite: "fav-1" } });
    await output.actions.hide_all.callback({ options: {} });
    await output.actions.runner_prepare.callback({ options: { bib: "V101", graphic: "runner-splits" } });
    assert.deepEqual(requests, [
      ["POST", "/api/control/favorite/fav-1/show"],
      ["POST", "/api/control/hide-all"],
      ["POST", "/api/control/runner/V101/runner-splits"],
    ]);
    connection.disconnect(true);
    for (let i = 0; i < 100 && instance.socket.connected; i++)
      await new Promise((r) => setTimeout(r, 10));
    assert.equal(output.feedbacks.on_air.callback({ options: { graphic: "results" } }), false);
    assert.equal(output.variables.on_air, "");
    assert.equal(output.variables.web_on, false);
    assert.equal(output.presets["show_fav-1"], undefined);
    assert.ok(output.presets.show, "transport buttons stay available offline");
  } finally {
    await instance.destroy();
    await new Promise((r) => io.close(r));
  }
});

test("Tally changes do not rebuild preset catalogues, but renamed favourites do", () => {
  const { instance, output } = harness();
  instance.state = {};
  instance.configureActions();
  instance.applyState(state);
  const presets = output.presets;
  instance.applyState({ ...state, onAir: [] });
  assert.equal(output.presets, presets);
  assert.equal(output.feedbacks.favorite_on_air.callback({ options: { favorite: "fav-1" } }), false);
  instance.applyState({ ...state, favorites: [{ ...state.favorites[0], label: "New name" }] });
  assert.notEqual(output.presets, presets);
  assert.equal(output.presets["prepare_fav-1"].name, "New name");
});

test("Companion automatically reconnects after transport loss and refreshes event, favourites and tally", async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"ok":true}');
  });
  const io = new Server(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  const { instance, output } = harness();
  let socket,
    connections = 0,
    latest = state;
  io.of("/control").on("connection", (client) => {
    socket = client;
    connections++;
    client.emit("state", latest);
  });
  const waitFor = async (predicate) => {
    for (let i = 0; i < 300; i++) {
      if (predicate()) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.fail("Timed out waiting for reconnect state");
  };
  try {
    await instance.init({ host: "127.0.0.1", port, wsPort: port });
    instance.socket.io
      .reconnectionDelay(100)
      .reconnectionDelayMax(100)
      .randomizationFactor(0);
    await waitFor(() => output.variables?.event_name === "Stage 1");
    latest = {
      ...state,
      eventName: "Stage 2",
      favorites: [{ ...state.favorites[0], label: "Updated favourite" }],
      onAir: [],
    };
    socket.conn.close();
    await waitFor(() => output.variables?.event_name === "");
    assert.equal(output.variables.on_air, "");
    await waitFor(
      () => connections === 2 && output.variables?.event_name === "Stage 2",
    );
    assert.equal(output.presets["prepare_fav-1"].name, "Updated favourite");
    assert.equal(output.variables.on_air, "");
    assert.equal(output.feedbacks.on_air.callback({ options: { graphic: "results" } }), false);
  } finally {
    await instance.destroy();
    await new Promise((r) => io.close(r));
  }
});

test("Companion records failed HTTP actions without treating them as successful control", async () => {
  const server = createServer((_req, res) => {
    res.writeHead(409, { "content-type": "application/json" });
    res.end('{"ok":false,"error":"No event is open in Live mode"}');
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { instance, output } = harness();
  instance.base = `http://127.0.0.1:${server.address().port}/api/control`;
  try {
    await instance.send("/show");
    assert.equal(output.log.level, "error");
    assert.match(output.log.message, /No event/);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
