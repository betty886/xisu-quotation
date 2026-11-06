# Quote calculator regression report

Original PR record: 2026-11-04. Independent review: 2026-11-06.

## Scope and tax-profile separation

The quoted unit prices and totals in this report are regression fixtures computed from the repository's **public reference configuration**, `skills/xisu-quotation/assets/parameters.reference.json`. Its `profile_type` is `public_reference_rules`, its `tax_multiplier` is **1.08**, and its default extra margin and minimum margin are both zero. These prices are reference calculations, not approved factory quotations or current commercial material prices. Alternate processing fees and the isolated tax value below are synthetic test inputs.

Actual factory operating parameters must be maintained and checked separately in a private configuration. The public fixture's 1.08 does not replace those operating rules. A cloned configuration with `tax_multiplier: 1.1` is used only as an **isolated synthetic tax fixture** to verify that the engine reads the supplied value without modifying the public profile; it does not declare any factory's actual tax rule or quote a factory price. This review does not change the public tax setting, material or machine parameters, or the production calculation formula. Public test prices must not be copied into a factory quotation without validating the complete private configuration and order conditions.

## Original suite record — 2026-11-04

The following environment and pass logs are preserved from the original PR #3 report. They describe that PR's reported run, not the independently executed checks on 2026-11-06; current verification is recorded separately below.

Reported baseline: `main` at `3a737e5e6b5ac9d80bf89b0f1863277e5ad3ca3d` (`Internal web quote calculator (#1)`), reported equal to `origin/main` at the time.

Reported runtime: Node.js v22.23.4, npm 10.9.9, `@playwright/test` 1.64.1, Chromium for Testing 156.0.8078.4 (Playwright Chromium build 1248).

Reported result: both the unmodified baseline suite and the suite after the original config-read assertions exited 0.

`npm test` runs six Node scripts in order. The last two launch headless Chromium through Playwright (`web-ui.test.cjs`, `flock-fixed-ui.test.cjs`) at desktop 1365×900 and mobile 390×844. There is no separate `playwright test` project.

### Reported baseline on unmodified `main`

Reported exit code: 0.

```text
> test
> node skills/xisu-quotation/scripts/quote.test.cjs && node skills/xisu-quotation/scripts/flock-weight.test.cjs && node skills/xisu-quotation/scripts/rules.test.cjs && node skills/xisu-quotation/scripts/web-server.test.cjs && node skills/xisu-quotation/scripts/web-ui.test.cjs && node skills/xisu-quotation/scripts/flock-fixed-ui.test.cjs

PASS PET、材料参考参数与不同厚度、自定义参数、植布尺寸、估厚、克重和输入验证
PASS 植绒固定参考参数、两种克重口径、形状、自定义配置、CLI及离线核算
PASS 含税系数、加工费档位、排版、小单、取整、估厚、植绒、无效输入与白 PET 回归
PASS local quote HTTP: 28 materials, PET, all flocked colors, cloth, height/weight, matching CLI, external origin/host, private paths, invalid input, custom configuration
PASS 1365px 高度估算、克重反推、实测、植布、复制
PASS 390px 高度估算、克重反推、实测、植布、复制
PASS 1365px 两种克重口径、明确等效厚度与本机网络隔离
PASS 390px 两种克重口径、明确等效厚度与本机网络隔离
```

### Reported result after the original processing-fee config assertion

The original PR's only suite change was in `skills/xisu-quotation/scripts/rules.test.cjs`: 触感PET（黑色、彩色）and 镀金PET（彩色）must quote `processing_base_per_sheet` from the loaded parameter object. The original report recorded exit code 0 after re-running `npm test`, with only the rules pass message changed.

