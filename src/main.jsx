import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import {
  createNode,
  getComponent,
  getComponentBehavior,
  hydrateNode,
  COMPONENT_OPTIONS,
} from "./componentRegistry";
import {
  exportCircuitToFile,
  importCircuitFromFile,
  normalizeCircuitFilename,
} from "./persistence";
import { ACTION_TYPES, createCircuitEngine } from "./simulationEngine";
import {
  arePinsInSameNet,
  buildGraph,
  buildNets,
  buildReverseGraph,
  buildSimulationGraph,
  collectReachableNodes,
  generateNetlist,
  getPinKey,
  getPoweredNetIndexes,
  parsePinReference,
  simulateCurrent,
  simulateVoltage,
} from "./engine";

function getNextSequenceValue(items, prefix) {
  const maxValue = items.reduce((currentMax, item) => {
    if (typeof item?.id !== "string" || !item.id.startsWith(prefix)) {
      return currentMax;
    }

    const parsedValue = Number.parseInt(item.id.slice(prefix.length), 10);
    return Number.isFinite(parsedValue) ? Math.max(currentMax, parsedValue) : currentMax;
  }, 0);

  return maxValue + 1;
}

function GridPattern() {
  return (
    <defs>
      <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
        <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#222" strokeWidth="1" />
      </pattern>
    </defs>
  );
}

function getPinGlobalPosition(node, pin) {
  const rotatedOffset = rotatePointOffset(pin.dx, pin.dy, getNodeRotation(node));

  return {
    x: node.x + rotatedOffset.dx,
    y: node.y + rotatedOffset.dy,
  };
}

function snap(value, gridSize = 20) {
  return Math.round(value / gridSize) * gridSize;
}

const SIDEBAR_WIDTH = 300;
const SIDEBAR_EDGE_OFFSET = 12;
const SIDEBAR_GAP = 24;
const SIDEBAR_CANVAS_OFFSET = SIDEBAR_WIDTH + SIDEBAR_EDGE_OFFSET + SIDEBAR_GAP;
const WORKSPACE_SIDEBAR_TOP = 152;
const SIDEBAR_COMPONENTS = [
  { value: "WIRE", label: "Wire", mode: "wire" },
  ...COMPONENT_OPTIONS.filter((component) => component.value !== "TEST").map((component) => ({
    value: component.value,
    label: component.label,
    mode: "create-node",
  })),
];

function getNodeRotation(node) {
  return typeof node?.rotation === "number" ? node.rotation : 0;
}

function isEditableKeyboardTarget(target) {
  if (!(target instanceof Element)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  const tagName = target.tagName?.toLowerCase();
  return tagName === "input" || tagName === "textarea";
}

function rotatePointOffset(dx, dy, rotation) {
  const normalizedRotation = ((rotation % 360) + 360) % 360;

  switch (normalizedRotation) {
    case 90:
      return { dx: -dy, dy: dx };
    case 180:
      return { dx: -dx, dy: -dy };
    case 270:
      return { dx: dy, dy: -dx };
    default:
      return { dx, dy };
  }
}

function getNodeStateObject(node) {
  return typeof node?.state === "object" && node.state !== null ? node.state : {};
}

function getSelectedNode(nodes, selectedNodeId) {
  return nodes.find((node) => node.id === selectedNodeId) ?? null;
}

function getButtonBaseStyle() {
  return {
    border: "1px solid #2f2f2f",
    borderRadius: 10,
    background: "#181818",
    color: "#d4d4d4",
    cursor: "pointer",
    fontFamily: "monospace",
    fontSize: 12,
    padding: "8px 10px",
  };
}



function getConnectedNodeIdsForWire(wire) {
  const from = parsePinReference(wire?.from);
  const to = parsePinReference(wire?.to);

  if (!from || !to) {
    return [];
  }

  return [from.nodeId, to.nodeId];
}

function isWireConnectedToNode(wire, nodeId) {
  const connectedNodeIds = getConnectedNodeIdsForWire(wire);
  return connectedNodeIds.includes(nodeId);
}

function isValidConnection(fromPinId, toPinId, wires) {
  const from = parsePinReference(fromPinId);
  const to = parsePinReference(toPinId);

  if (!from || !to) {
    return false;
  }

  if (from.nodeId === to.nodeId && from.pinId === to.pinId) {
    return false;
  }

  if (from.nodeId === to.nodeId) {
    return false;
  }

  return !wires.some(
    (wire) =>
      (getPinKey(wire.from.nodeId, wire.from.pinId) === fromPinId &&
        getPinKey(wire.to.nodeId, wire.to.pinId) === toPinId) ||
      (getPinKey(wire.from.nodeId, wire.from.pinId) === toPinId &&
        getPinKey(wire.to.nodeId, wire.to.pinId) === fromPinId)
  );
}



function computeSimulationState(simulationGraph, nodes, wires) {
  const sourceNode = nodes.find((node) => Boolean(getComponentBehavior(node).getSourcePins(node))) ?? null;

  if (!sourceNode) {
    return {
      forwardReachable: new Set(),
      backwardReachable: new Set(),
      poweredPins: new Set(),
      activeNodes: new Map(),
      poweredNodes: new Set(),
      pathEdges: [],
      blockedEdges: [],
    };
  }

  const sourcePins = getComponentBehavior(sourceNode).getSourcePins(sourceNode);
  const positivePinKey = getPinKey(sourceNode.id, sourcePins.positive);
  const negativePinKey = getPinKey(sourceNode.id, sourcePins.negative);
  const forwardReachable = collectReachableNodes(simulationGraph, positivePinKey);
  const backwardReachable = collectReachableNodes(buildReverseGraph(simulationGraph), negativePinKey);
  const poweredPins = new Set();

  forwardReachable.forEach((pinKey) => {
    if (backwardReachable.has(pinKey)) {
      poweredPins.add(pinKey);
    }
  });

  const activeNodes = new Map();

  nodes.forEach((node) => {
    const behavior = getComponentBehavior(node);
    const activationSegments = behavior.getActivationSegments(node);

    if (activationSegments.length > 0) {
      const isActive = activationSegments.some((segment) => {
        const fromPinKey = getPinKey(node.id, segment.from);
        const toPinKey = getPinKey(node.id, segment.to);

        return forwardReachable.has(fromPinKey) && backwardReachable.has(toPinKey);
      });

      activeNodes.set(node.id, {
        active: isActive,
        visualState: isActive ? "ON" : "OFF",
      });
      return;
    }

    const component = getComponent(node.type);
    const activityState = component.getNodeActivity(node, {
      simulationState: { poweredPins, forwardReachable, backwardReachable, activeNodes },
      poweredPins,
      forwardReachable,
      backwardReachable,
    });
    activeNodes.set(node.id, activityState);
  });

  // 4. Trace Path and Blocked Edges
  const poweredNodes = new Set();
  activeNodes.forEach((state, id) => state.active && poweredNodes.add(id));

  const pathEdges = [];
  const blockedEdges = [];

  // Path edges from wires
  wires.forEach((wire) => {
    const from = getPinKey(wire.from.nodeId, wire.from.pinId);
    const to = getPinKey(wire.to.nodeId, wire.to.pinId);
    if (poweredPins.has(from) && poweredPins.has(to)) {
      pathEdges.push({ from, to });
    }
  });

  // Internal paths and specific blocking conditions
  nodes.forEach((node) => {
    const behavior = getComponentBehavior(node);
    // Path edges (internal conductive segments)
    behavior.getConnections(node, "simulation").forEach((conn) => {
      const from = getPinKey(node.id, conn.from);
      const to = getPinKey(node.id, conn.to);
      if (poweredPins.has(from) && poweredPins.has(to)) {
        pathEdges.push({ from, to, isInternal: true });
      }
    });

    // Blocked edges (Switches/Buttons)
    if ((node.type === "SWITCH" || node.type === "BUTTON") && node.state === "OPEN") {
      blockedEdges.push({ from: getPinKey(node.id, "a"), to: getPinKey(node.id, "b") });
    }
    // Blocked edges (Reverse LED)
    if (node.type === "LED") {
      const anode = getPinKey(node.id, "anode");
      const cathode = getPinKey(node.id, "cathode");
      if (forwardReachable.has(cathode) && backwardReachable.has(anode)) {
        blockedEdges.push({ from: cathode, to: anode });
      }
    }
  });

  return {
    forwardReachable,
    backwardReachable,
    poweredPins,
    activeNodes,
    poweredNodes,
    pathEdges,
    blockedEdges,
  };
}

function getDiagnostics(nodes, simulationState, nets) {
  const { forwardReachable, backwardReachable, poweredPins, activeNodes } = simulationState;
  const inactiveNodes = [];
  const partialNodes = [];

  // 1 & 2. Detect Inactive and Partially Connected
  nodes.forEach((node) => {
    const nodePins = node.pins.map(p => getPinKey(node.id, p.id));

    // 1. Detect Inactive (Not participating in an active loop)
    const isParticipatingInLoop = nodePins.some(key => poweredPins.has(key));
    if (!isParticipatingInLoop) {
      inactiveNodes.push(node.id);
    }

    // 2. Detect Partially Connected (Has reachability but not a complete path)
    const hasPathThrough = activeNodes.get(node.id)?.active;
    if (!hasPathThrough) {
      const hasForward = nodePins.some(key => forwardReachable.has(key));
      const hasBackward = nodePins.some(key => backwardReachable.has(key));

      if (hasForward || hasBackward) {
        partialNodes.push(node.id);
      }
    }
  });

  // 3. Detect Floating Groups
  // We group nodes into connected components based on the shared nets.
  const nodeToSet = new Map();
  nodes.forEach(n => {
    const s = new Set([n.id]);
    nodeToSet.set(n.id, s);
  });

  nets.forEach(net => {
    const nodeIdsInNet = [...new Set(net.map(pk => pk.split(':')[0]))];
    if (nodeIdsInNet.length > 1) {
      const firstSet = nodeToSet.get(nodeIdsInNet[0]);
      for (let i = 1; i < nodeIdsInNet.length; i++) {
        const otherSet = nodeToSet.get(nodeIdsInNet[i]);
        if (firstSet !== otherSet) {
          otherSet.forEach(id => {
            firstSet.add(id);
            nodeToSet.set(id, firstSet);
          });
        }
      }
    }
  });

  const floatingGroups = [...new Set(nodeToSet.values())]
    .filter(group => {
      return ![...group].some(nodeId => {
        const node = nodes.find(n => n.id === nodeId);
        return node.pins.some(p => {
          const key = getPinKey(nodeId, p.id);
          return forwardReachable.has(key) || backwardReachable.has(key);
        });
      });
    })
    .map(group => [...group]);

  // 4. Detect Open Circuit
  const sourceNode = nodes.find((node) => Boolean(getComponentBehavior(node).getSourcePins(node))) ?? null;
  let hasOpenCircuit = false;
  if (sourceNode) {
    const sourcePins = getComponentBehavior(sourceNode).getSourcePins(sourceNode);
    const negativePinKey = getPinKey(sourceNode.id, sourcePins.negative);
    // If the battery exists but its return path (negative pin) isn't "powered", the circuit is open.
    hasOpenCircuit = !poweredPins.has(negativePinKey);
  }

  // 5. Detect Short Circuit
  // A short circuit occurs if the positive and negative terminals of a battery belong to the same net.
  let hasShortCircuit = false;
  const sourceNodes = nodes.filter((node) => Boolean(getComponentBehavior(node).getSourcePins(node)));
  for (const sourceNode of sourceNodes) {
    const sourcePins = getComponentBehavior(sourceNode).getSourcePins(sourceNode);
    const posKey = getPinKey(sourceNode.id, sourcePins.positive);
    const negKey = getPinKey(sourceNode.id, sourcePins.negative);
    if (arePinsInSameNet(nets, posKey, negKey)) {
      hasShortCircuit = true;
      break;
    }
  }

  return {
    inactiveNodes,
    partialNodes,
    floatingGroups,
    hasOpenCircuit,
    hasShortCircuit,
  };
}

function SimulationOverlay({ nodes, simulationState }) {
  const { pathEdges, blockedEdges } = simulationState;
  if (!pathEdges || !blockedEdges) return null;

  const renderEdge = (edge, color, isDashed = false) => {
    const fromPos = resolvePinPosition(nodes, edge.from);
    const toPos = resolvePinPosition(nodes, edge.to);
    if (!fromPos || !toPos) return null;
    return (
      <line
        key={`${edge.from}-${edge.to}-${color}`}
        x1={fromPos.x} y1={fromPos.y}
        x2={toPos.x} y2={toPos.y}
        stroke={color}
        strokeWidth="4"
        strokeDasharray={isDashed ? "4,4" : "none"}
        strokeLinecap="round"
        pointerEvents="none"
        opacity="0.8"
      />
    );
  };

  return (
    <g>
      {pathEdges.filter(e => e.isInternal).map(edge => renderEdge(edge, "#facc15"))}
      {blockedEdges.map(edge => renderEdge(edge, "#ef4444", true))}
    </g>
  );
}

function getConstrainedControlPointPosition(anchorPoint, nextPosition, event) {
  if (!anchorPoint || event.altKey || event.shiftKey) {
    return nextPosition;
  }

  const dx = Math.abs(nextPosition.x - anchorPoint.x);
  const dy = Math.abs(nextPosition.y - anchorPoint.y);

  if (dx > dy) {
    return {
      x: nextPosition.x,
      y: anchorPoint.y,
    };
  }

  return {
    x: anchorPoint.x,
    y: nextPosition.y,
  };
}

function WireLayer({
  draggedControlPoint,
  hoveredWireId,
  nodes,
  onControlPointDoubleClick,
  onControlPointMouseDown,
  onWireClick,
  onWireHover,
  selectedNodeId,
  selectedWireId,
  simulationState,
  wires,
}) {
  return wires.map((wire) => {
    const fromPin = resolvePinPosition(nodes, wire.from);
    const toPin = resolvePinPosition(nodes, wire.to);

    if (!fromPin || !toPin) {
      return null;
    }

    const pathPoints = [fromPin, ...(wire.points ?? []), toPin];
    const pointsString = pathPoints.map((point) => `${point.x},${point.y}`).join(" ");
    const isHovered = hoveredWireId === wire.id;
    const isSelected = selectedWireId === wire.id;
    const isConnectedToSelectedNode =
      selectedNodeId && isWireConnectedToNode(wire, selectedNodeId);
    const fromPinKey = getPinKey(wire.from.nodeId, wire.from.pinId);
    const toPinKey = getPinKey(wire.to.nodeId, wire.to.pinId);
    const isPowered =
      simulationState.poweredPins.has(fromPinKey) ||
      simulationState.poweredPins.has(toPinKey);

    return (
      <g key={wire.id}>
        <polyline
          points={pointsString}
          fill="none"
          stroke="transparent"
          strokeWidth="14"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ cursor: "pointer" }}
          onMouseEnter={() => onWireHover(wire.id)}
          onMouseLeave={() => onWireHover(null)}
          onClick={(event) => onWireClick(event, wire.id, toPin)}
        />
        <polyline
          points={pointsString}
          fill="none"
          stroke={
            isSelected
              ? "#ef4444"
              : isHovered
                ? isPowered
                  ? "#fde68a"
                  : "#67e8f9"
                : isConnectedToSelectedNode
                  ? isPowered
                    ? simulationState.poweredPins.has(fromPinKey) && simulationState.poweredPins.has(toPinKey)
                      ? "#facc15"
                      : "#f59e0b"
                    : "#f97316"
                  : isPowered
                    ? simulationState.poweredPins.has(fromPinKey) && simulationState.poweredPins.has(toPinKey)
                      ? "#facc15"
                      : "#fde047"
                    : "#22d3ee"
          }
          strokeWidth={isSelected ? 4 : isPowered ? 3 : 2}
          strokeLinecap="round"
          strokeLinejoin="round"
          pointerEvents="none"
        />
        {selectedWireId === wire.id &&
          (wire.points ?? []).map((point, pointIndex) => (
            <g key={`${wire.id}-point-${pointIndex}`}>
              <circle
                cx={point.x}
                cy={point.y}
                r="12"
                fill="transparent"
                style={{ cursor: "move" }}
                onDoubleClick={(event) =>
                  onControlPointDoubleClick(event, wire.id, pointIndex, point)
                }
                onMouseDown={(event) => onControlPointMouseDown(event, wire.id, pointIndex)}
              />
              <circle
                cx={point.x}
                cy={point.y}
                r="5"
                fill={
                  draggedControlPoint?.wireId === wire.id &&
                    draggedControlPoint?.pointIndex === pointIndex
                    ? "#f97316"
                    : "#fde68a"
                }
                stroke="#78350f"
                strokeWidth="1.5"
                pointerEvents="none"
              />
            </g>
          ))}
      </g>
    );
  });
}

