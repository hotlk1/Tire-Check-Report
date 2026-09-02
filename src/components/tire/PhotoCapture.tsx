"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/i18n/client";
import { Button } from "@/components/ui";
import type { StoredPhoto } from "@/lib/offline/db";

interface Props {
  photos: StoredPhoto[];
  required: boolean;
  onAdd: (files: FileList) => Promise<void> | void;
  onRemove: (photoId: string) => void;
}

function Thumb({ photo, onRemove }: { photo: StoredPhoto; onRemove: () => void }) {
  const t = useT();
  const url = useMemo(() => URL.createObjectURL(photo.blob), [photo.blob]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return (
    <div className="relative aspect-square overflow-hidden rounded-[var(--radius)] border border-border bg-surface-3">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : null}
      <button
        type="button"
        onClick={onRemove}
        className="absolute right-1 top-1 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white"
        aria-label={t("tire.photoRemove")}
      >
        ✕
      </button>
      {!photo.uploadedAt ? <span className="absolute bottom-1 left-1 rounded bg-black/50 px-1.5 py-0.5 text-[10px] text-white">local</span> : null}
    </div>
  );
}

export function PhotoCapture({ photos, required, onAdd, onRemove }: Props) {
  const t = useT();
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const handle = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      await onAdd(files);
    } finally {
      setBusy(false);
      if (cameraRef.current) cameraRef.current.value = "";
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div>
      {required && photos.length === 0 ? (
        <div className="mb-2 rounded-[var(--radius)] border border-status-red/30 bg-status-red-soft px-3 py-2 text-[13px] font-semibold text-status-red">{t("tire.photoRequired")}</div>
      ) : null}
      <div className="grid grid-cols-4 gap-2">
        {photos.map((p) => (
          <Thumb key={p.id} photo={p} onRemove={() => onRemove(p.id)} />
        ))}
        <button
          type="button"
          onClick={() => cameraRef.current?.click()}
          disabled={busy}
          className="flex aspect-square flex-col items-center justify-center gap-1 rounded-[var(--radius)] border-2 border-dashed border-border-strong bg-surface-2 text-[11px] font-semibold text-text-2 active:bg-surface-3"
        >
          <span className="text-xl">📷</span>
          {busy ? "…" : t("tire.takePhoto")}
        </button>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="text-[12px] text-text-3">{t("tire.photoHint")}</p>
        <Button variant="ghost" size="sm" type="button" onClick={() => fileRef.current?.click()} disabled={busy}>
          {t("tire.addPhoto")}
        </Button>
      </div>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void handle(e.target.files)} />
      <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => void handle(e.target.files)} />
    </div>
  );
}
