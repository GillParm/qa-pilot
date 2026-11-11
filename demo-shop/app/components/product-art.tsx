import type { Product } from "@/lib/products";

/** Line drawings in white on a speckled enamel tile. Decorative: the product name carries the meaning. */
const drawings: Record<Product["art"], React.ReactNode> = {
  mug: (
    <>
      <path d="M30 34h40v34a10 10 0 0 1-10 10H40a10 10 0 0 1-10-10z" />
      <path d="M70 42h6a8 8 0 0 1 0 16h-6" />
      <path d="M30 34h40" strokeWidth="5" />
    </>
  ),
  plate: (
    <>
      <ellipse cx="50" cy="56" rx="36" ry="16" />
      <ellipse cx="50" cy="54" rx="24" ry="9" />
    </>
  ),
  percolator: (
    <>
      <path d="M36 32h28l6 46H30z" />
      <path d="M64 42h8a6 6 0 0 1 0 12h-6" />
      <path d="M40 32l4-8h12l4 8" />
      <circle cx="50" cy="20" r="4" />
    </>
  ),
  spork: (
    <>
      <path d="M44 22c-8 0-10 14-6 20s4 8 4 12v24" />
      <path d="M44 22c8 0 10 14 6 20" />
      <path d="M60 22c-6 0-8 12-4 18s2 8 2 12v26" />
      <path d="M60 22c6 0 8 12 4 18" />
    </>
  ),
  billy: (
    <>
      <path d="M28 40h44v32a6 6 0 0 1-6 6H34a6 6 0 0 1-6-6z" />
      <path d="M26 40h48" strokeWidth="5" />
      <path d="M28 46C28 18 72 18 72 46" />
    </>
  ),
  bowl: (
    <>
      <path d="M22 46h56c0 18-12 30-28 30S22 64 22 46z" />
      <path d="M22 46h56" strokeWidth="5" />
    </>
  ),
};

export function ProductArt({
  product,
  size = "md",
}: {
  product: Product;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <div className={`enamel enamel-${product.enamel} art-${size}`} aria-hidden="true">
      <svg
        viewBox="0 0 100 100"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {drawings[product.art]}
      </svg>
    </div>
  );
}
