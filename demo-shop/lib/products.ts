/** In-memory catalogue. Prices are in cents. */
export interface Product {
  slug: string;
  name: string;
  price: number;
  /** Enamel colour of the product art. */
  enamel: "teal" | "navy" | "forest" | "mustard" | "slate";
  art: "mug" | "plate" | "percolator" | "spork" | "billy" | "bowl";
  summary: string;
  description: string;
  details: [string, string][];
}

export const products: Product[] = [
  {
    slug: "trail-mug",
    name: "Trail mug",
    price: 1800,
    enamel: "teal",
    art: "mug",
    summary: "12 oz, rolled rim",
    description:
      "A 12 oz enamel mug with a rolled navy rim. It holds heat long enough for a slow morning and sits fine on a camp stove.",
    details: [
      ["Capacity", "12 oz (350 ml)"],
      ["Weight", "210 g"],
      ["Care", "Hand wash; safe over an open flame"],
    ],
  },
  {
    slug: "camp-plate",
    name: "Camp plate",
    price: 1400,
    enamel: "navy",
    art: "plate",
    summary: "10 inch, shallow",
    description:
      "A shallow 10-inch plate with enough lip to keep beans where they belong. Stacks flat in a pack.",
    details: [
      ["Diameter", "10 in (25 cm)"],
      ["Weight", "280 g"],
      ["Care", "Hand wash"],
    ],
  },
  {
    slug: "percolator",
    name: "Camp percolator",
    price: 4600,
    enamel: "forest",
    art: "percolator",
    summary: "8 cups, glass knob",
    description:
      "An eight-cup percolator with a glass knob so you can watch the coffee darken. Works on a stove or embers.",
    details: [
      ["Capacity", "8 cups (1.2 l)"],
      ["Weight", "740 g"],
      ["Care", "Rinse and dry the basket after use"],
    ],
  },
  {
    slug: "spork-set",
    name: "Spork set",
    price: 900,
    enamel: "mustard",
    art: "spork",
    summary: "Four, stainless",
    description: "Four stainless steel sporks on a split ring. One for each person, one to lose.",
    details: [
      ["Pieces", "4"],
      ["Weight", "96 g"],
      ["Care", "Dishwasher safe"],
    ],
  },
  {
    slug: "billy-can",
    name: "Billy can",
    price: 3200,
    enamel: "slate",
    art: "billy",
    summary: "1.5 litre, wire bail",
    description:
      "A 1.5 litre pot with a wire bail for hanging over a fire and a lid that doubles as a frying pan.",
    details: [
      ["Capacity", "1.5 l"],
      ["Weight", "520 g"],
      ["Care", "Hand wash; safe over an open flame"],
    ],
  },
  {
    slug: "enamel-bowl",
    name: "Enamel bowl",
    price: 1600,
    enamel: "teal",
    art: "bowl",
    summary: "6 inch, deep",
    description: "A deep 6-inch bowl for porridge, stew or washing up a few sporks.",
    details: [
      ["Diameter", "6 in (15 cm)"],
      ["Weight", "190 g"],
      ["Care", "Hand wash"],
    ],
  },
];

export function findProduct(slug: string): Product | undefined {
  return products.find((p) => p.slug === slug);
}
