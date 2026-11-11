import Link from "next/link";
import { ProductArt } from "./components/product-art";
import { products } from "@/lib/products";
import { formatPrice } from "@/lib/shop";

export default function ProductsPage() {
  return (
    <>
      <h1 className="display max-w-2xl text-4xl sm:text-6xl">Camp kitchen enamelware</h1>
      <p className="mt-4 max-w-xl text-lg text-stone">
        Six pieces that can sit in a fire ring, ride in a pack and still look good on the table.
      </p>
      <ul className="mt-12 grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3" aria-label="Products">
        {products.map((product) => (
          <li key={product.slug}>
            <ProductArt product={product} />
            <h2 className="mt-4 text-lg font-bold">
              <Link href={`/products/${product.slug}`} className="hover:underline">
                {product.name}
              </Link>
            </h2>
            <p className="text-stone">{product.summary}</p>
            <p className="mt-1 font-semibold">{formatPrice(product.price)}</p>
          </li>
        ))}
      </ul>
    </>
  );
}
