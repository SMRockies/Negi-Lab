import { ComponentNetMapping, Netlist } from "./generateNetlist";

export interface SimulationResult {
  activeComponents: Set<string>;
  poweredNets: Set<string>;
  ledStates: Record<string, boolean>;
  circuitComplete: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Check if component allows conduction.
 *
 * The current editor stores switch and button state as "OPEN" / "CLOSED".
 * Boolean-shaped state is also accepted to keep this engine forward-compatible.
 */
function canConduct(component: ComponentNetMapping): boolean {
  switch (component.type) {
    case "SWITCH":
      return component.state === "CLOSED" || (isRecord(component.state) && component.state.closed === true);

    case "BUTTON":
      return component.state === "CLOSED" || (isRecord(component.state) && component.state.pressed === true);

    case "LED":
      return true;

    case "BATTERY":
      return true;

    default:
      return false;
  }
}

/**
 * Find battery terminals.
 *
 * First-version scope only supports a single battery source.
 */
function findBattery(netlist: Netlist) {
  const battery = netlist.components.find((component) => component.type === "BATTERY");

  if (!battery) return null;

  const positive = battery.pins.positive;
  const negative = battery.pins.negative;

  if (!positive || !negative) return null;

  return {
    componentId: battery.id,
    positive,
    negative,
  };
}

/**
 * Main simulation.
 *
 * Strategy:
 * - Start traversal at battery positive.
 * - Walk through reachable nets.
 * - Traverse components that currently conduct.
 * - Mark circuit complete if traversal can reach battery negative.
 *
 * LEDs are directional and only conduct anode -> cathode.
 * All other supported conductive components in this first version are treated
 * as bidirectional when they are closed/pressed.
 */
export function simulateCircuit(netlist: Netlist): SimulationResult {
  const activeComponents = new Set<string>();
  const poweredNets = new Set<string>();
  const ledStates: Record<string, boolean> = {};

  for (const component of netlist.components) {
    if (component.type === "LED") {
      ledStates[component.id] = false;
    }
  }

  const battery = findBattery(netlist);

  if (!battery) {
    return {
      activeComponents,
      poweredNets,
      ledStates,
      circuitComplete: false,
    };
  }

  poweredNets.add(battery.positive);
  const queue = [battery.positive];

  while (queue.length > 0) {
    const currentNet = queue.shift();

    if (!currentNet) continue;

    for (const component of netlist.components) {
      const pinEntries = Object.entries(component.pins);

      if (pinEntries.length === 0 || !canConduct(component)) {
        continue;
      }

      const connectedPins = pinEntries.filter(([, netId]) => netId === currentNet);

      if (connectedPins.length === 0) {
        continue;
      }

      if (component.type === "LED") {
        const anode = component.pins.anode;
        const cathode = component.pins.cathode;

        if (currentNet === anode && cathode && !poweredNets.has(cathode)) {
          poweredNets.add(cathode);
          queue.push(cathode);
        }

        if (currentNet === anode && cathode) {
          activeComponents.add(component.id);
          ledStates[component.id] = true;
        }

        continue;
      }

      const reachableOtherNets = pinEntries
        .map(([, netId]) => netId)
        .filter((netId) => netId !== currentNet);

      if (reachableOtherNets.length === 0) {
        continue;
      }

      activeComponents.add(component.id);

      for (const otherNet of reachableOtherNets) {
        if (poweredNets.has(otherNet)) {
          continue;
        }

        poweredNets.add(otherNet);
        queue.push(otherNet);
      }
    }
  }

  const circuitComplete = poweredNets.has(battery.negative);

  return {
    activeComponents,
    poweredNets,
    ledStates,
    circuitComplete,
  };
}
