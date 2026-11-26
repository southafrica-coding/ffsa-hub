"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { formatZar } from "@/lib/store/money";
import type { ProductKind } from "@/lib/store/types";
import { useCart } from "./cart";
import { Field, inputClass, Notice, PrimaryButton } from "./ui";

type Variant = { id: string; label: string; price_cents: number | null; stock: number | null };

export function BuyBox({
  product,
  variants,
}: {
  product: { id: string; title: string; kind: ProductKind; price_cents: number; allow_gift: boolean; allow_code_packs: boolean; is_preorder: boolean };
  variants: Variant[];
}) {
  const router = useRouter();
  const { add } = useCart();
  const readable = product.kind === "digital" || product.kind === "subscription";
  const canGift = readable && product.allow_gift;
  const canPack = product.allow_code_packs;
  const ships = product.kind === "physical" || product.kind === "bundle";

  const [purpose, setPurpose] = useState<"self" | "gift" | "code_pack">("self");
  const [variantId, setVariantId] = useState<string | null>(null);
  const [qty, setQty] = useState(ships ? 1 : 10);
  const [giftEmail, setGiftEmail] = useState("");
  const [giftMessage, setGiftMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);

  const variant = variants.find((v) => v.id === variantId) ?? null;
  const unit = variant?.price_cents ?? product.price_cents;
  const quantity = purpose === "gift" ? 1 : purpose === "code_pack" ? qty : ships ? qty : 1;
  const soldOut = (v: Variant) => !product.is_preorder && v.stock !== null && v.stock <= 0;

  function addToCart(goToCart: boolean) {
    setError(null);
    if (variants.length > 0 && !variant) return setError("Pick a size first.");
    if (purpose === "gift" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(giftEmail.trim())) return setError("Add the email of the person it's for.");
    if (purpose === "code_pack" && qty < 2) return setError("A pack is two codes or more.");
    add({
      productId: product.id,
      variantId: variant?.id ?? null,
      quantity,
      purpose,
      giftEmail: purpose === "gift" ? giftEmail.trim().toLowerCase() : null,
      giftMessage: purpose === "gift" ? giftMessage.trim() || null : null,
    });
    if (goToCart) router.push("/store/checkout");
    else {
      setAdded(true);
      setTimeout(() => setAdded(false), 2200);
    }
  }

  const options: Array<{ id: typeof purpose; label: string; show: boolean }> = [
    { id: "self", label: "For me", show: true },
    { id: "gift", label: "As a gift", show: canGift },
    { id: "code_pack", label: "Group codes", show: canPack },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-4 border-b border-rule pb-4">
        <span className="numeral text-[44px]">{formatZar(unit * (purpose === "self" && !ships ? 1 : quantity))}</span>
        {quantity > 1 && <span className="pb-1 font-mono text-[11px] text-[color:var(--text-tertiary)]">{formatZar(unit)} each</span>}
      </div>

      {options.filter((o) => o.show).length > 1 && (
        <div role="radiogroup" aria-label="Who it's for" className="grid grid-cols-3 border border-ink">
          {options
            .filter((o) => o.show)
            .map((o, i) => (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={purpose === o.id}
                onClick={() => setPurpose(o.id)}
                className={cn(
                  "min-h-11 px-2 font-mono text-[10px] font-bold uppercase tracking-[0.12em] transition-colors",
                  i > 0 && "border-l border-ink",
                  purpose === o.id ? "bg-ink text-white" : "bg-white text-ink hover:bg-bone"
                )}
              >
                {o.label}
              </button>
            ))}
        </div>
      )}

      {variants.length > 0 && (
        <div>
          <div className="mono-label mb-2">Size</div>
          <div className="flex flex-wrap gap-2">
            {variants.map((v) => (
              <button
                key={v.id}
                type="button"
                disabled={soldOut(v)}
                onClick={() => setVariantId(v.id)}
                aria-pressed={variantId === v.id}
                className={cn(
                  "min-h-11 min-w-12 border px-3 font-mono text-[12px] font-bold uppercase transition-colors",
                  variantId === v.id ? "border-ink bg-ink text-white" : "border-rule-strong bg-white text-ink hover:border-ink",
                  soldOut(v) && "cursor-not-allowed border-dashed text-[color:var(--text-quiet)] line-through hover:border-rule-strong"
                )}
              >
                {v.label}
              </button>
            ))}
          </div>
          {variant && variant.stock !== null && variant.stock > 0 && variant.stock <= 5 && !product.is_preorder && (
            <p className="mt-2 font-mono text-[11px] text-amber">Only {variant.stock} left</p>
          )}
        </div>
      )}

      {(ships || purpose === "code_pack") && purpose !== "gift" && (
        <Field label={purpose === "code_pack" ? "How many codes" : "Quantity"} hint={purpose === "code_pack" ? "One code per reader. You'll find them on your orders page to hand out." : undefined}>
          <input
            type="number"
            min={purpose === "code_pack" ? 2 : 1}
            max={purpose === "code_pack" ? 500 : 20}
            value={qty}
            onChange={(e) => setQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
            className={cn(inputClass, "w-32 tabular-nums")}
          />
        </Field>
      )}

      {purpose === "gift" && (
        <div className="space-y-3">
          <Field label="Their email" hint="We'll email them a code to claim it once you've paid.">
            <input type="email" value={giftEmail} onChange={(e) => setGiftEmail(e.target.value)} className={inputClass} placeholder="friend@example.com" />
          </Field>
          <Field label="A note (optional)">
            <textarea value={giftMessage} maxLength={500} onChange={(e) => setGiftMessage(e.target.value)} className={cn(inputClass, "h-24 py-3")} />
          </Field>
        </div>
      )}

      {error && <Notice tone="bad">{error}</Notice>}

      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <PrimaryButton type="button" onClick={() => addToCart(true)}>
          {product.is_preorder ? "Preorder" : "Buy now"}
        </PrimaryButton>
        <button
          type="button"
          onClick={() => addToCart(false)}
          className="inline-flex min-h-12 items-center justify-center gap-2 border border-ink bg-white px-5 font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-ink transition-colors hover:bg-bone"
        >
          {added ? (
            <>
              <Check className="h-4 w-4" /> Added
            </>
          ) : (
            "Add to cart"
          )}
        </button>
      </div>
    </div>
  );
}
