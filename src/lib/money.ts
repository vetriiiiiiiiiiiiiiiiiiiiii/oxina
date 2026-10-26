import { Prisma } from "@prisma/client";

export const D = (v: Prisma.Decimal.Value | null | undefined) => new Prisma.Decimal(v ?? 0);
export const ZERO = new Prisma.Decimal(0);
export const round2 = (v: Prisma.Decimal) => v.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
export const sum = (vals: Prisma.Decimal.Value[]) => vals.reduce<Prisma.Decimal>((a, b) => a.plus(D(b)), ZERO);

export interface LineCalc {
  quantity: number;
  unitPrice: Prisma.Decimal.Value;
  discount?: Prisma.Decimal.Value;
  taxRatePercent: Prisma.Decimal.Value;
}

/** Tax-exclusive pricing: taxable = qty*price - discount; tax = taxable * rate. */
export function calcLine(l: LineCalc) {
  const gross = D(l.unitPrice).times(l.quantity);
  const discount = D(l.discount);
  if (discount.greaterThan(gross)) throw new Error("Discount exceeds line value");
  const taxable = round2(gross.minus(discount));
  const tax = round2(taxable.times(D(l.taxRatePercent)).dividedBy(100));
  return { gross: round2(gross), discount: round2(discount), taxable, tax, total: round2(taxable.plus(tax)) };
}

export function formatINR(v: Prisma.Decimal.Value | null | undefined) {
  const n = Number(D(v).toFixed(2));
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);
}
