from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "site" / "assets"
GIF_PATH = ASSETS / "npx-vibe-agent-demo.gif"
POSTER_PATH = ASSETS / "npx-vibe-agent-demo-poster.png"

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
FONT_MONO_BOLD = [
    "C:/Windows/Fonts/consolab.ttf",
    "/System/Library/Fonts/Menlo.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",
]


def font(paths, size):
    for path in paths:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default(size=size)


UI_18 = font(FONT_UI, 18)
UI_20 = font(FONT_UI, 20)
UI_22 = font(FONT_UI, 22)
UI_22_BOLD = font(FONT_UI_BOLD, 22)
UI_28_BOLD = font(FONT_UI_BOLD, 28)
MONO_18 = font(FONT_MONO, 18)
MONO_19 = font(FONT_MONO, 19)
MONO_20_BOLD = font(FONT_MONO_BOLD, 20)


def base_frame():
    image = Image.new("RGB", (WIDTH, HEIGHT), "#edf3f1")
    draw = ImageDraw.Draw(image)

    draw.ellipse((890, -180, 1320, 250), fill="#d9eee7")
    draw.ellipse((-150, 470, 280, 900), fill="#e4ecef")
    draw.rounded_rectangle((34, 28, 1166, 647), radius=28, fill="#ffffff", outline="#cfdbd7", width=2)

    draw.rounded_rectangle((62, 52, 108, 98), radius=13, fill="#0d1721")
    draw.text((73, 62), "nv", font=UI_22_BOLD, fill="#ffffff")
    draw.text((124, 61), "npx-vibe", font=UI_28_BOLD, fill="#0d1721")
    draw.text((944, 65), "AGENT PREFLIGHT", font=UI_18, fill="#61737d")
    draw.ellipse((921, 70, 933, 82), fill="#2fbd8f")

    draw.rounded_rectangle((62, 118, 1138, 617), radius=22, fill="#0d1721")
    draw.line((62, 171, 1138, 171), fill="#263642", width=2)
    draw.ellipse((84, 139, 96, 151), fill="#f17682")
    draw.ellipse((104, 139, 116, 151), fill="#f1b23d")
    draw.ellipse((124, 139, 136, 151), fill="#35c694")
    draw.text((154, 132), "coding agent · package safety gate", font=UI_18, fill="#9aacb5")
    draw.text((1008, 132), "read-only", font=UI_18, fill="#82949f")

    return image


def draw_command(draw, typed):
    draw.text((88, 194), "$", font=MONO_20_BOLD, fill="#43d3a3")
    draw.text((112, 194), typed, font=MONO_19, fill="#eef4f7")
    if len(typed) < len("npx --yes npx-vibe@latest --agent esbuild"):
        x = 112 + draw.textlength(typed, font=MONO_19) + 3
        draw.rectangle((x, 198, x + 9, 222), fill="#8ea0aa")


def draw_step(draw, y, index, label, detail, active=True):
    color = "#37ca99" if active else "#52636e"
    draw.rounded_rectangle((88, y, 126, y + 38), radius=10, fill="#162a2b" if active else "#17232d")
    draw.text((97, y + 7), index, font=MONO_18, fill=color)
    draw.text((145, y + 1), label, font=UI_20, fill="#f3f7f8" if active else "#7e8d97")
    draw.text((145, y + 25), detail, font=UI_18, fill="#9babb5" if active else "#5e6d77")


def draw_json(draw, visible):
    draw.rounded_rectangle((720, 194, 1112, 501), radius=16, fill="#111e29", outline="#2a3b47", width=2)
    draw.text((744, 216), "VERSIONED JSON", font=UI_18, fill="#70d7b5")
    lines = [
        ('{', "#d8e2e8"),
        ('  "schemaVersion": 1,', "#d8e2e8"),
        ('  "kind": "package-scan",', "#d8e2e8"),
        ('  "status": "complete",', "#d8e2e8"),
        ('  "decision": {', "#d8e2e8"),
        ('    "action": "review",', "#f4bd50"),
        ('    "requiresHumanReview": true', "#f4bd50"),
        ('  }', "#d8e2e8"),
        ('}', "#d8e2e8"),
    ]
    for line_index, (line, color) in enumerate(lines[:visible]):
        draw.text((744, 252 + line_index * 25), line, font=MONO_18, fill=color)


def draw_agent_action(draw, action):
    if not action:
        return
    draw.rounded_rectangle((720, 521, 1112, 584), radius=14, fill="#2a2417", outline="#5b4821", width=2)
    draw.ellipse((744, 545, 756, 557), fill="#f0b63f")
    draw.text((770, 535), "Paused before execution", font=UI_20, fill="#fff5dc")
    draw.text((770, 558), "Human review required", font=UI_18, fill="#c7b88f")


def make_frame(command_chars, visible_steps, json_lines, show_action):
    image = base_frame()
    draw = ImageDraw.Draw(image)
    command = "npx --yes npx-vibe@latest --agent esbuild"
    draw_command(draw, command[:command_chars])

    steps = [
        ("RESOLVE", "esbuild@0.28.1 from the npm registry"),
        ("VERIFY", "sha512 integrity metadata matched"),
        ("INSPECT", "3 selected files · no package code executed"),
        ("DECIDE", "Caution · risk 43/100"),
    ]
    for step_index, (label, detail) in enumerate(steps):
        draw_step(draw, 254 + step_index * 70, f"0{step_index + 1}", label, detail, step_index < visible_steps)

    draw_json(draw, json_lines)
    draw_agent_action(draw, show_action)
    return image


def main():
    ASSETS.mkdir(parents=True, exist_ok=True)
    command_length = len("npx --yes npx-vibe@latest --agent esbuild")
    states = [
        (0, 0, 0, False, 450),
        (14, 0, 0, False, 350),
        (30, 0, 0, False, 350),
        (command_length, 1, 0, False, 650),
        (command_length, 2, 2, False, 650),
        (command_length, 3, 4, False, 650),
        (command_length, 4, 7, False, 750),
        (command_length, 4, 9, True, 2300),
    ]
    frames = [make_frame(*state[:4]) for state in states]
    durations = [state[4] for state in states]

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
