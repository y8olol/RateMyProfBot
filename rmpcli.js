#!/usr/bin/env node
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const inquirer = require("inquirer").default;
const chalk = require("chalk").default;
const yargs = require("yargs/yargs");
const { hideBin } = require("yargs/helpers");

const argv = yargs(hideBin(process.argv))
  .option("url", {
    alias: "u",
    type: "string",
    description: "RateMyProfessors professor URL or ID",
  })
  .option("headless", {
    alias: "H",
    type: "boolean",
    default: false,
    description: "Run browser in headless mode",
  })
  .option("slowMo", {
    type: "number",
    default: 300,
    description: "Slow down operations by specified ms",
  })
  .option("courseCode", {
    type: "string",
    default: "111",
    description: "Course code for the rating",
  })
  .option("rating", {
    type: "number",
    choices: [0, 1, 2, 3, 4, 5],
    default: 5,
    description: "Rating (0-5 where 5 is Awesome)",
  })
  .option("difficulty", {
    type: "number",
    choices: [0, 1, 2, 3, 4, 5],
    default: 2,
    description: "Difficulty (0-5 where 2 is Easy)",
  })
  .option("wouldTakeAgain", {
    type: "string",
    choices: ["Yes", "No"],
    default: "Yes",
    description: "Would you take again?",
  })
  .option("forCredit", {
    type: "string",
    choices: ["Yes", "No"],
    default: "Yes",
    description: "Was the class for credit?",
  })
  .option("usesTextbooks", {
    type: "string",
    choices: ["Yes", "No"],
    default: "No",
    description: "Does the class use textbooks?",
  })
  .option("attendanceMandatory", {
    type: "string",
    choices: ["Yes", "No"],
    default: "No",
    description: "Is attendance mandatory?",
  })
  .option("grade", {
    type: "string",
    choices: [
      "A+",
      "A",
      "A-",
      "B+",
      "B",
      "B-",
      "C+",
      "C",
      "C-",
      "D+",
      "D",
      "F",
    ],
    default: "A+",
    description: "Grade received",
  })
  .option("review", {
    type: "string",
    description: "Review text for the professor (if omitted, auto-generated via AI)",
  })
  .option("openrouterKey", {
    alias: "k",
    type: "string",
    description: "OpenRouter API key for AI-generated reviews",
  })
  .option("workers", {
    alias: "w",
    type: "number",
    default: 1,
    description: "Number of parallel workers per batch",
  })
  .option("loop", {
    alias: "l",
    type: "boolean",
    default: false,
    description: "Keep submitting in batches until --total is reached (or forever if --total is 0)",
  })
  .option("total", {
    alias: "t",
    type: "number",
    default: 0,
    description: "Total number of submissions when using --loop (0 = run forever)",
  })
  .help()
  .alias("help", "h").argv;

// ASCII art banner
function printBanner() {
  console.log(chalk.cyan([
    '▄▄▄▄▄▄▄                     ▄▄▄      ▄▄▄       ▄▄▄▄▄▄▄                 ▄▄ ▄▄▄▄▄▄▄               ',
    '███▀▀███▄        ██         ████▄  ▄████       ███▀▀███▄              ██  ███▀▀███▄        ██   ',
    '███▄▄███▀  ▀▀█▄ ▀██▀▀ ▄█▀█▄ ███▀████▀███ ██ ██ ███▄▄███▀ ████▄ ▄███▄ ▀██▀ ███▄▄███▀ ▄███▄ ▀██▀▀ ',
    '███▀▀██▄  ▄█▀██  ██   ██▄█▀ ███  ▀▀  ███ ██▄██ ███▀▀▀▀   ██ ▀▀ ██ ██  ██  ███  ███▄ ██ ██  ██   ',
    '███  ▀███ ▀█▄██  ██   ▀█▄▄▄ ███      ███  ▀██▀ ███       ██    ▀███▀  ██  ████████▀ ▀███▀  ██   ',
    '                                           ██                                                   ',
    '                                         ▀▀▀                                                    ',
  ].join('\n')));
  console.log();
}

// Extract professor ID from URL or return if it's already numeric ID
function extractProfessorId(input) {
  if (!input) return null;
  // Match patterns like /professor/1234567 or just 1234567
  const match = input.match(/(?:\/professor\/)?(\d+)/);
  return match ? match[1] : null;
}

// ── Review history store (one JSON file per professor ID) ───────────────────
// Stored at ./review_history/<profId>.json

