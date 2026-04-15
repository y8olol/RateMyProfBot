#!/usr/bin/env node
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
// Simple color helpers (avoids ESM/CJS chalk issues)
const chalk = {
  red:    (s) => `\x1b[31m${s}\x1b[0m`,
  green:  (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan:   (s) => `\x1b[36m${s}\x1b[0m`,
  white:  (s) => `\x1b[37m${s}\x1b[0m`,
  bold:   (s) => `\x1b[1m${s}\x1b[0m`,
  dim:    (s) => `\x1b[2m${s}\x1b[0m`,
};

// Simple arg parser (no yargs dependency needed)
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { count: 1, output: "cookies.json", headless: false, slowMo: 300 };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if ((a === "-n" || a === "--count") && args[i + 1]) opts.count = parseInt(args[++i], 10);
    else if ((a === "-o" || a === "--output") && args[i + 1]) opts.output = args[++i];
    else if (a === "-H" || a === "--headless") opts.headless = true;
    else if (a === "--slowMo" && args[i + 1]) opts.slowMo = parseInt(args[++i], 10);
    else if (a === "-h" || a === "--help") {
      console.log("Usage: node cookiegen.js [-n count] [-o output.json] [-H] [--slowMo ms]");
      process.exit(0);
    }
  }
  return opts;
}
const argv = parseArgs();

// ── Helpers ──────────────────────────────────────────────────────────────────

function randomString(len, charset = "abcdefghijklmnopqrstuvwxyz0123456789") {
  let out = "";
  for (let i = 0; i < len; i++)
    out += charset[Math.floor(Math.random() * charset.length)];
  return out;
}

function randomEmail() {
  return `${randomString(10)}@gmail.com`;
}

function randomPassword() {
  // 8 chars, mix of letters + digits for safety
  return randomString(6) + Math.floor(10 + Math.random() * 90);
}

// Load existing cookies file or start fresh
function loadOutputFile(filePath) {
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    // Normalise: could be a single object or an array
    if (Array.isArray(raw)) return raw;
    if (typeof raw === "object" && raw !== null) return [raw];
  } catch (_) {}
  return [];
}

// Append a new account entry and save
function appendToOutputFile(filePath, entry) {
  const existing = loadOutputFile(filePath);
  existing.push(entry);
  fs.writeFileSync(filePath, JSON.stringify(existing, null, 2), "utf8");
}

// ── Core account creation ─────────────────────────────────────────────────────

async function createAccount({ headless, slowMo }) {
  const email = randomEmail();
  const password = randomPassword();

  console.log(chalk.yellow(`  Email   : ${email}`));
  console.log(chalk.yellow(`  Password: ${password}`));

  const browser = await chromium.launch({ headless, slowMo });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  try {
    // Step 1 — Navigate
    console.log(chalk.yellow("  Navigating to RateMyProfessors..."));
    await page.goto("https://www.ratemyprofessors.com", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);

    // Accept cookie banner
    const cookieBtn = page.locator('#onetrust-accept-btn-handler');
    if (await cookieBtn.isVisible({ timeout: 4000 })) {
      await cookieBtn.click();
      await page.waitForTimeout(600);
      console.log(chalk.dim("  (cookie banner dismissed)"));
    }

    // Step 2 — Click Sign Up
    console.log(chalk.yellow("  Clicking Sign Up..."));
    await page.locator('[data-testid="modal-button-link"]').first().click();
    await page.waitForTimeout(1000);

    // If the login modal opened instead, click "Sign Up" inside the footer
    const signUpInModal = page.locator('.LoginModal__StyledHelperTextFooter-z0f5f3-4 [data-testid="modal-button-link"]');
    if (await signUpInModal.isVisible({ timeout: 2000 })) {
      console.log(chalk.dim("  (login modal detected — switching to Sign Up...)"));
      await signUpInModal.click();
      await page.waitForTimeout(1000);
    }

    // Step 3 & 4 — Fill email
    console.log(chalk.yellow("  Entering email..."));
    await page.locator('input#email[name="email"]').fill(email);
    await page.waitForTimeout(400);

    // Step 5 — Click Continue
    console.log(chalk.yellow("  Clicking Continue..."));
    await page.locator('button[type="submit"]').filter({ hasText: /continue/i }).click();
    await page.waitForTimeout(1500);

    // Step 6 — Fill password
    console.log(chalk.yellow("  Entering password..."));
    await page.locator('input#password[name="password"]').fill(password);
    await page.waitForTimeout(400);

    // Click the next Continue/Submit button (after password field appears)
    await page.locator('button[type="submit"]').filter({ hasText: /continue/i }).click();
    await page.waitForTimeout(1500);

    // Step 7 — Skip for now
    console.log(chalk.yellow("  Skipping profile details..."));
    const skipBtn = page.locator('button').filter({ hasText: /skip for now/i });
    if (await skipBtn.isVisible({ timeout: 4000 })) {
      await skipBtn.click();
      await page.waitForTimeout(1500);
    } else {
      console.log(chalk.dim("  (no skip button found, continuing...)"));
    }

    // Step 8 — Fetch rmpAuth cookie (www domain)
    console.log(chalk.yellow("  Fetching rmpAuth cookie..."));
    const cookies = await context.cookies("https://www.ratemyprofessors.com");
    const rmpAuth = cookies.find((c) => c.name === "rmpAuth");

    if (!rmpAuth) {
      throw new Error("rmpAuth cookie not found after signup — account creation may have failed.");
    }

    console.log(chalk.green(`  ✓ Got rmpAuth: ${rmpAuth.value.slice(0, 40)}...`));
    return { rmpAuth: rmpAuth.value };

  } finally {
    await browser.close();
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const outputPath = path.resolve(argv.output);
  const count = argv.count;

  console.log(chalk.cyan(`\nCookie Generator — creating ${count} account(s)`));
  console.log(chalk.cyan(`Output file: ${outputPath}\n`));

  let passed = 0;
  let failed = 0;

  for (let i = 1; i <= count; i++) {
    console.log(chalk.bold(`\n[${i}/${count}] Creating account...`));
    try {
      const entry = await createAccount({ headless: argv.headless, slowMo: argv.slowMo });
      appendToOutputFile(outputPath, entry);
      console.log(chalk.green(`[${i}/${count}] ✓ Saved to ${argv.output}`));
      passed++;
    } catch (err) {
      console.error(chalk.red(`[${i}/${count}] ✗ Failed: ${err.message}`));
      failed++;
    }
  }

  console.log(chalk.cyan(`\n${"─".repeat(40)}`));
  console.log(
    chalk.white(`Done! `) +
    chalk.green(`${passed} succeeded  `) +
    chalk.red(`${failed} failed`)
  );
  console.log(chalk.cyan("─".repeat(40) + "\n"));
}

main().catch((err) => {
  console.error(chalk.red("Fatal error:"), err);
  process.exit(1);
});
