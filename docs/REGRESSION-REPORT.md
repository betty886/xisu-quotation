# Quote calculator regression report

Date: 2026-11-04

Baseline: `main` at `3a737e5e6b5ac9d80bf89b0f1863277e5ad3ca3d` (`Internal web quote calculator (#1)`), confirmed equal to `origin/main`.

Runtime: Node.js v22.23.4, npm 10.9.9, `@playwright/test` 1.64.1, Chromium for Testing 156.0.8078.4 (Playwright Chromium build 1248).

Failures: none. Both the unmodified baseline suite and the suite after the config-read assertions exited 0.

## Suite results

`npm test` runs six Node scripts in order. The last two launch headless Chromium through Playwright (`web-ui.test.cjs`, `flock-fixed-ui.test.cjs`) at desktop 1365×900 and mobile 390×844. There is no separate `playwright test` project.

### Baseline on unmodified `main`

Exit code 0.

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

### After the processing-fee config assertion

The only suite change is in `skills/xisu-quotation/scripts/rules.test.cjs`: 触感PET（黑色、彩色）and 镀金PET（彩色）must quote `processing_base_per_sheet` from the loaded parameter object. Re-running `npm test` exited 0. The rules line is the only output that changed.

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

Covered by those scripts:

| Script | What it checks |
|---|---|
| `quote.test.cjs` | Sample PET transparent order (untaxed 0.1305 / tax-inclusive 0.1410), flock reference parameters, cloth layout, height estimate, weight, invalid input |
| `flock-weight.test.cjs` | Fixed flock price and density, finished vs substrate weight, custom config, offline CLI |
| `rules.test.cjs` | Tax factor, processing tiers, layout, small-order fees, rounding, height estimate, flock, invalid input, white PET regression, 触感/镀金 base fee read from config |
| `web-server.test.cjs` | Local HTTP quote API, including the same white PET prices, catalog size 28, auth and custom config |
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

Direct `quote()` result:

| Result | Value | Expected |
|---|---|---|
| Untaxed unit | **0.1985** | 0.1985 |
| Tax-inclusive unit | **0.2144** | 0.2144 |
| Untaxed total | 1985 | 0.1985 × 10000 |
| Tax-inclusive total | 2144 | 0.2144 × 10000 |

Match: yes.

Supporting layout from the same call: status `pending_review` with `review_label` null (mold and measured thickness were supplied; successful reference quotes stay `pending_review` because the parameter file is a reference profile), 30 cavities, 原方向, sheet 111.5 × 73 cm, material 6.7 yuan/kg, density 1.40, sheet processing 1.40 (PET 白色 base 1.00 + 30-cavity surcharge 0.40), small-order fee 500.

The same numbers are asserted in `rules.test.cjs` (CLI `quote()`) and `web-server.test.cjs` (`untaxedUnitPrice` 0.1985, `referenceUnitPrice` 0.2144).

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

All three rows are **1.5** (1.50 yuan per sheet). File lines: 触感PET 黑色 186–193, 触感PET 彩色 194–202, 镀金PET 彩色 203–211.

`quote.cjs` does not special-case these names with a 1.50 constant. It takes the matching material row and reads `entry.processing_base_per_sheet`, falling back to `config.default_processing_per_sheet` only when that field is missing. That number is passed through as `processingPerSheet`. The tray engine uses it as the sheet base; cavity surcharges come from `processing_tiers` as a difference, so the quoted base moves when the row changes.

A one-cavity quote against the reference file returns base and sheet processing **1.5** for each of the three rows. Editing only that row to 2.25, while setting `default_processing_per_sheet` to 9.9, returns **2.25**. Deleting the row field and setting `default_processing_per_sheet` to 3.3 returns **3.3**. The reference file’s own default is also 1.5 (`default_processing_per_sheet` at the end of the same JSON), so a missing field would still print 1.50; the edited-row and deleted-field cases separate the material row from that fallback and from a hardcoded 1.50.

`rules.test.cjs` now asserts the file value, the unchanged quote, the edited-row quote, and the missing-field fallback for all three rows.

## Failures

None. No assertion failed, and no Playwright page failed.

## How to re-run

From the repository root, with Node.js 18 or newer:

```bash
npm ci
npx playwright install chromium
npm test
```

`npm test` is the full suite, including the Playwright UI scripts. Those scripts call `chromium.launch` themselves; `npx playwright test` is not the project entry point.

To reprint the white PET case without the rest of the suite:

```bash
node -e 'const {quote}=require("./skills/xisu-quotation/scripts/quote.cjs"); const config=require("./skills/xisu-quotation/assets/parameters.reference.json"); const r=quote({shape:"rectangle",length_cm:17.5,width_cm:7.5,height_cm:4,mold_type:"male",material:"PET",color:"白色",quantity:10000,measured_thickness_mm:0.4,tax_included:true}, config); console.log(r.untaxed_unit, r.taxed_unit);'
```

Expected print: `0.1985 0.2144`.
