import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AddToCart } from "./add-to-cart";
import { ProductArt } from "../../components/product-art";
import { readFlags } from "@/lib/flags";
import { findProduct, products, type Product } from "@/lib/products";
import { formatPrice } from "@/lib/shop";

export function generateStaticParams() {
  return products.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: PageProps<"/products/[slug]">): Promise<Metadata> {
  const product = findProduct((await params).slug);
  return { title: product?.name ?? "Not found" };
}

/** The button label depends on DEMO_RENAME, read at request time. */
async function AddToCartWithFlags({ product }: { product: Product }) {
  const flags = await readFlags();
  return (
    <AddToCart
      product={{ slug: product.slug, name: product.name, price: product.price }}
      label={flags.rename ? "Add to bag" : "Add to cart"}
    />
  );
}

export default async function ProductPage({ params }: PageProps<"/products/[slug]">) {
  const product = findProduct((await params).slug);
  if (!product) notFound();

  return (
    <>
      <p>
        <Link href="/" className="text-stone hover:underline">
          All products
        </Link>
      </p>
      <div className="mt-6 grid gap-10 md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div className="max-w-sm md:max-w-none">
          <ProductArt product={product} size="lg" />
        </div>
        <div>
          <h1 className="display text-4xl sm:text-5xl">{product.name}</h1>
          <p className="mt-3 text-2xl font-semibold">{formatPrice(product.price)}</p>
          <p className="mt-4 max-w-prose text-lg">{product.description}</p>
          <div className="mt-8 min-h-24">
            <Suspense
              fallback={
                <button className="button" disabled>
                  Loading
                </button>
              }
            >
              <AddToCartWithFlags product={product} />
            </Suspense>
          </div>
          <dl className="mt-10 grid max-w-md grid-cols-[auto_1fr] gap-x-8 gap-y-2 border-t-2 border-line pt-6">
            {product.details.map(([term, value]) => (
              <div key={term} className="contents">
                <dt className="text-stone">{term}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </>
  );
}
