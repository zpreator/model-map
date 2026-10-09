import { defineConfig } from "vite";
import site from "./site.json";

// One source of truth for the deployed URL: site.json (override with SITE_URL for a custom domain).
// The path part becomes Vite's base, so assets resolve on nested pages too.
const url = process.env.SITE_URL ?? site.url;
export default defineConfig({ base: new URL(url).pathname });
