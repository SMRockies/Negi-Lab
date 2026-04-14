import React from "react";

const EMPTY_CONNECTIONS = [];
const EMPTY_SEGMENTS = [];

function getPoweredNodeActivity(node, simulationState) {
  const isActive = node.pins.some((pin) =>
    simulationState.poweredPins.has(`${node.id}:${pin.id}`)
  );

  return {
    active: isActive,
    visualState: isActive ? "ACTIVE" : "IDLE",
  };
}

function getInteractiveNodeInteractionState(node, interaction) {
  return {
    isDragged: node.id === interaction.draggedNodeId,
    isSelected: node.id === interaction.selectedNodeId,
    isConnectedToSelectedWire: Boolean(
      interaction.selectedWire &&
        interaction.getConnectedNodeIdsForWire(interaction.selectedWire).includes(node.id)
    ),
  };
}

function getSimpleNodeStyle(node, simulationState, interaction) {
  const { isDragged, isSelected, isConnectedToSelectedWire } =
    getInteractiveNodeInteractionState(node, interaction);
  const hasPoweredPins = interaction.getPoweredPins(node).length > 0;

  return {
    fill: isDragged
      ? "#86efac"
      : isSelected
        ? "#f97316"
        : hasPoweredPins
          ? "#facc15"
          : isConnectedToSelectedWire
            ? "#7dd3fc"
            : "#4ade80",
    stroke: isDragged || isSelected ? "#dcfce7" : hasPoweredPins ? "#fef08a" : "none",
    strokeWidth: isDragged || isSelected || hasPoweredPins ? 2 : 0,
  };
}

function getBatteryStyle(node, simulationState, interaction) {
  const { isDragged, isSelected, isConnectedToSelectedWire } =
    getInteractiveNodeInteractionState(node, interaction);
  const hasPoweredPins = interaction.getPoweredPins(node).length > 0;

  return {
    fill: isSelected ? "#2563eb" : isDragged ? "#93c5fd" : "#3b82f6",
    stroke:
      isSelected || isDragged
        ? "#dbeafe"
        : hasPoweredPins
          ? "#fde047"
          : isConnectedToSelectedWire
            ? "#7dd3fc"
            : "#1d4ed8",
    strokeWidth:
      isSelected || isDragged || isConnectedToSelectedWire || hasPoweredPins ? 2.5 : 1.5,
  };
}

function getLedStyle(node, simulationState, interaction) {
  const { isDragged, isSelected, isConnectedToSelectedWire } =
    getInteractiveNodeInteractionState(node, interaction);
  const isOn = Boolean(simulationState.activeNodes.get(node.id)?.active);

  return {
    fill: isSelected ? "#16a34a" : isDragged ? "#4ade80" : isOn ? "#22c55e" : "#14532d",
    stroke:
      isSelected || isDragged
        ? "#dcfce7"
        : isOn
          ? "#bbf7d0"
          : isConnectedToSelectedWire
            ? "#86efac"
            : "#166534",
    strokeWidth: isSelected || isDragged || isConnectedToSelectedWire || isOn ? 2.5 : 1.5,
  };
}

function getTerminalNodeStyle(node, interaction) {
  const { isDragged, isSelected } = getInteractiveNodeInteractionState(node, interaction);
  const isClosed = node.state === "CLOSED";

  return {
    fill: isClosed
      ? "rgba(253, 224, 71, 0.22)"
      : isDragged
        ? "rgba(134, 239, 172, 0.18)"
        : isSelected
          ? "rgba(249, 115, 22, 0.18)"
          : "rgba(17, 24, 39, 0.32)",
    stroke: isSelected || isDragged ? "#dcfce7" : isClosed ? "#fde047" : "#9ca3af",
    strokeWidth: isSelected || isDragged || isClosed ? 2.5 : 2,
  };
}

