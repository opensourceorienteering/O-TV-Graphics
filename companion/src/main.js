import { InstanceBase, InstanceStatus } from "@companion-module/base";
import { io } from "socket.io-client";

const EMPTY = { eventId: null, onAir: [], favorites: [], prepared: null };

/** Desk graphics, for "on air" feedback and Hide buttons */
const GRAPHICS = [
  ["runner-identity", "Runner identity"],
  ["runner-start", "Runner start"],
  ["start-group", "Start group"],
  ["start-list", "Start list"],
  ["live-feed", "Live split / finish feed"],
  ["results", "Results table"],
  ["runner-splits", "Runner splits"],
  ["position-history", "Position history"],
  ["podium", "Podium / flowers"],
  ["event-title", "Race title"],
  ["course-info", "Course parameters"],
  ["weather", "Weather"],
  ["free-text", "Free text"],
  ["speaker", "Commentators / speaker"],
  ["timer", "Elapsed timer"],
  ["team-standings", "Team standings"],
].map(([id, label]) => ({ id, label }));
const RUNNER_GRAPHICS = ["runner-identity", "runner-start", "runner-splits"];

/** Transport buttons: action id, label, API path */
const TRANSPORT = [
  ["show", "Show", "/show"],
  ["update", "Update", "/update"],
  ["hide", "Hide", "/hide"],
  ["hide_all", "Hide all", "/hide-all"],
  ["page_previous", "Page ◀", "/page/previous"],
  ["page_next", "Page ▶", "/page/next"],
];

