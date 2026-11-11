/**
 * Shop logic, including the two seeded bugs that qa-pilot's sample suite is
 * meant to catch. Each bug is on unless DEMO_BUGS=off.
 */

export function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export interface CartLine {
  slug: string;
  name: string;
  price: number;
  quantity: number;
  /** Price times quantity, worked out when the line was last written. */
  lineTotal: number;
}

/** Adds one of a product, or bumps the quantity of an existing line. */
export function addLine(
  lines: CartLine[],
  product: { slug: string; name: string; price: number },
): CartLine[] {
  const existing = lines.find((l) => l.slug === product.slug);
  if (!existing) {
    return [...lines, { ...product, quantity: 1, lineTotal: product.price }];
  }
  return lines.map((l) =>
    l.slug === product.slug
      ? { ...l, quantity: l.quantity + 1, lineTotal: l.price * (l.quantity + 1) }
      : l,
  );
}

/**
 * Changes a line's quantity.
 *
 * Seeded bug 1: with bugs on, the quantity changes but lineTotal keeps its old
 * value, so the order total does not follow the quantity picker.
 */
export function setLineQuantity(
  lines: CartLine[],
  slug: string,
  quantity: number,
  bugs: boolean,
): CartLine[] {
  return lines.map((l) => {
    if (l.slug !== slug) return l;
    if (bugs) return { ...l, quantity };
    return { ...l, quantity, lineTotal: l.price * quantity };
  });
}

export function removeLine(lines: CartLine[], slug: string): CartLine[] {
  return lines.filter((l) => l.slug !== slug);
}

export function orderTotal(lines: CartLine[]): number {
  return lines.reduce((sum, l) => sum + l.lineTotal, 0);
}

export function itemCount(lines: CartLine[]): number {
  return lines.reduce((sum, l) => sum + l.quantity, 0);
}

/**
 * Email check used by sign-up.
 *
 * Seeded bug 2: with bugs on, the pattern leaves "+" out of the local part, so
 * valid addresses such as ada+test@example.com are rejected.
 */
export function isValidEmail(email: string, bugs: boolean): boolean {
  const buggy = /^[a-z0-9._-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i;
  const correct = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i;
  return (bugs ? buggy : correct).test(email.trim());
}
