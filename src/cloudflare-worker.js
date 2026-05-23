import { handleRequest } from "./calendar.js";

export default {
  fetch(request) {
    return handleRequest(request);
  },
};
