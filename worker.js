import { fetchHandler, scheduledHandler } from "./app.js";

export default {
  fetch: fetchHandler,
  async scheduled(event, env, ctx) {
    ctx.waitUntil(scheduledHandler(event, env));
  }
};

export { fetchHandler };
