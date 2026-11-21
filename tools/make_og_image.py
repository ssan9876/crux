"""Renders tools/og-image.html to og.png (1200x630), the image Discord and other apps
show when someone pastes a link to Crux. Uses the Chrome installed on this PC.

Usage: python tools/make_og_image.py
"""
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CHROME = Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe")

subprocess.run(
    [
        str(CHROME),
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--force-device-scale-factor=1",
        "--window-size=1200,630",
        "--virtual-time-budget=8000",  # give the web fonts time to load
        f"--screenshot={ROOT / 'og.png'}",
        (ROOT / "tools" / "og-image.html").as_uri(),
    ],
    check=True,
    capture_output=True,
)
print("Wrote og.png")
