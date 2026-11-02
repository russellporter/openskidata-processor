/**
 * The region polygons embedded in the installed `openskidata-format` package.
 *
 * They are private constants inside the package's module rather than anything it exports,
 * so they are read out of the module text. That is more fragile than importing, and is
 * deliberately loud about it: if the layout changes so the declarations cannot be found, or
 * no longer parse as plain coordinate arrays, this throws rather than returning something
 * plausible. Used by both the generator that emits the Rust data and the one that builds
 * test vectors from the polygons' vertices, so the two cannot disagree about the data.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./tooling.mjs";

const sourcePath = join(
  repoRoot,
  "node_modules/openskidata-format/dist/RunDifficultyConvention.js",
);

const text = readFileSync(sourcePath, "utf8");

/**
 * The array literal passed to `turf.<constructor>(` for the named constant, found by
 * balancing brackets rather than with a regex that could stop at the wrong `]`.
 */
function extractLiteral(name, constructor) {
  const declaration = `const ${name} = turf.${constructor}(`;
  const start = text.indexOf(declaration);
  if (start === -1) {
    throw new Error(
      `Could not find \`${declaration}\` in ${sourcePath}. ` +
        "The package layout has changed; update this generator.",
    );
  }
  const open = text.indexOf("[", start + declaration.length);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "[") depth++;
    else if (text[i] === "]") {
      depth--;
      if (depth === 0) return text.slice(open, i + 1);
    }
  }
  throw new Error(`Unbalanced brackets in the literal for ${name}.`);
}

/** Parses a coordinate-array literal. Trailing commas make it JS rather than JSON. */
function parseLiteral(literal, name) {
  // A plain-data guard before evaluating anything: digits, signs, dots, exponents,
  // brackets, commas and whitespace only.
  if (!/^[\s\d.,eE+\-[\]]+$/.test(literal)) {
    throw new Error(
      `The literal for ${name} contains something other than coordinate data.`,
    );
  }
  return new Function(`return ${literal}`)();
}

function validate(multiPolygon, name) {
  if (!Array.isArray(multiPolygon) || multiPolygon.length === 0) {
    throw new Error(`${name} is not a non-empty MultiPolygon.`);
  }
  let vertices = 0;
  for (const polygon of multiPolygon) {
    for (const ring of polygon) {
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) {
        throw new Error(`${name} has an unclosed ring.`);
      }
      for (const position of ring) {
        if (
          position.length !== 2 ||
          !position.every((n) => typeof n === "number" && Number.isFinite(n))
        ) {
          throw new Error(`${name} has a malformed position.`);
        }
        vertices++;
      }
    }
  }
  return vertices;
}

/** Both regions as multipolygons, plus a vertex count each. */
export function loadConventionRegions() {
  // Japan is declared with `turf.polygon` (an array of rings) and North America with
  // `turf.multiPolygon` (an array of those). Japan is wrapped so both are uniformly
  // multipolygons, which is exactly how turf's point-in-polygon treats a Polygon
  // (`polys = [polys]`).
  const japan = [
    parseLiteral(extractLiteral("japanConventionGeometry", "polygon"), "japan"),
  ];
  const northAmerica = parseLiteral(
    extractLiteral("northAmericanConventionGeometry", "multiPolygon"),
    "northAmerica",
  );
  return {
    japan,
    northAmerica,
    japanVertices: validate(japan, "japanConventionGeometry"),
    northAmericaVertices: validate(
      northAmerica,
      "northAmericanConventionGeometry",
    ),
  };
}