function resolvePinPosition(nodes, pinReference) {
  const parsedPin = parsePinReference(pinReference);
  if (!parsedPin) {
    return null;
  }

  const { nodeId, pinId } = parsedPin;
  const node = nodes.find((currentNode) => currentNode.id === nodeId);
  if (!node) {
    return null;
  }

  const pin = node.pins.find((currentPin) => currentPin.id === pinId);
  if (!pin) {
    return null;
  }

  return getPinGlobalPosition(node, pin);
}

function NodeLayer({
  activePinId,
  draggedNodeId,
  nodes,
  onNodeClick,
  onNodeDoubleClick,
  onNodeHover,
  onNodeMouseDown,
  onPinClick,
  selectedWire,
  selectedNodeId,
  simulationState,
}) {
  function getPoweredPins(node) {
    return node.pins.filter((pin) => simulationState.poweredPins.has(getPinKey(node.id, pin.id)));
  }

  return nodes.map((node) => {
    const component = getComponent(node.type);
    const displayLabel = component.getDisplayLabel(node);

    return (
      <g
        key={node.id}
        onMouseEnter={() => onNodeHover(node.id)}
        onMouseLeave={() => onNodeHover(null)}
      >
        <g transform={`rotate(${getNodeRotation(node)} ${node.x} ${node.y})`}>
          {component.render(node, simulationState, {
            draggedNodeId,
            getConnectedNodeIdsForWire,
            getPoweredPins,
            onNodeClick,
            onNodeDoubleClick,
            onNodeHover,
            onNodeMouseDown,
            selectedNodeId,
            selectedWire,
          })}
        </g>
        <text
          x={node.x}
          y={node.y + 3}
          fill="#e5e7eb"
          fontFamily="monospace"
          fontSize="8"
          pointerEvents="none"
          textAnchor="middle"
        >
          {displayLabel}
        </text>

        {node.pins.map((pin) => {
          const pinPosition = getPinGlobalPosition(node, pin);
          const pinKey = `${node.id}:${pin.id}`;

          return (
            <g key={pin.id}>
              <text
                x={pinPosition.x + 6}
                y={pinPosition.y - 6}
                fill="#ffffff"
                fontFamily="monospace"
                fontSize="8"
                pointerEvents="none"
              >
                {pin.label ?? pin.id}
              </text>
              <circle
                cx={pinPosition.x}
                cy={pinPosition.y}
                r="12"
                fill="transparent"
                style={{ cursor: "crosshair" }}
                onClick={(event) => onPinClick(event, node.id, pin.id)}
              />
              <circle
                cx={pinPosition.x}
                cy={pinPosition.y}
                r={pin.radius}
                fill={
                  activePinId === pinKey
                    ? "#ef4444"
                    : simulationState.poweredPins.has(pinKey)
                      ? "#fde047"
                      : "#ffffff"
                }
                stroke={activePinId === pinKey ? "#fecaca" : simulationState.poweredPins.has(pinKey) ? "#facc15" : "#6b7280"}
                strokeWidth={activePinId === pinKey ? 2 : 1.5}
                pointerEvents="none"
              />
            </g>
          );
        })}
      </g>
    )
  });
}

