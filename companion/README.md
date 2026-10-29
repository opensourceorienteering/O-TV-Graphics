# Split Control Companion module

This local module targets Companion API 2.0 (Node 22 runtime). It is not published to the Companion registry.

```sh
cd companion
npm install
npm run package
```

Load the resulting package into Companion using its developer module workflow. In Split Control, enter Live first, then configure the connection with the Split Control host and ports. Presets are generated from its cue pages with on-air feedback.

For a setup without a dedicated module, use Companion Generic HTTP: Plan → Control exports a JSON catalogue of button recipes. It is a recipe catalogue, not a native Companion page backup. See [the control protocol](../docs/CONTROL-API.md).

Module implementation follows the [official API 2.0 migration reference](https://companion.free/for-developers/module-development/api-changes/v2.0/).

`npm test --prefix companion` (from the repository root) validates module actions/tally/disconnect recovery against a local HTTP/Socket.IO server. This is software validation; exercise the packaged module with the intended Companion host and physical deck before a broadcast.
