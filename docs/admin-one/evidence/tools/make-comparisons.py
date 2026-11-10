"""Generate labeled side-by-side review images from the unchanged reference PNGs and Chromium captures.
Requires Pillow. Captures are cropped to the top 900px of the 1440px browser viewport;
full, unmodified source screenshots remain next to these comparisons.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parents[2]
evidence = root / 'evidence'
font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 18)
small = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 14)
for name, reference, capture in [
    ('login', '01-login.png', 'login-1440.png'),
    ('dashboard', '02-dashboard.png', 'dashboard-1440.png'),
    ('directory', '03-customer-directory.png', 'customer-preview-1440.png'),
]:
    ref = Image.open(root / 'reference' / reference).convert('RGB')
    actual = Image.open(evidence / capture).convert('RGB')
    ref.thumbnail((720, 450), Image.Resampling.LANCZOS)
    actual = actual.crop((0, 0, 1440, 900)).resize((720, 450), Image.Resampling.LANCZOS)
    image = Image.new('RGB', (1472, 540), '#f6f8f5')
    draw = ImageDraw.Draw(image)
    draw.text((8, 10), 'Approved reference — illustrative data', font=font, fill='#123b29')
    draw.text((744, 10), 'Chromium — local test data, 1440px wide', font=font, fill='#123b29')
    image.paste(ref, (8, 42))
    image.paste(actual, (744, 42))
    draw.text((8, 507), 'Reference scaled to fit. Actual capture: top 900px of viewport, scaled to 50%; see full screenshots for all content.', font=small, fill='#43574a')
    image.save(evidence / 'comparisons' / f'{name}-side-by-side.png', optimize=True)
