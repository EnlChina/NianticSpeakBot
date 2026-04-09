import { Bot, GrammyError, HttpError, InlineQueryResultBuilder, webhookCallback } from "grammy";
import cmapJa from "./cmap_ja";

export interface Env {
  BOT_TOKEN: string;
}

const TELEGRAM_MAX_ENTITIES = 100;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const bot = new Bot(env.BOT_TOKEN);

    bot.catch((err) => {
      const ctx = err.ctx;
      console.error(`Error while handling update ${ctx.update.update_id}:`);
      const e = err.error;
      if (e instanceof GrammyError) {
        console.error("Error in request:", e.description);
      } else if (e instanceof HttpError) {
        console.error("Could not contact Telegram:", e);
      } else {
        console.error("Unknown error:", e);
      }
    });

    const getSpoilerEntitiesAndFilteredText = (text: string) => {
      const entities: { type: "spoiler"; offset: number; length: number }[] = [];
      let spoilerStart = -1;
      let spoilerLength = 0;
      let filteredText = "";

      for (let offset = 0; offset < text.length; ) {
        const codepoint = text.codePointAt(offset);
        const charLength = codepoint !== undefined && codepoint > 0xffff ? 2 : 1;
        const isAllowed = codepoint !== undefined && cmapJa.has(codepoint);
        const char = text.slice(offset, offset + charLength);

        if (isAllowed) {
          filteredText += char;
          if (spoilerStart >= 0) {
            entities.push({ type: "spoiler", offset: spoilerStart, length: spoilerLength });
            spoilerStart = -1;
            spoilerLength = 0;
          }
        } else {
          if (spoilerStart < 0) {
            spoilerStart = offset;
          }
          spoilerLength += charLength;
        }

        offset += charLength;
      }

      if (spoilerStart >= 0) {
        entities.push({ type: "spoiler", offset: spoilerStart, length: spoilerLength });
      }

      return { entities, filteredText };
    };

    const truncateTextAndEntitiesByLimit = (
      text: string,
      entities: { type: "spoiler"; offset: number; length: number }[],
      limit: number,
    ) => {
      if (entities.length <= limit) {
        return { text, entities, truncated: false };
      }

      const limitedEntities = entities.slice(0, limit);
      const lastEntity = limitedEntities[limitedEntities.length - 1];
      const textEndOffset = lastEntity.offset + lastEntity.length;
      const truncatedText = text.slice(0, textEndOffset);
      return { text: truncatedText, entities: limitedEntities, truncated: true };
    };

    bot.on("inline_query", async (ctx) => {
      const query = ctx.inlineQuery.query;
      if (!query.trim()) {
        await ctx.answerInlineQuery([InlineQueryResultBuilder.article("0", "…").text("…")]);
        return;
      }

      const { entities, filteredText } = getSpoilerEntitiesAndFilteredText(query);
      const tooManyEntities = entities.length > TELEGRAM_MAX_ENTITIES;
      const spoilerTitle = tooManyEntities
        ? "1) Send with Spoiler (Too many spoiler entities: only first 100 will be sent)"
        : "1) Send with Spoiler";

      await ctx.answerInlineQuery([
        InlineQueryResultBuilder.article("0", spoilerTitle).text(query, {
          entities: entities.slice(0, TELEGRAM_MAX_ENTITIES),
        }),
        InlineQueryResultBuilder.article("1", "2) Send without Spoiler").text(filteredText || "…"),
      ]);
    });

    bot.on("message:text", async (ctx) => {
      if (ctx.chat.type !== "private") {
        return;
      }

      const text = ctx.message.text;
      const hasCommandEntity = ctx.message.entities?.some((entity) => entity.type === "bot_command") ?? false;
      if (hasCommandEntity || text.trimStart().startsWith("/")) {
        return;
      }

      const { entities } = getSpoilerEntitiesAndFilteredText(text);
      const truncatedResult = truncateTextAndEntitiesByLimit(text, entities, TELEGRAM_MAX_ENTITIES);
      await ctx.reply(truncatedResult.text, { entities: truncatedResult.entities });
      if (truncatedResult.truncated) {
        await ctx.reply(
          "Your message exceeded Telegram's 100-entity limit. Only the first 100 spoilers and the corresponding text were sent.",
        );
      }
    });

    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/set-webhook") {
      const webhookUrl = `${url.origin}/webhook`;
      try {
        const result = await bot.api.setWebhook(webhookUrl, {
          allowed_updates: ["message", "callback_query", "inline_query"],
        });
        return new Response(JSON.stringify(result), {
          headers: { "Content-Type": "application/json" },
        });
      } catch (error: unknown) {
        console.error("Error setting webhook", error);
        return new Response("Failed to set webhook", { status: 500 });
      }
    }

    if (request.method === "POST" && url.pathname === "/webhook") {
      console.log("telegram webhook received");
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      try {
        const response = await Promise.race([
          webhookCallback(bot, "cloudflare-mod")(request),
          new Promise<never>((_, reject) => {
            timeoutId = setTimeout(
              () => reject(new Error("Webhook processing exceeded 8 second timeout")),
              8000,
            );
          }),
        ]);
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
          timeoutId = undefined;
        }
        console.log("Webhook processed successfully");
        return response as Response;
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        const errorStack = error instanceof Error ? error.stack : "";
        console.error("Error handling webhook:", errorMessage, errorStack);

        if (errorMessage.includes("timeout")) {
          return new Response(
            JSON.stringify({
              error: "Request timeout",
              message: "Request processing timed out, please retry later.",
            }),
            {
              status: 408,
              headers: { "Content-Type": "application/json" },
            },
          );
        }

        return new Response(
          JSON.stringify({
            error: "Webhook processing failed",
            message: "An unexpected error occurred while handling the webhook.",
          }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          },
        );
      } finally {
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }
      }
    }

    return new Response("Hello from YsProject!", {
      status: 200,
      headers: {
        "Content-Type": "text/plain",
      },
    });
  },
};
