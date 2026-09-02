"use client";

import type { Status } from "@/lib/tires/types";

export interface TireNodeProps {
  number: number;
  abbreviation: string;
  /** Worst status → ring + number badge. */
  status: Status;
  psiStatus?: Status;
  treadStatus?: Status;
  psi?: number | null;
  tread32?: number | null;
  requiresPsi?: boolean;
  isSpare?: boolean;
  absent?: boolean;
  selected?: boolean;
  /** Middle band: none (empty square), photo (indigo), need (red !). */
  photoState?: "none" | "photo" | "need";
  hasDamage?: boolean;
  showPos?: boolean;
  onSelect?: (number: number) => void;
  size?: "sm" | "md" | "lg";
}

/**
 * Tire card from the design system (§1c anatomy): status ring, number badge
 * top-left, PSI band, photo/damage band, tread band; spares swap the PSI
 * band for a SPARE cap. Em dash means no reading yet — never 0.
 */
export function TireNode({ number, abbreviation, status, psiStatus = "none", treadStatus = "none", psi, tread32, requiresPsi = true, isSpare, absent, selected, photoState = "none", hasDamage, showPos = true, onSelect, size = "md" }: TireNodeProps) {
  const w = size === "sm" ? 52 : size === "lg" ? 66 : 60;
  const hasPsi = psi !== null && psi !== undefined;
  const hasTread = tread32 !== null && tread32 !== undefined;
  const Tag = onSelect ? "button" : "div";
  return (
    <div style={{ width: w }}>
      <Tag
        type={onSelect ? "button" : undefined}
        className="tire"
        style={{ ["--tire-w" as string]: `${w}px` }}
        data-status={absent ? "none" : status}
        data-selected={selected ? "true" : "false"}
        data-absent={absent ? "true" : "false"}
        data-tire={number}
        aria-label={`Tire ${number} ${abbreviation}`}
        aria-pressed={onSelect ? !!selected : undefined}
        onClick={onSelect ? () => onSelect(number) : undefined}
      >
        <span className="badge">{number}</span>
        {isSpare || !requiresPsi ? (
          <span className="band" style={{ background: "var(--st-none-tint)" }}>
            <span className="cap">{absent ? "—" : "SPARE"}</span>
          </span>
        ) : (
          <span className="band" data-status={psiStatus} style={{ background: "var(--s-soft)" }}>
            <span className="val" data-empty={!hasPsi} style={{ color: hasPsi ? "var(--s)" : undefined }}>
              {hasPsi ? Math.round(psi!) : "—"}
            </span>
            <span className="unit">PSI</span>
          </span>
        )}
        <span className="mid" data-need={photoState === "need"}>
          <span className="cam" data-state={photoState}>
            {photoState === "need" ? "!" : "▣"}
          </span>
          {hasDamage ? <span className="dmg">DMG</span> : null}
        </span>
        <span className="band band-tread" data-status={absent ? "none" : treadStatus} style={{ background: "var(--s-soft)" }}>
          <span className="val" data-empty={!hasTread} style={{ color: hasTread ? "var(--s)" : undefined }}>
            {hasTread && !absent ? tread32 : "—"}
          </span>
          <span className="unit">/32</span>
        </span>
      </Tag>
      {showPos ? <div className="tire-pos">{abbreviation}</div> : null}
    </div>
  );
}
