export const ACTION_TYPES = {
  ADD_NODE: "ADD_NODE",
  REMOVE_NODE: "REMOVE_NODE",
  ADD_WIRE: "ADD_WIRE",
  REMOVE_WIRE: "REMOVE_WIRE",
  TOGGLE_SWITCH: "TOGGLE_SWITCH",
  PRESS_BUTTON: "PRESS_BUTTON",
  RELEASE_BUTTON: "RELEASE_BUTTON",
  UPDATE_NODE_STATE: "UPDATE_NODE_STATE",
  ROTATE_NODE: "ROTATE_NODE",
  MOVE_NODE: "MOVE_NODE",
  UPDATE_WIRE_POINTS: "UPDATE_WIRE_POINTS",
  REMOVE_WIRE_POINT: "REMOVE_WIRE_POINT",
  LOAD_CIRCUIT: "LOAD_CIRCUIT",
  COMMIT_HISTORY_ENTRY: "COMMIT_HISTORY_ENTRY",
  UNDO: "UNDO",
  REDO: "REDO",
};

function releasePressedButtons(nodes) {
  let didChange = false;

  const nextNodes = nodes.map((node) => {
    if (node.type === "BUTTON" && node.state === "CLOSED") {
      didChange = true;
      return { ...node, state: "OPEN" };
    }

    return node;
  });

  return didChange ? nextNodes : nodes;
}

function areSnapshotsEqual(firstSnapshot, secondSnapshot) {
  return (
    firstSnapshot.nodes === secondSnapshot.nodes &&
    firstSnapshot.wires === secondSnapshot.wires
  );
}

export function reducer(state, action) {
  switch (action.type) {
    case ACTION_TYPES.ADD_NODE:
      return {
        ...state,
        nodes: [...state.nodes, action.payload.node],
      };

    case ACTION_TYPES.REMOVE_NODE:
      return {
        ...state,
        nodes: state.nodes.filter((node) => node.id !== action.payload.nodeId),
        wires: state.wires.filter(
          (wire) =>
            wire.from.nodeId !== action.payload.nodeId &&
            wire.to.nodeId !== action.payload.nodeId
        ),
      };

    case ACTION_TYPES.ADD_WIRE:
      return {
        ...state,
        wires: [...state.wires, action.payload.wire],
      };

    case ACTION_TYPES.REMOVE_WIRE:
      return {
        ...state,
        wires: state.wires.filter((wire) => wire.id !== action.payload.wireId),
      };

    case ACTION_TYPES.TOGGLE_SWITCH:
      return {
        ...state,
        nodes: state.nodes.map((node) =>
          node.id === action.payload.nodeId && node.type === "SWITCH"
            ? {
                ...node,
                state: node.state === "OPEN" ? "CLOSED" : "OPEN",
              }
            : node
        ),
      };

    case ACTION_TYPES.PRESS_BUTTON:
      return {
        ...state,
        nodes: state.nodes.map((node) =>
          node.id === action.payload.nodeId && node.type === "BUTTON"
            ? { ...node, state: "CLOSED" }
            : node
        ),
      };

    case ACTION_TYPES.RELEASE_BUTTON: {
      const nextNodes = action.payload?.nodeId
        ? state.nodes.map((node) =>
            node.id === action.payload.nodeId && node.type === "BUTTON"
              ? { ...node, state: "OPEN" }
              : node
          )
        : releasePressedButtons(state.nodes);

      return {
        ...state,
        nodes: nextNodes,
      };
    }

    case ACTION_TYPES.UPDATE_NODE_STATE:
      return {
        ...state,
        nodes: state.nodes.map((node) =>
          node.id === action.payload.nodeId
            ? { ...node, state: action.payload.state }
            : node
        ),
      };

    case ACTION_TYPES.ROTATE_NODE:
      return {
        ...state,
        nodes: state.nodes.map((node) =>
          node.id === action.payload.nodeId
            ? { ...node, rotation: ((node.rotation ?? 0) + 90) % 360 }
            : node
        ),
      };

    case ACTION_TYPES.MOVE_NODE:
      return {
        ...state,
        nodes: state.nodes.map((node) =>
          node.id === action.payload.nodeId
            ? { ...node, x: action.payload.x, y: action.payload.y }
            : node
        ),
      };

    case ACTION_TYPES.UPDATE_WIRE_POINTS:
      return {
        ...state,
        wires: state.wires.map((wire) =>
          wire.id === action.payload.wireId
            ? { ...wire, points: action.payload.points }
            : wire
        ),
      };

    case ACTION_TYPES.REMOVE_WIRE_POINT:
      return {
        ...state,
        wires: state.wires.map((wire) =>
          wire.id === action.payload.wireId
            ? {
                ...wire,
                points: (wire.points ?? []).filter(
                  (_, index) => index !== action.payload.pointIndex
                ),
              }
            : wire
        ),
      };

    case ACTION_TYPES.LOAD_CIRCUIT:
      return {
        ...state,
        nodes: action.payload.nodes,
        wires: action.payload.wires,
      };

    default:
      return state;
  }
}

