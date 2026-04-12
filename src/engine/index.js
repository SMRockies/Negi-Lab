/**
 * Public barrel export for the circuit engine layer.
 *
 * This module provides the complete supported API for graph building,
 * net detection, and netlist generation. Engine consumers should import
 * from here rather than from individual engine files.
 *
 * Supported exports:
 * - buildGraph
 * - buildSimulationGraph
 * - buildReverseGraph
 * - collectReachableNodes
 * - buildNets
 * - findNet
 * - getNetIndex
 * - arePinsInSameNet
 * - getPoweredNetIndexes
 * - generateNetlist
 * - simulateCircuit
 * - simulateVoltage
 * - simulateCurrent
 * - getPinKey
 * - parsePinReference
 *
 * Usage:
 *   import { buildGraph, buildNets, generateNetlist, simulateCircuit, simulateVoltage, simulateCurrent } from "./engine";
 */

export {
  buildGraph,
  buildReverseGraph,
  buildSimulationGraph,
  collectReachableNodes,
} from "./buildGraph";

export {
  arePinsInSameNet,
  buildNets,
  findNet,
  getNetIndex,
  getPoweredNetIndexes,
} from "./findNets";

export { generateNetlist } from "./generateNetlist.ts";
export { simulateCircuit } from "./simulateCircuit.ts";
export { simulateVoltage } from "./simulateVoltage.ts";
export { simulateCurrent } from "./simulateCurrent.ts";

export { getPinKey, parsePinReference } from "./utils";
