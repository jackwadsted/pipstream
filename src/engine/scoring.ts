import type { GameConfig, PlacedNode, RunState } from "./types.js";

export interface ScorePath {
  leafNodeId: string;
  pipTotal: number;
  multiplier: number;
  contribution: number;
}

export interface ScoreResult {
  totalScore: number;
  paths: ScorePath[];
}

/**
 * Traverse the placed-tile tree and compute the final run score.
 *
 * Algorithm:
 * - Walk every root-to-leaf path (leaf = placed node with no children).
 * - Per path: sum pips of every tile → pipTotal.
 * - When a path passes through a double, each branch coming out of that double
 *   carries config.branchMultiplier. Multipliers stack multiplicatively — a path
 *   through two doubles gets branchMultiplier^2.
 * - Path contribution = pipTotal × (product of all branch multipliers on path).
 * - Total score = sum of all leaf-path contributions.
 *
 * The multiplier is applied when recursing INTO a double's children, so a double
 * that is itself a leaf (no children) does not apply its multiplier — there are no
 * branches coming out of it.
 */
export function computeScore(state: RunState, config: GameConfig): ScoreResult {
  const { placedNodes } = state;
  const { branchMultiplier } = config;

  const rootNode = Object.values(placedNodes).find((n) => n.parentNodeId === null);
  if (!rootNode) return { totalScore: 0, paths: [] };

  const childrenMap = buildChildrenMap(placedNodes);
  const paths: ScorePath[] = [];

  function traverse(
    nodeId: string,
    pathSoFar: PlacedNode[],
    currentMult: number,
  ): void {
    const node = placedNodes[nodeId]!;
    const path = [...pathSoFar, node];
    const children = childrenMap.get(nodeId) ?? [];

    if (children.length === 0) {
      const pipTotal = path.reduce(
        (sum, n) => sum + n.domino.pips[0] + n.domino.pips[1],
        0,
      );
      paths.push({
        leafNodeId: nodeId,
        pipTotal,
        multiplier: currentMult,
        contribution: pipTotal * currentMult,
      });
      return;
    }

    const isDouble = node.domino.pips[0] === node.domino.pips[1];
    const isRoot = node.parentNodeId === null;
    const childMult = isDouble && !isRoot ? currentMult * branchMultiplier : currentMult;

    for (const childId of children) {
      traverse(childId, path, childMult);
    }
  }

  traverse(rootNode.id, [], 1);

  const totalScore = paths.reduce((sum, p) => sum + p.contribution, 0);
  return { totalScore, paths };
}

function buildChildrenMap(
  placedNodes: Record<string, PlacedNode>,
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const node of Object.values(placedNodes)) {
    if (!map.has(node.id)) map.set(node.id, []);
    if (node.parentNodeId) {
      if (!map.has(node.parentNodeId)) map.set(node.parentNodeId, []);
      map.get(node.parentNodeId)!.push(node.id);
    }
  }
  return map;
}
