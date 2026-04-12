/**
 * Returns the canonical string key for a pin, used as a graph vertex identifier.
 *
 * @param {string} nodeId
 * @param {string} pinId
 * @returns {string} e.g. "battery1:positive"
 */
export function getPinKey(nodeId, pinId) {
  return `${nodeId}:${pinId}`;
}

/**
 * Normalizes a pin reference into a structured { nodeId, pinId } object.
 * Accepts either a pre-structured object or a colon-delimited string.
 *
 * @param {string | { nodeId: string, pinId: string } | null | undefined} pinReference
 * @returns {{ nodeId: string, pinId: string } | null}
 */
export function parsePinReference(pinReference) {
  if (!pinReference) {
    return null;
  }

  if (
    typeof pinReference === "object" &&
    pinReference.nodeId &&
    pinReference.pinId
  ) {
    return pinReference;
  }

  if (typeof pinReference !== "string") {
    return null;
  }

  const [nodeId, pinId] = pinReference.split(":");
  if (!nodeId || !pinId) {
    return null;
  }

  return { nodeId, pinId };
}
