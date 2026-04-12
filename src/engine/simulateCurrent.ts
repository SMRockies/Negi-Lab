import { ComponentNetMapping, Netlist } from "./generateNetlist";

export interface CurrentResult {
  totalCurrent: number;
  componentCurrents: Record<string, number>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * LED forward voltage drop.
 */
function getLEDVoltageDrop(): number {
  return 2.0;
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

function getResistance(component: ComponentNetMapping): number {
  if (!isRecord(component.state)) {
    return 100;
  }

  return typeof component.state.resistance === "number"
    ? component.state.resistance
    : 100;
}

/**
 * Find battery.
 *
 * First-version scope supports a single battery source.
 */
function findBattery(netlist: Netlist) {
  const battery = netlist.components.find((component) => component.type === "BATTERY");
  if (!battery) return null;

  const voltage =
    isRecord(battery.state) && typeof battery.state.voltage === "number"
      ? battery.state.voltage
      : 9;

  return { voltage };
}

/**
 * Main current solver.
 *
 * First-version scope:
 * - single loop only
 * - one battery source
 * - fixed LED drop
 * - resistor values taken from component state or defaulted
 */
export function simulateCurrent(netlist: Netlist): CurrentResult {
  const battery = findBattery(netlist);

  if (!battery) {
    return {
      totalCurrent: 0,
      componentCurrents: {},
    };
  }

  let totalResistance = 0;
  let totalVoltageDrop = 0;

  for (const component of netlist.components) {
    switch (component.type) {
      case "LED":
        totalVoltageDrop += getLEDVoltageDrop();
        break;

      case "RESISTOR":
        totalResistance += getResistance(component);
        break;

      case "SWITCH":
      case "BUTTON":
        if (!isClosedLike(component)) {
          return {
            totalCurrent: 0,
            componentCurrents: {},
          };
        }
        break;

      default:
        break;
    }
  }

  const availableVoltage = battery.voltage - totalVoltageDrop;

  if (totalResistance <= 0 || availableVoltage <= 0) {
    return {
      totalCurrent: 0,
      componentCurrents: {},
    };
  }

  const totalCurrent = availableVoltage / totalResistance;
  const componentCurrents: Record<string, number> = {};

  for (const component of netlist.components) {
    if (
      component.type === "LED" ||
      component.type === "RESISTOR" ||
      component.type === "SWITCH" ||
      component.type === "BUTTON"
    ) {
      componentCurrents[component.id] = totalCurrent;
    }
  }

  return {
    totalCurrent,
    componentCurrents,
  };
}