function DebugReadoutContent({
  diagnostics,
  activePinId,
  canRedo,
  canUndo,
  netCount,
  futureCount,
  poweredNetCount,
  graphVertexCount,
  hoveredInspector,
  mode,
  nodeCount,
  pointerPosition,
  pastCount,
  recentChange,
  selectedNodeId,
  selectedWireId,
  wireCount,
  zoom,
}) {
  return (
    <>
      <div>
        {recentChange
          ? `Recent change: ${recentChange.label} (${recentChange.x}, ${recentChange.y})`
          : "Recent change: none"}
      </div>
      <div>
        {pointerPosition
          ? `Pointer: ${pointerPosition.x}, ${pointerPosition.y}`
          : "Pointer: off canvas"}
      </div>
      <div>{`Nodes: ${nodeCount}`}</div>
      <div>{`Wires: ${wireCount}`}</div>
      <div>{`Undo: ${canUndo ? "yes" : "no"} (${pastCount})`}</div>
      <div>{`Redo: ${canRedo ? "yes" : "no"} (${futureCount})`}</div>
      <div>{`Graph pins: ${graphVertexCount}`}</div>
      <div>{`Nets: ${netCount}`}</div>
      <div>{`Powered nets: ${poweredNetCount}`}</div>
      <div>{`Zoom: ${Math.round(zoom * 100)}%`}</div>
      <div>{`Mode: ${mode}`}</div>
      <div>{activePinId ? `Active pin: ${activePinId}` : "Active pin: none"}</div>
      <div>{selectedNodeId ? `Selected node: ${selectedNodeId}` : "Selected node: none"}</div>
      <div>{selectedWireId ? `Selected wire: ${selectedWireId}` : "Selected wire: none"}</div>
      <div>{`Open circuit: ${diagnostics.hasOpenCircuit ? 'yes' : 'no'}`}</div>
      <div>{`Short circuit: ${diagnostics.hasShortCircuit ? 'yes' : 'no'}`}</div>
      <div>{`Inactive nodes: ${diagnostics.inactiveNodes.length > 0 ? diagnostics.inactiveNodes.join(', ') : 'none'}`}</div>
      <div>{`Partial nodes: ${diagnostics.partialNodes.length > 0 ? diagnostics.partialNodes.join(', ') : 'none'}`}</div>
      <div>{`Floating groups: ${diagnostics.floatingGroups.length}`}</div>
      {hoveredInspector?.debugLines?.length
        ? hoveredInspector.debugLines.map((line) => <div key={line}>{line}</div>)
        : <div>Hover: none</div>}
    </>
  );
}

function CoordinateReadout(props) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const toggleStyle = getButtonBaseStyle();

  return (
    <>
      <button
        style={{
          ...toggleStyle,
          position: "fixed",
          top: 12,
          left: 12,
          zIndex: 3,
          minWidth: 74,
        }}
        onClick={() => setIsCollapsed((previousValue) => !previousValue)}
        type="button"
      >
        {isCollapsed ? "Debug +" : "Debug -"}
      </button>
      {!isCollapsed && (
        <div
          style={{
            position: "fixed",
            top: 56,
            left: 12,
            padding: "8px 10px",
            borderRadius: 6,
            background: "rgba(0, 0, 0, 0.65)",
            color: "#d4d4d4",
            fontFamily: "monospace",
            fontSize: 12,
            lineHeight: 1.5,
            pointerEvents: "none",
            zIndex: 2,
          }}
        >
          <DebugReadoutContent {...props} />
        </div>
      )}
    </>
  );
}

function formatCurrentValue(current, fallback = "--") {
  if (!Number.isFinite(current)) {
    return fallback;
  }

  if (current === 0) {
    return "0 A";
  }

  const absoluteCurrent = Math.abs(current);

  if (absoluteCurrent < 1) {
    return `${(current * 1000).toFixed(0)} mA`;
  }

  return `${current.toFixed(2)} A`;
}

function formatVoltageValue(voltage, fallback = "--") {
  if (!Number.isFinite(voltage)) {
    return fallback;
  }

  return `${voltage.toFixed(2)} V`;
}

function formatResistanceValue(resistance, fallback = "--") {
  if (!Number.isFinite(resistance)) {
    return fallback;
  }

  return `${resistance} \u03a9`;
}

function getBatteryVoltage(node) {
  return typeof node?.state?.voltage === "number" ? node.state.voltage : 9;
}

function getNodeNetVoltage(node, pinId, componentNetMap, netVoltages) {
  const netId = componentNetMap?.pins?.[pinId];
  const voltage = netId ? netVoltages[netId] : undefined;
  return Number.isFinite(voltage) ? voltage : null;
}

function getNodeVoltageDrop(node, componentNetMap, netVoltages) {
  if (!node || !componentNetMap) {
    return null;
  }

  switch (node.type) {
    case "RESISTOR":
    case "SWITCH":
    case "BUTTON": {
      const aVoltage = getNodeNetVoltage(node, "a", componentNetMap, netVoltages);
      const bVoltage = getNodeNetVoltage(node, "b", componentNetMap, netVoltages);
      return aVoltage === null || bVoltage === null ? null : Math.abs(aVoltage - bVoltage);
    }

    case "LED": {
      const anodeVoltage = getNodeNetVoltage(node, "anode", componentNetMap, netVoltages);
      const cathodeVoltage = getNodeNetVoltage(node, "cathode", componentNetMap, netVoltages);
      return anodeVoltage === null || cathodeVoltage === null
        ? null
        : Math.abs(anodeVoltage - cathodeVoltage);
    }

    case "BATTERY": {
      const positiveVoltage = getNodeNetVoltage(node, "positive", componentNetMap, netVoltages);
      const negativeVoltage = getNodeNetVoltage(node, "negative", componentNetMap, netVoltages);
      return positiveVoltage === null || negativeVoltage === null
        ? getBatteryVoltage(node)
        : Math.abs(positiveVoltage - negativeVoltage);
    }

    default:
      return null;
  }
}

function buildHoveredInspector({
  hoveredEntity,
  nodes,
  wires,
  componentNetMapById,
  currentResult,
  netVoltages,
  simulationState,
}) {
  if (!hoveredEntity) {
    return null;
  }

  if (hoveredEntity.kind === "wire") {
    const wire = wires.find((currentWire) => currentWire.id === hoveredEntity.id);

    if (!wire) {
      return null;
    }

    return {
      debugLines: [`Hovering Wire: ${wire.id}`],
      tooltipRows: [
        { label: "Type", value: "WIRE" },
        { label: "ID", value: wire.id },
      ],
    };
  }

  const node = nodes.find((currentNode) => currentNode.id === hoveredEntity.id);

  if (!node) {
    return null;
  }

  const componentNetMap = componentNetMapById.get(node.id) ?? null;
  const componentCurrent = currentResult.componentCurrents[node.id];
  const voltageDrop = getNodeVoltageDrop(node, componentNetMap, netVoltages);
  const ledIsOn = Boolean(simulationState.activeNodes.get(node.id)?.active);
  const tooltipRows = [
    { label: "Type", value: node.type },
    { label: "ID", value: node.id },
  ];

  switch (node.type) {
    case "RESISTOR": {
      const resistance =
        typeof node.state?.resistance === "number" ? node.state.resistance : 100;

      tooltipRows.push(
        { label: "Resistance", value: formatResistanceValue(resistance) },
        { label: "Current", value: formatCurrentValue(componentCurrent) },
        { label: "Voltage Drop", value: formatVoltageValue(voltageDrop) },
      );

      return {
        debugLines: [
          `Hovering Resistor: ${formatResistanceValue(resistance)}`,
          `Current: ${formatCurrentValue(componentCurrent)}`,
          `Voltage Drop: ${formatVoltageValue(voltageDrop)}`,
        ],
        tooltipRows,
      };
    }

    case "LED": {
      tooltipRows.push(
        { label: "State", value: ledIsOn ? "ON" : "OFF" },
        { label: "Forward Voltage", value: formatVoltageValue(voltageDrop) },
        { label: "Current", value: formatCurrentValue(componentCurrent) },
      );

      return {
        debugLines: [
          `Hovering LED: ${ledIsOn ? "ON" : "OFF"}`,
          `Forward Voltage: ${formatVoltageValue(voltageDrop)}`,
          `Current: ${formatCurrentValue(componentCurrent)}`,
        ],
        tooltipRows,
      };
    }

    case "BATTERY": {
      const batteryVoltage = getBatteryVoltage(node);

      tooltipRows.push(
        { label: "Voltage", value: formatVoltageValue(batteryVoltage) },
        { label: "Output Current", value: formatCurrentValue(currentResult.totalCurrent) },
      );

      return {
        debugLines: [
          `Hovering Battery: ${formatVoltageValue(batteryVoltage)}`,
          `Output Current: ${formatCurrentValue(currentResult.totalCurrent)}`,
        ],
        tooltipRows,
      };
    }

    case "SWITCH": {
      const isClosed = node.state === "CLOSED";

      tooltipRows.push(
        { label: "State", value: isClosed ? "CLOSED" : "OPEN" },
        { label: "Current Passing", value: formatCurrentValue(componentCurrent) },
      );

      return {
        debugLines: [
          `Hovering Switch: ${isClosed ? "CLOSED" : "OPEN"}`,
          `Current Passing: ${formatCurrentValue(componentCurrent)}`,
        ],
        tooltipRows,
      };
    }

    case "BUTTON": {
      const isPressed = node.state === "CLOSED";

      tooltipRows.push(
        { label: "State", value: isPressed ? "PRESSED" : "RELEASED" },
        { label: "Current Passing", value: formatCurrentValue(componentCurrent) },
      );

      return {
        debugLines: [
          `Hovering Button: ${isPressed ? "PRESSED" : "RELEASED"}`,
          `Current Passing: ${formatCurrentValue(componentCurrent)}`,
        ],
        tooltipRows,
      };
    }

    default:
      return {
        debugLines: [`Hovering ${node.type}: ${node.id}`],
        tooltipRows,
      };
  }
}

