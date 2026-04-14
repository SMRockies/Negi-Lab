const CIRCUIT_FILE_VERSION = 1;
const CIRCUIT_FILE_EXTENSION = ".negi";
const CIRCUIT_FILE_NAME = `circuit${CIRCUIT_FILE_EXTENSION}`;

function serializeNode(node) {
  return {
    id: node.id,
    type: node.type,
    x: node.x,
    y: node.y,
    rotation: node.rotation ?? 0,
    state: node.state ?? null,
  };
}

function serializeWire(wire) {
  return {
    id: wire.id,
    from: wire.from,
    to: wire.to,
    points: wire.points ?? [],
  };
}

function validateNode(node, index) {
  if (!node || typeof node !== "object") {
    throw new Error(`Invalid node at index ${index}.`);
  }

  if (typeof node.id !== "string" || typeof node.type !== "string") {
    throw new Error(`Node ${index} is missing a valid id or type.`);
  }

  if (typeof node.x !== "number" || typeof node.y !== "number") {
    throw new Error(`Node ${index} is missing valid coordinates.`);
  }

  if (node.rotation !== undefined && typeof node.rotation !== "number") {
    throw new Error(`Node ${index} has an invalid rotation.`);
  }
}

function validateWireEndpoint(endpoint, label, index) {
  if (!endpoint || typeof endpoint !== "object") {
    throw new Error(`Wire ${index} has an invalid ${label} endpoint.`);
  }

  if (typeof endpoint.nodeId !== "string" || typeof endpoint.pinId !== "string") {
    throw new Error(`Wire ${index} has an invalid ${label} endpoint reference.`);
  }
}

function validateWire(wire, index) {
  if (!wire || typeof wire !== "object") {
    throw new Error(`Invalid wire at index ${index}.`);
  }

  if (typeof wire.id !== "string") {
    throw new Error(`Wire ${index} is missing a valid id.`);
  }

  validateWireEndpoint(wire.from, "from", index);
  validateWireEndpoint(wire.to, "to", index);

  if (wire.points !== undefined) {
    if (!Array.isArray(wire.points)) {
      throw new Error(`Wire ${index} has invalid bend points.`);
    }

    wire.points.forEach((point, pointIndex) => {
      if (!point || typeof point.x !== "number" || typeof point.y !== "number") {
        throw new Error(`Wire ${index} has an invalid bend point at index ${pointIndex}.`);
      }
    });
  }
}

export function saveCircuit(state) {
  return JSON.stringify(
    {
      version: CIRCUIT_FILE_VERSION,
      nodes: (state.nodes ?? []).map(serializeNode),
      wires: (state.wires ?? []).map(serializeWire),
    },
    null,
    2
  );
}

export function normalizeCircuitFilename(filename) {
  const trimmedFilename = String(filename ?? "").trim();
  const baseName =
    trimmedFilename.length > 0 ? trimmedFilename.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_") : "circuit";

  return baseName.toLowerCase().endsWith(CIRCUIT_FILE_EXTENSION)
    ? baseName
    : `${baseName}${CIRCUIT_FILE_EXTENSION}`;
}

export function loadCircuit(json) {
  let data;

  try {
    data = JSON.parse(json);
  } catch {
    throw new Error("Invalid circuit file: JSON could not be parsed.");
  }

  if (!data || typeof data !== "object") {
    throw new Error("Invalid circuit file: root object is missing.");
  }

  if (!Array.isArray(data.nodes) || !Array.isArray(data.wires)) {
    throw new Error("Invalid circuit file: nodes or wires are missing.");
  }

  data.nodes.forEach(validateNode);
  data.wires.forEach(validateWire);

  return {
    version: typeof data.version === "number" ? data.version : CIRCUIT_FILE_VERSION,
    nodes: data.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      x: node.x,
      y: node.y,
      rotation: typeof node.rotation === "number" ? node.rotation : 0,
      state: node.state ?? null,
    })),
    wires: data.wires.map((wire) => ({
      id: wire.id,
      from: wire.from,
      to: wire.to,
      points: Array.isArray(wire.points) ? wire.points : [],
    })),
  };
}

export function exportCircuitToFile(state, filename = CIRCUIT_FILE_NAME) {
  const normalizedFilename = normalizeCircuitFilename(filename);
  const json = saveCircuit(state);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = normalizedFilename;
  link.click();

  URL.revokeObjectURL(url);
}

export async function importCircuitFromFile(file) {
  if (!file) {
    throw new Error("No file selected.");
  }

  const text = await file.text();
  return loadCircuit(text);
}
