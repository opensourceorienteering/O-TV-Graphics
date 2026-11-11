/**
 * Example timing plugin: reads a JSON file written in the timing SDK model.
 *
 * Copy this folder into Split Control's timing plugins folder (Settings > Data sources >
 * Open plugins folder), press Reload, and add a "JSON file (example)" data source.
 *
 * The file: { "competition": {...}, "classes": [...], "entries": [...] } with the fields of
 * Competition, ClassInfo and Entry in src/shared/timing-sdk/index.ts (see sample.json).
 * Shows: a config schema, push (the file is watched), an extra field (heartRate) and
 * readable connection errors.
 *
 * Plugins are CommonJS and run in Split Control's main process with full access to the
 * computer, so they use only Node's own modules here.
 */

/* global require, module */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- plugins are CommonJS
const fs = require('fs');

module.exports = {
  manifest: {
    id: 'json-file',
    name: 'JSON file (example)',
    description: 'Results from a JSON file in the timing SDK model; reloads when the file changes',
    version: '1.0.0',
    sdk: '^1.0',
    configSchema: {
      type: 'object',
      required: ['filePath'],
      properties: {
        filePath: { type: 'string', title: 'JSON file', format: 'file' },
        pollIntervalMs: { type: 'integer', title: 'Poll interval (ms)', default: 5000, minimum: 1000 }
      }
    },
    capabilities: { push: true, minPollMs: 1000, relays: true },
    extFields: [
      { key: 'heartRate', on: 'entry', type: 'number', label: 'Heart rate', unit: 'bpm' }
    ]
  },

  create(config, ctx) {
    let data = null;
    let watcher = null;

    const read = () => {
      try {
        data = JSON.parse(fs.readFileSync(config.filePath, 'utf8'));
      } catch (error) {
        // Half-written file: keep the last good copy
        if (!data) throw new Error(`Could not read ${config.filePath}: ${error.message}`, { cause: error });
        ctx.log.warn('JSON file unreadable, keeping the last copy', { error: error.message });
      }
      return data;
    };

    return {
      async connect() {
        if (!fs.existsSync(config.filePath)) throw new Error(`File not found: ${config.filePath}`);
        read();
        // Push: tell Split Control as soon as the file changes (polling stays as the fallback)
        watcher = fs.watch(config.filePath, () => {
          read();
          if (data && data.competition) ctx.changed(data.competition.id);
        });
      },
      close() {
        if (watcher) watcher.close();
        watcher = null;
      },
      async competitions() {
        return [read().competition];
      },
      async classes() {
        return read().classes;
      },
      async entries(_competitionId, classId) {
        return read().entries.filter(e => e.classId === classId);
      }
    };
  }
};
