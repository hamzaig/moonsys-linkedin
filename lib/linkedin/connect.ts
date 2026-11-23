import type { Locator, Page } from "playwright";
import { profileTopCard, readTopCardDegree } from "./top-card";

/**
 * Follows a Connect link by its href when that href is a real invite URL, otherwise
 * clicks it. The Nov 2026 More-menu "Connect" item is an <a> whose href is just the
 * profile URL (the invite is opened by a JS handler), so following it only reloads
 * the profile — it must be clicked.
 */
async function openConnectControl(page: Page, control: Locator): Promise<void> {
  const href = await control.getAttribute("href");
  if (href && /custom-invite|\/invite/i.test(href)) {
    const inviteUrl = href.startsWith("http") ? href : `https://www.linkedin.com${href}`;
    await page.goto(inviteUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  } else {
    await control.click();
  }
  await page.waitForTimeout(1000);
}

export class WeeklyLimitError extends Error {}
export class AlreadyConnectedError extends Error {}
export class PendingInviteError extends Error {}

/**
 * Sends a LinkedIn connection request without a note.
 * Navigates to the profile page and clicks the Connect button.
 * Throws WeeklyLimitError if the weekly limit popup appears.
 * Throws AlreadyConnectedError / PendingInviteError if already in that state.
 */
export async function sendConnectionRequest(page: Page, linkedinUrl: string): Promise<void> {
  await page.goto(linkedinUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000 + Math.random() * 1000);

  // Already connected? Primary signal: presence of the profile's "Message" link
  // (only shown to 1st-degree connections) — an href attribute, not a CSS class
  // or translated text, so it survives LinkedIn's class-name hashing and non-
  // English UI languages. Falls back to the old text-scrape for accounts/layouts
  // where that link isn't found as a plain <a href>.
  //
  // MUST be scoped to the visited person's own intro/top card — a page-wide
  // search also matches "Message" links / "1st" badges belonging to OTHER
  // people rendered elsewhere on the page (sidebar modules like "People also
  // viewed"). For a non-connected target this false-positived AlreadyConnected,
  // which skipped the real invite AND (via the message step that follows) sent
  // a message to a random unrelated 1st-degree connection instead of the
  // target — see CLAUDE.md / memory for the Jul 2026 incident. The top card is
  // identified structurally as the section containing the page's own <h1> name
  // heading, robust to class-name hashing. Mirrors the same fix in visit.ts.
  // Degree comes from the top card's "· 1st/2nd/3rd" badge — NOT from a Message
  // link, which LinkedIn now also shows on 2nd/3rd-degree open profiles. See top-card.ts.
  const topCard = profileTopCard(page);
  if (await topCard.count() === 0) throw new Error("Profile top card not found — LinkedIn layout may have changed");
  const degree = await readTopCardDegree(topCard);
  if (degree === 1) throw new AlreadyConnectedError("Already connected");

  // Pending? (scoped to the top card — sidebar cards can show other people's Pending)
  const cardText = await topCard.innerText().catch(() => "");
  if (/\bPending\b/.test(cardText)) throw new PendingInviteError("Invitation already pending");
  const pendingBtn = topCard.locator('button[aria-label*="Pending"]:visible');
  if (await pendingBtn.count() > 0) throw new PendingInviteError("Invitation already pending");

  // Case 1: Direct Connect CTA in the top card. Scoped to the card: the page-wide
  // sidebar also renders "Invite <someone else> to connect" buttons.
  // A link is followed by href (clicking can fail because the Sales Nav overlay SVG
  // intercepts pointer events); a button is clicked.
  const directConnect = topCard.locator(
    'a[aria-label*="Invite"][aria-label*="to connect"]:visible, a[href*="custom-invite"]:visible, button[aria-label*="Invite"][aria-label*="to connect"]:visible'
  ).first();
  if (await directConnect.count() > 0) {
    await openConnectControl(page, directConnect);
  } else {
    // Case 2: Connect is inside the top card's "More" menu. Since the Nov 2026
    // layout that button has no aria-label (only the nav-bar "More" does), so match
    // it by its visible text within the card.
    const moreBtn = topCard.locator("button:visible").filter({ hasText: /^\s*More\s*$/ }).first();
    if (await moreBtn.count() === 0) throw new Error("Neither a Connect button nor a More menu found on profile card");
    await moreBtn.click();
    await page.waitForTimeout(800);

    // Check for Pending in the menu — means invite was already sent
    const pendingMenuItem = page.locator('[role="menuitem"]:has-text("Pending"):visible');
    if (await pendingMenuItem.count() > 0) throw new PendingInviteError("Invitation already pending (found in More menu)");

    const connectOption = page.locator('[role="menuitem"]:visible').filter({ hasText: /^\s*Connect\s*$/ });
    if (await connectOption.count() === 0) throw new Error("Connect option not found in More menu");
    await openConnectControl(page, connectOption.first());
  }

  await page.waitForTimeout(1000);

  // Click "Send without a note" / "Send now"
  const sendBtn = page.locator(
    // Nov 2026 layout: the invite dialog's button is a plain <button>Send without a note</button>
    // with no aria-label, so match its visible text too.
    'button:visible:has-text("Send without a note"), button:has-text("Send now"), button[aria-label*="Send without"], button[aria-label*="Send invitation"]:not([aria-label*="note"])'
  );
  if (await sendBtn.count() === 0) {
    // Without this, a missing dialog returned normally and the runner logged
    // "Connection request sent" although nothing was sent.
    throw new Error("Send invitation dialog not found after clicking Connect");
  }
  await sendBtn.first().click({ force: true });
  await page.waitForTimeout(1500);

  // Check for weekly limit popup
  const limitPopup = page.locator('div[class*="ip-fuse-limit-alert__warning"]');
  if (await limitPopup.count() > 0) throw new WeeklyLimitError("Weekly connection limit reached");

  // Check for error toast
  const errorToast = page.locator('div[data-test-artdeco-toast-item-type="error"]:visible');
  if (await errorToast.count() > 0) {
    const msg = await errorToast.innerText();
    throw new Error(`Connection error: ${msg.trim()}`);
  }
}