function getHistoryPath(profId) {
  const dir = path.join(process.cwd(), 'review_history');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${profId}.json`);
}

function loadHistory(profId) {
  const p = getHistoryPath(profId);
  if (!fs.existsSync(p)) return [];
  try { return JSON.parse(fs.readFileSync(p, 'utf8')).reviews || []; }
  catch (_) { return []; }
}

function saveToHistory(profId, text) {
  const p = getHistoryPath(profId);
  const reviews = loadHistory(profId);
  reviews.push({ text, submittedAt: new Date().toISOString() });
  fs.writeFileSync(p, JSON.stringify({ reviews }, null, 2), 'utf8');
}

function isDuplicate(text, history) {
  const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  return history.some(r => norm(r.text) === norm(text));
}

// Extract 5-word phrases that appear more than once across all history reviews
function getOverusedPhrases(history, topN = 5) {
  const freq = {};
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  for (const r of history) {
    const words = norm(r.text).split(' ').filter(Boolean);
    for (let i = 0; i <= words.length - 5; i++) {
      const phrase = words.slice(i, i + 5).join(' ');
      freq[phrase] = (freq[phrase] || 0) + 1;
    }
  }
  return Object.entries(freq)
    .filter(([, c]) => c > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([phrase]) => phrase);
}

// Clean a raw LLM response before using it as a review:
//  - Strips prompt-leakage lines (lines that look like instructions / meta-text)
//  - Hard caps at 350 chars, cutting at the last complete sentence within that limit
function cleanReview(raw) {
  const MAX_CHARS = 350;

  const isInstructionLine = (line) => {
    const l = line.toLowerCase();
    return [
      'let\'s craft', 'let us craft', 'sentence 1', 'sentence 2', 'sentence 3',
      'we need', 'we can produce', 'so we can', 'so we need', 'avoid overused',
      'avoid those', 'avoid phrases', 'avoid exact', 'produce a review',
      'produce maybe', 'short review', 'casual conversational', 'no bullet',
      'no gendered', 'must not mention', 'must match', 'do not mention',
      'output only', 'the student gave', 'overall rating', 'difficulty:',
      'would take again:', 'grade received:', 'here is your', 'here\'s your',
      'write a student', 'write a short', 'write something', 'write:',
      'just produce', 'just the review', 'should be plausible', 'provide natural',
      'rules:', 'note:', 'ratemyprofessors', 'scores:', 'rating:', 'plausible student',
      'maybe a ', 'maybe about', '30-35 sentences', '3-5 sentences', '35 sentences',
      'casual tone', 'perhaps "', 'something like:', 'like: "', 'that\'s 4 sentences',
      'that\'s 3 sentences', 'that\'s 5 sentences',
    ].some(w => l.includes(w));
  };

  // Strip markdown fences
  let text = raw.replace(/```[\s\S]*?```/g, '').trim();

  // DO NOT use the quoted-match extraction — the model wraps its suggestions in
  // quotes too ("Write: perhaps "Professor Chen...""), which pulls in named professors.
  // Instead always filter line by line.
  const kept = text
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0 && !isInstructionLine(l));
  text = kept.join(' ').replace(/\s+/g, ' ').trim();

  // Strip any inline quotes (the model sometimes wraps just the review sentence in quotes)
  text = text.replace(/^["'\u201C\u201D]+|["'\u201C\u201D]+$/g, '').trim();

  // Filter sentence by sentence as a second pass
  const sentenceMatches = text.match(/[^.!?]+[.!?]/g);
  if (sentenceMatches) {
    text = sentenceMatches
      .filter(s => !isInstructionLine(s))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Cap at 350 chars on a clean sentence boundary
  if (text.length > MAX_CHARS) {
    const trunc = text.slice(0, MAX_CHARS);
    const lastEnd = Math.max(trunc.lastIndexOf('. '), trunc.lastIndexOf('! '), trunc.lastIndexOf('? '));
    text = lastEnd > 80 ? trunc.slice(0, lastEnd + 1).trim() : trunc.slice(0, MAX_CHARS - 3).trim() + '...';
  }

  return text;
}

// Returns true if the text looks like genuine student review prose.
function looksLikeReview(text) {
  if (!text || text.length < 30) return false;
  const l = text.toLowerCase();

  // Must not contain instruction phrases
  const badPhrases = [
    'write a', 'write:', 'write something', 'produce a', 'let\'s craft',
    'we need', 'sentence 1', 'avoid overused', 'output only', 'the student gave',
    'overall rating', 'scores:', 'rating:', 'rules:', 'plausible',
    'casual conversational', 'no gendered', 'no bullet', 'must not',
    'do not mention', 'perhaps "', 'something like', 'that\'s 4 sentences',
  ];
  if (badPhrases.some(p => l.includes(p))) return false;

  // Must not contain quotes (model putting review in quotes = likely still leaking)
  if (/[""\u201C\u201D]/.test(text)) return false;

  // Must not contain semicolons (indicator of structured/instruction output)
  if (text.includes(';')) return false;

  // Must not reference anyone by title + name (Professor Smith, Prof. Lee, Dr. Patel, etc.)
  if (/\b(?:Professor|Prof\.|Dr\.|Mr\.|Ms\.|Mrs\.)\s+[A-Z]/.test(text)) return false;

  // Must contain at least one sentence-ending punctuation
  if (!/[.!?]/.test(text)) return false;

  return true;
}





// Lightweight AI check: does the text have no names, no colons, no quotes, and is an actual review?
async function aiCheckReview(openrouterKey, text) {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${openrouterKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "arcee-ai/trinity-large-preview:free",
        messages: [
          { role: "system", content: "You are a text validator. Reply with only YES or NO." },
          { role: "user", content: `Does this text satisfy ALL of these rules?
1. No person's name mentioned (no Professor Smith, Dr. Lee, etc.)
2. No colon characters (:)
3. No quote characters (" or ')
4. Is an actual review sentence(s), not instructions or meta-text

Text: ${text}

Reply YES if all 4 rules pass, NO if any fail.` }
        ],
        max_tokens: 5,
        temperature: 0,
      }),
    });
    if (!res.ok) return { valid: true }; // don't block on API failure
    const data = await res.json();
    const answer = (data.choices?.[0]?.message?.content || '').trim().toUpperCase();
    return answer.startsWith('YES') ? { valid: true } : { valid: false, reason: 'failed AI rules check' };
  } catch (_) {
    return { valid: true }; // don't block on network error
  }
}

// Generate a unique review via OpenRouter using arcee-ai/trinity-large-preview:free.
// Checks against the professor's stored review history and retries with escalating
// temperature + duplicate feedback if the model produces something already used.
async function generateReview(openrouterKey, profId, { rating, difficulty, wouldTakeAgain, grade }, pfx = '') {
  const ratingLabel = ['Awful', 'Awful', 'Poor', 'Average', 'Good', 'Awesome'][rating] || 'Average';
  const diffLabel   = ['N/A', 'Very Easy', 'Easy', 'Medium', 'Hard', 'Very Hard'][difficulty] || 'Medium';

  const history = loadHistory(profId);
  const MAX_ATTEMPTS = 5;
  let previouslyRejected = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const temperature = parseFloat(Math.min(0.7 + attempt * 0.15, 1.4).toFixed(2));
    const overusedPhrases = getOverusedPhrases(history);

    // No previously-rejected text injected — just let temperature escalation drive variation
    const extraRules = attempt > 1 ? `\n- Vary your sentence structure and opening word from previous attempts` : '';

    const systemPrompt = `You are a college student writing a short professor review. Output ONLY the review itself — nothing else.

FORBIDDEN — do not output any of these:
- Any person's name whatsoever (Smith, Chen, Lee, Patel, Martinez, Johnson, or any other name)
- Title + name combos like "Professor Smith", "Dr. Lee", "Prof. Chen" — use "the professor" or "they" instead
- Planning text, sentence labels, instructions, meta-commentary
- Colons or quote characters

Your entire response must be 3-5 sentences of casual student review prose. Begin immediately with the first sentence.${extraRules}`;

    const userPrompt = `Scores — Rating: ${rating}/5 (${ratingLabel}), Difficulty: ${difficulty}/5 (${diffLabel}), Would take again: ${wouldTakeAgain}, Grade: ${grade}. Write the review now.`;

    if (attempt === 1) {
      console.log(chalk.yellow(`${pfx}Generating AI review... (${history.length} previous on record for prof ${profId})`));
    } else {
      console.log(chalk.yellow(`${pfx}Duplicate — regenerating (attempt ${attempt}/${MAX_ATTEMPTS}, temp=${temperature})...`));
    }

    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openrouterKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "arcee-ai/trinity-large-preview:free",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user",   content: userPrompt },
        ],
        max_tokens: 200,
        temperature,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenRouter API error ${res.status}: ${err}`);
    }

    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content?.trim();
    if (!raw) throw new Error("OpenRouter returned empty response");

    // Clean the text before using it:
    // 1. Strip prompt-leakage lines (lines that look like instructions, not prose)
    // 2. Hard cap at 350 chars, cutting at the last complete sentence within that limit
    const text = cleanReview(raw);

    // Fast local check first — catches obvious garbage without an API call
    if (!looksLikeReview(text)) {
      console.log(chalk.yellow(`${pfx}⚠ Local check failed, retrying... (got: "${raw.slice(0, 80).replace(/\n/g, ' ')}")`));
      previouslyRejected = raw.slice(0, 200);
      continue;
    }

    // AI check — verify no names, no colons, no quotes, actual review
    const aiCheck = await aiCheckReview(openrouterKey, text);
    if (!aiCheck.valid) {
      console.log(chalk.yellow(`${pfx}⚠ AI check failed (${aiCheck.reason}), retrying...`));
      previouslyRejected = text;
      continue;
    }

    if (isDuplicate(text, history)) {
      console.log(chalk.red(`${pfx}✗ Duplicate detected, retrying...`));
      previouslyRejected = text;
      continue;
    }

    console.log(chalk.green(`${pfx}✓ Unique review ready (${text.length} chars): "${text.slice(0, 60)}..."`));
    return text;
  }

  throw new Error(`Could not generate a unique review after ${MAX_ATTEMPTS} attempts`);
}


