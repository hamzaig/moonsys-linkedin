import type { Locator, Page } from "playwright";

/**
 * Locates the visited person's own intro/top card on a LinkedIn profile page.
 *
 * Every degree/connect check MUST be scoped to this card: `main` also contains
 * sidebar modules ("More profiles for you", "People you may know") full of OTHER
 * people's Message links, "· 1st" badges and "Invite X to connect" buttons. A
 * page-wide match once marked a stranger as the target (Jul 2026 incident).
 *
 * LinkedIn's Nov 2026 layout renders the name as an <h2> (it used to be <h1>), so
 * both are accepted. The top card is the first such section in DOM order.
 */
export function profileTopCard(page: Page): Locator {
  return page.locator("main section").filter({ has: page.locator("h1, h2") }).first();
}

export type Degree = 1 | 2 | 3 | null;

/**
 * Reads the connection degree from the top card's "· 1st / · 2nd / · 3rd" badge.
 *
 * Do NOT infer 1st-degree from a Message link: since the Nov 2026 layout LinkedIn
 * shows a Message link (a[href*="/messaging/compose"]) on 2nd/3rd-degree open
 * profiles too, so that signal now gives false "already connected" results.
 * Only the first ~200 chars are checked so a badge in later card content can't match.
 */
export async function readTopCardDegree(card: Locator): Promise<Degree> {
  const text = (await card.innerText().catch(() => "")).slice(0, 200);
  const m = text.match(/·\s*(1st|2nd|3rd)\b/);
  if (!m) return null;
  return m[1] === "1st" ? 1 : m[1] === "2nd" ? 2 : 3;
}
