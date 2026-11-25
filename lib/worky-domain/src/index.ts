export const WORKY_CATEGORIES = ["Plomería", "Electricidad", "Gas", "Albañilería", "Otro"] as const;

export type WorkyCategory = typeof WORKY_CATEGORIES[number];

export type WorkyCategoryResolution = {
  category: WorkyCategory;
  original: string;
  preserveOriginalTrade: boolean;
};

const aliases: ReadonlyArray<{ category: WorkyCategory; terms: readonly string[] }> = [
  {
    category: "Albañilería",
    terms: ["albañil", "albañiles", "albañilería", "constructor", "construcción", "mampostería"],
  },
  {
    category: "Plomería",
    terms: ["plomero", "plomera", "plomeros", "plomeras", "fontanero", "fontanera", "sanitarista", "cañería"],
  },
  {
    category: "Electricidad",
    terms: ["electricista", "electricistas", "instalador eléctrico", "instaladora eléctrica"],
  },
  {
    category: "Gas",
    terms: ["gasista", "gasistas", "instalador de gas", "instaladora de gas"],
  },
  {
    category: "Otro",
    terms: [
      "pintor", "pintora", "pintura", "carpintero", "carpintera", "carpintería",
      "jardinero", "jardinera", "jardinería", "herrero", "herrera", "herrería",
      "cerrajero", "cerrajera", "cerrajería", "techista", "techos", "yesero",
      "yesera", "yesería", "soldador", "soldadora", "soldadura", "vidriero",
      "vidriera", "mantenimiento", "reparación", "reparaciones",
    ],
  },
];

function normalizeTerm(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const normalizedAliases = aliases.flatMap(({ category, terms }) =>
  terms.map((term) => ({ category, term: normalizeTerm(term) })),
).sort((left, right) => right.term.length - left.term.length);

export function resolveWorkyCategory(value: unknown): WorkyCategoryResolution | null {
  if (typeof value !== "string") return null;
  const original = value.trim();
  if (!original) return null;

  const normalized = normalizeTerm(original);
  if (!normalized) return null;

  const canonical = WORKY_CATEGORIES.find((category) => normalizeTerm(category) === normalized);
  const category = canonical
    ?? normalizedAliases.find(({ term }) => normalized === term || normalized.startsWith(`${term} `))?.category
    ?? "Otro";

  const genericOther = normalized === "otro" || normalized === "otra" || normalized === "otros";
  return {
    category,
    original: original.slice(0, 80),
    preserveOriginalTrade: category === "Otro" && !genericOther,
  };
}
