import Link from "next/link";
import { btnSecondary, inputCls, Panel, selectCls } from "@/components/admin/ui";
import type { MessageKey, Translator } from "@/i18n";
import { defaultConfigFor } from "@/lib/equipment/templates";
import { wheelPositionsOf, type ComponentKind, type EquipmentConfig } from "@/lib/equipment/types";
import { assetBase } from "@/lib/equipment/paths";
import type { TireAssetRow } from "@/lib/repos/tire-assets";
import { replaceTireAction, setTireStateAction } from "@/app/admin/(app)/tires/assets/actions";

/** Positions of a configuration with the physical tire currently mounted at each, plus the admin actions (replace / remove / mark). */
export function MountedTiresPanel({ t, assetId, kind, config, tires, canEdit }: { t: Translator; assetId: string; kind: ComponentKind; config: EquipmentConfig | null; tires: TireAssetRow[]; canEdit: boolean }) {
  const cfg = config ?? defaultConfigFor(kind);
  const byPos = new Map(tires.filter((x) => x.current_position_key).map((x) => [x.current_position_key!, x]));
  const positions: { key: string; label: string }[] = [];
  cfg.axles.forEach((a, i) => {
    const sameRole = cfg.axles.filter((x) => x.role === a.role).length;
    const idx = cfg.axles.slice(0, i + 1).filter((x) => x.role === a.role).length;
    const axleLabel = `${t(`equipment.axleRoles.${a.role}` as MessageKey)}${sameRole > 1 ? ` ${idx}` : ""}`;
    for (const w of wheelPositionsOf(a)) positions.push({ key: w.key, label: `${axleLabel} · ${w.abbreviation}` });
  });
  cfg.spares.forEach((s, i) => positions.push({ key: s.key, label: `${t("design.sheet.spare")} ${i + 1}` }));
  const returnTo = `${assetBase(kind)}/${assetId}`;

  return (
    <Panel title={t("admin.assets.mountedTires")} actions={<Link className="text-[12px] text-accent" href={`/admin/tires/assets?asset=${assetId}`}>{t("admin.nav.tireAssets")} ›</Link>}>
      <p className="mb-2 text-[12px] text-text-3">{t("admin.assets.mountedHint")}</p>
      <div className="max-h-[520px] space-y-1.5 overflow-y-auto pr-1">
        {positions.map((p) => {
          const tire = byPos.get(p.key);
          return (
            <details key={p.key} className="rounded-[var(--radius)] border border-border px-2 py-1.5" data-testid={`mounted-${p.key}`}>
              <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-[12px]">
                <span className="w-40 font-semibold text-text-2">{p.label}</span>
                {tire ? (
                  <>
                    <Link className="font-mono text-accent" href={`/admin/tires/assets/${tire.id}`}>{tire.code}</Link>
                    <span className="text-text-2">{tire.variant_label ?? ([tire.make, tire.model, tire.size].filter(Boolean).join(" ") || "—")}</span>
                    {tire.last_tread_32nds !== null ? <span className="text-text-3">{tire.last_tread_32nds}/32 · {tire.last_psi ?? "—"} PSI</span> : null}
                  </>
                ) : (
                  <span className="text-text-3">{t("admin.assets.noTire")}</span>
                )}
              </summary>
              {canEdit ? (
                <div className="mt-2 grid gap-2 border-t border-border pt-2 md:grid-cols-2">
                  <form action={replaceTireAction} className="grid grid-cols-2 gap-1.5 text-[12px]">
                    <input type="hidden" name="assetId" value={assetId} />
                    <input type="hidden" name="positionKey" value={p.key} />
                    <input type="hidden" name="return" value={returnTo} />
                    <div className="col-span-2 font-semibold text-text-2">{t("admin.assets.replace")} · {t("admin.assets.newTire")}</div>
                    <input name="make" placeholder={t("admin.assets.make")} className={inputCls + " h-8"} />
                    <input name="model" placeholder={t("admin.assets.model")} className={inputCls + " h-8"} />
                    <input name="size" placeholder={t("tire.size")} className={inputCls + " h-8"} />
                    <input name="serial" placeholder={t("admin.tireAssets.serial")} className={inputCls + " h-8"} />
                    {tire ? (
                      <label className="col-span-2 text-text-2">
                        {t("admin.assets.oldTireState")}
                        <select name="oldState" defaultValue="removed" className={selectCls + " h-8"}>
                          {(["removed", "unmounted", "damaged", "disposed", "lost"] as const).map((s) => (
                            <option key={s} value={s}>{t(`admin.tireAssets.states.${s}`)}</option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                    <button type="submit" className={btnSecondary + " col-span-2 h-8"}>{t("admin.assets.replace")}</button>
                  </form>
                  {tire ? (
                    <div className="grid gap-1.5 text-[12px]">
                      <div className="font-semibold text-text-2">{tire.code}</div>
                      {(["unmounted", "damaged", "lost", "disposed"] as const).map((s) => (
                        <form key={s} action={setTireStateAction}>
                          <input type="hidden" name="tireId" value={tire.id} />
                          <input type="hidden" name="state" value={s} />
                          <input type="hidden" name="return" value={returnTo} />
                          <button type="submit" className={btnSecondary + " h-8 w-full"}>
                            {t(s === "unmounted" ? "admin.assets.removeTire" : s === "damaged" ? "admin.assets.markDamaged" : s === "lost" ? "admin.assets.markLost" : "admin.assets.markDisposed")}
                          </button>
                        </form>
                      ))}
                      <Link className="text-accent" href={`/admin/tires/assets/${tire.id}`}>{t("admin.assets.move")} ›</Link>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </details>
          );
        })}
      </div>
    </Panel>
  );
}
