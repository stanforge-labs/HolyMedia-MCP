"""Exact screenshot/DOM comparison; only the two identity rectangles may differ."""
import json
import math
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

root = Path(sys.argv[1])
output = Path(sys.argv[2])
output.mkdir(parents=True, exist_ok=True)


def load(label, key):
    return json.loads((root / label / f"{key}.json").read_text(encoding="utf-8"))


def nonzero(diff):
    r, g, b = diff.convert("RGB").split()
    maximum = ImageChops.lighter(ImageChops.lighter(r, g), b)
    return sum(maximum.histogram()[1:])


def differences(left, right, allowed=(), unchanged_partner=()):
    a = Image.open(left).convert("RGB")
    b = Image.open(right).convert("RGB")
    assert a.size == b.size, f"Image size changed: {left.name}"
    diff = ImageChops.difference(a, b)
    total = nonzero(diff)
    outside = diff.copy()
    draw = ImageDraw.Draw(outside)
    for rectangle in allowed:
        x, y, w, h = [rectangle[k] for k in ("x", "y", "width", "height")]
        draw.rectangle((math.floor(x), math.floor(y), math.ceil(x + w) - 1, math.ceil(y + h) - 1), fill=(0, 0, 0))
    raw_outside = nonzero(outside)
    # The unchanged translucent SVG shows <=2 RGB units of raster noise in
    # calibration; its source, geometry and computed styles must match exactly.
    # No other region gets a tolerance, and raw pixel counts remain in the report.
    noise = 0
    for rectangle in unchanged_partner:
        x, y, w, h = [rectangle[k] for k in ("x", "y", "width", "height")]
        box = (math.floor(x), math.floor(y), math.ceil(x + w), math.ceil(y + h))
        crop = outside.crop(box)
        if max(channel[1] for channel in crop.getextrema()) <= 2:
            noise += nonzero(crop)
            draw.rectangle((box[0], box[1], box[2] - 1, box[3] - 1), fill=(0, 0, 0))
    return {"changed_pixels": total, "outside_brand_raw_pixels": raw_outside, "unchanged_partner_alpha_noise_pixels": noise, "outside_allowed_pixels": nonzero(outside)}


def pair(key, part, filename):
    if part == "footer":
        before = Image.open(root / "baseline" / f"{key}-full.png").convert("RGB")
        after = Image.open(root / "after" / f"{key}-full.png").convert("RGB")
        footer = next(element for element in load("baseline", key)["layout"] if element["tag"] == "FOOTER")
        box = (0, max(0, math.floor(footer["y"]) - 16), before.width, before.height)
        before, after = before.crop(box), after.crop(box)
    else:
        before = Image.open(root / "baseline" / f"{key}-{part}.png").convert("RGB")
        after = Image.open(root / "after" / f"{key}-{part}.png").convert("RGB")
    canvas = Image.new("RGB", (before.width + after.width + 12, max(before.height, after.height) + 36), "#20232b")
    canvas.paste(before, (0, 36))
    canvas.paste(after, (before.width + 12, 36))
    draw = ImageDraw.Draw(canvas)
    draw.text((8, 11), "BEFORE / CURRENT PRODUCTION", fill="white")
    draw.text((before.width + 20, 11), "AFTER / LOCAL PATCH", fill="white")
    canvas.save(output / filename)


report = {"policy": "Exact geometry/DOM and pixels outside .site-brand and .footer__identity. Only the byte-identical, position-identical Astana Hub SVG allows raster noise <=2/255 per RGB channel; raw noise counts are disclosed.", "live_baseline": [], "candidate": []}
live_index = root / "live" / "index.json"
assert live_index.exists() or "--offline" in sys.argv, "Live baseline evidence is required unless CI explicitly runs offline"
for entry in json.loads(live_index.read_text()) if live_index.exists() else []:
    key = entry["key"]
    live, baseline = load("live", key), load("baseline", key)
    for field in ("html", "layout", "links", "buttons", "allowed", "partner", "height", "width"):
        assert live[field] == baseline[field], f"Live baseline mismatch: {key} / {field}"
    result = differences(root / "live" / f"{key}-full.png", root / "baseline" / f"{key}-full.png")
    report["live_baseline"].append({"key": key, **result})
    assert result["changed_pixels"] == 0, f"Live pixel mismatch: {key}: {result}"

for entry in json.loads((root / "baseline" / "index.json").read_text()):
    key = entry["key"]
    baseline, after = load("baseline", key), load("after", key)
    for field in ("html", "layout", "links", "buttons", "allowed", "partner", "height", "width"):
        assert baseline[field] == after[field], f"Outside-brand structural/layout change: {key} / {field}"
    result = differences(root / "baseline" / f"{key}-full.png", root / "after" / f"{key}-full.png", baseline["allowed"], [image for image in baseline["partner"]["images"] if image["display"] != "none"])
    report["candidate"].append({"key": key, **result, "allowed_rectangles": baseline["allowed"]})
    assert result["outside_allowed_pixels"] == 0, f"Outside-brand visual change: {key}: {result}"

for locale in ("ru", "en"):
    for device in ("desktop", "mobile"):
        key = f"{locale}-dark-{device}"
        for part in ("top", "footer", "full"):
            pair(key, part, f"{key}-{part}-before-after.png")
        pair(f"{locale}-light-{device}", "footer", f"{locale}-light-{device}-footer-before-after.png")
        marked = Image.open(root / "after" / f"{key}-full.png").convert("RGB")
        draw = ImageDraw.Draw(marked)
        for r in load("after", key)["allowed"]:
            draw.rectangle((r["x"] - 1, r["y"] - 1, r["x"] + r["width"], r["y"] + r["height"]), outline="#ff3d8b", width=2)
        marked.save(output / f"{key}-allowed-regions.png")

(output / "comparison-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"PASS: {len(report['live_baseline'])} exact live/baseline comparisons; {len(report['candidate'])} brand-only comparisons; 0 outside-brand changes beyond the disclosed unchanged-SVG alpha quantization")
