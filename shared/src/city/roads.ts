/** Road graph helpers: adjacency, nearest node, shortest path. Used by bots and the generator. */

import type { RoadGraph } from './types';

/** For each node id, the ids of the edges that touch it. */
export function roadAdjacency(graph: RoadGraph): number[][] {
  const adj: number[][] = graph.nodes.map(() => []);
  for (const e of graph.edges) {
    adj[e.a].push(e.id);
    adj[e.b].push(e.id);
  }
  return adj;
}

/** Id of the road node closest to a point, or -1 for an empty graph. */
export function nearestRoadNode(graph: RoadGraph, x: number, z: number): number {
  let best = -1;
  let bestD = Infinity;
  for (const n of graph.nodes) {
    const dx = n.x - x;
    const dz = n.z - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = n.id;
    }
  }
  return best;
}

/**
 * Shortest path along the roads between two nodes, as a list of node ids including both ends.
 * `edgeOpen` can close edges (for example a bridge whose deck has been destroyed). Returns an
 * empty list when there is no route.
 */
export function findRoadPath(
  graph: RoadGraph,
  adjacency: readonly number[][],
  from: number,
  to: number,
  edgeOpen?: (edgeId: number) => boolean,
): number[] {
  const n = graph.nodes.length;
  if (from < 0 || to < 0 || from >= n || to >= n) return [];
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  dist[from] = 0;
  for (;;) {
    // The graph is small (a few hundred nodes), so a linear scan for the closest open node is fine.
    let u = -1;
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      if (!done[i] && dist[i] < best) {
        best = dist[i];
        u = i;
      }
    }
    if (u < 0) return [];
    if (u === to) break;
    done[u] = 1;
    const nu = graph.nodes[u];
    for (const edgeId of adjacency[u]) {
      if (edgeOpen && !edgeOpen(edgeId)) continue;
      const e = graph.edges[edgeId];
      const v = e.a === u ? e.b : e.a;
      if (done[v]) continue;
      const nv = graph.nodes[v];
      const d = best + Math.hypot(nv.x - nu.x, nv.z - nu.z);
      if (d < dist[v]) {
        dist[v] = d;
        prev[v] = u;
      }
    }
  }
  const path: number[] = [];
  for (let at = to; at >= 0; at = prev[at]) path.push(at);
  return path.reverse();
}
