"use client";

import { useState } from "react";
import { useI18n } from "@/i18n/client";

/** Small feedback bottom sheet: 1–5 rating plus optional text. Never touches the inspection draft. */
export function FeedbackSheet({ page, onClose }: { page: string; onClose: () => void }) {
  const { t, locale } = useI18n();
  const [rating, setRating] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed" | "rating">("idle");

  const send = async () => {
    if (!rating) {
      setState("rating");
      return;
    }
    setState("sending");
    try {
      const res = await fetch("/api/driver/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rating, message: message.trim() || null, page, locale }) });
      setState(res.ok ? "sent" : "failed");
    } catch {
      setState("failed");
    }
  };

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} aria-hidden />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={t("feedback.title")} style={{ maxHeight: "70vh" }} data-testid="feedback-sheet">
        <div className="scr" style={{ padding: 20, overflow: "auto" }}>
          <div className="h3" style={{ fontSize: 17 }}>{t("feedback.title")}</div>
          <p className="sub" style={{ marginTop: 4 }}>{t("feedback.subtitle")}</p>
          {state === "sent" ? (
            <div className="notice" data-status="green" style={{ marginTop: 14, display: "block", font: "600 13px/1.4 var(--font-sans)" }} data-testid="feedback-sent">{t("feedback.sent")}</div>
          ) : (
            <>
              <div className="label" style={{ marginTop: 14 }}>{t("feedback.rating")}</div>
              <div style={{ display: "flex", gap: 6, marginTop: 8 }} role="radiogroup" aria-label={t("feedback.rating")}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" role="radio" aria-checked={rating === n} className="chip-btn" data-active={rating !== null && n <= rating} style={{ flex: 1, height: 44, font: "700 16px/1 var(--font-sans)" }} onClick={() => { setRating(n); if (state === "rating") setState("idle"); }} data-testid={`feedback-star-${n}`} title={t(`feedback.stars.s${n as 1}`)}>
                    ★
                  </button>
                ))}
              </div>
              <div style={{ font: "500 11.5px/1.4 var(--font-sans)", color: "var(--muted)", marginTop: 6 }}>{rating ? t(`feedback.stars.s${rating as 1}`) : ""}</div>
              {state === "rating" ? <div style={{ marginTop: 6, font: "600 12px/1.4 var(--font-sans)", color: "var(--st-crit)" }} role="alert">{t("feedback.ratingRequired")}</div> : null}
              <textarea className="textarea" style={{ marginTop: 12, minHeight: 84 }} placeholder={t("feedback.placeholder")} value={message} onChange={(e) => setMessage(e.target.value)} data-testid="feedback-text" />
              {state === "failed" ? <div className="notice" data-status="red" style={{ marginTop: 10, display: "block", font: "600 12.5px/1.4 var(--font-sans)" }} role="alert">{t("feedback.failed")}</div> : null}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 8, marginTop: 14 }}>
                <button type="button" className="btn-secondary" onClick={onClose}>{t("app.cancel")}</button>
                <button type="button" className="btn-primary" disabled={state === "sending"} onClick={send} data-testid="feedback-send">{t("feedback.send")}</button>
              </div>
            </>
          )}
          {state === "sent" ? <button type="button" className="btn-secondary" style={{ marginTop: 12, width: "100%" }} onClick={onClose}>{t("app.close")}</button> : null}
        </div>
      </div>
    </>
  );
}
