"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MasteryLevel } from "@/lib/recallModel";
import type { Concept, ConceptEdge } from "@/lib/types";
import { layoutMap } from "@/lib/mapLayout";
import { vibrateTap } from "@/lib/haptics";

/** The deck, drawn.
 *
 * Everything on screen comes from data this app already had: the edges from
 * /api/concept-map (validated by validateEdges, so every one of them points at a
 * concept in THIS deck), the rows from mapLayout (which ranks in learningPath order,
 * so the map and the revision sheet's numbered list cannot disagree), and each node's
 * state from the recall engine.
 *
 * Inline SVG with no graph library. A force-directed layout would need a dependency,
 * a simulation loop and a different picture every time it settled - and "different
 * every time" is the one thing a map of your own subject must never be.
 *
 * PERFORMANCE CONTRACT (matches StreakCounter and PageTransition): panning writes a
 * transform straight to the scene's `<g>` through a ref. No React state changes while
 * a finger is down, so a 400-node deck drags on the compositor rather than re-rendering
 * four hundred elements a frame.
 *
 * COLOUR: none, beyond the three the app already uses for mastery. Relations are told
 * apart by STROKE - solid, thin, dashed - because this design system's own rule is that
 * contrast is the only signal (see globals.css). */

/** Past this many nodes, labels are off by default: a 200-node deck with every label
 * drawn is a wall of overlapping text that says less than the dots alone. The Labels
 * control turns them back on at any size, and a focused concept always shows its
 * own neighbourhood's labels regardless. */
const LABEL_LIMIT = 28;

const MIN_ZOOM = 0.35;
const MAX_ZOOM = 2.6;
const ZOOM_STEP = 1.3;
/** Movement past this (in CSS px) makes a gesture a pan rather than a tap. */
const DRAG_SLOP = 6;

const NODE_R = 8;

/** What a line between two ideas actually claims, in one word.
 *
 * A stroke style is a code the student is never given; a word is not. These are drawn
 * only on the FOCUSED node's own edges - a handful at a time - because a label on every
 * edge of a 400-node deck is not a map, it is a wall. `prerequisite` reads from the
 * dependent end ("this needs that"), which is the direction a student asks the question
 * in. */
const EDGE_WORD = {
  prerequisite: "needs",
  explains: "explains",
  contrast: "vs",
} as const;

/** The same three states the learning path and the relation chips already use. Solid
 * is the only thing that gets the accent; fading is the only thing that gets a warning;
 * everything else is a quiet ring, because "seen once" and "never seen" are not worth
 * spending a colour to tell apart at this size. */
function nodeClass(level: MasteryLevel | null): string {
  if (level === "solid") return "fill-accent";
  if (level === "fading") return "fill-pending";
  return "fill-foreground/25";
}

