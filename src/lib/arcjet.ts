import arcjet, { detectBot, request, shield, slidingWindow } from "@arcjet/next";

const key = process.env.ARCJET_KEY;

const aj = key
  ? arcjet({
      key,
      rules: [
        shield({ mode: "LIVE" }),
        // Link previews (Slack, iMessage) are fine; scrapers and other bots are not.
        detectBot({ mode: "LIVE", allow: ["CATEGORY:PREVIEW"] }),
        slidingWindow({ mode: "LIVE", interval: "1m", max: 30 }),
      ],
    })
  : null;

/** Returns false when Arcjet denies the current request. No-op without ARCJET_KEY. */
export async function allowPageRequest(): Promise<boolean> {
  if (!aj) return true;
  const decision = await aj.protect(await request());
  return !decision.isDenied();
}
