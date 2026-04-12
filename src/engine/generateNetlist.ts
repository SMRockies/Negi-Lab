/**
 * Builds a simulation-ready netlist from derived circuit nets.
 *
 * This module turns raw connectivity groups into a component-aware electrical
 * map. The result is suitable for future simulation rules because it answers:
 * - which pins belong to each net
 * - which net each component pin is attached to
 */

import { getComponent, getComponentBehavior } from "../componentRegistry";
import { parsePinReference } from "./utils";

export interface PinRef {
  nodeId: string;
  pinId: string;
}

export interface Net {
  id: string;
  label: string;
  pins: PinRef[];
}

export interface NodeComponentPin {
  id: string;
}

export interface NodeComponent {
  id: string;
  type: string;
  state?: unknown;
  pins?: NodeComponentPin[];
}

export interface ComponentNetMapping {
  id: string;
  type: string;
  state?: unknown;
  pins: Record<string, string>;
}

export interface Netlist {
  nets: Net[];
  components: ComponentNetMapping[];
}

function getSemanticNetLabel(netPins: PinRef[], nodes: NodeComponent[], fallbackId: string): string {
  const pinKeySet = new Set(netPins.map((pin) => `${pin.nodeId}:${pin.pinId}`));

  for (const node of nodes) {
    const sourcePins = getComponentBehavior(node).getSourcePins(node);

    if (!sourcePins) continue;

    if (pinKeySet.has(`${node.id}:${sourcePins.positive}`)) return "VCC";
    if (pinKeySet.has(`${node.id}:${sourcePins.negative}`)) return "GND";
  }

  return fallbackId;
}

function normalizeNetPins(rawPins: string[]): PinRef[] {
  return rawPins
    .map((pinKey) => parsePinReference(pinKey))
    .filter((pin): pin is PinRef => Boolean(pin));
}

function normalizeNets(rawNets: Array<string[] | Net>, nodes: NodeComponent[]): Net[] {
  return rawNets.map((rawNet, index) => {
    if (!Array.isArray(rawNet)) {
      return {
        id: rawNet.id,
        label: rawNet.label ?? rawNet.id,
        pins: rawNet.pins ?? [],
      };
    }

    const id = `NET${index}`;
    const pins = normalizeNetPins(rawNet);

    return {
      id,
      label: getSemanticNetLabel(pins, nodes, id),
      pins,
    };
  });
}

/**
 * Build quick lookup:
 * pinKey -> netId
 */
function buildPinToNetMap(nets: Net[]): Map<string, string> {
  const map = new Map<string, string>();

  for (const net of nets) {
    for (const pin of net.pins) {
      map.set(`${pin.nodeId}:${pin.pinId}`, net.id);
    }
  }

  return map;
}

function getNodePinIds(node: NodeComponent): string[] {
  if (Array.isArray(node.pins) && node.pins.length > 0) {
    return node.pins.map((pin) => pin.id);
  }

  return getComponent(node.type).pins.map((pin) => pin.id);
}

/**
 * Generate simulation-ready netlist.
 *
 * Input:
 * - `nodes`: authored components from circuit state
 * - `nets`: raw connected groups from `buildNets(graph)` or already-normalized nets
 *
 * Output:
 * - `nets`: normalized net objects with stable IDs and pin references
 * - `components`: per-component pin-to-net mapping
 */
export function generateNetlist(
  nodes: NodeComponent[],
  nets: Array<string[] | Net>
): Netlist {
  const normalizedNets = normalizeNets(nets, nodes);
  const pinToNet = buildPinToNetMap(normalizedNets);

  const components: ComponentNetMapping[] = nodes.map((node) => {
    const pins: Record<string, string> = {};

    for (const pinId of getNodePinIds(node)) {
      const netId = pinToNet.get(`${node.id}:${pinId}`);

      if (netId) {
        pins[pinId] = netId;
      }
    }

    return {
      id: node.id,
      type: node.type,
      state: node.state ?? null,
      pins,
    };
  });

  return {
    nets: normalizedNets,
    components,
  };
}
