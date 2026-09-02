"use client";

import type { Status } from "@/lib/tires/types";

export interface TireNodeProps {
  number: number;
  abbreviation: string;
  status: Status;
  psi?: number | null;
  tread32?: number | null;
  requiresPsi?: boolean;
  selected?: boolean;
  photoMissing?: boolean;
  showValues?: boolean;
  onSelect?: (number: number) => void;
  size?: "sm" | "md" | "lg";
  /** Spare declared "No spare": rendered as an empty dashed slot. */
  absent?: boolean;
}

/**
 * A single tire on the diagram: dark tread block with a colored status ring
 * (gray = not checked, green / yellow / red per thresholds). Loud states are
 * expressed through the ring, not the whole component.
 */
export function TireNode({ number, abbreviation, status, psi, tread32, requiresPsi = true, selected, photoMissing, showValues = true, onSelect, size = "md", absent }: TireNodeProps) {
  const dims = size === "sm" ? { w: 36, h: 50 } : size === "lg" ? { w: 56, h: 76 } : { w: 46, h: 64 };
  const hasPsi = psi !== null && psi !== undefined;
  const hasTread = tread32 !== null && tread32 !== undefined;
  const value = showValues && (hasPsi || hasTread) ? `${requiresPsi ? (hasPsi ? Math.round(psi!) : "–") : ""}${requiresPsi ? "·" : ""}${hasTread ? tread32 : "–"}` : null;
  const Tag = onSelect ? "button" : "div";
  return (
    <div className="flex flex-col items-center">
      <Tag
        type={onSelect ? "button" : undefined}
        className="tire"
        style={{ ["--tire-w" as string]: `${dims.w}px`, ["--tire-h" as string]: `${dims.h}px` }}
        data-status={status}
        data-absent={absent ? "true" : "false"}
        data-selected={selected ? "true" : "false"}
        data-photo-missing={photoMissing ? "true" : "false"}
        data-tire={number}
        aria-label={`Tire ${number} ${abbreviation}`}
        aria-pressed={onSelect ? !!selected : undefined}
        onClick={onSelect ? () => onSelect(number) : undefined}
      >
        <span className="n">{absent ? "—" : number}</span>
        {absent ? <span className="v">{number}</span> : value ? <span className="v">{value}</span> : null}
      </Tag>
      <div className="tire-label">{abbreviation}</div>
    </div>
  );
}
