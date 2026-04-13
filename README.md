# RateMyProfBot

Automated RateMyProfessors submission CLI. Fills and submits professor ratings with AI-generated unique reviews using [OpenRouter](https://openrouter.ai).

## Features

- Automated form filling for any professor by ID or URL
- AI-generated reviews via OpenRouter (unique per professor, stored in local history)
- Parallel workers — run multiple submissions simultaneously
- Loop mode — run batches continuously until a target count is hit
- Duplicate detection — never submits the same review twice per professor
- Review validation — local + AI checks ensure clean output (no names, no colons, no quotes)
- Cookie banner handling — auto-dismisses and re-fills form if state resets

## Requirements

- Node.js 18+
- An [OpenRouter](https://openrouter.ai) API key

## Installation

```bash
git clone https://github.com/y8olol/RateMyProfBot.git
cd RateMyProfBot
npm install
npx playwright install chromium
```

## Usage

First, grab the profs USERID from a ratemyproflink. (the numbers at the end)

### Basic

```bash
node rmpcli.js --url USERID
```

### With custom rating + AI review

```bash
node rmpcli.js --url USERID --rating 4 --difficulty 2 --openrouterKey sk-or-...
```

### Run N submissions in parallel

```bash
node rmpcli.js --url USERID --rating 5 --workers 5 --openrouterKey sk-or-...
```

### Loop mode — keep submitting in batches

```bash
# Run forever, 3 workers per batch (Ctrl+C to stop)
node rmpcli.js --url USERID --workers 3 --loop --openrouterKey sk-or-...

# Run until 50 total submitted, 5 at a time
node rmpcli.js --url USERID --workers 5 --loop --total 50 --openrouterKey sk-or-...
```

### Headless + fast

```bash
node rmpcli.js --url USERID --workers 5 --loop --total 20 --headless --slowMo 100 --openrouterKey sk-or-...
```

## Options

| Flag | Alias | Default | Description |
|------|-------|---------|-------------|
| `--url` | `-u` | — | Professor URL or numeric ID |
| `--rating` | | `5` | Overall rating (0–5) |
| `--difficulty` | | `2` | Difficulty (0–5) |
| `--wouldTakeAgain` | | `Yes` | Yes / No |
| `--forCredit` | | `Yes` | Yes / No |
| `--usesTextbooks` | | `No` | Yes / No |
| `--attendanceMandatory` | | `No` | Yes / No |
| `--grade` | | `A+` | Grade received |
| `--courseCode` | | `111` | Course code |
| `--review` | | — | Manual review text (skips AI) |
| `--openrouterKey` | `-k` | — | OpenRouter API key |
| `--workers` | `-w` | `1` | Parallel workers per batch |
| `--loop` | `-l` | `false` | Loop in batches |
| `--total` | `-t` | `0` | Total submissions (0 = infinite) |
| `--headless` | `-H` | `false` | Run browser headlessly |
| `--slowMo` | | `300` | Milliseconds between actions |

## Review History

Submitted reviews are stored in `review_history/<profId>.json`. This file is gitignored. The bot will never generate a review that duplicates one already in the history for that professor.

## Notes

- The submit button requires a ReCAPTCHA solve in some cases — the browser will stay open for manual completion if that happens
- `review_history/` is created automatically on first run
