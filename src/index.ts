import { Bot, InlineQueryResultBuilder, webhookCallback } from "grammy";

export interface Env {
  BOT_TOKEN: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const bot = new Bot(env.BOT_TOKEN);

    bot.on("inline_query", async (ctx) => {
      const query = ctx.inlineQuery.query;
      await ctx.answerInlineQuery([
        InlineQueryResultBuilder.article("0", query || "…").text(query || "…"),
      ]);
    });

    const handleUpdate = webhookCallback(bot, "cloudflare-mod");
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/set-webhook") {
      const webhookUrl = `${url.origin}/webhook`;
      try {
        const result = await bot.api.setWebhook(webhookUrl, {
          allowed_updates: ["message", "callback_query"],
        });
        return new Response(JSON.stringify(result), {
          headers: { "Content-Type": "application/json" },
        });
      } catch (error: unknown) {
        console.error("Error setting webhook", error);
        return new Response("Failed to set webhook", { status: 500 });
      }
    }

    if (request.method === "POST") {
      try {
        return await handleUpdate(request);
      } catch (err) {
        console.error("Error handling update:", err);
        return new Response("Internal Server Error", { status: 500 });
      }
    }

    return new Response("Not Found", { status: 404 });
  },
};
