import { ComponentNetMapping, Netlist } from "./generateNetlist";

export interface VoltageResult {
  netVoltages: Record<string, number>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Default component voltage drops for the first approximation pass.
 */
function getVoltageDrop(type: string): number {
  switch (type) {
    case "LED":
      return 2.0;
    case "SWITCH":
      return 0.0;
    case "BUTTON":
      return 0.0;
    case "RESISTOR":
      return 1.0;
    default:
      return 0.0;
  }
}

function isClosedLike(component: ComponentNetMapping): boolean {
  if (component.state === "CLOSED") {
    return true;
  }

  if (!isRecord(component.state)) {
    return false;
  }

  if (component.type === "SWITCH") {
    return component.state.closed === true;
  }

  if (component.type === "BUTTON") {
    return component.state.pressed === true;
  }

  return false;
}

/**
 * Find battery voltage source.
 *
 * The current editor does not yet author battery voltage explicitly, so this
 * falls back to 9V unless a future battery state object provides `voltage`.
 */
function findBattery(netlist: Netlist) {
  const battery = netlist.components.find((component) => component.type === "BATTERY");

  if (!battery) return null;

  const positive = battery.pins.positive;
  const negative = battery.pins.negative;

  if (!positive || !negative) return null;

  const voltage =
    isRecord(battery.state) && typeof battery.state.voltage === "number"
      ? battery.state.voltage
      : 9;

  return {
    positive,
    negative,
    voltage,
  };
}

/**
 * Voltage propagation engine.
 *
 * First-version scope:
 * - static DC approximation only
 * - no current calculation
 * - fixed drops for directional or passive components
 * - single battery source
 */
export function simulateVoltage(netlist: Netlist): VoltageResult {
  const netVoltages: Record<string, number> = {};

  const battery = findBattery(netlist);
  if (!battery) return { netVoltages };

  netVoltages[battery.positive] = battery.voltage;
  netVoltages[battery.negative] = 0;

  let changed = true;

  while (changed) {
    changed = false;

    for (const component of netlist.components) {
      const pins = component.pins;

      switch (component.type) {
        case "LED": {
          const anode = pins.anode;
          const cathode = pins.cathode;

          if (
            anode &&
            cathode &&
            netVoltages[anode] !== undefined &&
            netVoltages[cathode] === undefined
          ) {
            netVoltages[cathode] = netVoltages[anode] - getVoltageDrop("LED");
            changed = true;
          }

          break;
        }

        case "SWITCH":
        case "BUTTON": {
          if (!isClosedLike(component)) break;

          const a = pins.a;
          const b = pins.b;

          if (a && b && netVoltages[a] !== undefined && netVoltages[b] === undefined) {
            netVoltages[b] = netVoltages[a] - getVoltageDrop(component.type);
            changed = true;
          }

          if (a && b && netVoltages[b] !== undefined && netVoltages[a] === undefined) {
            netVoltages[a] = netVoltages[b] - getVoltageDrop(component.type);
            changed = true;
          }

          break;
        }

        case "RESISTOR": {
          const a = pins.a;
          const b = pins.b;

          if (a && b && netVoltages[a] !== undefined && netVoltages[b] === undefined) {
            netVoltages[b] = netVoltages[a] - getVoltageDrop("RESISTOR");
            changed = true;
          }

          if (a && b && netVoltages[b] !== undefined && netVoltages[a] === undefined) {
            netVoltages[a] = netVoltages[b] - getVoltageDrop("RESISTOR");
            changed = true;
          }

          break;
        }

        default:
          break;
      }
    }
  }

  return { netVoltages };
}
