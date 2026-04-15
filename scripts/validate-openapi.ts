import SwaggerParser from "@apidevtools/swagger-parser";
import { join } from "node:path";

const specPath = join(import.meta.dirname, "../src/openapi/openapi.json");

await SwaggerParser.validate(specPath);
console.log("OpenAPI document is valid:", specPath);
