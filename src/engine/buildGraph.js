/**
 * Graph builders for the circuit engine.
 *
 * Public API from this module:
 * - buildGraph
 * - buildSimulationGraph
 * - buildReverseGraph
 * - collectReachableNodes
 *
 * Internal helpers in this file stay private on purpose. The supported
 * public import surface for engine consumers is `src/engine/index.js`.
 *
 * Two graph views are produced:
 * - Topology graph (`buildGraph`) for net extraction and structural logic.
 * - Simulation graph (`buildSimulationGraph`) for directed conduction analysis.
 */

import { getComponentBehavior } from "../componentRegistry";
import { getPinKey, parsePinReference } from "./utils";

/**
 * Adds a bidirectional edge between two pin keys in an adjacency graph.
 *
 * Internal helper. Consumers should use `buildGraph` or
 * `buildSimulationGraph` rather than importing this behavior directly.
 *
 * @param {Object} graph  Mutable adjacency map being built.
 * @param {string} a      First pin key.
 * @param {string} b      Second pin key.
 */
function connectPinKeys(graph, a, b) {
  if (!graph[a]) graph[a] = [];
  if (!graph[b]) graph[b] = [];
  graph[a].push(b);
  graph[b].push(a);
}

/**
 * Adds a directed (one-way) edge from one pin to another.
 *
 * Internal helper. Consumers should use `buildGraph` or
 * `buildSimulationGraph` rather than importing this behavior directly.
 *
 * @param {Object} graph   Mutable adjacency map being built.
 * @param {string} from    Source pin key.
 * @param {string} to      Destination pin key.
 */
function connectDirectedPinKeys(graph, from, to) {
  if (!graph[from]) graph[from] = [];
  if (!graph[to]) graph[to] = [];
  graph[from].push(to);
}

/**
 * Projects a component's behavior-defined internal connections into the graph.
 *
 * Internal helper used by both graph builders.
 *
 * @param {Object} graph       Mutable adjacency map being built.
 * @param {Object} node        The component node instance.
 * @param {Array} connections  Array of { from: pinId, to: pinId } objects.
 */
function injectBehaviorConnections(graph, node, connections) {
  connections.forEach((connection) => {
    connectDirectedPinKeys(
      graph,
      getPinKey(node.id, connection.from),
      getPinKey(node.id, connection.to)
    );
  });
}

/**
 * Builds a topology adjacency graph from committed wires and node behaviors.
 *
 * Used for net extraction, powered-net derivation, and structural editor logic.
 *
 * - Wire edges are bidirectional.
 * - Component internal connections (for example, closed switch a<->b) are
 *   injected as directed pairs so that bidirectional topology is captured.
 *
 * @param {Array} wires  Committed wire objects from circuit state.
 * @param {Array} nodes  Component node objects from circuit state.
 * @returns {Object} Adjacency map: { pinKey: string[] }
 */
export function buildGraph(wires, nodes) {
  const graph = {};

  wires.forEach((wire) => {
    const from = parsePinReference(wire.from);
    const to = parsePinReference(wire.to);

    if (!from || !to) return;

    connectPinKeys(graph, getPinKey(from.nodeId, from.pinId), getPinKey(to.nodeId, to.pinId));
  });

  nodes.forEach((node) => {
    injectBehaviorConnections(
      graph,
      node,
      getComponentBehavior(node).getConnections(node, "topology")
    );
  });

  return graph;
}

/**
 * Builds a simulation adjacency graph from nodes and wires.
 *
 * Used for directed activation analysis, reachability intersection, and
 * component conduction logic.
 *
 * Extends the topology graph with directed component-internal conduction rules:
 * - LED: anode -> cathode (forward-biased only)
 * - Battery: positive -> negative (conceptual source traversal)
 *
 * @param {Array} nodes  Component node objects from circuit state.
 * @param {Array} wires  Committed wire objects from circuit state.
 * @returns {Object} Directed adjacency map: { pinKey: string[] }
 */
export function buildSimulationGraph(nodes, wires) {
  const graph = {};

  wires.forEach((wire) => {
    const from = parsePinReference(wire.from);
    const to = parsePinReference(wire.to);

    if (!from || !to) return;

    // Wires are always bidirectional conductors in the simulation graph.
    connectPinKeys(
      graph,
      getPinKey(from.nodeId, from.pinId),
      getPinKey(to.nodeId, to.pinId)
    );
  });

  nodes.forEach((node) => {
    // Component behaviors inject their own directed conductive rules.
    injectBehaviorConnections(
      graph,
      node,
      getComponentBehavior(node).getConnections(node, "simulation")
    );
  });

  return graph;
}

/**
 * Reverses the direction of all edges in a directed adjacency graph.
 *
 * Used to enable reverse-reachability traversal from battery negative back
 * through the circuit using the same BFS primitive as forward traversal.
 *
 * @param {Object} graph  Directed adjacency map from buildSimulationGraph.
 * @returns {Object} Reversed adjacency map: { pinKey: string[] }
 */
export function buildReverseGraph(graph) {
  const reverseGraph = {};

  for (const fromPinKey in graph) {
    if (!reverseGraph[fromPinKey]) reverseGraph[fromPinKey] = [];

    for (const toPinKey of graph[fromPinKey]) {
      if (!reverseGraph[toPinKey]) reverseGraph[toPinKey] = [];
      reverseGraph[toPinKey].push(fromPinKey);
    }
  }

  return reverseGraph;
}

/**
 * Returns the set of all pin keys reachable from a starting pin in the given
 * graph using breadth-first search.
 *
 * Used for:
 * - forward reachability from battery positive
 * - reverse reachability from battery negative via buildReverseGraph
 *
 * @param {Object} graph        Adjacency map to traverse.
 * @param {string} startPinKey  Starting vertex (pin key string).
 * @returns {Set<string>} All reachable pin keys, including the start.
 */
export function collectReachableNodes(graph, startPinKey) {
  if (!startPinKey) return new Set();

  const visited = new Set();
  const queue = [startPinKey];

  while (queue.length > 0) {
    const current = queue.shift();

    if (visited.has(current)) continue;

    visited.add(current);

    const neighbors = graph[current] || [];
    for (const next of neighbors) {
      if (!visited.has(next)) queue.push(next);
    }
  }

  return visited;
}
