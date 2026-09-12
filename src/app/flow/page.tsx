import FlowStateHub from "@/components/FlowStateHub";

/** The Home/Action screen, reachable at /flow.
 *
 * Deliberately its OWN route rather than a replacement for src/app/page.tsx: making this
 * the native home swaps out the screen students currently land on, which is a product
 * decision rather than a styling one. Wiring it as the Home tab is a one-line change in
 * MobileTabBar + page.tsx when that call is made. */
export default function FlowPage() {
  return <FlowStateHub />;
}
