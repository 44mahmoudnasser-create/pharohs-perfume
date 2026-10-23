import { createContext, useContext, type ComponentType } from "react";

/** Minimal product shape the sales screen needs. */
export type SellableProduct = {
  id: number;
  name: string;
  sku: string | null;
  category_id: number;
  sale_mode: string;
  unit_price: number | null;
  inventory_item_id: number | null;
  image_url: string | null;
  description: string | null;
};

/** A line in the cart before checkout. `params` are sent to sales_create_sale as-is. */
export type CartLineDraft = {
  product: SellableProduct;
  quantity: number;
  params: Record<string, number>;
  /** e.g. "100 مل · زيت فرنسي" */
  description: string;
  /** list price for display — the database recomputes it at checkout */
  unitPrice: number;
  /** stock hint from the server, ignoring other cart lines; null = unknown */
  maxUnits: number | null;
  /** stock items that this line consumes (to sum reservations across cart lines) */
  stockKey: string;
};

export type LineEditorProps = {
  product: SellableProduct;
  onAdd: (draft: CartLineDraft) => void;
  /** units of the same stockKey already in the cart */
  reservedFor: (stockKey: string) => number;
};

/**
 * A sale mode tells the sales module how to collect a line for a product.
 * Pricing and stock rules live in the database resolver for the same mode.
 */
export type SaleModeDefinition = {
  mode: string;
  label: string;
  hint: string;
  LineEditor: ComponentType<LineEditorProps>;
  /** Extra settings shown in the product form (edit mode), e.g. allowed sizes. */
  ProductExtension?: ComponentType<{ productId: number }>;
  /** True when the product row itself carries price + inventory item. */
  usesProductStockItem?: boolean;
};

const Ctx = createContext<SaleModeDefinition[]>([]);

export function SaleModesProvider({ modes, children }: { modes: SaleModeDefinition[]; children: React.ReactNode }) {
  return <Ctx.Provider value={modes}>{children}</Ctx.Provider>;
}

export function useSaleModes() {
  const modes = useContext(Ctx);
  return {
    modes,
    get: (mode: string) => modes.find(m => m.mode === mode),
    label: (mode: string) => modes.find(m => m.mode === mode)?.label ?? mode,
  };
}
