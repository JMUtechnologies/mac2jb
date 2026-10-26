"""Supply the bundled DejaVu font for HBLauncher's unchanged Linux font path."""
import os
from PIL import ImageFont

_original_truetype = ImageFont.truetype

def _bundled_truetype(font, *args, **kwargs):
    if font == '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf':
        font = os.environ['MAC2JB_HBLAUNCHER_FONT']
    return _original_truetype(font, *args, **kwargs)

ImageFont.truetype = _bundled_truetype
