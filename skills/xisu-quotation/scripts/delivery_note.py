#!/usr/bin/env python3
"""Fill a delivery-note workbook and export PDF.

Copies the chosen template, writes the shipment fields, and can convert to PDF.
Sample output uses the anonymized template. Official output uses a template
path supplied by the caller and does not add sample document titles.
The script does not stamp, sign, or send the file.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

from openpyxl import load_workbook

DIGITS = "零壹贰叁肆伍陆柒捌玖"
TEMPLATE_NAME = "delivery-note-anonymized.xlsx"
DEFAULT_SUPPLIER = {
    "name": "示例塑料制品有限公司",
    "address": "示例市示例路00号",
    "phone": "000-0000-0000",
}
DATE_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")
INTERNAL_KEYS = {
    "material_price", "price_per_kg", "density", "density_g_cm3", "margin",
    "cost", "processing", "processing_fee", "gross_margin", "materialPrice",
}


def _four(number: int) -> str:
    units = ["", "拾", "佰", "仟"]
    out: list[str] = []
    zero = False
    for index in range(4):
        digit = number % 10
        if digit == 0:
            if out and not zero:
                zero = True
        else:
            if zero:
                out.append("零")
                zero = False
            out.append(DIGITS[digit] + units[index])
        number //= 10
    return "".join(reversed(out))


def integer_cn(number: int) -> str:
    if number == 0:
        return "零"
    groups = []
    while number:
        groups.append(number % 10000)
        number //= 10000
    big = ["", "万", "亿", "兆"]
    parts: list[str] = []
    for index in range(len(groups) - 1, -1, -1):
        group = groups[index]
        if group == 0:
            continue
        if parts and group < 1000:
            parts.append("零")
        parts.append(_four(group) + big[index])
    text = "".join(parts)
    while "零零" in text:
        text = text.replace("零零", "零")
    return text


def rmb_label(amount) -> str:
    value = Decimal(str(amount)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    if value < 0:
        raise ValueError("合计不能为负数。")
    cents_total = int((value * 100).to_integral_value(rounding=ROUND_HALF_UP))
    integer, cents = divmod(cents_total, 100)
    jiao, fen = divmod(cents, 10)
    if integer == 0 and cents == 0:
        body = "零元整"
    else:
        body = integer_cn(integer) + "元" if integer else ""
        if jiao == 0 and fen == 0:
            body += "整"
        else:
            if integer and jiao == 0 and fen:
                body += "零"
            if jiao:
                body += DIGITS[jiao] + "角"
            if fen:
                body += DIGITS[fen] + "分"
    return "人民币（大写）：" + body


def money(value) -> Decimal:
    return Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def price_decimal(value) -> Decimal:
    text = str(value).strip()
    if not re.fullmatch(r"\d+(?:\.\d+)?", text):
        raise ValueError("单价须为有效正数。")
    amount = Decimal(text)
    if amount <= 0:
        raise ValueError("单价须为有效正数。")
    return amount


def price_format(amount: Decimal) -> str:
    text = format(amount, "f")
    fraction = text.split(".", 1)[1] if "." in text else ""
    places = max(2, len(fraction.rstrip("0")))
    return "0." + ("0" * places)


def label(prefix: str, value) -> str:
    text = "" if value is None else str(value).strip()
    return prefix if not text else prefix + text


def valid_date(value: str) -> str:
    match = DATE_RE.fullmatch(str(value or "").strip())
    if not match:
        raise ValueError("送货日期须为 YYYY-MM-DD。")
    year, month, day = (int(part) for part in match.groups())
    try:
        from datetime import date
        date(year, month, day)
    except ValueError as error:
        raise ValueError("送货日期不是有效日期。") from error
    return f"{year:04d}-{month:02d}-{day:02d}"


def blank(value) -> bool:
    return value is None or (isinstance(value, str) and value.strip() == "")


def checked_payload(raw: dict, profile: str = "anonymized") -> dict:
    if not isinstance(raw, dict):
        raise ValueError("送货单数据须为对象。")
    leaked = sorted(set(raw) & INTERNAL_KEYS)
    if leaked:
        raise ValueError("客户送货单不能包含内部价格或成本字段。")
    lines = raw.get("lines")
    if not isinstance(lines, list) or not lines:
        raise ValueError("送货单至少要有一行本次出货。")
    if len(lines) > 5:
        raise ValueError("送货单数据行最多 5 行产品加 1 行模具费。")
    clean_lines = []
    for line in lines:
        if not isinstance(line, dict):
            raise ValueError("出货行格式无效。")
        leaked = sorted(set(line) & INTERNAL_KEYS)
        if leaked:
            raise ValueError("客户送货单不能包含内部价格或成本字段。")
        quantity = line.get("quantity")
        if isinstance(quantity, bool) or not isinstance(quantity, int) or quantity <= 0:
            raise ValueError("本次出货数量须为正整数。")
        clean_lines.append({
            "name": "" if line.get("name") is None else str(line.get("name")).strip(),
            "spec": "" if line.get("spec") is None else str(line.get("spec")).strip(),
            "pieces": "" if line.get("pieces") in (None, "") else line.get("pieces"),
            "quantity": quantity,
            "unit_price": price_decimal(line.get("unit_price")),
            "note": "" if line.get("note") is None else str(line.get("note")).strip(),
        })
    mold = raw.get("mold_fee", None)
    if mold in (None, "", 0, "0"):
        mold_fee = None
    else:
        mold_fee = money(mold)
        if mold_fee <= 0:
            raise ValueError("模具费须为正数；没有模具费时留空。")
    official = profile == "official"
    supplier_name = raw.get("supplier_name")
    supplier_address = raw.get("supplier_address")
    supplier_phone = raw.get("supplier_phone")
    if not official:
        supplier_name = str(supplier_name or DEFAULT_SUPPLIER["name"]).strip()
        supplier_address = str(supplier_address or DEFAULT_SUPPLIER["address"]).strip()
        supplier_phone = str(supplier_phone or DEFAULT_SUPPLIER["phone"]).strip()
    else:
        supplier_name = None if blank(supplier_name) else str(supplier_name).strip()
        supplier_address = None if blank(supplier_address) else str(supplier_address).strip()
        supplier_phone = None if blank(supplier_phone) else str(supplier_phone).strip()
    address_line = None
    if supplier_address is not None or supplier_phone is not None or not official:
        address_line = f"地址：{supplier_address or ''}    电话：{supplier_phone or ''}"
    return {
        "profile": profile,
        "supplier_name": supplier_name,
        "address_line": address_line,
        "customer_name": label("客户名称：", raw.get("customer_name")),
        "customer_phone": label("客户电话：", raw.get("customer_phone")),
        "customer_address": label("客户地址：", raw.get("customer_address")),
        "contact": label("联系人：", raw.get("contact")),
        "order_no": label("单号：", raw.get("order_no")),
        "ship_date": "送货日期：" + valid_date(raw.get("ship_date")),
        "lines": clean_lines,
        "mold_fee": mold_fee,
    }


def line_total(quantity: int, unit_price: Decimal) -> Decimal:
    return (Decimal(quantity) * unit_price).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def expected_total(payload: dict) -> Decimal:
    total = sum((line_total(line["quantity"], line["unit_price"]) for line in payload["lines"]), Decimal("0.00"))
    if payload["mold_fee"] is not None:
        total += payload["mold_fee"]
    return total.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def clear_row(ws, row: int) -> None:
    for column in ("A", "C", "K", "O", "R", "V", "Z", "AD"):
        ws[f"{column}{row}"].value = None


def apply_properties(wb, profile: str) -> None:
    if profile == "official":
        wb.properties.title = "送货单"
        wb.properties.creator = ""
        wb.properties.lastModifiedBy = ""
        wb.properties.subject = ""
        wb.properties.description = ""
        wb.properties.keywords = ""
        return
    wb.properties.title = "示例送货单"
    wb.properties.creator = "示例"
    wb.properties.lastModifiedBy = "示例"
    wb.properties.subject = "虚构送货单"
    wb.properties.description = "Fictional delivery note. No seal."
    wb.properties.keywords = ""


def write_workbook(template: Path, payload: dict, target: Path) -> Decimal:
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(template, target)
    wb = load_workbook(target)
    if [ws.title for ws in wb.worksheets] != ["送货单"]:
        raise ValueError("范本工作表不符合送货单版式。")
    ws = wb.active
    if ws.sheet_state != "visible":
        raise ValueError("范本工作表不是可见表。")
    if payload["supplier_name"] is not None:
        ws["A1"] = payload["supplier_name"]
    ws["X1"] = "送  货  单"
    if payload["address_line"] is not None:
        ws["A2"] = payload["address_line"]
    ws["A4"] = payload["customer_name"]
    ws["N4"] = payload["customer_phone"]
    ws["X4"] = payload["order_no"]
    ws["A5"] = payload["customer_address"]
    ws["N5"] = payload["contact"]
    ws["X5"] = payload["ship_date"]
    for row in range(8, 14):
        clear_row(ws, row)
    for index, line in enumerate(payload["lines"]):
        row = 8 + index
        ws[f"A{row}"] = index + 1
        ws[f"C{row}"] = line["name"] or None
        ws[f"K{row}"] = line["spec"] or None
        ws[f"O{row}"] = line["pieces"] or None
        ws[f"R{row}"] = line["quantity"]
        ws[f"R{row}"].number_format = "0\\个"
        ws[f"V{row}"] = float(line["unit_price"])
        ws[f"V{row}"].number_format = price_format(line["unit_price"])
        ws[f"Z{row}"] = f"=ROUND(R{row}*V{row},2)"
        ws[f"Z{row}"].number_format = "#,##0.00"
        ws[f"AD{row}"] = line["note"] or None
    mold_row = 8 + len(payload["lines"])
    ws[f"A{mold_row}"] = len(payload["lines"]) + 1
    ws[f"C{mold_row}"] = "模具费"
    if payload["mold_fee"] is None:
        ws[f"Z{mold_row}"] = None
    else:
        ws[f"Z{mold_row}"] = float(payload["mold_fee"])
        ws[f"Z{mold_row}"].number_format = "#,##0.00"
    if ws["Z14"].value != "=SUM(Z8:Z13)":
        ws["Z14"] = "=SUM(Z8:Z13)"
    total = expected_total(payload)
    ws["A15"] = rmb_label(total)
    ws["A17"] = "送货单位/经手人（盖章/签字）："
    ws["R17"] = "收货单位/经手人（盖章/签字）："
    ws.page_setup.orientation = "landscape"
    ws.page_setup.paperSize = 9
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 1
    ws.page_setup.scale = 100
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.print_options.horizontalCentered = True
    ws.print_options.verticalCentered = True
    ws.print_area = "A1:AH20"
    ws.page_margins.left = 0.3
    ws.page_margins.right = 0.3
    ws.page_margins.top = 0.3
    ws.page_margins.bottom = 0.3
    ws.page_margins.header = 0.511811023622047
    ws.page_margins.footer = 0.511811023622047
    apply_properties(wb, payload.get("profile") or "anonymized")
    if getattr(ws, "_images", None):
        raise ValueError("送货单不能包含图片或印章。")
    wb.save(target)
    return total


def convert_pdf(xlsx_path: Path, pdf_path: Path) -> None:
    pdf_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="lo-delivery-") as profile:
        command = [
            "soffice", "--headless", "--norestore", "--nolockcheck",
            f"-env:UserInstallation=file://{profile}",
            "--convert-to", "pdf", "--outdir", str(pdf_path.parent), str(xlsx_path),
        ]
        completed = subprocess.run(command, check=False, capture_output=True, text=True)
        if completed.returncode != 0:
            raise RuntimeError(completed.stderr.strip() or "LibreOffice 转换 PDF 失败。")
        produced = pdf_path.parent / (xlsx_path.stem + ".pdf")
        if produced != pdf_path:
            produced.replace(pdf_path)


def inspect_workbook(path: Path) -> dict:
    wb = load_workbook(path)
    ws = wb.active
    with zipfile.ZipFile(path) as archive:
        sheet = archive.read("xl/worksheets/sheet1.xml").decode("utf-8")
        book = archive.read("xl/workbook.xml").decode("utf-8")
    return {
        "sheets": [[item.title, item.sheet_state] for item in wb.worksheets],
        "merges": len(list(ws.merged_cells.ranges)),
        "images": len(getattr(ws, "_images", []) or []),
        "A1": ws["A1"].value,
        "A4": ws["A4"].value,
        "X4": ws["X4"].value,
        "X5": ws["X5"].value,
        "C8": ws["C8"].value,
        "R8": ws["R8"].value,
        "V8": ws["V8"].value,
        "Z8": ws["Z8"].value,
        "C9": ws["C9"].value,
        "Z9": ws["Z9"].value,
        "C10": ws["C10"].value,
        "Z14": ws["Z14"].value,
        "A15": ws["A15"].value,
        "A17": ws["A17"].value,
        "R17": ws["R17"].value,
        "font": ws["A1"].font.name,
        "quantity_format": ws["R8"].number_format,
        "print_area": ws.print_area,
        "orientation": ws.page_setup.orientation,
        "paper": ws.page_setup.paperSize,
        "fit_to_page": bool(ws.sheet_properties.pageSetUpPr.fitToPage),
        "fit_width": ws.page_setup.fitToWidth,
        "fit_height": ws.page_setup.fitToHeight,
        "centered": [ws.print_options.horizontalCentered, ws.print_options.verticalCentered],
        "xml_fit": "fitToPage=\"1\"" in sheet,
        "xml_landscape": "orientation=\"landscape\"" in sheet and "paperSize=\"9\"" in sheet,
        "xml_cols": 'width="4.1"' in sheet and 'min="1"' in sheet and 'max="34"' in sheet,
        "xml_print_area": "送货单" in book and "$A$1:$AH$20" in book,
        "defined_names": sorted(wb.defined_names.keys()),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="填写送货单可变字段并导出 PDF")
    parser.add_argument("--profile", choices=["anonymized", "official"], default="anonymized")
    parser.add_argument("--template")
    parser.add_argument("--input")
    parser.add_argument("--xlsx")
    parser.add_argument("--pdf")
    parser.add_argument("--uppercase")
    parser.add_argument("--inspect")
    args = parser.parse_args()
    if args.uppercase is not None:
        print(rmb_label(args.uppercase))
        return 0
    if args.inspect:
        json.dump(inspect_workbook(Path(args.inspect)), sys.stdout, ensure_ascii=False)
        print()
        return 0
    payload = checked_payload(json.loads(Path(args.input).read_text(encoding="utf-8")), args.profile)
    total = write_workbook(Path(args.template), payload, Path(args.xlsx))
    if args.pdf:
        convert_pdf(Path(args.xlsx), Path(args.pdf))
    json.dump({"total": format(total, "f"), "uppercase": rmb_label(total)}, sys.stdout, ensure_ascii=False)
    print()
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001 - CLI boundary
        print(json.dumps({"error": str(error)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(2) from error
