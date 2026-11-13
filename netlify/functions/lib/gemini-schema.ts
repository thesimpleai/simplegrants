import type { Schema, Type } from "@google/genai";
import { z } from "zod";

/** Gemini's native schema is a subset of JSON Schema. Keep provider requests
 * structural; Zod remains authoritative for strictness, lengths and limits. */
export function geminiOutputSchema(schema: z.ZodType): Schema {
  const json = z.toJSONSchema(schema, {
    target: "draft-7",
    reused: "inline",
    cycles: "throw",
  });
  function convert(node: Record<string, unknown>): Schema {
    if (Array.isArray(node.anyOf)) {
      const variants = node.anyOf as Record<string, unknown>[];
      const nonNull = variants.filter((item) => item.type !== "null");
      if (nonNull.length === 1 && variants.length === 2)
        return { ...convert(nonNull[0]), nullable: true };
      throw new Error("Unsupported Gemini output schema union");
    }
    const types = Array.isArray(node.type) ? node.type : [node.type];
    const nonNull = types.filter((type) => type !== "null");
    if (
      nonNull.length !== 1 ||
      !["object", "array", "string", "number", "integer", "boolean"].includes(
        String(nonNull[0]),
      )
    )
      throw new Error("Unsupported Gemini output schema type");
    const result: Schema = { type: String(nonNull[0]).toUpperCase() as Type };
    if (types.includes("null")) result.nullable = true;
    if (node.properties)
      result.properties = Object.fromEntries(
        Object.entries(
          node.properties as Record<string, Record<string, unknown>>,
        ).map(([key, value]) => [key, convert(value)]),
      );
    if (Array.isArray(node.required) && node.required.length)
      result.required = node.required as string[];
    if (node.items)
      result.items = convert(node.items as Record<string, unknown>);
    if (Array.isArray(node.enum)) result.enum = node.enum.map(String);
    return result;
  }
  return convert(json);
}
