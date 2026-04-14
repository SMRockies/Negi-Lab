# `.negi` File Format Reference

## Overview

`.negi` is a JSON-based circuit description format for Negi-Lab.

Its purpose is to store the authored circuit structure in a portable form so circuits can be:

- saved to disk
- loaded back into the editor
- shared between users
- versioned over time

The format is intentionally minimal. It is designed to store circuit authoring data, not derived runtime data such as graphs or simulation caches.

Derived electrical views such as nets and named netlists are reconstructed by the engine layer after load rather than stored directly in the file.

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

Each node represents a placed component in the editor, such as a battery, LED, switch, button, or resistor.

Typical node fields:

- `id`: unique component identifier
- `type`: component type such as `BATTERY`, `LED`, `SWITCH`, or `RESISTOR`
- `x`: x-position on the canvas
- `y`: y-position on the canvas
- `state`: component-specific authored state

Example node:

```json
{
  "id": "resistor1",
  "type": "RESISTOR",
  "x": 300,
  "y": 200,
  "state": { "resistance": 100 }
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
      "state": "CLOSED"
    },
    {
      "id": "resistor1",
      "type": "RESISTOR",
      "x": 200,
      "y": 200,
      "state": { "resistance": 100 }
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
      "to": { "nodeId": "resistor1", "pinId": "a" }
    },
    {
      "from": { "nodeId": "resistor1", "pinId": "b" },
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

The same rule applies to:

- derived net groups from `buildNets(...)`
- simulation-ready netlists from `generateNetlist(nodes, nets)`
- traversal results from `simulateCircuit(netlist)`
- voltage estimates from `simulateVoltage(netlist)`
- current estimates from `simulateCurrent(netlist)`

Those are engine outputs, not persisted file fields.

## Relationship to the Engine Layer

The `.negi` file stores the authored circuit only:

- `nodes`
- `wires`
- optional metadata

After import, the standalone engine layer in `src/engine/` derives higher-level electrical structures from that data:

- `buildGraph(wires, nodes)` creates the topology graph
- `buildNets(graph)` groups connected pins into nets
- `generateNetlist(nodes, nets)` converts those derived nets into a simulation-ready netlist:

```json
{
  "nets": [
    {
      "id": "NET0",
      "label": "VCC",
      "pins": [
        { "nodeId": "battery1", "pinId": "positive" },
        { "nodeId": "switch1", "pinId": "a" }
      ]
    },
    {
      "id": "NET1",
      "label": "GND",
      "pins": [
        { "nodeId": "led1", "pinId": "cathode" },
        { "nodeId": "battery1", "pinId": "negative" }
      ]
    }
  ],
  "components": [
    {
      "id": "led1",
      "type": "LED",
      "state": {},
      "pins": {
        "anode": "NET0",
        "cathode": "NET1"
      }
    }
  ]
}
```

This netlist shape is intentionally derived rather than embedded in `.negi`, so the saved file remains minimal and future engine logic can evolve without forcing redundant file updates.

The next derived layer is simulation:

- `simulateCircuit(netlist)` traverses the generated netlist from battery positive toward battery negative
- it reports powered nets, active conductive components, LED on/off state, and whether the circuit is complete
- `simulateVoltage(netlist)` performs a first static voltage-propagation pass and reports estimated voltage by net ID
- `simulateCurrent(netlist)` performs a first single-loop current solve and reports total loop current plus per-component current estimates

These simulation results are also derived runtime data and should not be written back into `.negi`.

## Saving Filename

The editor currently lets the user choose the export filename before saving.

Filename behavior:

- if no name is provided, the editor falls back to `circuit.negi`
- if the user omits the extension, `.negi` is appended automatically
- invalid filename characters are normalized before download

Examples:

- `basic-led-circuit` becomes `basic-led-circuit.negi`
- `demo.negi` stays `demo.negi`