export default function ConceptMapView({
  concepts,
  edges,
  levelOf,
  selectedId,
  onSelect,
}: {
  concepts: readonly Concept[];
  edges: readonly ConceptEdge[];
  levelOf: (id: string) => MasteryLevel | null;
  /** The concept in focus, or null for the whole-deck overview. */
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SVGGElement>(null);
  /** Pan and zoom live here and NOT in state - see the performance contract above. */
  const view = useRef({ x: 0, y: 0, k: 1 });
  const drag = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);

  const ids = useMemo(() => concepts.map((c) => c.id), [concepts]);
  const layout = useMemo(() => layoutMap(ids, edges), [ids, edges]);
  const [labels, setLabels] = useState(() => layout.nodes.length <= LABEL_LIMIT);

  const position = useMemo(
    () => new Map(layout.nodes.map((node) => [node.id, node])),
    [layout],
  );
  const labelById = useMemo(
    () => new Map(concepts.map((c) => [c.id, c.concept])),
    [concepts],
  );

  /** The focused concept and everything one hop from it, in any relation. Drawn at
   * full strength while the rest of the deck falls back to a whisper. */
  const neighbourhood = useMemo(() => {
    if (selectedId === null) return null;
    const near = new Set([selectedId]);
    for (const edge of edges) {
      if (edge.from === selectedId) near.add(edge.to);
      if (edge.to === selectedId) near.add(edge.from);
    }
    return near;
  }, [selectedId, edges]);

  const apply = useCallback(() => {
    const { x, y, k } = view.current;
    sceneRef.current?.setAttribute("transform", `translate(${x} ${y}) scale(${k})`);
  }, []);

  /** Centres the whole drawing in whatever space the box has. Writes only through
   * refs, so it is safe to call from an effect - no state changes, nothing to
   * cascade. */
  const fit = useCallback(() => {
    const box = boxRef.current;
    if (!box || layout.width === 0) return;
    const { width, height } = box.getBoundingClientRect();
    const k = Math.min(width / layout.width, height / layout.height, 1.4);
    view.current = {
      k,
      x: (width - layout.width * k) / 2,
      y: (height - layout.height * k) / 2,
    };
    apply();
  }, [layout, apply]);

  useEffect(() => {
    fit();
  }, [fit]);

  function zoom(factor: number) {
    const box = boxRef.current;
    if (!box) return;
    const { width, height } = box.getBoundingClientRect();
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.current.k * factor));
    const scale = next / view.current.k;
    // Around the centre of the box, so zooming does not walk the drawing off screen.
    view.current = {
      k: next,
      x: width / 2 - (width / 2 - view.current.x) * scale,
      y: height / 2 - (height / 2 - view.current.y) * scale,
    };
    apply();
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const state = drag.current;
    if (!state || state.id !== event.pointerId) return;
    const dx = event.clientX - state.x;
    const dy = event.clientY - state.y;
    if (!state.moved && Math.hypot(dx, dy) < DRAG_SLOP) return;
    state.moved = true;
    state.x = event.clientX;
    state.y = event.clientY;
    view.current.x += dx;
    view.current.y += dy;
    apply();
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const state = drag.current;
    drag.current = null;
    if (state?.moved) return;
    // A tap on empty canvas leaves focus mode. A tap on a node is handled by the
    // node itself and stops there.
    if (event.target === event.currentTarget || (event.target as Element).tagName === "svg") {
      onSelect(null);
    }
  }

  if (layout.nodes.length === 0) return null;

  const dim = (id: string) => neighbourhood !== null && !neighbourhood.has(id);
  /** An edge with the focused concept at one end - the only ones that get a word. */
  const touchesFocus = (edge: ConceptEdge) =>
    selectedId !== null && (edge.from === selectedId || edge.to === selectedId);
  const edgeDim = (edge: ConceptEdge) =>
    neighbourhood !== null && !(neighbourhood.has(edge.from) && neighbourhood.has(edge.to));

  return (
    <div className="relative">
      <div
        ref={boxRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (drag.current = null)}
        className="relative h-[46vh] min-h-[300px] w-full touch-none overflow-hidden rounded-2xl border border-border bg-surface/40 md:backdrop-blur-xl"
      >
        <svg className="h-full w-full" role="img" aria-label="Concept map">
          <defs>
            <marker
              id="map-arrow"
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M0 0.5 L7.5 4 L0 7.5 z" className="fill-foreground/45" />
            </marker>
          </defs>

          <g ref={sceneRef}>
            {/* Edges first, so a node always sits on top of its own lines. */}
            {edges.map((edge, index) => {
              const from = position.get(edge.from);
              const to = position.get(edge.to);
              if (!from || !to) return null;
              const faded = edgeDim(edge);

              // Trimmed at both ends. Drawn centre-to-centre, the arrowhead lands
              // UNDERNEATH the node it points at - measured on the device, where every
              // arrow in the map was invisible - and the tail disappears into the dot
              // it leaves. GAP_END leaves room for the marker itself, not just the
              // radius.
              const [sx, sy, tx, ty] = trim(from.x, from.y, to.x, to.y);

              if (edge.relation === "contrast") {
                // Symmetric, so no arrow to draw and no direction to imply. Dashed,
                // which is the only thing on the canvas that is.
                return (
                  <g key={`c-${index}`}>
                  <line
                    x1={sx}
                    y1={sy}
                    x2={tx}
                    y2={ty}
                    strokeDasharray="5 5"
                    className={`stroke-foreground/30 transition-opacity ${faded ? "opacity-10" : "opacity-100"}`}
                    strokeWidth={1.4}
                  />
                  {touchesFocus(edge) && (
                    // A third of the way along rather than the middle. Two concepts can
                    // carry BOTH a directed edge and a contrast edge - stroke volume and
                    // cardiac output do, since one leads to the other and they are also
                    // the classic mix-up - and at the midpoint the two words print on
                    // top of each other. Measured on the device, where "NEEDS" and "VS"
                    // came out as "N.VS.S".
                    <EdgeWord x={sx + (tx - sx) * 0.3} y={sy + (ty - sy) * 0.3} word={EDGE_WORD.contrast} />
                  )}
                  </g>
                );
              }

              // A cubic with vertical handles, so lines leave the bottom of one node
              // and arrive at the top of the next instead of cutting corners.
              const mid = (sy + ty) / 2;
              const d = `M ${sx} ${sy} C ${sx} ${mid}, ${tx} ${mid}, ${tx} ${ty}`;
              const explains = edge.relation === "explains";
              return (
                <g key={`e-${index}`}>
                <path
                  d={d}
                  fill="none"
                  markerEnd="url(#map-arrow)"
                  strokeWidth={explains ? 1 : 1.6}
                  className={`${explains ? "stroke-foreground/20" : "stroke-foreground/40"} transition-opacity ${
                    faded ? "opacity-10" : "opacity-100"
                  }`}
                />
                {touchesFocus(edge) && (
                  <EdgeWord
                    x={(sx + tx) / 2}
                    y={(sy + ty) / 2}
                    word={explains ? EDGE_WORD.explains : EDGE_WORD.prerequisite}
                  />
                )}
                </g>
              );
            })}

            {layout.nodes.map((node) => {
              const level = levelOf(node.id);
              const faded = dim(node.id);
              const focused = node.id === selectedId;
              const showLabel = labels || (neighbourhood?.has(node.id) ?? false);

              return (
                <g
                  key={node.id}
                  onClick={() => {
                    if (drag.current?.moved) return;
                    vibrateTap();
                    onSelect(focused ? null : node.id);
                  }}
                  className={`cursor-pointer transition-opacity ${faded ? "opacity-15" : "opacity-100"}`}
                >
                  {/* A finger is wider than an 8px dot. */}
                  <circle cx={node.x} cy={node.y} r={22} fill="transparent" />
                  {focused && (
                    <circle
                      cx={node.x}
                      cy={node.y}
                      r={NODE_R + 6}
                      className="fill-none stroke-accent/70"
                      strokeWidth={1.5}
                    />
                  )}
                  <circle cx={node.x} cy={node.y} r={NODE_R} className={nodeClass(level)} />
                  {showLabel && (
                    <text
                      x={node.x}
                      y={node.y + NODE_R + 15}
                      textAnchor="middle"
                      className="pointer-events-none fill-foreground text-[11px] font-medium"
                    >
                      {clip(labelById.get(node.id) ?? "")}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>

        {/* Controls, floating over the canvas. Same 7x7 pill buttons as the PDF
            reader's zoom stepper, rather than a second idiom for the same job. */}
        <div className="absolute bottom-3 right-3 flex items-center gap-1 rounded-full border border-border bg-surface/90 px-1.5 py-1 backdrop-blur-md">
          <MapButton label="Zoom out" onClick={() => zoom(1 / ZOOM_STEP)}>
            &minus;
          </MapButton>
          <MapButton label="Fit the whole map" onClick={fit}>
            <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
              <path
                d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </MapButton>
          <MapButton label="Zoom in" onClick={() => zoom(ZOOM_STEP)}>
            +
          </MapButton>
          <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
          <button
            type="button"
            onClick={() => {
              vibrateTap();
              setLabels((on) => !on);
            }}
            aria-pressed={labels}
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
              labels ? "bg-foreground/10 text-foreground" : "text-muted-foreground"
            }`}
          >
            Labels
          </button>
        </div>
      </div>
    </div>
  );
}

/** One word, on its own plate so the line underneath does not run through it.
 *
 * `paintOrder: stroke` draws a thick background-coloured stroke behind the glyphs
 * before filling them - a knockout that needs no rectangle to be measured, which SVG
 * cannot do for text anyway. */
function EdgeWord({ x, y, word }: { x: number; y: number; word: string }) {
  return (
    <text
      x={x}
      y={y}
      textAnchor="middle"
      dominantBaseline="middle"
      style={{ paintOrder: "stroke" }}
      strokeWidth={6}
      className="pointer-events-none fill-muted-foreground stroke-background text-[10px] font-medium uppercase tracking-wider"
    >
      {word}
    </text>
  );
}

/** Pulls a line's two ends back to the edges of the dots it joins.
 *
 * `GAP_END` is larger than `GAP_START` because the arrow marker is drawn beyond the
 * path's last point: stopping at the node's radius still buries the head under it. */
function trim(x1: number, y1: number, x2: number, y2: number): [number, number, number, number] {
  const GAP_START = NODE_R + 3;
  const GAP_END = NODE_R + 9;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy);
  // Two nodes on top of each other cannot be trimmed sensibly; leave the line alone
  // rather than dividing by zero and drawing a NaN path Chrome silently discards.
  if (length < GAP_START + GAP_END) return [x1, y1, x2, y2];
  const ux = dx / length;
  const uy = dy / length;
  return [x1 + ux * GAP_START, y1 + uy * GAP_START, x2 - ux * GAP_END, y2 - uy * GAP_END];
}

/** Labels are 2-6 words and the plate under a node is not that wide. Cut in the
 * middle of the SVG's own text rather than with CSS, which cannot ellipsis an
 * SVG <text>. */
function clip(label: string): string {
  return label.length > 22 ? `${label.slice(0, 21).trimEnd()}…` : label;
}

function MapButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        vibrateTap();
        onClick();
      }}
      aria-label={label}
      title={label}
      className="flex h-7 w-7 items-center justify-center rounded-full text-sm text-foreground transition-colors hover:bg-foreground/10 active:scale-90"
    >
      {children}
    </button>
  );
}
