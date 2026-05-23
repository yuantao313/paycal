import { handleRequest } from "../src/calendar.js";

export const config = { runtime: "edge" };

export default function handler(request) {
  return handleRequest(request);
}
