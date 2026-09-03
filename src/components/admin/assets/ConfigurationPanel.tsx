import { fmtDate, Panel } from "@/components/admin/ui";
import type { Locale, MessageKey, Translator } from "@/i18n";
import { defaultConfigFor, templateByKey } from "@/lib/equipment/templates";
import { wheelPositionsOf, type ComponentKind } from "@/lib/equipment/types";
import type { AssetConfigurationRow } from "@/lib/repos/equipment";
import { ConfigEditor } from "./ConfigEditor";

/** Current axle configuration of an asset, its version history and the editor (admins). */
export function ConfigurationPanel({ t, locale, kind, configurations, canEdit, action }: { t: Translator; locale: Locale; kind: ComponentKind; configurations: AssetConfigurationRow[]; canEdit: boolean; action: (form: FormData) => void | Promise<void> }) {
  const current = configurations[0] ?? null;
  const config = current?.config ?? defaultConfigFor(kind);
  const tires = config.axles.reduce((n, a) => n + wheelPositionsOf(a).length, 0);
  const tpl = config.templateKey ? templateByKey(config.templateKey) : undefined;
  return (
    <Panel title={t("admin.assets.configuration")} actions={<span className="text-[12px] text-text-3">{current ? t("admin.assets.currentVersion", { version: current.version }) : t("admin.assets.defaultTemplate")}</span>}>
      <div id="configuration" />
      <p className="mb-2 text-[12px] text-text-3">{t("admin.assets.configurationHint")}</p>
      <div className="mb-3 flex flex-wrap gap-1.5 text-[12px]">
        {config.axles.map((a, i) => (
          <span key={a.key} className="rounded-md border border-border bg-surface-2 px-2 py-1">
            {i + 1}. {t(`equipment.axleRoles.${a.role}` as MessageKey)} · {t(a.wheels === "single" ? "admin.assets.wheelsSingle" : a.wheels === "dual" ? "admin.assets.wheelsDual" : "admin.assets.wheelsSuperSingle")}
            {a.liftable ? ` · ${t("admin.assets.liftable")}` : ""}
          </span>
        ))}
        <span className="rounded-md border border-border px-2 py-1 text-text-3">{t("equipment.configSummary", { axles: config.axles.length, tires, spares: config.spares.length })}{tpl ? ` · ${t(tpl.labelKey as MessageKey)}` : ""}</span>
      </div>
      {canEdit ? <ConfigEditor kind={kind} initial={config} action={action} /> : null}
      {configurations.length ? (
        <div className="mt-3 text-[12px] text-text-3">
          <div className="mb-1 font-semibold text-text-2">{t("admin.assets.configHistory")}</div>
          {configurations.map((c) => (
            <div key={c.id}>
              v{c.version} · {fmtDate(c.created_at, locale)} · {c.created_by_name ?? "—"} · {c.config.axles.length} {t("admin.assets.axle").toLowerCase()} · {c.config.spares.length} {t("admin.assets.spares").toLowerCase()}{c.note ? ` · ${c.note}` : ""}
            </div>
          ))}
        </div>
      ) : null}
    </Panel>
  );
}
