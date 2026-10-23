import type { SaleModeDefinition } from "@/modules/sales/saleModes";
import PerfumeLineEditor from "./PerfumeLineEditor";
import ProductRestrictions from "./ProductRestrictions";

/** Plugs perfume formulations into the generic sales + catalog modules. */
export const perfumeSaleMode: SaleModeDefinition = {
  mode: "perfume_formulation",
  label: "تركيبة عطر",
  hint: "يُختار الحجم ونوع الزيت وقت البيع، ويُخصم الزيت بالجرام وزجاجة فارغة",
  LineEditor: PerfumeLineEditor,
  ProductExtension: ProductRestrictions,
};
