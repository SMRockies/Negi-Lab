/**
 * Net detection and membership utilities.
 *
 * A "net" is a group of electrically connected pins, i.e. a connected
 * component of the topology graph. Each net represents one continuous
 * electrical node in the circuit.
 *
 * This module is part of the public engine API and is re-exported through
 * `src/engine/index.js`, which should be the supported import path.
 *
 * Public API from this module:
 * - buildNets
 * - findNet
 * - getNetIndex
 * - arePinsInSameNet
 * - getPoweredNetIndexes
 */

import { getComponentBehavior } from "../componentRegistry";
import { getPinKey } from "./utils";

/**
 * Derives all nets from a topology adjacency graph using depth-first search.
 *
 * Each net is an array of pin key strings that are all mutually reachable
 * through wires and closed-switch/button internal connections.
 *
 * @param {Object} graph  Topology adjacency map from buildGraph().
 * @returns {Array<string[]>} Array of nets, each a list of pin keys.
 *
 * @example
 * // Given battery+ -> switch_a -> (switch closed) -> switch_b -> led_anode -> led_cathode -> battery-
 * buildNets(graph)
 * // -> [
 * //     ["battery1:positive", "switch1:a"],
 * //     ["switch1:b", "led1:anode"],
 * //     ["led1:cathode", "battery1:negative"]
 * //   ]
 */
export function buildNets(graph) {
  const visited = new Set();
  const nets = [];

  for (const pin in graph) {
    if (visited.has(pin)) continue;

    const net = [];
    const stack = [pin];

    while (stack.length > 0) {
      const current = stack.pop();

      if (visited.has(current)) continue;

      visited.add(current);
      net.push(current);

      const neighbors = graph[current] || [];
      stack.push(...neighbors);
    }

    nets.push(net);
  }

  return nets;
}

/**
 * Returns the index of the net that contains the given pin key, or -1
 * if the pin does not appear in any net.
 *
 * @param {Array<string[]>} nets    Result of buildNets().
 * @param {string} pinKey           Pin key to look up.
 * @returns {number} Net index, or -1 if not found.
 */
export function getNetIndex(nets, pinKey) {
  return nets.findIndex((net) => net.includes(pinKey));
}

/**
 * Returns the net (array of pin keys) that contains the given pin key,
 * or null if the pin does not appear in any net.
 *
 * @param {Array<string[]>} nets    Result of buildNets().
 * @param {string} pinKey           Pin key to look up.
 * @returns {string[] | null}
 */
export function findNet(nets, pinKey) {
  const index = getNetIndex(nets, pinKey);
  return index === -1 ? null : nets[index];
}

/**
 * Returns true if both pin keys belong to the same derived net.
 *
 * @param {Array<string[]>} nets          Result of buildNets().
 * @param {string} firstPinKey            First pin key.
 * @param {string} secondPinKey           Second pin key.
 * @returns {boolean}
 */
export function arePinsInSameNet(nets, firstPinKey, secondPinKey) {
  const firstNet = findNet(nets, firstPinKey);
  const secondNet = findNet(nets, secondPinKey);
  return Boolean(firstNet && secondNet && firstNet === secondNet);
}

/**
 * Returns the set of net indexes that are energized by battery or other
 * source-component positive terminals.
 *
 * A powered net is one that contains at least one source-positive pin.
 * This drives higher-level propagation logic such as powered-wire rendering.
 *
 * @param {Array<string[]>} nets  Result of buildNets().
 * @param {Array} nodes           Component node objects from circuit state.
 * @returns {Set<number>} Set of powered net indexes.
 */
export function getPoweredNetIndexes(nets, nodes) {
  const poweredNetIndexes = new Set();

  const sourceNodes = nodes.filter(
    (node) => Boolean(getComponentBehavior(node).getSourcePins(node))
  );

  sourceNodes.forEach((sourceNode) => {
    const sourcePins = getComponentBehavior(sourceNode).getSourcePins(sourceNode);
    const positivePinKey = getPinKey(sourceNode.id, sourcePins.positive);
    const poweredNetIndex = getNetIndex(nets, positivePinKey);

    if (poweredNetIndex !== -1) {
      poweredNetIndexes.add(poweredNetIndex);
    }
  });

  return poweredNetIndexes;
}