// Dismiss the cookie banner if it is currently visible.
// Returns true if a banner was found and clicked, false otherwise.
async function dismissCookieBanner(page) {
  try {
    const onetrust = page.locator('#onetrust-accept-btn-handler');
    if (await onetrust.isVisible({ timeout: 1000 })) {
      await onetrust.click();
      await onetrust.waitFor({ state: 'hidden', timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(600);
      return true;
    }
  } catch (_) {}
  try {
    const generic = page.locator('button').filter({ hasText: /accept all cookies/i }).first();
    if (await generic.isVisible({ timeout: 1000 })) {
      await generic.click();
      await generic.waitFor({ state: 'hidden', timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(600);
      return true;
    }
  } catch (_) {}
  return false;
}

// Open a React-select dropdown and pick an option, retrying if the cookie banner
// intercepts the click and prevents the options list from appearing.
async function selectReactOption(page, controlLocator, desiredText, label) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    // Always dismiss any visible banner BEFORE clicking the dropdown
    await dismissCookieBanner(page);

    await controlLocator.click({ force: true });
    await page.waitForTimeout(400);

    // Wait up to 3s for options to appear
    try {
      await page.waitForSelector('[role="option"]', { state: 'attached', timeout: 3000 });
    } catch (_) {
      // Options never appeared — banner likely intercepted the click
      console.log(chalk.yellow(`  ⚠ ${label} dropdown didn't open (attempt ${attempt}/3), checking for cookie banner...`));
      const dismissed = await dismissCookieBanner(page);
      if (!dismissed) {
        await page.keyboard.press('Escape'); // close any half-open state
      }
      await page.waitForTimeout(400);
      continue;
    }

    // Options are visible — pick the matching one
    const allOptions = page.locator('[role="option"]');
    if (desiredText) {
      const match = allOptions.filter({ hasText: desiredText });
      if (await match.count() > 0) {
        await match.first().click({ force: true });
        return;
      }
      const firstName = (await allOptions.first().textContent() || '').trim();
      console.log(chalk.yellow(`  ⚠ "${desiredText}" not found in ${label} dropdown, using first option: "${firstName}"`));
    }
    await allOptions.first().click({ force: true });
    return;
  }
  throw new Error(`Could not open ${label} dropdown after 3 attempts`);
}

// Fill every field on the form. Extracted so it can be retried cleanly if the
// cookie banner fires mid-fill and React resets the form state.
async function fillForm(page, {
  courseCode, rating, difficulty, wouldTakeAgain,
  forCredit, usesTextbooks, attendanceMandatory, grade, tags, reviewText
}) {
  // ── Course Code (React-select) ──────────────────────────────────────────────
  console.log(chalk.yellow(`Selecting course code: ${courseCode}`));
  await selectReactOption(
    page,
    page.locator('[class*="CourseCode"] [class*="-control"]').first(),
    courseCode,
    'course code'
  );
  console.log(chalk.green('✓ Course code selected'));

  // ── Rating slider ────────────────────────────────────────────────────────────
  console.log(chalk.yellow(`Setting rating to: ${rating}`));
  await page.evaluate((val) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    const input = document.querySelector('input[name="rating"]');
    setter.call(input, String(val));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, rating);
  console.log(chalk.green('✓ Rating set'));

  // ── Difficulty slider ────────────────────────────────────────────────────────
  console.log(chalk.yellow(`Setting difficulty to: ${difficulty}`));
  await page.evaluate((val) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    const input = document.querySelector('input[name="difficulty"]');
    setter.call(input, String(val));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, difficulty);
  console.log(chalk.green('✓ Difficulty set'));

  // ── Radio buttons (by name+value attribute, NOT #id) ─────────────────────────
  const radios = [
    { name: 'wouldTakeAgain',      value: wouldTakeAgain,      label: 'Would take again' },
    { name: 'forCredit',           value: forCredit,           label: 'For credit' },
    { name: 'usesTextbooks',       value: usesTextbooks,       label: 'Uses textbooks' },
    { name: 'attendanceMandatory', value: attendanceMandatory, label: 'Attendance mandatory' },
  ];
  for (const r of radios) {
    console.log(chalk.yellow(`${r.label}: ${r.value}`));
    await page.evaluate(({ name, value }) => {
      const radio = document.querySelector(
        `input[type="radio"][name="${name}"][value="${value}"]`
      );
      if (radio) {
        radio.click();
        radio.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, { name: r.name, value: r.value });
    console.log(chalk.green(`✓ ${r.label} set`));
  }

  // ── Grade dropdown (React-select) ────────────────────────────────────────────
  console.log(chalk.yellow(`Selecting grade: ${grade}`));
  const gradeControlCount = await page.locator('[class*="GradeSelector"] [class*="-control"]').count();
  const gradeControl = gradeControlCount > 0
    ? page.locator('[class*="GradeSelector"] [class*="-control"]').first()
    : page.locator('[class*="-control"]').nth(1);
  await selectReactOption(page, gradeControl, grade, 'grade');
  console.log(chalk.green('✓ Grade selected'));

  // ── Tag checkboxes ────────────────────────────────────────────────────────────
  console.log(chalk.yellow('Checking tags...'));
  await page.evaluate((tagNames) => {
    tagNames.forEach((name) => {
      const cb = document.querySelector(`input[name="${name}"]`);
      if (cb && !cb.checked) cb.click();
    });
  }, tags);
  console.log(chalk.green('✓ Tags checked'));

  // ── Review textarea ───────────────────────────────────────────────────────────
  console.log(chalk.yellow('Filling review textarea...'));
  await page.evaluate((text) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    const ta = document.querySelector('textarea[name="comment"]') || document.querySelector('textarea');
    if (ta) {
      setter.call(ta, text);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      ta.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, reviewText);
  console.log(chalk.green('✓ Review written'));
}

// Read live DOM values back and return list of field names that are wrong/missing.
async function verifyForm(page, {
  rating, difficulty, wouldTakeAgain, forCredit,
  usesTextbooks, attendanceMandatory, reviewText
}) {
  return await page.evaluate((exp) => {
    const missing = [];
    const courseVal = document.querySelector('[class*="singleValue"], [class*="single-value"]');
    if (!courseVal || !courseVal.textContent.trim()) missing.push('courseCode');
    const ratingEl = document.querySelector('input[name="rating"]');
    if (!ratingEl || String(ratingEl.value) !== String(exp.rating)) missing.push('rating');
    const diffEl = document.querySelector('input[name="difficulty"]');
    if (!diffEl || String(diffEl.value) !== String(exp.difficulty)) missing.push('difficulty');
    for (const r of [
      { name: 'wouldTakeAgain',      value: exp.wouldTakeAgain },
      { name: 'forCredit',           value: exp.forCredit },
      { name: 'usesTextbooks',       value: exp.usesTextbooks },
      { name: 'attendanceMandatory', value: exp.attendanceMandatory },
    ]) {
      const el = document.querySelector(`input[type="radio"][name="${r.name}"][value="${r.value}"]`);
      if (!el || !el.checked) missing.push(r.name);
    }
    const ta = document.querySelector('textarea[name="comment"]') || document.querySelector('textarea');
    if (!ta || !ta.value.trim()) missing.push('reviewText');
    return missing;
  }, { rating, difficulty, wouldTakeAgain, forCredit, usesTextbooks, attendanceMandatory, reviewText });
}

// Main rating function
async function rateProfessor(profId, options = {}) {
  const {
    headless = false,
    slowMo = 300,
    courseCode = "111",
    rating = 5,
    difficulty = 2,
    wouldTakeAgain = "Yes",
    forCredit = "Yes",
    usesTextbooks = "No",
    attendanceMandatory = "No",
    grade = "A+",
    tags = ["Amazinglectures", "Givesgoodfeedback", "Inspirational"],
    reviewText = "This professor is amazing! Lectures are engaging and well-structured. " +
      "Cares about student success and provides helpful feedback. " +
      "Highly recommend taking their course.",
    showSubmitPrompt = false,
    interactive = false,
    openrouterKey = null,
    _attemptLabel = '',
  } = options;
  const pfx = _attemptLabel ? _attemptLabel + ' ' : '';

  // Generate review via AI if a key is provided and no manual review was given
  let finalReviewText = reviewText;
  if (openrouterKey && !options.reviewText) {
    finalReviewText = await generateReview(openrouterKey, profId, { rating, difficulty, wouldTakeAgain, grade }, pfx);
  }

  const formOptions = {
    courseCode, rating, difficulty, wouldTakeAgain,
    forCredit, usesTextbooks, attendanceMandatory, grade, tags,
    reviewText: finalReviewText,
  };

  console.log(chalk.blue(`${pfx}Starting automation for professor ID: ${profId}`));

  const browser = await chromium.launch({ headless, slowMo });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  let submit = false;
  try {
    console.log(chalk.yellow(`${pfx}Navigating to rating form...`));
    await page.goto(
      `https://www.ratemyprofessors.com/add/professor-rating/${profId}`,
      { waitUntil: "domcontentloaded" },
    );
    await page.waitForSelector('input[name="rating"]', { state: "attached", timeout: 10000 });

    // Dismiss any banner present on load before touching anything
    const bannerOnLoad = await dismissCookieBanner(page);
    if (bannerOnLoad) console.log(chalk.yellow("✓ Cookie banner dismissed (on load)"));
    console.log(chalk.green(`${pfx}✓ Rating form loaded`));

    // ── Fill attempt (up to 3 total, re-filling if banner resets the form) ──────
    let attempts = 0;
    let missing = [];
    while (attempts < 3) {
      attempts++;
      if (attempts > 1) {
        console.log(chalk.yellow(`⚠ Re-filling form (attempt ${attempts}/3)...`));
        await page.waitForTimeout(700); // let React finish remounting
      }
      await fillForm(page, formOptions);

      // Check if banner fired during fill
      const bannerAfterFill = await dismissCookieBanner(page);
      if (bannerAfterFill) {
        console.log(chalk.yellow("⚠ Cookie banner appeared after fill — form may have reset, retrying..."));
        continue; // go back to top of while loop and re-fill
      }

      // Verify everything actually stuck
      console.log(chalk.yellow("Verifying form fields..."));
      missing = await verifyForm(page, formOptions);
      if (missing.length === 0) break;
      console.log(chalk.yellow(`⚠ Fields not set correctly: ${missing.join(', ')}. Retrying...`));
    }

    if (missing.length > 0) {
      console.log(chalk.red(`✗ Could not set fields after ${attempts} attempts: ${missing.join(', ')}`));
      console.log(chalk.blue("Browser left open for manual fix."));
    } else {
      console.log(chalk.green(`${pfx}✓ All fields verified`));
    }

    // ── Submit logic ─────────────────────────────────────────────────────────
    if (!interactive) {
      submit = true;
    } else if (showSubmitPrompt) {
      const { submit: answer } = await inquirer.prompt([
        {
          type: "confirm",
          name: "submit",
          message: "All fields filled. Submit the rating?",
          default: false,
        },
      ]);
      submit = answer;
    }

    if (submit) {
      console.log(chalk.yellow(`${pfx}Submitting form...`));
      // Final banner check right before clicking submit
      await dismissCookieBanner(page);

      // Find the submit button — RMP uses "Submit Rating" as the button text
      const submitBtn = page
        .locator('button:has-text("Submit Rating"), button[type="submit"]')
        .first();
      await submitBtn.waitFor({ state: "visible", timeout: 10000 });
      await submitBtn.click({ force: true });
      await page.waitForTimeout(5000);
      console.log(chalk.green(`${pfx}✓ Form submitted!`));
      saveToHistory(profId, finalReviewText);
      console.log(chalk.dim(`${pfx}  Review saved to history (prof ${profId}, total: ${loadHistory(profId).length})`));
    } else {
      console.log(chalk.blue("Submission skipped. Browser left open for manual review."));
      await new Promise((resolve) => setTimeout(resolve, 60000));
    }
  } catch (err) {
    console.error(chalk.red("Error during automation:"), err);
  } finally {
    await browser.close();
  }
}


// Main CLI function
async function main() {
  printBanner();

  let profId = null;

  if (argv.url) {
    profId = extractProfessorId(argv.url);
    if (!profId) {
      console.error(
        chalk.red(
          "Could not extract professor ID from URL. Provide a valid RMP URL or numeric ID.",
        ),
      );
      process.exit(1);
    }
  } else {
    const { url } = await inquirer.prompt([
      {
        type: "input",
        name: "url",
        message: "Enter RateMyProfessors professor URL or ID:",
        validate: (input) => {
          const id = extractProfessorId(input);
          return id ? true : "Please enter a valid URL or numeric ID";
        },
      },
    ]);
    profId = extractProfessorId(url);
  }

  console.log(chalk.green(`Target professor ID: ${profId}`));

  const interactive = !argv.url;

  // Ask for optional customization only if we're in interactive mode
  let customize = false;
  if (interactive) {
    // We prompted for professor ID, so ask about customization
    const { customize: answer } = await inquirer.prompt([
      {
        type: "confirm",
        name: "customize",
        message: "Customize rating values?",
        default: false,
      },
    ]);
    customize = answer;
  }

  const options = {};
  if (customize) {
    const answers = await inquirer.prompt([
      {
        type: "input",
        name: "courseCode",
        message: "Course code:",
        default: "111",
      },
      {
        type: "list",
        name: "rating",
        message: "Rating (0-5):",
        choices: ["5", "4", "3", "2", "1", "0"],
        default: "5",
      },
      {
        type: "list",
        name: "difficulty",
        message: "Difficulty (0-5):",
        choices: ["5", "4", "3", "2", "1", "0"],
        default: "2",
      },
      {
        type: "list",
        name: "wouldTakeAgain",
        message: "Would take again?",
        choices: ["Yes", "No"],
        default: "Yes",
      },
      {
        type: "list",
        name: "forCredit",
        message: "For credit?",
        choices: ["Yes", "No"],
        default: "Yes",
      },
      {
        type: "list",
        name: "usesTextbooks",
        message: "Uses textbooks?",
        choices: ["Yes", "No"],
        default: "No",
      },
      {
        type: "list",
        name: "attendanceMandatory",
        message: "Attendance mandatory?",
        choices: ["Yes", "No"],
        default: "No",
      },
      {
        type: "list",
        name: "grade",
        message: "Grade:",
        choices: [
          "A+",
          "A",
          "A-",
          "B+",
          "B",
          "B-",
          "C+",
          "C",
          "C-",
          "D+",
          "D",
          "F",
        ],
        default: "A+",
      },
      {
        type: "checkbox",
        name: "tags",
        message: "Select tags (space to toggle, enter to confirm):",
        choices: [
          "Amazing Lectures",
          "Gives Good Feedback",
          "Inspirational",
          "Tough Grader",
          "Get Ready to Read",
          "Skip Class? You Won't Pass.",
          "Lecture Heavy",
          "Graded by Few Things",
          "Participation Matters",
          "Respected",
        ],
        default: ["Amazing Lectures", "Gives Good Feedback", "Inspirational"],
      },
      {
        type: "input",
        name: "reviewText",
        message: "Review text:",
        default:
          "This professor is amazing! Lectures are engaging and well-structured. " +
          "Cares about student success and provides helpful feedback. " +
          "Highly recommend taking their course.",
      },
    ]);

    // Map tag names to the actual input names used on RMP
    const tagMap = {
      "Amazing Lectures": "Amazinglectures",
      "Gives Good Feedback": "Givesgoodfeedback",
      Inspirational: "Inspirational",
      "Tough Grader": "Toughgrader",
      "Get Ready to Read": "Getreadytoread",
      "Skip Class? You Won't Pass.": "Skipclassyouwontpass",
      "Lecture Heavy": "Lectureheavy",
      "Graded by Few Things": "Gradedbyfewthings",
      "Participation Matters": "Participationmatters",
      Respected: "Respected",
    };

    options.tags = answers.tags.map((t) => tagMap[t]);
    options.courseCode = answers.courseCode;
    options.rating = parseInt(answers.rating, 10);
    options.difficulty = parseInt(answers.difficulty, 10);
    options.wouldTakeAgain = answers.wouldTakeAgain;
    options.forCredit = answers.forCredit;
    options.usesTextbooks = answers.usesTextbooks;
    options.attendanceMandatory = answers.attendanceMandatory;
    options.grade = answers.grade;
    options.reviewText = answers.reviewText;
  }

  // Apply CLI overrides
  if (argv.courseCode) options.courseCode = argv.courseCode;
  if (argv.rating) options.rating = parseInt(argv.rating, 10);
  if (argv.difficulty) options.difficulty = parseInt(argv.difficulty, 10);
  if (argv.wouldTakeAgain) options.wouldTakeAgain = argv.wouldTakeAgain;
  if (argv.forCredit) options.forCredit = argv.forCredit;
  if (argv.usesTextbooks) options.usesTextbooks = argv.usesTextbooks;
  if (argv.attendanceMandatory)
    options.attendanceMandatory = argv.attendanceMandatory;
  if (argv.grade) options.grade = argv.grade;
  if (argv.review) options.reviewText = argv.review;
  if (argv.openrouterKey) options.openrouterKey = argv.openrouterKey;

  // Only show submit prompt in fully interactive mode (when we prompted for both ID and customization)
  const showSubmitPrompt = interactive && customize;

  const workers = argv.workers || 1;
  const loop = argv.loop || false;
  const total = argv.total || 0; // 0 = infinite when looping

  const rateOptions = {
    headless: argv.headless,
    slowMo: argv.slowMo,
    ...options,
    showSubmitPrompt,
    interactive,
  };

  // Run a single batch of `workers` submissions in parallel.
  // Returns { passed, failed } counts for the batch.
  async function runBatch(batchNum, startIdx) {
    const batchLabel = loop ? chalk.cyan(`[Batch ${batchNum}]`) : '';
    if (loop) console.log(chalk.cyan(`\n${batchLabel} Launching ${workers} workers...`));
    else if (workers > 1) console.log(chalk.cyan(`\nLaunching ${workers} parallel workers...`));

    const tasks = Array.from({ length: workers }, (_, i) => {
      const globalIdx = startIdx + i + 1;
      const label = chalk.bold(loop ? `[#${globalIdx}]` : `[#${i + 1}]`);
      return (async () => {
        try {
          await rateProfessor(profId, { ...rateOptions, _attemptLabel: label });
          console.log(chalk.green(`${label} ✓ Submitted successfully`));
          return { idx: globalIdx, success: true };
        } catch (err) {
          console.log(chalk.red(`${label} ✗ Failed: ${err.message}`));
          return { idx: globalIdx, success: false, error: err.message };
        }
      })();
    });

    const results = await Promise.allSettled(tasks);
    const resolved = results.map(r => r.value ?? r.reason);

    let passed = 0, failed = 0;
    console.log(chalk.cyan(`\n── ${loop ? batchLabel + ' ' : ''}Results ${'─'.repeat(30)}`));
    for (const r of resolved) {
      if (r?.success) { console.log(chalk.green(`  #${r.idx} ✓ Success`)); passed++; }
      else { console.log(chalk.red(`  #${r.idx} ✗ Failed${r?.error ? ': ' + r.error : ''}`)); failed++; }
    }
    console.log(chalk.cyan('─'.repeat(40)));
    console.log(chalk.white(`  Workers: ${workers}  `) + chalk.green(`Passed: ${passed}  `) + chalk.red(`Failed: ${failed}`));
    console.log(chalk.cyan('─'.repeat(40) + '\n'));
    return { passed, failed };
  }

  if (!loop) {
    // Single batch (or single submission)
    if (workers === 1) {
      await rateProfessor(profId, rateOptions);
    } else {
      await runBatch(1, 0);
    }
  } else {
    // Loop mode: keep running batches until total is reached (or Ctrl+C if total=0)
    if (total === 0) {
      console.log(chalk.cyan(`\nLoop mode: running ${workers} workers per batch indefinitely (Ctrl+C to stop)\n`));
    } else {
      console.log(chalk.cyan(`\nLoop mode: ${total} total submissions, ${workers} workers per batch\n`));
    }

    let submitted = 0;
    let totalPassed = 0;
    let totalFailed = 0;
    let batchNum = 0;

    process.on('SIGINT', () => {
      console.log(chalk.cyan(`\n\nStopped after ${submitted} submissions — ${totalPassed} passed, ${totalFailed} failed.`));
      process.exit(0);
    });

    while (total === 0 || submitted < total) {
      const remaining = total === 0 ? workers : Math.min(workers, total - submitted);
      // Temporarily override workers for last partial batch
      const savedWorkers = workers;
      batchNum++;

      const batchWorkers = remaining;
      // Patch runBatch to use batchWorkers — easier to just inline
      const batchLabel = chalk.cyan(`[Batch ${batchNum}]`);
      console.log(chalk.cyan(`\n${batchLabel} Launching ${batchWorkers} workers... (${total > 0 ? submitted + '/' + total : submitted + ' so far'})`));

      const tasks = Array.from({ length: batchWorkers }, (_, i) => {
        const globalIdx = submitted + i + 1;
        const label = chalk.bold(`[#${globalIdx}]`);
        return (async () => {
          try {
            await rateProfessor(profId, { ...rateOptions, _attemptLabel: label });
            console.log(chalk.green(`${label} ✓ Submitted`));
            return { idx: globalIdx, success: true };
          } catch (err) {
            console.log(chalk.red(`${label} ✗ Failed: ${err.message}`));
            return { idx: globalIdx, success: false, error: err.message };
          }
        })();
      });

      const results = await Promise.allSettled(tasks);
      const resolved = results.map(r => r.value ?? r.reason);

      let batchPassed = 0, batchFailed = 0;
      for (const r of resolved) {
        if (r?.success) batchPassed++; else batchFailed++;
      }
      submitted += batchWorkers;
      totalPassed += batchPassed;
      totalFailed += batchFailed;

      console.log(chalk.cyan(`── ${batchLabel} done: `) + chalk.green(`${batchPassed} passed`) + chalk.white(', ') + chalk.red(`${batchFailed} failed`) + chalk.white(` | Total so far: ${submitted} (${totalPassed} ✓ ${totalFailed} ✗)`));
    }

    console.log(chalk.cyan(`\n${'═'.repeat(40)}`));
    console.log(chalk.white(`  All done!  Total: ${submitted}  `) + chalk.green(`Passed: ${totalPassed}  `) + chalk.red(`Failed: ${totalFailed}`));
    console.log(chalk.cyan('═'.repeat(40) + '\n'));
  }
}

main().catch((err) => {
  console.error(chalk.red("Fatal error:"), err);
  process.exit(1);
});