function getResistorStyle(node, simulationState, interaction) {
  const { isDragged, isSelected, isConnectedToSelectedWire } =
    getInteractiveNodeInteractionState(node, interaction);
  const hasPoweredPins = interaction.getPoweredPins(node).length > 0;

  return {
    fill: isSelected ? "#92400e" : isDragged ? "#fdba74" : "#78350f",
    stroke:
      isSelected || isDragged
        ? "#ffedd5"
        : hasPoweredPins
          ? "#fde047"
          : isConnectedToSelectedWire
            ? "#7dd3fc"
            : "#f59e0b",
    strokeWidth:
      isSelected || isDragged || isConnectedToSelectedWire || hasPoweredPins ? 2.5 : 1.75,
  };
}

function renderBasicCircle(node, style, interaction, onNodeMouseDown) {
  return (
    <circle
      cx={node.x}
      cy={node.y}
      r={node.radius}
      fill={style.fill}
      stroke={style.stroke}
      strokeWidth={style.strokeWidth}
      style={{ cursor: "grab" }}
      onMouseEnter={() => interaction.onNodeHover?.(node.id)}
      onMouseLeave={() => interaction.onNodeHover?.(null)}
      onMouseDown={(event) => onNodeMouseDown(event, node.id)}
      onDoubleClick={(event) => interaction.onNodeDoubleClick?.(event, node.id)}
    />
  );
}

function renderTerminalComponent(node, interaction, bodyStyle, indicator) {
  const isClosed = node.state === "CLOSED";
  const stroke = isClosed ? "#fde047" : "#9ca3af";

  return (
    <>
      <circle
        cx={node.x}
        cy={node.y}
        r={node.radius + 6}
        fill={bodyStyle.fill}
        stroke={bodyStyle.stroke}
        strokeWidth={bodyStyle.strokeWidth}
        style={{ cursor: "grab" }}
        onMouseEnter={() => interaction.onNodeHover?.(node.id)}
        onMouseLeave={() => interaction.onNodeHover?.(null)}
        onMouseDown={(event) => interaction.onNodeMouseDown(event, node.id)}
        onClick={(event) => interaction.onNodeClick(event, node.id)}
        onDoubleClick={(event) => interaction.onNodeDoubleClick?.(event, node.id)}
      />
      <line
        x1={node.x - 20}
        y1={node.y}
        x2={node.x - 6}
        y2={node.y}
        stroke={stroke}
        strokeWidth="2"
        strokeLinecap="round"
        pointerEvents="none"
      />
      <line
        x1={node.x + 6}
        y1={node.y}
        x2={node.x + 20}
        y2={node.y}
        stroke={stroke}
        strokeWidth="2"
        strokeLinecap="round"
        pointerEvents="none"
      />
      {indicator(isClosed)}
    </>
  );
}

function createTerminalComponent({ type, label }) {
  return {
    type,
    label,
    stateInteraction: type === "SWITCH" ? "toggle" : "momentary",
    radius: 18,
    defaultState: "OPEN",
    pins: [
      { id: "a", role: "terminal", label: "A", dx: -20, dy: 0, radius: 5 },
      { id: "b", role: "terminal", label: "B", dx: 20, dy: 0, radius: 5 },
    ],
    behavior: {
      getConnections(node, layer = "topology") {
        if ((layer === "topology" || layer === "simulation") && node.state === "CLOSED") {
          return [
            { from: "a", to: "b" },
            { from: "b", to: "a" },
          ];
        }

        return EMPTY_CONNECTIONS;
      },
      getActivationSegments() {
        return EMPTY_SEGMENTS;
      },
      getSourcePins() {
        return null;
      },
    },
    getNodeActivity(node) {
      return {
        active: node.state === "CLOSED",
        visualState: node.state,
      };
    },
    getDisplayLabel(node) {
      return node.state;
    },
    render(node, simulationState, interaction) {
      const bodyStyle = getTerminalNodeStyle(node, interaction);

      return renderTerminalComponent(node, interaction, bodyStyle, (isClosed) =>
        type === "SWITCH" ? (
          <line
            x1={node.x - 6}
            y1={node.y}
            x2={node.x + 6}
            y2={isClosed ? node.y : node.y - 10}
            stroke={isClosed ? "#fde047" : "#9ca3af"}
            strokeWidth="2.5"
            strokeLinecap="round"
            pointerEvents="none"
          />
        ) : (
          <rect
            x={node.x - 6}
            y={isClosed ? node.y - 4 : node.y - 8}
            width="12"
            height="8"
            rx="2"
            fill={isClosed ? "#fde047" : "#6b7280"}
            pointerEvents="none"
          />
        )
      );
    },
  };
}