function actionChangesDerivedState(action) {
  switch (action.type) {
    case ACTION_TYPES.UNDO:
    case ACTION_TYPES.REDO:
    case ACTION_TYPES.ADD_NODE:
    case ACTION_TYPES.REMOVE_NODE:
    case ACTION_TYPES.ADD_WIRE:
    case ACTION_TYPES.REMOVE_WIRE:
    case ACTION_TYPES.TOGGLE_SWITCH:
    case ACTION_TYPES.PRESS_BUTTON:
    case ACTION_TYPES.RELEASE_BUTTON:
    case ACTION_TYPES.UPDATE_NODE_STATE:
    case ACTION_TYPES.ROTATE_NODE:
    case ACTION_TYPES.MOVE_NODE:
    case ACTION_TYPES.LOAD_CIRCUIT:
      return true;

    default:
      return false;
  }
}

function toHistoryState(snapshot, history = {}) {
  return {
    past: history.past ?? [],
    present: snapshot,
    future: history.future ?? [],
    graph: history.graph ?? null,
    simulationState: history.simulationState ?? null,
  };
}

export function createCircuitEngine({
  buildGraph,
  buildSimulationGraph,
  computeSimulationState,
}) {
  let isGraphDirty = true;

  function sync(historyState) {
    if (isGraphDirty || !historyState.graph || !historyState.simulationState) {
      const { nodes, wires } = historyState.present;
      const graph = buildGraph(wires, nodes);
      const simulationGraph = buildSimulationGraph(nodes, wires);
      const simulationState = computeSimulationState(simulationGraph, nodes, wires);

      isGraphDirty = false;

      return {
        ...historyState,
        graph,
        simulationState,
      };
    }

    return historyState;
  }

  return {
    createState({ nodes, wires }) {
      return sync(
        toHistoryState({
          nodes,
          wires,
        })
      );
    },

    dispatch(state, action) {
      if (action.type === ACTION_TYPES.COMMIT_HISTORY_ENTRY) {
        const beforeSnapshot = action.payload?.before;
        const afterSnapshot = action.payload?.after ?? state.present;

        if (!beforeSnapshot || areSnapshotsEqual(beforeSnapshot, afterSnapshot)) {
          return state;
        }

        const nextState = {
          ...state,
          past: [...state.past, beforeSnapshot],
          present: afterSnapshot,
          future: [],
        };

        isGraphDirty = true;
        return sync(nextState);
      }

      if (action.type === ACTION_TYPES.UNDO) {
        if (state.past.length === 0) {
          return state;
        }

        const previousPresent = state.past[state.past.length - 1];
        const nextState = {
          ...state,
          past: state.past.slice(0, -1),
          present: previousPresent,
          future: [state.present, ...state.future],
          graph: null,
          simulationState: null,
        };

        isGraphDirty = true;
        return sync(nextState);
      }

      if (action.type === ACTION_TYPES.REDO) {
        if (state.future.length === 0) {
          return state;
        }

        const nextPresent = state.future[0];
        const nextState = {
          ...state,
          past: [...state.past, state.present],
          present: nextPresent,
          future: state.future.slice(1),
          graph: null,
          simulationState: null,
        };

        isGraphDirty = true;
        return sync(nextState);
      }

      const reducedPresent = reducer(state.present, action);

      if (reducedPresent === state.present || areSnapshotsEqual(reducedPresent, state.present)) {
        return state;
      }

      if (action.meta?.skipHistory) {
        const nextState = {
          ...state,
          present: reducedPresent,
        };

        if (actionChangesDerivedState(action)) {
          isGraphDirty = true;
        }

        return sync(nextState);
      }

      const nextState = {
        ...state,
        past: [...state.past, state.present],
        present: reducedPresent,
        future: [],
        graph: state.graph,
        simulationState: state.simulationState,
      };

      if (actionChangesDerivedState(action)) {
        isGraphDirty = true;
      }

      return sync(nextState);
    },
  };
}