function HoverInspectorTooltip({ hoveredInspector, pointerClientPosition, viewport }) {
  if (!hoveredInspector || !pointerClientPosition) {
    return null;
  }

  const tooltipWidth = 220;
  const tooltipHeight = 140;
  const offset = 16;
  const left = Math.min(pointerClientPosition.x + offset, viewport.width - tooltipWidth - 12);
  const top = Math.min(pointerClientPosition.y + offset, viewport.height - tooltipHeight - 12);

  return (
    <div
      style={{
        position: "fixed",
        left: Math.max(12, left),
        top: Math.max(12, top),
        minWidth: 180,
        maxWidth: tooltipWidth,
        padding: "10px 12px",
        border: "1px solid rgba(34, 211, 238, 0.35)",
        borderRadius: 8,
        background: "rgba(7, 11, 18, 0.92)",
        boxShadow: "0 14px 30px rgba(0, 0, 0, 0.32)",
        color: "#e5e7eb",
        fontFamily: "monospace",
        fontSize: 12,
        lineHeight: 1.45,
        pointerEvents: "none",
        zIndex: 4,
      }}
    >
      {hoveredInspector.tooltipRows.map((row) => (
        <div
          key={`${row.label}:${row.value}`}
          style={{ display: "flex", justifyContent: "space-between", gap: 12 }}
        >
          <span style={{ color: "#67e8f9" }}>{row.label}</span>
          <span style={{ textAlign: "right" }}>{row.value}</span>
        </div>
      ))}
    </div>
  );
}

function HistoryToolbar({ canRedo, canUndo, onRedo, onUndo }) {
  const buttonStyle = {
    ...getButtonBaseStyle(),
    minWidth: 70,
  };

  const disabledStyle = {
    opacity: 0.45,
    cursor: "not-allowed",
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 100,
        right: 12,
        display: "flex",
        gap: 8,
        zIndex: 2,
      }}
    >
      <button
        style={canUndo ? buttonStyle : { ...buttonStyle, ...disabledStyle }}
        onClick={onUndo}
        disabled={!canUndo}
        type="button"
      >
        Undo
      </button>
      <button
        style={canRedo ? buttonStyle : { ...buttonStyle, ...disabledStyle }}
        onClick={onRedo}
        disabled={!canRedo}
        type="button"
      >
        Redo
      </button>
    </div>
  );
}

function ModeToolbar({ mode, onModeChange }) {
  const baseButtonStyle = getButtonBaseStyle();

  function getButtonStyle(buttonMode) {
    return {
      ...baseButtonStyle,
      background: mode === buttonMode ? "#0f766e" : baseButtonStyle.background,
      borderColor: mode === buttonMode ? "#22d3ee" : "#2f2f2f",
      color: mode === buttonMode ? "#ecfeff" : baseButtonStyle.color,
    };
  }

  return (
    <div
      style={{
        position: "fixed",
        top: 12,
        right: 12,
        display: "flex",
        gap: 8,
        zIndex: 2,
      }}
    >
      <button style={getButtonStyle("select")} onClick={() => onModeChange("select")} type="button">
        Select
      </button>
      <button style={getButtonStyle("create-node")} onClick={() => onModeChange("create-node")} type="button">
        Create Node
      </button>
      <button style={getButtonStyle("wire")} onClick={() => onModeChange("wire")} type="button">
        Wire
      </button>
    </div>
  );
}

function WorkspaceSection({ children, title }) {
  return (
    <div
      style={{
        background: "linear-gradient(180deg, rgba(24, 24, 24, 0.96), rgba(13, 16, 22, 0.98))",
        border: "1px solid rgba(255, 255, 255, 0.08)",
        borderRadius: 16,
        padding: 16,
        boxShadow: "0 18px 40px rgba(0, 0, 0, 0.28)",
      }}
    >
      <div
        style={{
          color: "#f3f4f6",
          fontFamily: "system-ui, sans-serif",
          fontWeight: 700,
          fontSize: 12,
          letterSpacing: "0.08em",
          marginBottom: 12,
          textTransform: "uppercase",
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function InspectorNumberField({
  label,
  min,
  onSubmit,
  step,
  value,
}) {
  const [draftValue, setDraftValue] = useState(String(value));

  useEffect(() => {
    setDraftValue(String(value));
  }, [value]);

  function commitValue() {
    const parsedValue = Number.parseFloat(String(draftValue).trim());

    if (!Number.isFinite(parsedValue) || (typeof min === "number" && parsedValue < min)) {
      setDraftValue(String(value));
      return;
    }

    onSubmit(parsedValue);
  }

  return (
    <label style={{ display: "grid", gap: 6 }}>
      <span style={{ color: "#a5b4c3", fontSize: 12, fontFamily: "monospace" }}>{label}</span>
      <input
        value={draftValue}
        onBlur={commitValue}
        onChange={(event) => setDraftValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            commitValue();
          }
        }}
        min={min}
        step={step}
        style={{
          background: "#0f141b",
          border: "1px solid rgba(255, 255, 255, 0.1)",
          borderRadius: 10,
          color: "#f3f4f6",
          fontFamily: "monospace",
          fontSize: 13,
          outline: "none",
          padding: "10px 12px",
        }}
        type="number"
      />
    </label>
  );
}

function WorkspaceSidebar({
  componentSearch,
  componentType,
  currentFilename,
  mode,
  onComponentSearchChange,
  onComponentSelect,
  onDeleteSelection,
  onImport,
  onRotateSelectedNode,
  onSave,
  onSaveAs,
  onUpdateBatteryVoltage,
  onUpdateResistorValue,
  onExport,
  selectedNode,
  selectedWire,
}) {
  const buttonStyle = getButtonBaseStyle();
  const primaryButtonStyle = {
    ...buttonStyle,
    background: "linear-gradient(180deg, #0f766e, #115e59)",
    borderColor: "#22d3ee",
    color: "#ecfeff",
  };
  const inspectorButtonStyle = {
    ...buttonStyle,
    width: "100%",
  };
  const filteredComponents = SIDEBAR_COMPONENTS.filter((component) =>
    component.label.toLowerCase().includes(componentSearch.trim().toLowerCase())
  );

  return (
    <aside
      style={{
        position: "fixed",
        top: WORKSPACE_SIDEBAR_TOP,
        right: SIDEBAR_EDGE_OFFSET,
        bottom: 12,
        width: SIDEBAR_WIDTH,
        display: "flex",
        flexDirection: "column",
        gap: 14,
        overflowY: "auto",
        paddingRight: 4,
        zIndex: 2,
      }}
    >
      <WorkspaceSection title="Project Panel">
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "grid", gap: 4 }}>
            <div style={{ color: "#f8fafc", fontSize: 20, fontWeight: 700 }}>
              Negi-Lab
            </div>
            <div
              style={{
                background: "rgba(15, 23, 42, 0.9)",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                borderRadius: 12,
                color: "#cbd5e1",
                fontFamily: "monospace",
                fontSize: 13,
                padding: "10px 12px",
              }}
            >
              {currentFilename}
            </div>
          </div>
          <div
            style={{
              display: "grid",
              gap: 8,
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            }}
          >
            <button style={primaryButtonStyle} onClick={onSave} type="button">
              Save
            </button>
            <button style={buttonStyle} onClick={onSaveAs} type="button">
              Save As
            </button>
            <button style={buttonStyle} onClick={onImport} type="button">
              Load
            </button>
            <button style={buttonStyle} onClick={onExport} type="button">
              Export
            </button>
          </div>
        </div>
      </WorkspaceSection>

      <WorkspaceSection title="Component Library">
        <div style={{ display: "grid", gap: 12 }}>
          <input
            value={componentSearch}
            onChange={(event) => onComponentSearchChange(event.target.value)}
            placeholder="Search components"
            style={{
              background: "#0f141b",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              borderRadius: 12,
              color: "#f3f4f6",
              fontFamily: "monospace",
              fontSize: 13,
              outline: "none",
              padding: "10px 12px",
            }}
            type="text"
          />
          <div
            style={{
              background: "rgba(10, 14, 20, 0.78)",
              border: "1px solid rgba(255, 255, 255, 0.06)",
              borderRadius: 14,
              display: "grid",
              gap: 10,
              maxHeight: 250,
              overflowY: "auto",
              padding: 12,
            }}
          >
            <div
              style={{
                color: "#94a3b8",
                fontFamily: "monospace",
                fontSize: 12,
                textTransform: "uppercase",
              }}
            >
              Basic
            </div>
            {filteredComponents.map((component) => {
              const isCurrentComponent =
                component.mode === "wire"
                  ? mode === "wire"
                  : mode === "create-node" && componentType === component.value;

              return (
                <button
                  key={component.value}
                  style={{
                    ...buttonStyle,
                    background: isCurrentComponent ? "rgba(15, 118, 110, 0.32)" : "#161b22",
                    borderColor: isCurrentComponent ? "#22d3ee" : "#2f2f2f",
                    textAlign: "left",
                  }}
                  onClick={() => onComponentSelect(component)}
                  type="button"
                >
                  {component.label}
                </button>
              );
            })}
            {filteredComponents.length === 0 && (
              <div style={{ color: "#64748b", fontFamily: "monospace", fontSize: 12 }}>
                No components found.
              </div>
            )}
          </div>
        </div>
      </WorkspaceSection>

      <WorkspaceSection title="Properties Inspector">
        {!selectedNode && !selectedWire && (
          <div style={{ color: "#94a3b8", fontFamily: "monospace", fontSize: 13 }}>
            No component selected
          </div>
        )}

        {selectedWire && (
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ color: "#f8fafc", fontWeight: 600 }}>{selectedWire.id}</div>
            <div style={{ color: "#94a3b8", fontFamily: "monospace", fontSize: 12 }}>
              Wire info
            </div>
            <div style={{ color: "#cbd5e1", fontFamily: "monospace", fontSize: 12 }}>
              {`${selectedWire.from.nodeId}:${selectedWire.from.pinId} -> ${selectedWire.to.nodeId}:${selectedWire.to.pinId}`}
            </div>
            <button style={inspectorButtonStyle} onClick={onDeleteSelection} type="button">
              Delete
            </button>
          </div>
        )}

        {selectedNode?.type === "RESISTOR" && (
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "grid", gap: 6 }}>
              <span style={{ color: "#a5b4c3", fontSize: 12, fontFamily: "monospace" }}>
                Component name
              </span>
              <div style={{ color: "#f8fafc", fontFamily: "monospace", fontSize: 13 }}>
                {selectedNode.id}
              </div>
            </div>
            <InspectorNumberField
              label="Resistance value"
              min={0.01}
              onSubmit={onUpdateResistorValue}
              step="any"
              value={typeof selectedNode.state?.resistance === "number" ? selectedNode.state.resistance : 100}
            />
            <button style={inspectorButtonStyle} onClick={onRotateSelectedNode} type="button">
              Rotate
            </button>
            <button style={inspectorButtonStyle} onClick={onDeleteSelection} type="button">
              Delete
            </button>
          </div>
        )}

        {selectedNode?.type === "BATTERY" && (
          <div style={{ display: "grid", gap: 12 }}>
            <InspectorNumberField
              label="Voltage"
              min={0.01}
              onSubmit={onUpdateBatteryVoltage}
              step="any"
              value={getBatteryVoltage(selectedNode)}
            />
            <button style={inspectorButtonStyle} onClick={onRotateSelectedNode} type="button">
              Rotate
            </button>
            <button style={inspectorButtonStyle} onClick={onDeleteSelection} type="button">
              Delete
            </button>
          </div>
        )}

        {selectedNode?.type === "LED" && (
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ color: "#f8fafc", fontWeight: 600 }}>{selectedNode.id}</div>
            <button style={inspectorButtonStyle} onClick={onRotateSelectedNode} type="button">
              Rotate
            </button>
            <button style={inspectorButtonStyle} onClick={onDeleteSelection} type="button">
              Delete
            </button>
          </div>
        )}

        {selectedNode?.type === "SWITCH" && (
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ color: "#f8fafc", fontWeight: 600 }}>{selectedNode.id}</div>
            <button style={inspectorButtonStyle} onClick={onRotateSelectedNode} type="button">
              Rotate
            </button>
            <button style={inspectorButtonStyle} onClick={onDeleteSelection} type="button">
              Delete
            </button>
          </div>
        )}

        {selectedNode?.type === "TEST" && (
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ color: "#f8fafc", fontWeight: 600 }}>{selectedNode.id}</div>
            <button style={inspectorButtonStyle} onClick={onRotateSelectedNode} type="button">
              Rotate
            </button>
            <button style={inspectorButtonStyle} onClick={onDeleteSelection} type="button">
              Delete
            </button>
          </div>
        )}

        {selectedNode &&
          !["RESISTOR", "BATTERY", "LED", "SWITCH", "TEST"].includes(selectedNode.type) && (
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ color: "#f8fafc", fontWeight: 600 }}>{selectedNode.id}</div>
              <button style={inspectorButtonStyle} onClick={onRotateSelectedNode} type="button">
                Rotate
              </button>
              <button style={inspectorButtonStyle} onClick={onDeleteSelection} type="button">
                Delete
              </button>
            </div>
          )}
      </WorkspaceSection>
    </aside>
  );
}