export const TEST = {
  type: "TEST",
  label: "Test Node",
  stateInteraction: "static",
  radius: 12,
  pins: [
    { id: "pin-top", role: "input", label: "T1", dx: 0, dy: -20, radius: 5 },
    { id: "pin-bottom", role: "output", label: "T2", dx: 0, dy: 20, radius: 5 },
  ],
  behavior: {
    getConnections() {
      return EMPTY_CONNECTIONS;
    },
    getActivationSegments() {
      return EMPTY_SEGMENTS;
    },
    getSourcePins() {
      return null;
    },
  },
  getNodeActivity(node, simulationState) {
    return getPoweredNodeActivity(node, simulationState);
  },
  getDisplayLabel(node) {
    return node.type;
  },
  render(node, simulationState, interaction) {
    const style = getSimpleNodeStyle(node, simulationState, interaction);
    return renderBasicCircle(node, style, interaction, interaction.onNodeMouseDown);
  },
};

export const LED = {
  type: "LED",
  label: "LED",
  stateInteraction: "static",
  radius: 18,
  pins: [
    { id: "anode", role: "input", label: "A", dx: 0, dy: -20, radius: 5 },
    { id: "cathode", role: "output", label: "C", dx: 0, dy: 20, radius: 5 },
  ],
  behavior: {
    getConnections(node, layer = "topology") {
      if (layer === "simulation") {
        return [{ from: "anode", to: "cathode" }];
      }

      return EMPTY_CONNECTIONS;
    },
    getActivationSegments() {
      return [{ from: "anode", to: "cathode" }];
    },
    getSourcePins() {
      return null;
    },
  },
  getNodeActivity(node, simulationState) {
    const isOn = Boolean(simulationState.activeNodes.get(node.id)?.active);
    return {
      active: isOn,
      visualState: isOn ? "ON" : "OFF",
    };
  },
  getDisplayLabel(node) {
    return node.type;
  },
  render(node, simulationState, interaction) {
    const style = getLedStyle(node, simulationState, interaction);
    const isOn = Boolean(simulationState.activeNodes.get(node.id)?.active);

    return (
      <>
        {isOn && (
          <circle
            cx={node.x}
            cy={node.y}
            r={25}
            fill="none"
            stroke="#22c55e"
            strokeWidth="4"
            opacity="0.6"
            pointerEvents="none"
          />
        )}
        {renderBasicCircle(node, style, interaction, interaction.onNodeMouseDown)}
      </>
    );
  },
};

export const BATTERY = {
  type: "BATTERY",
  label: "Battery",
  stateInteraction: "static",
  radius: 18,
  defaultState: {
    voltage: 9,
  },
  pins: [
    { id: "positive", role: "source", label: "+", dx: 0, dy: -20, radius: 5 },
    { id: "negative", role: "sink", label: "-", dx: 0, dy: 20, radius: 5 },
  ],
  behavior: {
    getConnections(node, layer = "topology") {
      if (layer === "simulation") {
        return [{ from: "positive", to: "negative" }];
      }

      return EMPTY_CONNECTIONS;
    },
    getActivationSegments() {
      return EMPTY_SEGMENTS;
    },
    getSourcePins() {
      return { positive: "positive", negative: "negative" };
    },
  },
  getNodeActivity(node, simulationState) {
    return getPoweredNodeActivity(node, simulationState);
  },
  getDisplayLabel(node) {
    return node.type;
  },
  render(node, simulationState, interaction) {
    const style = getBatteryStyle(node, simulationState, interaction);
    const hasPoweredPins = interaction.getPoweredPins(node).length > 0;

    return (
      <>
        {hasPoweredPins && (
          <circle
            cx={node.x}
            cy={node.y}
            r={24}
            fill="none"
            stroke="#fde047"
            strokeWidth="3"
            opacity="0.4"
            pointerEvents="none"
          />
        )}
        {renderBasicCircle(node, style, interaction, interaction.onNodeMouseDown)}
        <text
          x={node.x}
          y={node.y - 25}
          fill="#ffffff"
          fontFamily="monospace"
          fontSize="10"
          fontWeight="700"
          pointerEvents="none"
          textAnchor="middle"
        >
          +
        </text>
        <text
          x={node.x}
          y={node.y + 30}
          fill="#ffffff"
          fontFamily="monospace"
          fontSize="10"
          fontWeight="700"
          pointerEvents="none"
          textAnchor="middle"
        >
          -
        </text>
      </>
    );
  },
};

