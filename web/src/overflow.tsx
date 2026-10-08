import { useId, useState, type MouseEvent } from "react";

export function OverflowTip({ text, className }: { text: string; className: string }) {
  const tipId = useId();
  const [tip, setTip] = useState<{ x: number; y: number; above: boolean } | null>(null);

  function onEnter(event: MouseEvent<HTMLSpanElement>) {
    const el = event.currentTarget;
    if (el.scrollWidth <= el.clientWidth + 1) {
      setTip(null);
      return;
    }
    const box = el.getBoundingClientRect();
    const above = box.bottom + 28 > window.innerHeight;
    setTip({ x: box.left, y: above ? box.top - 4 : box.bottom + 4, above });
  }

  return (
    <>
      <span className={className} onMouseEnter={onEnter} onMouseLeave={() => setTip(null)} aria-describedby={tip ? tipId : undefined}>
        {text}
      </span>
      {tip && (
        <span id={tipId} className={tip.above ? "tree-tip above" : "tree-tip"} style={{ left: tip.x, top: tip.y }} role="tooltip">
          {text}
        </span>
      )}
    </>
  );
}
