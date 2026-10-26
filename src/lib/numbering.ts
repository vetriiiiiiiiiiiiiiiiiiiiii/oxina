import type { Db } from "@/lib/db";

/**
 * Controlled, gap-minimised document numbering. The row-level lock taken by the UPSERT
 * serialises concurrent callers; call inside the transaction that creates the document.
 *   nextNumber(tx, "JOB", "RE", 2026)  ->  "OXI-RE-2026-000001"
 */
export async function nextNumber(db: Db, docType: string, unitCode: string, year = new Date().getUTCFullYear(), pad = 6) {
  const key = `${docType}:${unitCode}:${year}`;
  const rows = await db.$queryRaw<{ value: number }[]>`
    INSERT INTO "NumberSequence" ("key", "nextValue", "updatedAt") VALUES (${key}, 2, now())
    ON CONFLICT ("key") DO UPDATE SET "nextValue" = "NumberSequence"."nextValue" + 1, "updatedAt" = now()
    RETURNING "nextValue" - 1 AS value`;
  const n = Number(rows[0].value);
  const prefix = DOC_PREFIX[docType] ?? docType;
  return `${prefix}-${unitCode}-${year}-${String(n).padStart(pad, "0")}`;
}

const DOC_PREFIX: Record<string, string> = {
  JOB: "OXI",
  EST: "EST",
  INV: "INV",
  RCPT: "RCPT",
  CN: "CN",
  SPR: "SPR",
  PO: "PO",
  GRN: "GRN",
  TRF: "TRF",
  BKG: "BKG",
  QTN: "QTN",
  WCL: "WCL",
  CUST: "CUS",
};
