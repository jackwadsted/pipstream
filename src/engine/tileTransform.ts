import type { PlacedNode } from "./types.js";

export interface TileTransform {
  /** Rotation in radians for the SVG rotate transform, around the tile's center. */
  rotation: number;
  /**
   * True when the tile was rotated +π to flip its 'b' end inward toward the parent.
   * Informational — the rotation already encodes the flip; consumers can use this
   * flag for debugging or future visual effects.
   */
  flipped: boolean;
}

/**
 * Compute the rotation for a placed tile so its connected end faces inward
 * (toward the parent / tree center) and its open end faces outward.
 *
 * The DominoTileSVG renders pips[0] to the LEFT (angle π from center) and
 * pips[1] to the RIGHT (angle 0) before any rotation. After rotating by R:
 *   - pips[0] direction = π + R  (inward when R = layoutAngle, since parent is at layoutAngle+π)
 *   - pips[1] direction = R      (inward when R = layoutAngle + π)
 *
 * connectedEnd 'a' (pips[0] matched parent): natural orientation — rotation = layoutAngle.
 * connectedEnd 'b' (pips[1] matched parent): flip needed — rotation = layoutAngle + π.
 * connectedEnd null (root tile, no parent): use layoutAngle unchanged.
 *   Convention: root tile is passed layoutAngle=0 by the caller, placing pips[0]
 *   facing left and pips[1] facing right (horizontal, toward the first child subtree).
 *
 * @param node - The placed node (connectedEnd determines which pip faces inward).
 * @param angleFromLayout - Angle in radians from the tree center to this node position
 *   (Math.atan2 of the node's (y, x) layout coordinates). The tile's long axis aligns
 *   along this angle. This function does not change the positional angle, only adds π
 *   when needed for the pip-end flip.
 */
export function getTileTransform(
  node: PlacedNode,
  angleFromLayout: number,
): TileTransform {
  if (node.connectedEnd === "b") {
    return { rotation: angleFromLayout + Math.PI, flipped: true };
  }
  return { rotation: angleFromLayout, flipped: false };
}
