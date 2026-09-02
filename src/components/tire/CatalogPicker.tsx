"use client";

import { useEffect, useMemo, useState } from "react";
import { useT } from "@/i18n/client";
import { apiJson } from "@/lib/client/api";

interface Brand {
  id: string;
  name: string;
  models_count?: number;
}
interface Model {
  id: string;
  name: string;
  application: string;
}
interface Variant {
  id: string;
  size: string;
  load_range: string | null;
  part_number: string | null;
  original_tread_32nds: number | null;
  max_cold_psi: number | null;
  brand_name?: string;
  model_name?: string;
}

export interface CatalogSelection {
  tireVariantId: string | null;
  tireMake: string;
  tireModel: string;
  tireSize: string;
}

interface Props {
  value: { tireVariantId?: string | null; tireMake?: string; tireModel?: string; tireSize?: string };
  onChange: (sel: CatalogSelection) => void;
  /** Cache shared across sheets so the brand list loads once per session. */
  online?: boolean;
}

let brandCache: Brand[] | null = null;

/**
 * Cascading brand → model → size picker backed by the catalog API, with a
 * free-text fallback so an unlisted tire never blocks the inspection. The
 * chosen variant id and the make/model/size text are both stored: the text
 * survives even if the catalog row is later discontinued.
 */
