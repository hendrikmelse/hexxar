/** Anything with two chamber indexes: a corridor. */
export interface Link {
  readonly from: number;
  readonly to: number;
}

export interface TopologyIssues {
  /**
   * Dead-end chambers (one corridor) whose tail is longer than one corridor: following the
   * layout from the dead end through chambers that have only two corridors takes more than one
   * step before it reaches a junction. This is a snake or a long peninsula. A dead end that
   * hangs straight off a junction is fine.
   */
  readonly tails: readonly number[];
}

const neighborsOf = (count: number, links: readonly Link[]): number[][] => {
  const neighbors: number[][] = Array.from({ length: count }, () => []);
  for (const { from, to } of links) {
    neighbors[from]!.push(to);
    neighbors[to]!.push(from);
  }
  return neighbors;
};

/** Find the dead ends with a tail longer than one corridor. */
export function topologyIssues(count: number, links: readonly Link[]): TopologyIssues {
  const neighbors = neighborsOf(count, links);
  const tails: number[] = [];
  for (let leaf = 0; leaf < count; leaf++) {
    if (neighbors[leaf]!.length !== 1) continue;
    let previous = leaf;
    let current = neighbors[leaf]![0]!;
    let length = 1;
    // Walk along chambers with exactly two corridors; anything else ends the tail.
    while (neighbors[current]!.length === 2 && current !== leaf) {
      const next = neighbors[current]!.find((n) => n !== previous)!;
      previous = current;
      current = next;
      length++;
    }
    if (length > 1) tails.push(leaf);
  }
  return { tails };
}

/** Does the layout have no tail or peninsula longer than one corridor? */
export const topologyOk = (count: number, links: readonly Link[]): boolean =>
  topologyIssues(count, links).tails.length === 0;
