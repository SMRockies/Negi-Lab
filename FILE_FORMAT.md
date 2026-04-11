# `.negi` File Format Reference

## Overview

`.negi` is a JSON-based circuit description format for Myine.

Its purpose is to store the authored circuit structure in a portable form so circuits can be:

- saved to disk
- loaded back into the editor
- shared between users
- versioned over time

The format is intentionally minimal. It is designed to store circuit authoring data, not derived runtime data such as graphs or simulation caches.

## Schema

### `version`

`version` is a numeric format version.

Example:

```json
{
  "version": 1
}
```

This allows the format to evolve later without ambiguity.

### `nodes`

`nodes` is an array of circuit components.

Each node represents a placed component in the editor, such as a battery, LED, or switch.

Typical node fields:

- `id`: unique component identifier
- `type`: component type such as `BATTERY`, `LED`, or `SWITCH`
- `x`: x-position on the canvas
- `y`: y-position on the canvas
- `state`: component-specific authored state

Example node:

```json
{
  "id": "switch1",
  "type": "SWITCH",
  "x": 300,
  "y": 200,
  "state": { "closed": true }
}
```

### `wires`

`wires` is an array of connections between component pins.

Each wire describes:

- `from`: source pin reference
- `to`: destination pin reference

Each pin reference contains:

- `nodeId`: the node the pin belongs to
- `pinId`: the specific pin on that node

Example wire:

```json
{
  "from": { "nodeId": "battery1", "pinId": "positive" },
  "to": { "nodeId": "led1", "pinId": "anode" }
}
```

### `meta`

`meta` is an optional object for descriptive file information.

It can be used for human-friendly metadata such as:

- `name`
- `createdAt`
- `author`

This is useful for project naming, indexing, and future library features.

## Full Example

The following example is the canonical `.negi` reference example:

```json
{
  "version": 1,
  "meta": {
    "name": "Basic LED Circuit",
    "createdAt": "2026-03-30",
    "author": "Srinjoy"
  },
  "nodes": [
    {
      "id": "battery1",
      "type": "BATTERY",
      "x": 500,
      "y": 200,
      "state": {}
    },
    {
      "id": "led1",
      "type": "LED",
      "x": 400,
      "y": 200,
      "state": {}
    },
    {
      "id": "switch1",
      "type": "SWITCH",
      "x": 300,
      "y": 200,
      "state": { "closed": true }
    }
  ],
  "wires": [
    {
      "from": { "nodeId": "battery1", "pinId": "positive" },
      "to": { "nodeId": "led1", "pinId": "anode" }
    },
    {
      "from": { "nodeId": "led1", "pinId": "cathode" },
      "to": { "nodeId": "switch1", "pinId": "a" }
    },
    {
      "from": { "nodeId": "switch1", "pinId": "b" },
      "to": { "nodeId": "battery1", "pinId": "negative" }
    }
  ]
}
```

## Design Principles

The `.negi` format should remain:

- minimal
- human-readable
- versioned
- portable
- independent from derived runtime state

That means values such as `graph` and `simulationState` should be recomputed after load instead of being stored in the file.

## Saving Filename

The editor currently lets the user choose the export filename before saving.

Filename behavior:

- if no name is provided, the editor falls back to `circuit.negi`
- if the user omits the extension, `.negi` is appended automatically
- invalid filename characters are normalized before download

Examples:

- `basic-led-circuit` becomes `basic-led-circuit.negi`
- `demo.negi` stays `demo.negi`
