import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { useAsync } from "@/core/hooks/useAsync";
import { useNotify } from "@/core/ui/Notifications";
import { AsyncBoundary } from "@/core/ui/States";
import { cn } from "@/core/lib/cn";
import { getRestrictions, listBottleSizes, listOilTypes, setRestrictions } from "./api";

/** Product-form extension: optionally limit which sizes / oils a formulation is sold in. */
export default function ProductRestrictions({ productId }: { productId: number }) {
  const notify = useNotify();
  const data = useAsync(async () => {
    const [sizes, oils, current] = await Promise.all([listBottleSizes(), listOilTypes(), getRestrictions(productId)]);
    return { sizes: sizes.filter(s => s.active), oils: oils.filter(o => o.active), current };
  }, [productId]);
  const [sizeIds, setSizeIds] = useState<number[]>([]);
  const [oilIds, setOilIds] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data.data) { setSizeIds(data.data.current.sizeIds); setOilIds(data.data.current.oilIds); }
  }, [data.data]);

  const toggle = (list: number[], set: (v: number[]) => void, id: number) =>
    set(list.includes(id) ? list.filter(x => x !== id) : [...list, id]);

  const save = async () => {
    setSaving(true);
    try {
      await setRestrictions(productId, sizeIds, oilIds);
      notify.success("تم حفظ الأحجام والزيوت المسموحة");
    } catch (e) { notify.error(e); }
    setSaving(false);
  };

  const Chips = ({ items, selected, onToggle }: { items: { id: number; name: string }[]; selected: number[]; onToggle: (id: number) => void }) => (
    <div className="flex flex-wrap gap-2">
      {items.map(i => (
        <button key={i.id} type="button" onClick={() => onToggle(i.id)}
          className={cn("px-3 py-1.5 rounded-lg border text-xs transition-colors",
            selected.includes(i.id) ? "border-accent bg-accent/15 text-text font-semibold" : "border-border bg-card2 text-subtext hover:text-text")}>
          {i.name}
        </button>
      ))}
    </div>
  );

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold text-text">الأحجام والزيوت المسموحة لهذا العطر</p>
        <p className="text-[11px] text-subtext">بدون أي اختيار = كل الأحجام / الزيوت المفعّلة مسموحة.</p>
      </div>
      <AsyncBoundary loading={data.loading && !data.data} error={data.error} onRetry={data.reload}>
        {data.data && (
          <>
            <div>
              <p className="eg-label">الأحجام {sizeIds.length === 0 && <span className="text-success">(الكل)</span>}</p>
              <Chips items={data.data.sizes} selected={sizeIds} onToggle={id => toggle(sizeIds, setSizeIds, id)} />
            </div>
            <div>
              <p className="eg-label">أنواع الزيوت {oilIds.length === 0 && <span className="text-success">(الكل)</span>}</p>
              <Chips items={data.data.oils} selected={oilIds} onToggle={id => toggle(oilIds, setOilIds, id)} />
            </div>
            <button onClick={save} disabled={saving} className="eg-btn-ghost !py-1.5 !text-xs">
              <Save className="w-3.5 h-3.5" />{saving ? "جاري الحفظ..." : "حفظ الاختيارات"}
            </button>
          </>
        )}
      </AsyncBoundary>
    </div>
  );
}