function WireHint({ selectedWireId }) {
  if (!selectedWireId) {
    return null;
  }

  return (
    <div
      style={{
        position: "fixed",
        bottom: 12,
        left: "50%",
        transform: "translateX(-50%)",
        padding: "8px 12px",
        borderRadius: 6,
        background: "rgba(0, 0, 0, 0.72)",
        color: "#d4d4d4",
        fontFamily: "monospace",
        fontSize: 12,
        lineHeight: 1.4,
        pointerEvents: "none",
        zIndex: 2,
      }}
    >
      Hold Alt or Shift to disable constraints for freeform dragging. Double-click a bend point to remove it.
    </div>
  );
}

function ZoomToolbar({ onZoomIn, onZoomOut, onZoomReset, zoom }) {
  const buttonStyle = {
    ...getButtonBaseStyle(),
    minWidth: 44,
  };

  return (
    <div
      style={{
        position: "fixed",
        right: 12,
        bottom: 12,
        display: "flex",
        gap: 8,
        alignItems: "center",
        zIndex: 2,
      }}
    >
      <button style={buttonStyle} onClick={onZoomOut} type="button">
        -
      </button>
      <button style={{ ...buttonStyle, minWidth: 72 }} onClick={onZoomReset} type="button">
        {Math.round(zoom * 100)}%
      </button>
      <button style={buttonStyle} onClick={onZoomIn} type="button">
        +
      </button>
    </div>
  );
}

