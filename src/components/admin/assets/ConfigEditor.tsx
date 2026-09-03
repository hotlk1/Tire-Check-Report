"use client";

import { useState } from "react";
import { btnPrimary, btnSecondary, inputCls, selectCls } from "@/components/admin/ui";
import { useT } from "@/i18n/client";
import type { MessageKey } from "@/i18n";
import { templatesFor } from "@/lib/equipment/templates";
import { wheelPositionsOf, type AxleDefinitionConfig, type AxleRole, type ComponentKind, type EquipmentConfig, type WheelSetup } from "@/lib/equipment/types";

const ROLES: AxleRole[] = ["steer", "drive", "pusher", "tag", "lift", "trailer", "dolly"];
const WHEELS: WheelSetup[] = ["single", "dual", "super_single"];

/**
 * Admin editor for an asset's axle configuration: start from a template,
 * then adjust axles (role, wheels, lift), reorder and set the number of spare
 * slots. Submits the resulting configuration as JSON to a server action.
 */
export function ConfigEditor({ kind, initial, action }: { kind: ComponentKind; initial: EquipmentConfig; action: (form: FormData) => void | Promise<void> }) {
  const t = useT();
  const templates = templatesFor(kind);
  const [config, setConfig] = useState<EquipmentConfig>(initial);
  const tires = config.axles.reduce((n, a) => n + wheelPositionsOf(a).length, 0);

  const setAxle = (i: number, patch: Partial<AxleDefinitionConfig>) => setConfig((c) => ({ ...c, templateKey: null, axles: c.axles.map((a, k) => (k === i ? { ...a, ...patch } : a)) }));
  const move = (i: number, dir: -1 | 1) =>
    setConfig((c) => {
      const axles = [...c.axles];
      const j = i + dir;
      if (j < 0 || j >= axles.length) return c;
      [axles[i], axles[j]] = [axles[j], axles[i]];
      return { ...c, templateKey: null, axles };
    });
  const remove = (i: number) => setConfig((c) => ({ ...c, templateKey: null, axles: c.axles.filter((_, k) => k !== i) }));
  const add = () =>
    setConfig((c) => {
      const role: AxleRole = kind === "truck" ? "drive" : kind === "dolly" ? "dolly" : "trailer";
      const n = c.axles.length + 1;
      let key = `axle-${n}`;
      while (c.axles.some((a) => a.key === key)) key = `${key}b`;
      return { ...c, templateKey: null, axles: [...c.axles, { key, role, wheels: "dual" }] };
    });
  const setSpares = (n: number) => setConfig((c) => ({ ...c, templateKey: null, spares: Array.from({ length: Math.max(0, Math.min(6, n)) }, (_, i) => ({ key: `spare-${i + 1}` })) }));

  return (
    <form action={action} className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[12px] text-text-2">
          {t("admin.assets.template")}
          <select className={selectCls + " h-9 w-64"} value={config.templateKey ?? ""} onChange={(e) => { const tpl = templates.find((x) => x.key === e.target.value); if (tpl) setConfig(structuredClone(tpl.config)); }} data-testid="config-template">
            <option value="">—</option>
            {templates.map((tpl) => (
              <option key={tpl.key} value={tpl.key}>{t(tpl.labelKey as MessageKey)}</option>
            ))}
          </select>
        </label>
        <span className="pb-2 text-[12px] text-text-3">{t("equipment.configSummary", { axles: config.axles.length, tires, spares: config.spares.length })}</span>
      </div>
      <div className="space-y-1.5">
        {config.axles.map((a, i) => (
          <div key={a.key} className="flex flex-wrap items-center gap-2 rounded-[var(--radius)] border border-border px-2 py-1.5" data-testid={`axle-row-${i}`}>
            <span className="w-8 text-center text-[12px] font-bold text-text-2">{i + 1}</span>
            <select className={selectCls + " h-8 w-40"} value={a.role} onChange={(e) => setAxle(i, { role: e.target.value as AxleRole })} aria-label={t("admin.assets.role")}>
              {ROLES.map((r) => (
                <option key={r} value={r}>{t(`equipment.axleRoles.${r}` as MessageKey)}</option>
              ))}
            </select>
            <select className={selectCls + " h-8 w-36"} value={a.wheels} onChange={(e) => setAxle(i, { wheels: e.target.value as WheelSetup })} aria-label={t("admin.assets.wheels")}>
              {WHEELS.map((w) => (
                <option key={w} value={w}>{t(w === "single" ? "admin.assets.wheelsSingle" : w === "dual" ? "admin.assets.wheelsDual" : "admin.assets.wheelsSuperSingle")}</option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-[12px] text-text-2">
              <input type="checkbox" checked={!!a.liftable} onChange={(e) => setAxle(i, { liftable: e.target.checked })} /> {t("admin.assets.liftable")}
            </label>
            <span className="ml-auto flex gap-1">
              <button type="button" className={btnSecondary + " h-8 px-2"} onClick={() => move(i, -1)} aria-label="up">↑</button>
              <button type="button" className={btnSecondary + " h-8 px-2"} onClick={() => move(i, 1)} aria-label="down">↓</button>
              <button type="button" className={btnSecondary + " h-8 px-2"} onClick={() => remove(i)} disabled={config.axles.length <= 1}>{t("admin.assets.removeAxle")}</button>
            </span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <button type="button" className={btnSecondary} onClick={add} data-testid="add-axle">+ {t("admin.assets.addAxle")}</button>
        <label className="text-[12px] text-text-2">
          {t("admin.assets.spares")}
          <input type="number" min="0" max="6" value={config.spares.length} onChange={(e) => setSpares(Number(e.target.value))} className={inputCls + " h-9 w-20 text-right"} data-testid="spare-count" />
        </label>
        <label className="text-[12px] text-text-2">
          {t("admin.settings.note")}
          <input name="note" className={inputCls + " h-9 w-64"} />
        </label>
        <input type="hidden" name="config" value={JSON.stringify(config)} />
        <button type="submit" className={btnPrimary} data-testid="publish-config">{t("admin.assets.publishConfig")}</button>
      </div>
    </form>
  );
}