```text
> test
> node skills/xisu-quotation/scripts/quote.test.cjs && node skills/xisu-quotation/scripts/flock-weight.test.cjs && node skills/xisu-quotation/scripts/rules.test.cjs && node skills/xisu-quotation/scripts/web-server.test.cjs && node skills/xisu-quotation/scripts/web-ui.test.cjs && node skills/xisu-quotation/scripts/flock-fixed-ui.test.cjs

PASS PET、材料参考参数与不同厚度、自定义参数、植布尺寸、估厚、克重和输入验证
PASS 植绒固定参考参数、两种克重口径、形状、自定义配置、CLI及离线核算
PASS 含税系数、加工费档位、排版、小单、取整、估厚、植绒、无效输入、白 PET 回归与触感/镀金加工费读取配置
PASS local quote HTTP: 28 materials, PET, all flocked colors, cloth, height/weight, matching CLI, external origin/host, private paths, invalid input, custom configuration
PASS 1365px 高度估算、克重反推、实测、植布、复制
PASS 390px 高度估算、克重反推、实测、植布、复制
PASS 1365px 两种克重口径、明确等效厚度与本机网络隔离
PASS 390px 两种克重口径、明确等效厚度与本机网络隔离
```

Coverage confirmed by reading those scripts:

| Script | What it checks |
|---|---|
| `quote.test.cjs` | Sample PET transparent order (untaxed 0.1305 / tax-inclusive 0.1410), flock reference parameters, cloth layout, height estimate, weight, invalid input |
| `flock-weight.test.cjs` | Fixed flock price and density, finished vs substrate weight, custom config, offline module call in a child `node -e` process |
| `rules.test.cjs` | Tax factor, processing tiers, layout, small-order fees, rounding, height estimate, flock, invalid input, white PET regression, 触感/镀金 base fee read from config |
| `web-server.test.cjs` | Local HTTP quote API, including the same white PET prices, 28 selectable variants, auth, custom config, and comparison with a direct `quote()` module call |
| `web-ui.test.cjs` | Playwright UI: login, height estimate, weight back-calculation, measured thickness, cloth, copy, both viewports |
| `flock-fixed-ui.test.cjs` | Playwright UI: flock weight basis, copy enabled, no remote requests, both viewports |

## Check 1: white PET 阳模

Input, using the built-in reference file `skills/xisu-quotation/assets/parameters.reference.json`:

| Field | Value |
|---|---|
| Material / color | PET / 白色 |
| Mold | 阳模 (`male`) |
| Size | 17.5 × 7.5 × 4 cm |
| Thickness | 40 丝 = 0.40 mm (`measured_thickness_mm: 0.4`; the UI shows 丝 as mm × 100) |
| Quantity | 10000 |
| Public reference tax multiplier | 1.08 |
| Extra margin / minimum margin | 0 / 0 |
| Extra defect rate | 0 |
| Mold, packaging, other fees and freight | 0; pickup freight default |

Direct `quote()` result, independently checked on 2026-11-06 using the unchanged public reference parameters:

| Result | Value | Expected |
|---|---|---|
| Reference untaxed unit | **0.1985** | 0.1985 |
| Reference tax-inclusive unit (1.08) | **0.2144** | 0.2144 |
| Reference untaxed total | 1985 | 0.1985 × 10000 |
| Reference tax-inclusive total (1.08) | 2144 | 0.2144 × 10000 |

Match: yes.

The result has status `pending_review` and `review_label: null`. The current `quote.cjs` returns `pending_review` for every successful quote; this is not a dynamic decision based on `profile_type`. Here `review_label` is null because no extra input assumptions were added. Neither that null label nor a passing regression test approves a quotation for customer use.

### Independent calculation and rounding

The formula in `quote.cjs` / `tray-engine.cjs` and separate arithmetic give the following chain:

| Step | Calculation | Result |
|---|---|---|
| Male-mold occupied size | (17.5 + 4) × (7.5 + 4) | 21.5 × 11.5 cm |
| Original layout | floor((126 − 4) / 21.5) × floor((76 − 4) / 11.5) | 5 × 6 = 30 cavities |
| Original sheet | (5 × 21.5 + 4) × (6 × 11.5 + 4) | 111.5 × 73 = 8139.5 cm² |
| Rotated alternative | 10 × 3 cavities, sheet 119 × 68.5 | 30 cavities, 8151.5 cm² |
| Selected layout | Equal cavity counts; smaller sheet area wins | Original orientation |
| Sheet weight | 8139.5 × 0.4 × 1.40 / 10000 | 0.455812 kg |
| Material cost per sheet | 0.455812 × 6.7 | 3.0539404 yuan |
| Processing cost per sheet | Base 1.00 + 26–36-cavity surcharge 0.40 | 1.40 yuan |
| Continuous chargeable sheets | 10000 / 30 | 333.333333… sheets |
| Small-order fee | Continuous count below 500 sheets | 500 yuan per order |
| Unrounded untaxed total | (3.0539404 + 1.40) × (10000 / 30) + 500 | 1984.6468 yuan |
| Unrounded untaxed unit | 1984.6468 / 10000 | 0.19846468 yuan |
| Unrounded tax-inclusive unit | 0.19846468 × public multiplier 1.08 | 0.2143418544 yuan |