function Editor() {
  const containerRef = useRef(null);
  const dragStartStateRef = useRef(null);
  const fileInputRef = useRef(null);
  const skipCanvasClickRef = useRef(false);
  const skipNodeClickRef = useRef(false);
  const svgRef = useRef(null);
  const nextNodeId = useRef(2);
  const nextWireId = useRef(1);
  const canvasSize = { width: 3200, height: 2000 };

  const engine = useMemo(
    () =>
      createCircuitEngine({
        buildGraph,
        buildSimulationGraph,
        computeSimulationState,
      }),
    []
  );

  const [circuitState, setCircuitState] = useState(() =>
    engine.createState({
      nodes: [createNode("TEST", "node-1", 100, 100)],
      wires: [],
    })
  );
  const [componentTypeToCreate, setComponentTypeToCreate] = useState("RESISTOR");
  const [componentSearch, setComponentSearch] = useState("");
  const [mode, setMode] = useState("select");
  const [activePinId, setActivePinId] = useState(null);
  const [canvasPanStart, setCanvasPanStart] = useState(null);
  const [draggedControlPoint, setDraggedControlPoint] = useState(null);
  const [dragStart, setDragStart] = useState(null);
  const [draggedNodeId, setDraggedNodeId] = useState(null);
  const [hoveredEntity, setHoveredEntity] = useState(null);
  const [isPanningCanvas, setIsPanningCanvas] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [pointerClientPosition, setPointerClientPosition] = useState(null);
  const [pointerPosition, setPointerPosition] = useState(null);
  const [selectedNodeId, setSelectedNodeId] = useState("node-1");
  const [selectedWireId, setSelectedWireId] = useState(null);
  const [wireDraftPoints, setWireDraftPoints] = useState([]);
  const [zoom, setZoom] = useState(1);
  const [exportFilename, setExportFilename] = useState("circuit.negi");
  const [recentChange, setRecentChange] = useState({
    label: "Initial node",
    x: 100,
    y: 100,
  });
  const [viewport, setViewport] = useState(() => ({
    width: typeof window !== "undefined" ? window.innerWidth : 1920,
    height: typeof window !== "undefined" ? window.innerHeight : 1080,
  }));

  const {
    past,
    present,
    future,
    graph: connectionGraph,
    simulationState,
  } = circuitState;
  const { nodes, wires } = present;

  function dispatch(action) {
    setCircuitState((previousState) => engine.dispatch(previousState, action));
  }

  function handleNodeHover(nodeId) {
    setHoveredEntity(nodeId ? { kind: "node", id: nodeId } : null);
  }

  function handleWireHover(wireId) {
    setHoveredEntity(wireId ? { kind: "wire", id: wireId } : null);
  }

  function finalizeDragTransaction() {
    if (!dragStartStateRef.current) {
      return;
    }

    dispatch({
      type: ACTION_TYPES.COMMIT_HISTORY_ENTRY,
      payload: {
        before: dragStartStateRef.current,
      },
    });
    dragStartStateRef.current = null;
  }

  function handleUndo() {
    dispatch({ type: ACTION_TYPES.UNDO });
  }

  function handleRedo() {
    dispatch({ type: ACTION_TYPES.REDO });
  }

  function exportCircuit(filename) {
    const normalizedFilename = normalizeCircuitFilename(filename);
    exportCircuitToFile(present, normalizedFilename);
    setExportFilename(normalizedFilename);
    return normalizedFilename;
  }

  function handleExportCircuit() {
    const filename = exportCircuit(exportFilename);
    setRecentChange((previousChange) => ({
      label: `Saved ${filename}`,
      x: previousChange?.x ?? 0,
      y: previousChange?.y ?? 0,
    }));
  }

  function handleSaveAsCircuit() {
    const response = window.prompt("Save circuit as", exportFilename);

    if (response === null) {
      return;
    }

    const filename = exportCircuit(response);
    setRecentChange((previousChange) => ({
      label: `Saved as ${filename}`,
      x: previousChange?.x ?? 0,
      y: previousChange?.y ?? 0,
    }));
  }

  function handleImportClick() {
    fileInputRef.current?.click();
  }

  async function handleImportCircuit(event) {
    const [file] = Array.from(event.target.files ?? []);

    if (!file) {
      return;
    }

    try {
      const loadedCircuit = await importCircuitFromFile(file);
      const hydratedNodes = loadedCircuit.nodes.map(hydrateNode);
      const hydratedWires = loadedCircuit.wires.map((wire) => ({
        ...wire,
        points: wire.points ?? [],
      }));

      nextNodeId.current = getNextSequenceValue(hydratedNodes, "node-");
      nextWireId.current = getNextSequenceValue(hydratedWires, "wire-");

      dispatch({
        type: ACTION_TYPES.LOAD_CIRCUIT,
        payload: {
          nodes: hydratedNodes,
          wires: hydratedWires,
        },
      });

      setExportFilename(normalizeCircuitFilename(file.name));
      setActivePinId(null);
      setDraggedControlPoint(null);
      setDraggedNodeId(null);
      setSelectedNodeId(hydratedNodes[0]?.id ?? null);
      setSelectedWireId(null);
      setWireDraftPoints([]);
      setRecentChange({
        label: `Loaded ${file.name}`,
        x: hydratedNodes[0]?.x ?? 0,
        y: hydratedNodes[0]?.y ?? 0,
      });
    } catch (error) {
      setRecentChange((previousChange) => ({
        label: `Load failed: ${error.message}`,
        x: previousChange?.x ?? 0,
        y: previousChange?.y ?? 0,
      }));
    } finally {
      event.target.value = "";
    }
  }

  function handleDeleteSelection() {
    if (selectedWireId) {
      const wireToDelete = wires.find((wire) => wire.id === selectedWireId);

      if (!wireToDelete) {
        return;
      }

      dispatch({
        type: ACTION_TYPES.REMOVE_WIRE,
        payload: { wireId: selectedWireId },
      });
      setHoveredEntity((previousHoveredEntity) =>
        previousHoveredEntity?.kind === "wire" && previousHoveredEntity.id === selectedWireId
          ? null
          : previousHoveredEntity
      );
      setSelectedWireId(null);
      const toPinPosition = resolvePinPosition(nodes, wireToDelete.to);
      setRecentChange({
        label: `Deleted ${selectedWireId}`,
        x: toPinPosition?.x ?? 0,
        y: toPinPosition?.y ?? 0,
      });
      return;
    }

    if (!selectedNodeId) {
      return;
    }

    const nodeToDelete = getSelectedNode(nodes, selectedNodeId);

    if (!nodeToDelete) {
      return;
    }

    dispatch({
      type: ACTION_TYPES.REMOVE_NODE,
      payload: { nodeId: selectedNodeId },
    });
    setActivePinId((previousActivePinId) =>
      previousActivePinId?.startsWith(`${selectedNodeId}:`) ? null : previousActivePinId
    );
    setDraggedNodeId(null);
    setHoveredEntity((previousHoveredEntity) =>
      previousHoveredEntity?.id === selectedNodeId ? null : previousHoveredEntity
    );
    setSelectedNodeId(null);
    setRecentChange({
      label: `Deleted ${selectedNodeId}`,
      x: nodeToDelete.x,
      y: nodeToDelete.y,
    });
  }

  function handleRotateSelectedNode() {
    if (!selectedNodeId) {
      return;
    }

    const selectedNode = getSelectedNode(nodes, selectedNodeId);

    if (!selectedNode) {
      return;
    }

    dispatch({
      type: ACTION_TYPES.ROTATE_NODE,
      payload: { nodeId: selectedNodeId },
    });
    setRecentChange({
      label: `Rotated ${selectedNodeId}`,
      x: selectedNode.x,
      y: selectedNode.y,
    });
  }

  function handleUpdateSelectedNodeState(nextState) {
    if (!selectedNodeId) {
      return;
    }

    dispatch({
      type: ACTION_TYPES.UPDATE_NODE_STATE,
      payload: {
        nodeId: selectedNodeId,
        state: nextState,
      },
    });
  }

  function handleUpdateResistorValue(nextResistance) {
    const selectedNode = getSelectedNode(nodes, selectedNodeId);

    if (!selectedNode || selectedNode.type !== "RESISTOR") {
      return;
    }

    handleUpdateSelectedNodeState({
      ...getNodeStateObject(selectedNode),
      resistance: nextResistance,
    });
    setRecentChange({
      label: `${selectedNode.id} set to ${nextResistance} ohm`,
      x: selectedNode.x,
      y: selectedNode.y,
    });
  }

  function handleUpdateBatteryVoltage(nextVoltage) {
    const selectedNode = getSelectedNode(nodes, selectedNodeId);

    if (!selectedNode || selectedNode.type !== "BATTERY") {
      return;
    }

    handleUpdateSelectedNodeState({
      ...getNodeStateObject(selectedNode),
      voltage: nextVoltage,
    });
    setRecentChange({
      label: `${selectedNode.id} set to ${nextVoltage} V`,
      x: selectedNode.x,
      y: selectedNode.y,
    });
  }

  function handleSidebarComponentSelect(component) {
    if (component.mode === "wire") {
      handleModeChange("wire");
      return;
    }

    setComponentTypeToCreate(component.value);
    setComponentSearch("");
    handleModeChange("create-node");
  }

  useEffect(() => {
    function handleResize() {
      setViewport({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    }

    handleResize();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  useEffect(() => {
    function handleGlobalMouseUp() {
      if (
        !nodes.some((node) => {
          const component = getComponent(node.type);
          return component.stateInteraction === "momentary" && node.state === "CLOSED";
        })
      ) {
        return;
      }

      dispatch({
        type: ACTION_TYPES.RELEASE_BUTTON,
        payload: {},
      });
    }

    window.addEventListener("mouseup", handleGlobalMouseUp);

    return () => {
      window.removeEventListener("mouseup", handleGlobalMouseUp);
    };
  }, [nodes]);

  useEffect(() => {
    function handleKeyDown(event) {
      if (isEditableKeyboardTarget(event.target)) {
        return;
      }

      const isModifierPressed = event.ctrlKey || event.metaKey;

      if (isModifierPressed && event.key.toLowerCase() === "z") {
        event.preventDefault();

        if (event.shiftKey) {
          dispatch({ type: ACTION_TYPES.REDO });
          return;
        }

        dispatch({ type: ACTION_TYPES.UNDO });
        return;
      }

      if (isModifierPressed && event.key.toLowerCase() === "y") {
        event.preventDefault();
        dispatch({ type: ACTION_TYPES.REDO });
        return;
      }

      if (event.key !== "Delete" && event.key !== "Backspace") {
        return;
      }

      event.preventDefault();
      handleDeleteSelection();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [nodes, selectedNodeId, selectedWireId, wires]);

  useEffect(() => {
    if (selectedNodeId && !nodes.some((node) => node.id === selectedNodeId)) {
      setSelectedNodeId(null);
    }

    if (selectedWireId && !wires.some((wire) => wire.id === selectedWireId)) {
      setSelectedWireId(null);
    }

    if (
      activePinId &&
      !resolvePinPosition(nodes, activePinId)
    ) {
      setActivePinId(null);
    }

    if (
      hoveredEntity?.kind === "node" &&
      !nodes.some((node) => node.id === hoveredEntity.id)
    ) {
      setHoveredEntity(null);
    }

    if (
      hoveredEntity?.kind === "wire" &&
      !wires.some((wire) => wire.id === hoveredEntity.id)
    ) {
      setHoveredEntity(null);
    }
  }, [activePinId, hoveredEntity, nodes, selectedNodeId, selectedWireId, wires]);

  function getSvgCoordinates(svg, event) {
    if (!svg) {
      return null;
    }

    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;

    const transformedPoint = point.matrixTransform(svg.getScreenCTM().inverse());
    return {
      x: Math.round(transformedPoint.x),
      y: Math.round(transformedPoint.y),
    };
  }

  function getActivePinPosition() {
    return resolvePinPosition(nodes, activePinId);
  }

  function updateZoom(nextZoom) {
    setZoom(Math.max(0.5, Math.min(2.5, nextZoom)));
  }

  function handleZoomIn() {
    updateZoom(zoom + 0.1);
  }

  function handleZoomOut() {
    updateZoom(zoom - 0.1);
  }

  function handleZoomReset() {
    setZoom(1);
  }

  function handleModeChange(nextMode) {
    setMode(nextMode);
    setCanvasPanStart(null);
    setDraggedControlPoint(null);
    setDragStart(null);
    setDraggedNodeId(null);
    setHoveredEntity(null);
    setIsPanningCanvas(false);
    setIsDragging(false);
    setSelectedWireId(null);
    setWireDraftPoints([]);

    if (nextMode !== "wire") {
      setActivePinId(null);
    }

    dispatch({
      type: ACTION_TYPES.RELEASE_BUTTON,
      payload: {},
    });

    setRecentChange((previousChange) => ({
      label: `Mode: ${nextMode}`,
      x: previousChange?.x ?? 0,
      y: previousChange?.y ?? 0,
    }));
  }

  function handleCanvasClick(event) {
    if (skipCanvasClickRef.current) {
      skipCanvasClickRef.current = false;
      return;
    }

    const coordinates = getSvgCoordinates(svgRef.current, event);
    if (!coordinates) {
      return;
    }

    const snappedCoordinates = {
      x: snap(coordinates.x),
      y: snap(coordinates.y),
    };

    if (mode === "wire" && activePinId) {
      setSelectedNodeId(null);
      setSelectedWireId(null);
      setWireDraftPoints((previousPoints) => [
        ...previousPoints,
        snappedCoordinates,
      ]);
      setRecentChange({
        label: `Added bend point`,
        x: snappedCoordinates.x,
        y: snappedCoordinates.y,
      });
      return;
    }

    if (mode !== "create-node") {
      setActivePinId(null);
      setSelectedNodeId(null);
      setSelectedWireId(null);
      setRecentChange({
        label: "Cleared selection",
        x: snappedCoordinates.x,
        y: snappedCoordinates.y,
      });
      return;
    }

    const nodeId = `node-${nextNodeId.current++}`;
    setActivePinId(null);
    setSelectedNodeId(nodeId);
    setSelectedWireId(null);
    dispatch({
      type: ACTION_TYPES.ADD_NODE,
      payload: {
        node: createNode(
          componentTypeToCreate,
          nodeId,
          snappedCoordinates.x,
          snappedCoordinates.y
        ),
      },
    });
    setRecentChange({
      label: `Added ${componentTypeToCreate} ${nodeId}`,
      x: snappedCoordinates.x,
      y: snappedCoordinates.y,
    });

    console.log("SVG click:", {
      x: snappedCoordinates.x,
      y: snappedCoordinates.y,
    });
  }

  function handleCanvasMouseDown(event) {
    if (mode !== "select" || !containerRef.current) {
      return;
    }

    setCanvasPanStart({
      clientX: event.clientX,
      clientY: event.clientY,
      scrollLeft: containerRef.current.scrollLeft,
      scrollTop: containerRef.current.scrollTop,
    });
    setIsPanningCanvas(false);
  }

  function handleControlPointMouseDown(event, wireId, pointIndex) {
    event.stopPropagation();

    if (mode !== "select") {
      return;
    }

    setActivePinId(null);
    setDragStart(null);
    setDraggedNodeId(null);
    setIsDragging(false);
    setSelectedNodeId(null);
    setSelectedWireId(wireId);
    setDraggedControlPoint({ wireId, pointIndex });
  }

  function handleControlPointDoubleClick(event, wireId, pointIndex, point) {
    event.stopPropagation();

    if (mode !== "select") {
      return;
    }

    setDraggedControlPoint(null);
    dispatch({
      type: ACTION_TYPES.REMOVE_WIRE_POINT,
      payload: { wireId, pointIndex },
    });
    setSelectedWireId(wireId);
    setRecentChange({
      label: `Removed bend point from ${wireId}`,
      x: point.x,
      y: point.y,
    });
  }

  function handleNodeClick(event, nodeId) {
    event.stopPropagation();

    if (skipNodeClickRef.current) {
      skipNodeClickRef.current = false;
      return;
    }

    if (mode !== "select") {
      return;
    }

    const node = nodes.find((currentNode) => currentNode.id === nodeId);
    const component = getComponent(node?.type);
    if (!node || component.stateInteraction !== "toggle") {
      return;
    }

    setSelectedNodeId(nodeId);
    setSelectedWireId(null);
    setActivePinId(null);
    dispatch({
      type: ACTION_TYPES.TOGGLE_SWITCH,
      payload: { nodeId },
    });
    setRecentChange({
      label: `${nodeId} ${node.state === "OPEN" ? "closed" : "open"}`,
      x: node.x,
      y: node.y,
    });
  }

  function handleNodeDoubleClick(event, nodeId) {
    event.stopPropagation();

    if (mode !== "select") {
      return;
    }

    const node = nodes.find((currentNode) => currentNode.id === nodeId);

    if (!node || node.type !== "RESISTOR") {
      return;
    }

    const currentResistance =
      typeof node.state?.resistance === "number" ? node.state.resistance : 100;
    const response = window.prompt("Resistance (ohms)", String(currentResistance));

    if (response === null) {
      return;
    }

    const parsedResistance = Number.parseFloat(response.trim());

    if (!Number.isFinite(parsedResistance) || parsedResistance <= 0) {
      setRecentChange({
        label: `Rejected invalid resistance for ${nodeId}`,
        x: node.x,
        y: node.y,
      });
      return;
    }

    setSelectedNodeId(nodeId);
    setSelectedWireId(null);
    setActivePinId(null);
    dispatch({
      type: ACTION_TYPES.UPDATE_NODE_STATE,
      payload: {
        nodeId,
        state: {
          ...(typeof node.state === "object" && node.state !== null ? node.state : {}),
          resistance: parsedResistance,
        },
      },
    });
    setRecentChange({
      label: `${nodeId} set to ${parsedResistance} ohm`,
      x: node.x,
      y: node.y,
    });
  }

  function handlePinClick(event, nodeId, pinId) {
    event.stopPropagation();
    setDraggedNodeId(null);
    setSelectedWireId(null);
    setSelectedNodeId(nodeId);
    const globalPinId = `${nodeId}:${pinId}`;
    const pinReference = { nodeId, pinId };
    const pinPosition = resolvePinPosition(nodes, globalPinId);

    if (mode !== "wire") {
      setActivePinId(null);

      if (pinPosition) {
        setRecentChange({
          label: `Focused ${globalPinId}`,
          x: pinPosition.x,
          y: pinPosition.y,
        });
      }

      return;
    }

    if (activePinId && activePinId !== globalPinId) {
      const wireId = `wire-${nextWireId.current++}`;
      const connectionIsValid = isValidConnection(activePinId, globalPinId, wires);
      const fromPinPosition = resolvePinPosition(nodes, activePinId);

      if (!fromPinPosition || !pinPosition) {
        setActivePinId(null);
        setWireDraftPoints([]);
        return;
      }

      if (!connectionIsValid) {
        setActivePinId(null);
        setWireDraftPoints([]);

        if (pinPosition) {
          setRecentChange({
            label: `Blocked invalid connection`,
            x: pinPosition.x,
            y: pinPosition.y,
          });
        }

        return;
      }

      if (connectionIsValid) {
        dispatch({
          type: ACTION_TYPES.ADD_WIRE,
          payload: {
            wire: {
              id: wireId,
              from: parsePinReference(activePinId),
              to: pinReference,
              points: wireDraftPoints,
            },
          },
        });
      }

      setActivePinId(null);
      setWireDraftPoints([]);

      if (pinPosition) {
        setRecentChange({
          label: `Connected ${wireId}`,
          x: pinPosition.x,
          y: pinPosition.y,
        });
      }

      return;
    }

    if (activePinId === globalPinId) {
      setActivePinId(null);
      setWireDraftPoints([]);

      if (pinPosition) {
        setRecentChange({
          label: `Deselected ${globalPinId}`,
          x: pinPosition.x,
          y: pinPosition.y,
        });
      }

      return;
    }

    setActivePinId(globalPinId);
    setWireDraftPoints([]);
    const node = nodes.find((currentNode) => currentNode.id === nodeId);
    const pin = node?.pins.find((currentPin) => currentPin.id === pinId);

    if (node && pin) {
      setRecentChange({
        label: `Selected ${globalPinId}`,
        x: node.x + pin.dx,
        y: node.y + pin.dy,
      });
    }
  }

  function handleWireClick(event, wireId, wirePosition) {
    event.stopPropagation();
    setActivePinId(null);
    setDraggedControlPoint(null);
    setDraggedNodeId(null);
    setSelectedNodeId(null);
    setSelectedWireId(wireId);
    setWireDraftPoints([]);
    setRecentChange({
      label: `Selected ${wireId}`,
      x: wirePosition.x,
      y: wirePosition.y,
    });
  }

  function handleSvgMouseMove(event) {
    const coordinates = getSvgCoordinates(svgRef.current, event);
    if (!coordinates) {
      return;
    }

    setPointerClientPosition({
      x: event.clientX,
      y: event.clientY,
    });
    setPointerPosition(coordinates);

    if (canvasPanStart && containerRef.current) {
      const dx = event.clientX - canvasPanStart.clientX;
      const dy = event.clientY - canvasPanStart.clientY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const panThreshold = 5;

      if (!isPanningCanvas && distance > panThreshold) {
        setIsPanningCanvas(true);
        skipCanvasClickRef.current = true;
      }

      if (isPanningCanvas || distance > panThreshold) {
        containerRef.current.scrollLeft = canvasPanStart.scrollLeft - dx;
        containerRef.current.scrollTop = canvasPanStart.scrollTop - dy;
        setRecentChange({
          label: "Panned canvas",
          x: coordinates.x,
          y: coordinates.y,
        });
        return;
      }
    }

    if (draggedControlPoint) {
      const draggedWire = wires.find((wire) => wire.id === draggedControlPoint.wireId);
      const fromPinPosition = resolvePinPosition(draggedWire ? nodes : [], draggedWire?.from);
      const previousPoint =
        draggedControlPoint.pointIndex === 0
          ? fromPinPosition
          : draggedWire?.points?.[draggedControlPoint.pointIndex - 1] ?? null;

      const snappedCoordinates = {
        x: snap(coordinates.x),
        y: snap(coordinates.y),
      };
      const constrainedCoordinates = getConstrainedControlPointPosition(
        previousPoint,
        snappedCoordinates,
        event
      );

      const nextPoints = (draggedWire?.points ?? []).map((point, pointIndex) =>
        pointIndex === draggedControlPoint.pointIndex ? constrainedCoordinates : point
      );

      dispatch({
        type: ACTION_TYPES.UPDATE_WIRE_POINTS,
        payload: {
          wireId: draggedControlPoint.wireId,
          points: nextPoints,
        },
      });
      setRecentChange({
        label: `Moved bend point on ${draggedControlPoint.wireId}`,
        x: constrainedCoordinates.x,
        y: constrainedCoordinates.y,
      });
      return;
    }

    if (!dragStart) {
      return;
    }

    const dx = event.clientX - dragStart.x;
    const dy = event.clientY - dragStart.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const dragThreshold = 5;

    if (!isDragging && distance > dragThreshold) {
      setDraggedNodeId(dragStart.nodeId);
      setIsDragging(true);
      skipNodeClickRef.current = true;
    }

    if (!draggedNodeId && !isDragging) {
      return;
    }

    const nodeIdToMove = draggedNodeId ?? dragStart.nodeId;
    const snappedCoordinates = {
      x: snap(coordinates.x),
      y: snap(coordinates.y),
    };

    dispatch({
      type: ACTION_TYPES.MOVE_NODE,
      payload: {
        nodeId: nodeIdToMove,
        x: snappedCoordinates.x,
        y: snappedCoordinates.y,
      },
      meta: {
        skipHistory: true,
      },
    });
    setRecentChange({
      label: `Moved ${nodeIdToMove}`,
      x: snappedCoordinates.x,
      y: snappedCoordinates.y,
    });
  }

  function handleNodeMouseDown(event, nodeId) {
    event.stopPropagation();

    if (mode !== "select") {
      return;
    }

    const node = nodes.find((currentNode) => currentNode.id === nodeId);

    const component = getComponent(node?.type);

    if (component.stateInteraction === "momentary") {
      dispatch({
        type: ACTION_TYPES.PRESS_BUTTON,
        payload: { nodeId },
      });
      setRecentChange({
        label: `${nodeId} pressed`,
        x: node.x,
        y: node.y,
      });
    }

    setActivePinId(null);
    setDragStart({
      x: event.clientX,
      y: event.clientY,
      nodeId,
    });
    dragStartStateRef.current = present;
    setDraggedNodeId(null);
    setIsDragging(false);
    setSelectedNodeId(nodeId);
    setSelectedWireId(null);
  }

  function handleStopDragging() {
    if (isDragging) {
      finalizeDragTransaction();
    } else {
      dragStartStateRef.current = null;
    }

    if (skipNodeClickRef.current) {
      window.setTimeout(() => {
        skipNodeClickRef.current = false;
      }, 0);
    }

    setCanvasPanStart(null);
    setDraggedControlPoint(null);
    setDragStart(null);
    setDraggedNodeId(null);
    setIsPanningCanvas(false);
    setIsDragging(false);
  }

  function handlePointerLeave() {
    if (isDragging) {
      finalizeDragTransaction();
    } else {
      dragStartStateRef.current = null;
    }

    setCanvasPanStart(null);
    setDraggedControlPoint(null);
    setHoveredEntity(null);
    setDragStart(null);
    setPointerClientPosition(null);
    setPointerPosition(null);
    setDraggedNodeId(null);
    setIsPanningCanvas(false);
    setIsDragging(false);
    skipNodeClickRef.current = false;
  }

  const activePinPosition = useMemo(() => getActivePinPosition(), [nodes, activePinId]);
  const nets = useMemo(() => buildNets(connectionGraph), [connectionGraph]);
  const netlist = useMemo(() => generateNetlist(nodes, nets), [nodes, nets]);
  const currentResult = useMemo(() => simulateCurrent(netlist), [netlist]);
  const voltageResult = useMemo(() => simulateVoltage(netlist), [netlist]);
  const poweredNetIndexes = useMemo(() => getPoweredNetIndexes(nets, nodes), [nets, nodes]);
  const graphVertexCount = useMemo(
    () => Object.keys(connectionGraph ?? {}).length,
    [connectionGraph]
  );
  const netCount = useMemo(() => nets.length, [nets]);
  const poweredNetCount = useMemo(() => poweredNetIndexes.size, [poweredNetIndexes]);

  const diagnostics = useMemo(
    () => getDiagnostics(nodes, simulationState, nets),
    [nodes, simulationState, nets]
  );

  const selectedNode = useMemo(
    () => getSelectedNode(nodes, selectedNodeId),
    [nodes, selectedNodeId]
  );
  const selectedWire = useMemo(
    () => wires.find((wire) => wire.id === selectedWireId) ?? null,
    [wires, selectedWireId]
  );
  const hoveredWireId = hoveredEntity?.kind === "wire" ? hoveredEntity.id : null;
  const componentNetMapById = useMemo(
    () => new Map(netlist.components.map((component) => [component.id, component])),
    [netlist]
  );
  const hoveredInspector = useMemo(
    () =>
      buildHoveredInspector({
        hoveredEntity,
        nodes,
        wires,
        componentNetMapById,
        currentResult,
        netVoltages: voltageResult.netVoltages,
        simulationState,
      }),
    [componentNetMapById, currentResult, hoveredEntity, nodes, simulationState, voltageResult, wires]
  );

  const wirePreviewPoints =
    activePinPosition && pointerPosition
      ? [activePinPosition, ...wireDraftPoints, pointerPosition]
      : [];
  const wirePreviewString = wirePreviewPoints
    .map((point) => `${point.x},${point.y}`)
    .join(" ");

  return (
    <div
      ref={containerRef}
      style={{
        position: "fixed",
        inset: 0,
        overflow: "auto",
        background: "#111",
        margin: 0,
        paddingRight: SIDEBAR_CANVAS_OFFSET,
      }}
    >
      <input
        ref={fileInputRef}
        accept=".negi,application/json"
        onChange={handleImportCircuit}
        style={{ display: "none" }}
        type="file"
      />
      <CoordinateReadout
        diagnostics={diagnostics}
        activePinId={activePinId}
        canRedo={future.length > 0}
        canUndo={past.length > 0}
        futureCount={future.length}
        netCount={netCount}
        pastCount={past.length}
        poweredNetCount={poweredNetCount}
        graphVertexCount={graphVertexCount}
        hoveredInspector={hoveredInspector}
        mode={mode}
        nodeCount={nodes.length}
        pointerPosition={pointerPosition}
        recentChange={recentChange}
        selectedNodeId={selectedNodeId}
        selectedWireId={selectedWireId}
        wireCount={wires.length}
        zoom={zoom}
      />
      <WorkspaceSidebar
        componentSearch={componentSearch}
        componentType={componentTypeToCreate}
        currentFilename={exportFilename}
        mode={mode}
        onComponentSearchChange={setComponentSearch}
        onComponentSelect={handleSidebarComponentSelect}
        onDeleteSelection={handleDeleteSelection}
        onExport={handleExportCircuit}
        onImport={handleImportClick}
        onRotateSelectedNode={handleRotateSelectedNode}
        onSave={handleExportCircuit}
        onSaveAs={handleSaveAsCircuit}
        onUpdateBatteryVoltage={handleUpdateBatteryVoltage}
        onUpdateResistorValue={handleUpdateResistorValue}
        selectedNode={selectedNode}
        selectedWire={selectedWire}
      />
      <WireHint selectedWireId={selectedWireId} />
      <ModeToolbar mode={mode} onModeChange={handleModeChange} />
      <HistoryToolbar
        canRedo={future.length > 0}
        canUndo={past.length > 0}
        onRedo={handleRedo}
        onUndo={handleUndo}
      />
      <HoverInspectorTooltip
        hoveredInspector={hoveredInspector}
        pointerClientPosition={pointerClientPosition}
        viewport={viewport}
      />
      <ZoomToolbar
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onZoomReset={handleZoomReset}
        zoom={zoom}
      />
      <svg
        ref={svgRef}
        width={canvasSize.width * zoom}
        height={canvasSize.height * zoom}
        viewBox={`0 0 ${canvasSize.width} ${canvasSize.height}`}
        preserveAspectRatio="xMinYMin slice"
        onMouseMove={handleSvgMouseMove}
        onMouseUp={handleStopDragging}
        onMouseLeave={handlePointerLeave}
        style={{ display: "block", background: "#111" }}
      >
        <GridPattern />

        <rect
          x="0"
          y="0"
          width={canvasSize.width}
          height={canvasSize.height}
          fill="url(#grid)"
          pointerEvents="all"
          onMouseDown={handleCanvasMouseDown}
          onClick={handleCanvasClick}
          style={{ cursor: mode === "select" ? (isPanningCanvas ? "grabbing" : "grab") : "default" }}
        />

        <WireLayer
          draggedControlPoint={draggedControlPoint}
          hoveredWireId={hoveredWireId}
          nodes={nodes}
          onControlPointDoubleClick={handleControlPointDoubleClick}
          onControlPointMouseDown={handleControlPointMouseDown}
          onWireClick={handleWireClick}
          onWireHover={handleWireHover}
          selectedNodeId={selectedNodeId}
          selectedWireId={selectedWireId}
          simulationState={simulationState}
          wires={wires}
        />

        <SimulationOverlay nodes={nodes} simulationState={simulationState} />

        <NodeLayer
          activePinId={activePinId}
          draggedNodeId={draggedNodeId}
          nodes={nodes}
          onNodeClick={handleNodeClick}
          onNodeDoubleClick={handleNodeDoubleClick}
          onNodeHover={handleNodeHover}
          onNodeMouseDown={handleNodeMouseDown}
          onPinClick={handlePinClick}
          selectedWire={selectedWire}
          selectedNodeId={selectedNodeId}
          simulationState={simulationState}
        />

        {activePinId && activePinPosition && pointerPosition && (
          <polyline
            points={wirePreviewString}
            fill="none"
            stroke={simulationState.poweredPins.has(activePinId) ? "#fde047" : "#22d3ee"}
            strokeWidth={simulationState.poweredPins.has(activePinId) ? "3" : "2"}
            strokeLinecap="round"
            strokeLinejoin="round"
            pointerEvents="none"
          />
        )}
      </svg>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Editor />
  </React.StrictMode>
);
