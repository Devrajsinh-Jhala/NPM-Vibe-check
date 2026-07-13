from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "site" / "assets"
GIF_PATH = ASSETS / "npx-vibe-mcp-demo.gif"
POSTER_PATH = ASSETS / "npx-vibe-mcp-demo-poster.png"

WIDTH = 1200
HEIGHT = 675

FONT_UI = [
    "C:/Windows/Fonts/segoeui.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]
FONT_UI_BOLD = [
    "C:/Windows/Fonts/segoeuib.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]
FONT_MONO = [
    "C:/Windows/Fonts/consola.ttf",
    "/System/Library/Fonts/Menlo.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
]


def font(paths, size):
    for path in paths:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default(size=size)


UI_16 = font(FONT_UI, 16)
UI_18 = font(FONT_UI, 18)
UI_20 = font(FONT_UI, 20)
UI_20_BOLD = font(FONT_UI_BOLD, 20)
UI_24_BOLD = font(FONT_UI_BOLD, 24)
UI_29_BOLD = font(FONT_UI_BOLD, 29)
MONO_16 = font(FONT_MONO, 16)
MONO_18 = font(FONT_MONO, 18)


def base_frame():
    image = Image.new("RGB", (WIDTH, HEIGHT), "#edf3f1")
    draw = ImageDraw.Draw(image)

    draw.ellipse((850, -200, 1320, 270), fill="#d8eee7")
    draw.ellipse((-160, 470, 270, 900), fill="#e2ebef")
    draw.rounded_rectangle((34, 28, 1166, 647), radius=28, fill="#ffffff", outline="#cfdbd7", width=2)

    draw.rounded_rectangle((62, 52, 108, 98), radius=13, fill="#0d1721")
    draw.text((73, 62), "nv", font=UI_20_BOLD, fill="#ffffff")
    draw.text((124, 59), "npx-vibe", font=UI_29_BOLD, fill="#0d1721")
    draw.ellipse((909, 70, 921, 82), fill="#2fbd8f")
    draw.text((934, 64), "MCP SERVER", font=UI_18, fill="#61737d")

    draw.rounded_rectangle((62, 120, 1138, 610), radius=22, fill="#0d1721")
    draw.line((62, 175, 1138, 175), fill="#263642", width=2)
    draw.ellipse((84, 140, 96, 152), fill="#f17682")
    draw.ellipse((104, 140, 116, 152), fill="#f1b23d")
    draw.ellipse((124, 140, 136, 152), fill="#35c694")
    draw.text((154, 133), "MCP client  <->  npx-vibe", font=UI_18, fill="#9aacb5")
    draw.text((1022, 133), "stdio", font=UI_18, fill="#82949f")

    return image


def pill(draw, xy, text, active=False):
    fill = "#16312d" if active else "#17242e"
    outline = "#2f8f75" if active else "#2c3b46"
    color = "#6fe0b7" if active else "#8b9ba5"
    draw.rounded_rectangle(xy, radius=10, fill=fill, outline=outline, width=2)
    draw.text((xy[0] + 14, xy[1] + 9), text, font=MONO_16, fill=color)


def draw_request(draw, stage):
    draw.text((88, 202), "MCP CLIENT", font=UI_16, fill="#6fdab7")
    events = [
        ("01", "initialize", "Protocol 2025-11-25 negotiated"),
        ("02", "tools/list", "3 read-only tools discovered"),
        ("03", "scan_package", '{ "package": "esbuild" }'),
    ]
    for index, (number, label, detail) in enumerate(events):
        y = 235 + index * 78
        active = stage > index
        draw.rounded_rectangle((88, y, 126, y + 38), radius=10, fill="#16302d" if active else "#17242e")
        draw.text((97, y + 7), number, font=MONO_16, fill="#55d4aa" if active else "#576872")
        draw.text((145, y), label, font=UI_20_BOLD, fill="#eef5f6" if active else "#768792")
        draw.text((145, y + 29), detail, font=UI_16, fill="#9cacb5" if active else "#53636e")

    pill(draw, (88, 492, 248, 532), "scan_package", stage >= 2)
    pill(draw, (258, 492, 414, 532), "scan_project", stage >= 2)
    pill(draw, (424, 492, 552, 532), "list_models", stage >= 2)
    draw.text((88, 555), "No package code executed", font=UI_18, fill="#78d6b8" if stage >= 3 else "#53636e")


def draw_result(draw, visible_lines, show_gate):
    draw.rounded_rectangle((600, 202, 1112, 557), radius=17, fill="#111e29", outline="#2a3b47", width=2)
    draw.text((624, 223), "STRUCTURED RESULT", font=UI_16, fill="#70d7b5")
    lines = [
        ('{', "#d8e2e8"),
        ('  "schemaVersion": 1,', "#d8e2e8"),
        ('  "status": "complete",', "#d8e2e8"),
        ('  "decision": {', "#d8e2e8"),
        ('    "verdict": "caution",', "#f4bd50"),
        ('    "riskScore": 43,', "#f4bd50"),
        ('    "action": "review",', "#f4bd50"),
        ('    "mayContinue": false', "#f4bd50"),
        ('  }', "#d8e2e8"),
        ('}', "#d8e2e8"),
    ]
    for index, (line, color) in enumerate(lines[:visible_lines]):
        draw.text((624, 260 + index * 25), line, font=MONO_18, fill=color)

    if show_gate:
        draw.rounded_rectangle((600, 574, 1112, 600), radius=8, fill="#392d16")
        draw.ellipse((618, 581, 630, 593), fill="#f0b63f")
        draw.text((644, 577), "Human approval required before execution", font=UI_16, fill="#fff0c9")


def make_frame(stage, visible_lines, show_gate):
    image = base_frame()
    draw = ImageDraw.Draw(image)
    draw_request(draw, stage)
    draw_result(draw, visible_lines, show_gate)
    return image


def main():
    ASSETS.mkdir(parents=True, exist_ok=True)
    states = [
        (0, 0, False, 600),
        (1, 2, False, 700),
        (2, 3, False, 700),
        (3, 5, False, 800),
        (3, 8, False, 650),
        (3, 10, True, 2400),
    ]
    frames = [make_frame(*state[:3]) for state in states]
    durations = [state[3] for state in states]

    frames[-1].save(POSTER_PATH, optimize=True)
    frames[0].save(
        GIF_PATH,
        save_all=True,
        append_images=frames[1:],
        duration=durations,
        loop=0,
        disposal=2,
        optimize=True,
    )
    print(f"Created {GIF_PATH.relative_to(ROOT)}")
    print(f"Created {POSTER_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
