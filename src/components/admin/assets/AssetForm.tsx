import { btnPrimary, inputCls, selectCls } from "@/components/admin/ui";
import type { Translator } from "@/i18n";
import type { AssetListRow } from "@/lib/repos/admin/assets";

export function AssetForm({ t, asset, action }: { t: Translator; asset?: AssetListRow | null; action: (form: FormData) => void | Promise<void> }) {
  return (
    <form action={action} className="grid grid-cols-2 gap-2 md:grid-cols-4">
      <label className="text-[12px] text-text-2">
        {t("admin.assets.unit")} *
        <input name="unit_number" required defaultValue={asset?.unit_number ?? ""} className={inputCls} data-testid="unit-number" />
      </label>
      <label className="text-[12px] text-text-2">
        {t("admin.assets.vin")}
        <input name="vin" defaultValue={asset?.vin ?? ""} className={inputCls} />
      </label>
      <label className="text-[12px] text-text-2">
        {t("admin.assets.make")}
        <input name="make" defaultValue={asset?.make ?? ""} className={inputCls} />
      </label>
      <label className="text-[12px] text-text-2">
        {t("admin.assets.model")}
        <input name="model" defaultValue={asset?.model ?? ""} className={inputCls} />
      </label>
      <label className="text-[12px] text-text-2">
        {t("admin.assets.year")}
        <input name="year" type="number" min="1980" max="2100" defaultValue={asset?.year ?? ""} className={inputCls} />
      </label>
      <label className="text-[12px] text-text-2">
        {t("admin.assets.plate")}
        <input name="license_plate" defaultValue={asset?.license_plate ?? ""} className={inputCls} />
      </label>
      <label className="text-[12px] text-text-2">
        {t("admin.common.status")}
        <select name="status" defaultValue={asset?.status ?? "active"} className={selectCls}>
          <option value="active">{t("admin.common.active")}</option>
          <option value="inactive">{t("admin.common.inactive")}</option>
        </select>
      </label>
      <div className="flex items-end">
        <button type="submit" className={btnPrimary}>
          {t("admin.common.save")}
        </button>
      </div>
    </form>
  );
}