export const RESISTOR = {
  type: "RESISTOR",
  label: "Resistor",
  stateInteraction: "static",
  radius: 18,
  defaultState: {
    resistance: 100,
  },
  pins: [
    { id: "a", role: "input", label: "A", dx: -20, dy: 0, radius: 5 },
    { id: "b", role: "output", label: "B", dx: 20, dy: 0, radius: 5 },
  ],
  behavior: {
    getConnections() {
      return [
        { from: "a", to: "b" },
        { from: "b", to: "a" },
      ];
    },
    getActivationSegments() {
      return EMPTY_SEGMENTS;
    },
    getSourcePins() {
      return null;
    },
  },
  getNodeActivity(node, simulationState) {
    return getPoweredNodeActivity(node, simulationState);
  },
  getDisplayLabel(node) {
    const resistance =
      typeof node.state?.resistance === "number" ? node.state.resistance : 100;
    return `${resistance} ohm`;
  },
  render(node, simulationState, interaction) {
    const style = getResistorStyle(node, simulationState, interaction);

    return (
      <>
        <line
          x1={node.x - 20}
          y1={node.y}
          x2={node.x - 10}
          y2={node.y}
          stroke={style.stroke}
          strokeWidth="2.5"
          strokeLinecap="round"
          pointerEvents="none"
        />
        <rect
          x={node.x - 10}
          y={node.y - 6}
          width="20"
          height="12"
          rx="2"
          fill={style.fill}
          stroke={style.stroke}
          strokeWidth={style.strokeWidth}
          style={{ cursor: "grab" }}
          onMouseEnter={() => interaction.onNodeHover?.(node.id)}
          onMouseLeave={() => interaction.onNodeHover?.(null)}
          onMouseDown={(event) => interaction.onNodeMouseDown(event, node.id)}
          onDoubleClick={(event) => interaction.onNodeDoubleClick?.(event, node.id)}
        />
        <line
          x1={node.x + 10}
          y1={node.y}
          x2={node.x + 20}
          y2={node.y}
          stroke={style.stroke}
          strokeWidth="2.5"
          strokeLinecap="round"
          pointerEvents="none"
        />
      </>
    );
  },
};

export const SWITCH = createTerminalComponent({
  type: "SWITCH",
  label: "Switch",
});

export const BUTTON = createTerminalComponent({
  type: "BUTTON",
  label: "Button",
});

export const COMPONENTS = {
  TEST,
  LED,
  BATTERY,
  SWITCH,
  BUTTON,
  RESISTOR,
};

export const COMPONENT_OPTIONS = Object.values(COMPONENTS).map((component) => ({
  value: component.type,
  label: component.label,
}));

export function getComponent(type) {
  return COMPONENTS[type] ?? TEST;
}

export function getComponentBehavior(nodeOrType) {
  const type = typeof nodeOrType === "string" ? nodeOrType : nodeOrType?.type;
  return getComponent(type).behavior;
}

export function createNode(type, id, x, y) {
  const component = getComponent(type);

  return {
    id,
    type: component.type,
    x,
    y,
    rotation: 0,
    radius: component.radius,
    state: component.defaultState ?? null,
    pins: component.pins.map((pin) => ({ ...pin })),
  };
}

export function hydrateNode(serializedNode) {
  const hydratedNode = createNode(
    serializedNode.type,
    serializedNode.id,
    serializedNode.x,
    serializedNode.y
  );

  return {
    ...hydratedNode,
    rotation: typeof serializedNode.rotation === "number" ? serializedNode.rotation : 0,
    state: serializedNode.state ?? hydratedNode.state ?? null,
  };
}