export default class OLGrafik extends InstanceBase {
  async init(config) {
    this.state = EMPTY;
    this.configureActions();
    await this.configUpdated(config);
  }
  getConfigFields() {
    return [
      {
        type: "textinput",
        id: "host",
        label: "Split Control host",
        default: "127.0.0.1",
        width: 6,
      },
      {
        type: "number",
        id: "port",
        label: "HTTP port",
        default: 5657,
        min: 1,
        max: 65535,
        width: 3,
      },
      {
        type: "number",
        id: "wsPort",
        label: "Socket.IO port",
        default: 5656,
        min: 1,
        max: 65535,
        width: 3,
      },
    ];
  }
  async configUpdated(config) {
    this.socket?.disconnect();
    this.config = config;
    const host = config.host || "127.0.0.1";
    this.base = `http://${host}:${config.port || 5657}/api/control`;
    this.socket = io(`http://${host}:${config.wsPort || 5656}/control`, {
      transports: ["websocket"],
    });
    this.socket.on("connect", () => this.updateStatus(InstanceStatus.Ok));
    const offline = (message) => {
      this.applyState(EMPTY);
      this.updateStatus(InstanceStatus.ConnectionFailure, message);
    };
    this.socket.on("disconnect", () => offline("Disconnected"));
    this.socket.on("connect_error", (error) => offline(error.message));
    this.socket.on("state", (state) => this.applyState(state));
  }
  async destroy() {
    this.socket?.disconnect();
  }
  async send(path) {
    try {
      const response = await fetch(`${this.base}${path}`, {
        method: "POST",
        signal: AbortSignal.timeout(5000),
      });
      const body = await response.json();
      if (!response.ok || !body.ok)
        throw new Error(body.error || "Control action failed");
    } catch (error) {
      this.log("error", error.message);
    }
  }
  configureActions() {
    const actions = {};
    for (const [id, name, path] of TRANSPORT)
      actions[id] = { name, options: [], callback: async () => this.send(path) };
    const favoriteOption = {
      id: "favorite",
      type: "textinput",
      label: "Favourite ID (from the preset, or GET /api/control/favorites)",
      default: "",
    };
    actions.favorite_prepare = {
      name: "Load favourite into Preview",
      options: [favoriteOption],
      callback: async ({ options }) =>
        this.send(`/favorite/${encodeURIComponent(options.favorite)}/prepare`),
    };
    actions.favorite_show = {
      name: "Show favourite (load and put on air)",
      options: [favoriteOption],
      callback: async ({ options }) =>
        this.send(`/favorite/${encodeURIComponent(options.favorite)}/show`),
    };
    const graphicOption = {
      id: "graphic",
      type: "dropdown",
      label: "Graphic",
      default: "runner-identity",
      choices: GRAPHICS,
    };
    actions.hide_graphic = {
      name: "Hide one graphic",
      options: [graphicOption],
      callback: async ({ options }) => this.send(`/hide/${options.graphic}`),
    };
    actions.runner_prepare = {
      name: "Load runner graphic into Preview (by bib)",
      options: [
        { id: "bib", type: "textinput", label: "Bib or virtual bib", default: "V101" },
        {
          ...graphicOption,
          choices: GRAPHICS.filter((g) => RUNNER_GRAPHICS.includes(g.id)),
        },
      ],
      callback: async ({ options }) =>
        this.send(`/runner/${encodeURIComponent(options.bib)}/${options.graphic}`),
    };
    this.setActionDefinitions(actions);
    this.setFeedbackDefinitions({
      on_air: {
        type: "boolean",
        name: "Graphic on air",
        defaultStyle: { bgcolor: 0x9b263e, color: 0xffffff },
        options: [graphicOption],
        callback: ({ options }) =>
          this.state.onAir.some((o) => o.key === options.graphic),
      },
      favorite_on_air: {
        type: "boolean",
        name: "Favourite's graphic on air",
        defaultStyle: { bgcolor: 0x9b263e, color: 0xffffff },
        options: [favoriteOption],
        callback: ({ options }) => {
          const fav = this.state.favorites.find((f) => f.id === options.favorite);
          return !!fav && this.state.onAir.some((o) => o.key === fav.key);
        },
      },
      prepared: {
        type: "boolean",
        name: "Something is prepared in Preview",
        defaultStyle: { bgcolor: 0x24573e, color: 0xffffff },
        options: [],
        callback: () => !!this.state.prepared,
      },
    });
    this.setVariableDefinitions({
      event_name: { name: "Event" },
      on_air: { name: "On-air graphics" },
      prepared: { name: "Prepared in Preview" },
      data_ok: { name: "Data test status" },
      web_on: { name: "Web enabled" },
      ndi_on: { name: "NDI active" },
    });
  }
  applyState(state) {
    this.state = { ...EMPTY, ...state };
    const s = this.state;
    this.setVariableValues({
      event_name: s.eventName || "",
      on_air: s.onAir.map((o) => `${o.label}: ${o.name}`).join(", "),
      prepared: s.prepared ? `${s.prepared.label}: ${s.prepared.name}` : "",
      data_ok: !!s.data?.ok,
      web_on: !!s.output?.web,
      ndi_on: !!s.output?.ndi,
    });
    this.checkFeedbacks("on_air", "favorite_on_air", "prepared");
    // Rebuild the button catalogue only when the favourites change, not on every tally
    const catalog = JSON.stringify(s.favorites.map((f) => [f.id, f.label, f.key]));
    if (catalog === this.catalog) return;
    this.catalog = catalog;
    const presets = {};
    const button = (name, actionId, options = {}, feedbacks = [], bgcolor = 0x24573e) => ({
      type: "simple",
      name,
      style: { text: name, size: "auto", color: 0xffffff, bgcolor },
      steps: [{ down: [{ actionId, options }], up: [] }],
      feedbacks,
    });
    const onAirStyle = { bgcolor: 0x9b263e, color: 0xffffff };
    const transport = [];
    for (const [id, name] of TRANSPORT) {
      transport.push(id);
      presets[id] = button(
        name,
        id,
        {},
        id === "show" ? [{ feedbackId: "prepared", options: {}, style: { bgcolor: 0x2f7d4f, color: 0xffffff } }] : [],
        id === "hide_all" ? 0x5a1b1b : 0x333333,
      );
    }
    const prepare = [];
    const show = [];
    for (const f of s.favorites) {
      const options = { favorite: f.id };
      const feedbacks = [{ feedbackId: "favorite_on_air", options, style: onAirStyle }];
      prepare.push(`prepare_${f.id}`);
      presets[`prepare_${f.id}`] = button(f.label, "favorite_prepare", options, feedbacks);
      show.push(`show_${f.id}`);
      presets[`show_${f.id}`] = button(`${f.label}\n▶ air`, "favorite_show", options, feedbacks, 0x1d3f5e);
    }
    const structure = [
      {
        id: "transport",
        name: "Transport",
        definitions: [{ id: "transport", type: "simple", name: "Show / Update / Hide", presets: transport }],
      },
      {
        id: "favorites",
        name: "Favourites",
        definitions: [
          { id: "prepare", type: "simple", name: "Load into Preview (then press Show)", presets: prepare },
          { id: "show", type: "simple", name: "Straight to air", presets: show },
        ],
      },
    ];
    this.setPresetDefinitions(structure, presets);
  }
}
export const UpgradeScripts = [];
