import { Iskra } from "@iskradevs/apisdk";
const apiKey = process.env.ISKRA_API_KEY;
const baseUrl = process.env.ISKRA_BASE_URL;
if (!apiKey || !baseUrl) throw new Error("Set ISKRA_API_KEY and ISKRA_BASE_URL");
export const iskra = new Iskra({
  apiKey,
  baseUrl,
  ...(process.env.ISKRA_RUN_AS ? { runAs: process.env.ISKRA_RUN_AS } : {}),
});