The charge uses continuous sheets. `productionSheets` is 334, but that whole-sheet value is for production planning and is not substituted into the pricing formula. There is no extra defect rate, margin, or pass-through fee in this fixture.

The two prices are calculated independently from unrounded costs, then each unit price is rounded **up** to four decimal places: 0.1985 untaxed and 0.2144 with the public 1.08 multiplier. Each rounded unit is multiplied by 10000 and the resulting total is rounded to cents, giving 1985.00 and 2144.00. The calculation does not derive one quoted unit from the already rounded other unit.

The same result values are asserted in `rules.test.cjs` through a direct `quote()` module call and in `web-server.test.cjs` through the HTTP endpoint (`untaxedUnitPrice` 0.1985, `referenceUnitPrice` 0.2144). The `rules.test.cjs` assertions do not invoke the `quote.cjs` command-line entry point.

## Check 2: 触感PET and 镀金PET processing base

From `skills/xisu-quotation/assets/parameters.reference.json`:

```json
{
  "material": "触感PET",
  "color": "黑色",
  "price_per_kg": 11,
  "density_g_cm3": 1.4,
  "processing_base_per_sheet": 1.5
}
```

```json
{
  "material": "触感PET",
  "color": "彩色",
  "price_per_kg": 12.5,
  "density_g_cm3": 1.4,
  "processing_base_per_sheet": 1.5
}
```

```json
{
  "material": "镀金PET",
  "color": "彩色",
  "price_per_kg": 9,
  "density_g_cm3": 1.4,
  "processing_base_per_sheet": 1.5
}
```

All three reference rows are **1.5** (1.50 yuan per sheet).

`quote.cjs` does not special-case these names with a 1.50 constant. It takes the matching material row and reads `entry.processing_base_per_sheet`, falling back through `??` to `config.default_processing_per_sheet` when the field is absent or null. That number is passed through as `processingPerSheet`. The tray engine uses it as the sheet base; cavity surcharges come from `processing_tiers` as a difference, so the quoted base moves when the row changes. A valid zero is not a nullish value and must not trigger this fallback.

The one-cavity fixture clones the reference configuration **in memory** and uses `machineForColumns(1)` to set its machine maximum dimensions to 15 × 15 cm. Its order is a 10 × 10 × 1 cm rectangle, female mold, quantity 100 and measured thickness 0.5 mm. The original 126 × 76 cm reference machine is not edited. Running that same order on the unmodified reference machine would produce 66 cavities and a processing fee of 2.60 (base 1.50 plus surcharge 1.10), so the fixture's machine override is necessary to isolate the base fee.

With this one-cavity fixture, the reference material row returns base and sheet processing **1.5** for each of the three rows. Editing the cloned material row to 2.25, while setting its `default_processing_per_sheet` to 9.9, returns **2.25**. Deleting the cloned row field and setting its default to 3.3 returns **3.3**. The reference file's own default is also 1.5, so the edited-row and deleted-field cases are needed to distinguish the material row from both the fallback and a hardcoded 1.50. These test-only parameter changes never write the reference file or a factory configuration.

The original PR #3 assertions cover the file value, the unchanged one-cavity quote, the edited-row quote with a deliberately different default, and the missing-field fallback for all three rows.

## Independent review — 2026-11-06

### Branches and duplicate-PR decision

The live `main` checked before consolidation was still `3a737e5e6b5ac9d80bf89b0f1863277e5ad3ca3d`. The relevant snapshots were:

| Snapshot | Changed files relative to that baseline | Coverage |
|---|---|---|
| [PR #2](https://github.com/betty886/xisu-quotation/pull/2), `41ab34286ba8ccef02f6488763234aa6f5e2c1a7` | 14 added lines in `rules.test.cjs` | Three reference rows at 1.50; one-cavity fee; material-row override to 2.25 |
| [PR #3](https://github.com/betty886/xisu-quotation/pull/3), original head `34c1c579e4ec8fe14329b23637a6bb154b6210c0` | `rules.test.cjs` and this report; originally 180 additions and 1 deletion in total | All PR #2 cases, plus separate base/total assertions, explicit one-cavity check, row 2.25 taking precedence over default 9.9, and absent-row-field fallback to default 3.3 |

The baseline already tested fixed processing fees and cavity tiers for 触感PET 黑色 and 镀金PET 彩色, along with the white PET regression. It did not contain the equivalent three-row edited-fee and fallback assertions added by these PRs. No later `main` commit had made those assertions redundant at the time of review.

The two PRs modify the same end of `rules.test.cjs`. A local `git merge-tree` simulation confirmed a content conflict there if both branches are combined. Even a manual conflict resolution that retains both blocks would repeat the same three reference/override cases. PR #3 subsumes PR #2's useful coverage and is the consolidation target; retain one set of tests and close PR #2 as superseded after the retained change is verified and handled through the repository's normal permissions and review rules.

Neither original PR changes `quote.cjs`, `tray-engine.cjs`, the reference parameter file, or the factory's operating configuration. Review corrections are restricted to tests and this report.

### Independently verified findings

- Direct execution of the fetched `quote.cjs` / `tray-engine.cjs` at the original PR #3 head reproduced the white PET values above. Separate arithmetic reproduced the same unrounded values and rounding sequence.
- The transparent PET sample also reproduced 0.1305 untaxed, 0.1410 with the public reference tax multiplier, and a tax-inclusive total of 33840.
- The one-cavity machine override, public tax multiplier 1.08, zero margin defaults, continuous-sheet pricing and unconditional successful `pending_review` status were checked against source.
- The locked Playwright packages require Node.js **20 or newer**; the original report's Node.js 18 instruction was incorrect.
- The original PR's historical pass logs alone do not establish the outcome of the current verification run.

### Retained test coverage after consolidation

The revised `rules.test.cjs` keeps a single three-material test family from PR #3 and adds the following boundary checks within that family. The original PR #2 block is not copied alongside it.

| Scenario | Expected behavior |
|---|---|
| Reference rows, one cavity | All three retain base and sheet processing fee 1.50 |
| Edited row 2.25, alternate default 9.9, one cavity | Material row takes precedence; base and total are 2.25 |
| Edited row 2.25, alternate default 9.9, 26 cavities | Configured base remains 2.25; cavity increment is 0.40; total processing fee is 2.65 |
| Material fee field deleted or explicitly null, default 3.3 | Both nullish cases fall back to 3.3 |
| Valid material fee 0, alternate default 9.9 | Zero remains zero; it does not trigger fallback |
| Isolated cloned tax fixture at 1.1 | The supplied multiplier drives tax calculation, including when the selected display is untaxed; unrounded costs and the untaxed quote are unchanged |
| Original public profile after the synthetic tax check | The original multiplier remains 1.08 and re-quoting it reproduces the original result exactly |

The zero/null cases protect the `??` behavior from an accidental change to a truthiness-based fallback. The 26-cavity case verifies that changing the material base still composes correctly with the existing cavity surcharge. The tax fixture checks configuration isolation without publishing a price for that fixture or altering the public or private configuration files.

### Current execution record

Actual environment: Node.js **v24.22.1**, npm **11.9.0**, and the repository's locked `@playwright/test` **1.64.1**. `npm ci --no-audit --no-fund` completed successfully without changing `package.json` or `package-lock.json`.

| Check | Actual outcome |
|---|---|
| Unmodified `main`: `quote.test.cjs`, `flock-weight.test.cjs`, `rules.test.cjs`, `web-server.test.cjs` | All four passed, exit 0 |
| Original PR #2 and original PR #3: `rules.test.cjs` | Both passed, exit 0 |
| Retained PR #3 after the additional checks above: the same four non-browser scripts | All four passed, each exit 0 |
| Unmodified `main`: full `npm test` entry point | First four scripts passed; `web-ui.test.cjs` could not launch its browser; the second UI script was not reached |
| `git diff --check` | Passed |
| Production code and parameter comparison with baseline `main` | Unchanged; only this report and `rules.test.cjs` differ |

The four non-browser scripts were run directly as follows on the retained revision:

```bash
node skills/xisu-quotation/scripts/quote.test.cjs
node skills/xisu-quotation/scripts/flock-weight.test.cjs
node skills/xisu-quotation/scripts/rules.test.cjs
node skills/xisu-quotation/scripts/web-server.test.cjs
```

**UI verification limitation:** both `npx playwright install chromium` and its `--only-shell` variant failed to install the expected Chromium 156.0.8078.4 / build 1248. In this environment the official download URL returned a small HTML "Site Unavailable" page instead of a ZIP, and no suitable browser was already installed. The full-suite attempt in the untouched `main` worktree therefore stopped at browser launch with a missing-executable error. It was bounded by `timeout 20s`; the existing UI script leaves its HTTP server running when browser launch fails before its cleanup block, so the process was cleaned up with exit **124**. This is neither a passing full-suite run nor an observed quotation-assertion failure.

The two UI scripts are **not independently revalidated in this review**. Their source and all application code are unchanged. The 2026-11-04 UI PASS output above remains a historical claim from the original PR, not a current verified result. Re-run `npm test` in an environment with the locked browser installed to obtain a current full-suite result. This limitation is recorded rather than changing dependencies, skipping tests in the project entry point, or claiming that unavailable checks passed.

### Targeted regression-sensitivity check

A separate in-memory experiment ran the four versions of `rules.test.cjs` against fresh copies of the same production source and reference configuration. All four passed the unmodified source. Each deliberately introduced source mutation below was then evaluated without writing production files or changing any branch. This checks whether the assertions detect the intended regression; it is limited to the rules script, not the complete `npm test` suite.

| Deliberately introduced regression | Baseline main | PR #2 | Original PR #3 | Retained tests |
|---|---|---|---|---|
| Special-material base forced to 1.50 | Missed | Caught | Caught | Caught |
| Missing-field fallback forced to 1.50 | Missed | Missed | Caught | Caught |
| Valid zero incorrectly falls back (`??` changed to `\|\|`) | Missed | Missed | Missed | Caught |
| Explicit null incorrectly bypasses fallback | Missed | Missed | Missed | Caught by error on the required successful quote |
| Configured special-material base ignored above one cavity | Missed | Missed | Missed | Caught |
| Supplied tax multiplier ignored in favor of constant 1.08 | Missed | Missed | Missed | Caught |

The experiment exited 0 after checking that the retained suite rejected all six deliberate mutations. It confirms the added coverage addresses distinct omissions rather than repeating the original single-cavity assertions.

## How to re-run

From the repository root, with Node.js **20 or newer**, as required by the Playwright 1.64.1 packages in `package-lock.json`:

```bash
npm ci
npx playwright install chromium
npm test
```

`npm test` is the full suite, including the Playwright UI scripts. Those scripts call `chromium.launch` themselves; `npx playwright test` is not the project entry point.

To reprint the white PET case without the rest of the suite, call the exported module from Node:

```bash
node -e 'const {quote}=require("./skills/xisu-quotation/scripts/quote.cjs"); const config=require("./skills/xisu-quotation/assets/parameters.reference.json"); const r=quote({shape:"rectangle",length_cm:17.5,width_cm:7.5,height_cm:4,mold_type:"male",material:"PET",color:"白色",quantity:10000,measured_thickness_mm:0.4,tax_included:true}, config); console.log(r.untaxed_unit, r.taxed_unit);'
```

Expected print with the unchanged **public reference configuration and its 1.08 multiplier**: `0.1985 0.2144`. This is not a factory quotation. The file-input CLI is a separate entry point: `node skills/xisu-quotation/scripts/quote.cjs ORDER.json [PARAMETERS.json]`.
