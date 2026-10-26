import { LinkTabs } from "@/components/shell/tabs";
export function InventoryTabs({ active }: { active: string }) {
  return <LinkTabs active={active} tabs={[{ key: "stock", label: "Stock", href: "/inventory" }, { key: "requests", label: "Service requests", href: "/inventory/requests" }, { key: "purchases", label: "Purchases & suppliers", href: "/inventory/purchases" }, { key: "transfers", label: "Transfers", href: "/inventory/transfers" }, { key: "movements", label: "Movements & audits", href: "/inventory/movements" }]} />;
}
