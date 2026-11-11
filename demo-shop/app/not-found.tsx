import Link from "next/link";

export default function NotFound() {
  return (
    <>
      <h1 className="display text-4xl">Page not found</h1>
      <p className="mt-4 text-lg">
        That page is not in the shop.{" "}
        <Link href="/" className="font-semibold underline">
          See all products
        </Link>
        .
      </p>
    </>
  );
}