export function CatalogPicker({ value, onChange, online = true }: Props) {
  const t = useT();
  const [custom, setCustom] = useState<boolean>(!value.tireVariantId && !!(value.tireMake || value.tireModel || value.tireSize));
  const [brands, setBrands] = useState<Brand[]>(brandCache ?? []);
  const [brandId, setBrandId] = useState<string | null>(null);
  const [models, setModels] = useState<Model[]>([]);
  const [modelId, setModelId] = useState<string | null>(null);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Variant[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (brandCache || !online) return;
    apiJson<{ brands: Brand[] }>("/api/driver/catalog?level=brands")
      .then((d) => {
        brandCache = d.brands;
        setBrands(d.brands);
      })
      .catch(() => setBrands([]));
  }, [online]);

  useEffect(() => {
    if (!brandId) return;
    let cancelled = false;
    apiJson<{ models: Model[] }>(`/api/driver/catalog?level=models&brand=${brandId}`)
      .then((d) => !cancelled && setModels(d.models))
      .catch(() => !cancelled && setModels([]));
    return () => {
      cancelled = true;
    };
  }, [brandId]);

  useEffect(() => {
    if (!modelId) return;
    let cancelled = false;
    apiJson<{ variants: Variant[] }>(`/api/driver/catalog?level=variants&model=${modelId}`)
      .then((d) => !cancelled && setVariants(d.variants))
      .catch(() => !cancelled && setVariants([]));
    return () => {
      cancelled = true;
    };
  }, [modelId]);

  // free search (brand / model / size / part number)
  useEffect(() => {
    if (q.trim().length < 2) return;
    let cancelled = false;
    const id = setTimeout(() => {
      setLoading(true);
      apiJson<{ variants: Variant[] }>(`/api/driver/catalog?level=search&q=${encodeURIComponent(q.trim())}`)
        .then((d) => !cancelled && setHits(d.variants))
        .catch(() => !cancelled && setHits([]))
        .finally(() => !cancelled && setLoading(false));
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [q]);

  const brandName = useMemo(() => brands.find((b) => b.id === brandId)?.name ?? "", [brands, brandId]);
  const modelName = useMemo(() => models.find((m) => m.id === modelId)?.name ?? "", [models, modelId]);

  const pick = (v: Variant, bName = brandName, mName = modelName) => {
    onChange({ tireVariantId: v.id, tireMake: v.brand_name ?? bName, tireModel: v.model_name ?? mName, tireSize: v.size + (v.load_range ? ` ${v.load_range}` : "") });
    setQ("");
    setHits([]);
  };
  const clear = () => {
    setBrandId(null);
    setModelId(null);
    setModels([]);
    setVariants([]);
    onChange({ tireVariantId: null, tireMake: "", tireModel: "", tireSize: "" });
  };

  if (value.tireVariantId) {
    return (
      <div className="catalog-selected" data-testid="catalog-selected">
        <div>
          <div className="label-xs" style={{ letterSpacing: ".08em" }}>{t("tire.catalog.selected")}</div>
          <div className="catalog-selected-name">
            {value.tireMake} {value.tireModel}
          </div>
          <div className="mono catalog-selected-size">{value.tireSize}</div>
        </div>
        <button type="button" className="chip-btn" onClick={clear}>
          {t("tire.catalog.clear")}
        </button>
      </div>
    );
  }

  if (custom || !online) {
    return (
      <div className="catalog-grid">
        <div className="span-2">
          <div className="label-xs" style={{ letterSpacing: ".06em" }}>{t("tire.catalog.brand")}</div>
          <input className="text-input" style={{ marginTop: 6 }} placeholder="e.g. Michelin" value={value.tireMake ?? ""} onChange={(e) => onChange({ tireVariantId: null, tireMake: e.target.value, tireModel: value.tireModel ?? "", tireSize: value.tireSize ?? "" })} />
        </div>
        <div>
          <div className="label-xs" style={{ letterSpacing: ".06em" }}>{t("tire.catalog.model")}</div>
          <input className="text-input" style={{ marginTop: 6 }} placeholder="X Line" value={value.tireModel ?? ""} onChange={(e) => onChange({ tireVariantId: null, tireMake: value.tireMake ?? "", tireModel: e.target.value, tireSize: value.tireSize ?? "" })} />
        </div>
        <div>
          <div className="label-xs" style={{ letterSpacing: ".06em" }}>{t("tire.catalog.size")}</div>
          <input className="text-input mono" style={{ marginTop: 6 }} placeholder="295/75R22.5" value={value.tireSize ?? ""} onChange={(e) => onChange({ tireVariantId: null, tireMake: value.tireMake ?? "", tireModel: value.tireModel ?? "", tireSize: e.target.value })} />
        </div>
        {online ? (
          <button type="button" className="link-btn span-2" onClick={() => setCustom(false)}>
            {t("tire.catalog.pickFromCatalog")}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="catalog-picker" data-testid="catalog-picker">
      <input
        className="text-input"
        placeholder={t("tire.catalog.search")}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          if (e.target.value.trim().length < 2) setHits([]);
        }}
        autoComplete="off"
        data-testid="catalog-search"
      />
      {q.trim().length >= 2 ? (
        <div className="catalog-list">
          {loading ? <div className="catalog-empty">…</div> : null}
          {!loading && hits.length === 0 ? <div className="catalog-empty">{t("tire.catalog.noMatch")}</div> : null}
          {hits.map((v) => (
            <button key={v.id} type="button" className="catalog-row" onClick={() => pick(v)}>
              <span className="catalog-row-name">
                {v.brand_name} {v.model_name}
              </span>
              <span className="mono catalog-row-size">
                {v.size}
                {v.load_range ? ` ${v.load_range}` : ""}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <>
          <div className="label-xs" style={{ letterSpacing: ".08em", marginTop: 10 }}>{t("tire.catalog.brand")}</div>
          <div className="chip-wrap">
            {brands.map((b) => (
              <button key={b.id} type="button" className="chip-btn" data-active={brandId === b.id} onClick={() => { setBrandId(b.id); setModelId(null); setModels([]); setVariants([]); }}>
                {b.name}
              </button>
            ))}
          </div>
          {brandId ? (
            <>
              <div className="label-xs" style={{ letterSpacing: ".08em", marginTop: 10 }}>{t("tire.catalog.model")}</div>
              <div className="chip-wrap">
                {models.map((m) => (
                  <button key={m.id} type="button" className="chip-btn" data-active={modelId === m.id} onClick={() => { setModelId(m.id); setVariants([]); }}>
                    {m.name}
                  </button>
                ))}
              </div>
            </>
          ) : null}
          {modelId ? (
            <>
              <div className="label-xs" style={{ letterSpacing: ".08em", marginTop: 10 }}>{t("tire.catalog.size")}</div>
              <div className="chip-wrap">
                {variants.map((v) => (
                  <button key={v.id} type="button" className="chip-btn mono" onClick={() => pick(v)}>
                    {v.size}
                    {v.load_range ? ` ${v.load_range}` : ""}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </>
      )}
      <button type="button" className="link-btn" style={{ marginTop: 10 }} onClick={() => setCustom(true)}>
        {t("tire.catalog.custom")}
      </button>
    </div>
  );
}
