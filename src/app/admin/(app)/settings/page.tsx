import { fmtDate, PageHeader, Pagination, Panel, Table, Td, Th, btnPrimary, inputCls } from "@/components/admin/ui";
import { getServerTranslator } from "@/i18n/server";
import { canConfigure, requireAdmin } from "@/lib/auth/session";
import { listAudit } from "@/lib/repos/admin/reports";
import { listThresholdVersions } from "@/lib/repos/admin/thresholds";
import { DEFAULT_PHOTO_POLICY, DEFAULT_THRESHOLDS, STATUTORY_MIN_TREAD_32, validateThresholdConfig, type PhotoPolicy, type ThresholdConfig } from "@/lib/tires/thresholds";
import { publishThresholdsAction, saveGeneralAction } from "./actions";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

function Num({ name, value, disabled }: { name: string; value: number; disabled: boolean }) {
  return <input name={name} type="number" step="1" defaultValue={value} disabled={disabled} className={inputCls + " h-9 w-24 text-right"} />;
}

export default async function SettingsPage({ searchParams }: PageProps<"/admin/settings">) {
  const session = await requireAdmin();
  const { t, locale } = await getServerTranslator();
  const sp = await searchParams;
  const page = Math.max(1, Number(one(sp.apage)) || 1);
  const [versions, audit] = await Promise.all([listThresholdVersions(session.scope), listAudit(session.scope, { page, pageSize: 50 })]);
  const current = versions[0];
  const parsed = validateThresholdConfig(current.config, { statutory: false });
  const cfg: ThresholdConfig = parsed.ok ? parsed.config : DEFAULT_THRESHOLDS;
  const CLASSES = ["steer", "drive", "trailer", "spare"] as const;
  const POLICY = Object.keys(DEFAULT_PHOTO_POLICY) as (keyof PhotoPolicy)[];
  const ro = !canConfigure(session);
  const dueDays = Number(session.tenant?.settings?.inspectionDueDays) || 7;
  const error = one(sp.error);

  return (
    <>
      <PageHeader title={t("admin.settings.title")} subtitle={session.tenant?.name} />
      {error ? <div className="mb-3 rounded-[var(--radius)] bg-status-red-soft px-3 py-2 text-[13px] text-status-red">{error === "not_allowed" ? t("admin.common.notAllowed") : t("admin.settings.invalid", { message: error })}</div> : null}
      {one(sp.saved) ? <div className="mb-3 rounded-[var(--radius)] bg-status-green-soft px-3 py-2 text-[13px] text-status-green">{t("admin.common.saved")}</div> : null}

      <Panel title={t("admin.settings.general")} className="mb-4">
        <form action={saveGeneralAction} className="flex flex-wrap items-end gap-2">
          <label className="text-[12px] text-text-2">
            {t("admin.settings.dueDays")}
            <input name="inspectionDueDays" type="number" min="1" max="365" defaultValue={dueDays} disabled={ro} className={inputCls + " h-9 w-28"} />
          </label>
          {!ro ? (
            <button type="submit" className={btnPrimary}>
              {t("admin.common.save")}
            </button>
          ) : null}
        </form>
      </Panel>

      <Panel
        title={t("admin.settings.thresholds")}
        actions={
          <span className="text-[12px] text-text-3">
            {t("admin.settings.current")}: {current.tenant_id ? t("admin.settings.tenantVersion", { tenant: session.tenant?.name ?? "", version: current.version }) : `${t("admin.settings.system")} v${current.version}`}
          </span>
        }
        className="mb-4"
      >
        <p className="mb-1 text-[12px] text-text-3">{t("admin.settings.thresholdsHint")} {current.tenant_id ? "" : t("admin.settings.systemDefaults")}</p>
        <p className="mb-3 text-[12px] text-text-3">{t("admin.settings.statutory", { steer: STATUTORY_MIN_TREAD_32.steer, other: STATUTORY_MIN_TREAD_32.drive })}</p>
        <form action={publishThresholdsAction}>
          <Table>
            <thead>
              <tr>
                <Th />
                <Th right>{t("admin.settings.treadRed")}</Th>
                <Th right>{t("admin.settings.treadYellow")}</Th>
                <Th right>{t("admin.settings.psiRedBelow")}</Th>
                <Th right>{t("admin.settings.psiYellowBelow")}</Th>
                <Th right>{t("admin.settings.psiRedAbove")}</Th>
              </tr>
            </thead>
            <tbody>
              {CLASSES.map((k) => (
                <tr key={k}>
                  <Td className="font-semibold">{t(`admin.settings.${k}`)}</Td>
                  <Td right>
                    <Num name={`tread.${k}.redMax`} value={cfg.tread32[k].redMax} disabled={ro} />
                  </Td>
                  <Td right>
                    <Num name={`tread.${k}.yellowMax`} value={cfg.tread32[k].yellowMax} disabled={ro} />
                  </Td>
                  <Td right>
                    <Num name={`psi.${k}.redBelow`} value={cfg.psi[k].redBelow} disabled={ro} />
                  </Td>
                  <Td right>
                    <Num name={`psi.${k}.yellowBelow`} value={cfg.psi[k].yellowBelow} disabled={ro} />
                  </Td>
                  <Td right>
                    <Num name={`psi.${k}.redAbove`} value={cfg.psi[k].redAbove} disabled={ro} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <span className="text-[12px] font-semibold text-text-2">{t("admin.settings.axle")}:</span>
            <label className="text-[12px] text-text-2">
              {t("admin.settings.psiDiffYellow")}
              <Num name="axle.psiDiffYellow" value={cfg.axle.psiDiffYellow} disabled={ro} />
            </label>
            <label className="text-[12px] text-text-2">
              {t("admin.settings.psiDiffRed")}
              <Num name="axle.psiDiffRed" value={cfg.axle.psiDiffRed} disabled={ro} />
            </label>
            <label className="text-[12px] text-text-2">
              {t("admin.settings.dualMismatch")}
              <Num name="axle.dualTreadMismatch" value={cfg.axle.dualTreadMismatch} disabled={ro} />
            </label>
          </div>
          <div className="mt-4">
            <div className="text-[12px] font-semibold text-text-2">{t("admin.settings.photoPolicy")}</div>
            <p className="mb-2 text-[12px] text-text-3">{t("admin.settings.photoPolicyHint")}</p>
            <div className="flex flex-wrap gap-3">
              {POLICY.map((k) => (
                <label key={k} className="flex items-center gap-1 text-[12px] text-text-2">
                  <input type="checkbox" name={`photo.${k}`} defaultChecked={cfg.photoPolicy[k]} disabled={ro} data-testid={`photo-${k}`} /> {t(`admin.settings.policy.${k}`)}
                </label>
              ))}
            </div>
          </div>
          {!ro ? (
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <label className="text-[12px] text-text-2">
                {t("admin.settings.note")}
                <input name="note" className={inputCls + " h-9 w-72"} />
              </label>
              <button type="submit" className={btnPrimary} data-testid="publish-thresholds">
                {t("admin.settings.publish")}
              </button>
            </div>
          ) : null}
        </form>
      </Panel>

      <Panel title={t("admin.settings.history")} className="mb-4">
        <Table>
          <thead>
            <tr>
              <Th>{t("admin.common.version")}</Th>
              <Th>{t("admin.common.created")}</Th>
              <Th>{t("admin.common.by")}</Th>
              <Th>{t("admin.settings.note")}</Th>
              <Th>{t("admin.settings.steer")}</Th>
              <Th>{t("admin.settings.drive")}</Th>
              <Th>{t("admin.settings.trailer")}</Th>
              <Th>{t("admin.settings.axle")}</Th>
            </tr>
          </thead>
          <tbody>
            {versions.map((v) => (
              <tr key={v.id}>
                <Td className="font-semibold">{v.tenant_id ? `v${v.version}` : `${t("admin.settings.system")} v${v.version}`}</Td>
                <Td>{fmtDate(v.created_at, locale)}</Td>
                <Td>{v.created_by_name ?? v.created_by_email ?? "—"}</Td>
                <Td>{v.note ?? "—"}</Td>
                {(["steer", "drive", "trailer"] as const).map((k) => {
                  const c = validateThresholdConfig(v.config, { statutory: false });
                  const x = c.ok ? c.config : DEFAULT_THRESHOLDS;
                  return (
                    <Td key={k} mono>
                      T≤{x.tread32[k].redMax}/≤{x.tread32[k].yellowMax} · P&lt;{x.psi[k].redBelow}/&lt;{x.psi[k].yellowBelow}/&gt;{x.psi[k].redAbove}
                    </Td>
                  );
                })}
                <Td mono>
                  Δ≥{v.config.axle.psiDiffYellow}/≥{v.config.axle.psiDiffRed} · ≠≥{v.config.axle.dualTreadMismatch}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Panel>

      <Panel title={t("admin.settings.audit")}>
        <div id="audit" />
        <Table>
          <thead>
            <tr>
              <Th>{t("admin.settings.auditColumns.when")}</Th>
              <Th>{t("admin.settings.auditColumns.who")}</Th>
              <Th>{t("admin.settings.auditColumns.action")}</Th>
              <Th>{t("admin.settings.auditColumns.entity")}</Th>
              <Th>{t("admin.settings.auditColumns.change")}</Th>
            </tr>
          </thead>
          <tbody>
            {audit.rows.map((a) => (
              <tr key={a.id}>
                <Td>{fmtDate(a.created_at, locale)}</Td>
                <Td>{a.actor_label ?? "—"}</Td>
                <Td>{a.action}</Td>
                <Td>
                  {a.entity_type} <span className="font-mono text-[11px] text-text-3">{a.entity_id?.slice(0, 8)}</span>
                </Td>
                <Td mono className="max-w-[520px] break-all">
                  {a.old_value ? <span className="text-status-red">− {JSON.stringify(a.old_value).slice(0, 300)}</span> : null}
                  {a.old_value && a.new_value ? <br /> : null}
                  {a.new_value ? <span className="text-status-green">+ {JSON.stringify(a.new_value).slice(0, 300)}</span> : null}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <Pagination page={page} total={audit.total} pageSize={50} hrefFor={(p) => `/admin/settings?apage=${p}#audit`} label={t("admin.common.page", { page, pages: Math.max(1, Math.ceil(audit.total / 50)) })} />
      </Panel>
    </>
  );
}
