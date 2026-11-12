"""Render actual PDF bytes and check text/geometry. Visual approval remains manual."""
import json
import os
import pathlib
import re
import subprocess
import sys
import pdfplumber
from PIL import Image, ImageDraw

source = pathlib.Path(sys.argv[1]).resolve()
target = pathlib.Path(sys.argv[2]).resolve()
target.mkdir(parents=True, exist_ok=True)
evidence = []
for file in sorted(source.glob('*.pdf')):
    with pdfplumber.open(file) as pdf:
        text = '\n'.join(page.extract_text() or '' for page in pdf.pages)
        private_key = 'answer-key' in file.name or 'event-key' in file.name
        assert 'NEPUBLIKOVANÝ NADPIS' not in text and 'PRIVATE_CONTACT' not in text and '@example.test' not in text
        if private_key:
            assert 'SOUKROMÁ_' in text
        else:
            assert 'SOUKROMÁ_' not in text
        for index, page in enumerate(pdf.pages):
            assert abs(min(page.width, page.height) - 595.28) < .1
            assert abs(max(page.width, page.height) - 841.89) < .1
            assert f'Strana {index + 1} / {len(pdf.pages)}' in (page.extract_text() or '')
            for char in page.chars:
                assert char['x0'] >= 40 and char['x1'] <= page.width - 40, (file.name, index, char)
                assert char['top'] >= 30 and char['bottom'] <= page.height - 35, (file.name, index, char)
        if 'long-' in file.name:
            assert len(re.findall(r'^\d{2}(?:\s|$)', text, re.M)) == 67, (file.name, 'Missing question block')
        evidence.append({'file': file.name, 'pages': len(pdf.pages), 'A4': True, 'margins': True, 'playerAnswersAbsent': not private_key})
    subprocess.run([os.environ['PRINT_PDFTOPPM'], '-png', '-r', '100', str(file), str(target / file.stem)], check=True, capture_output=True)
    pages = sorted(target.glob(file.stem + '-*.png'))
    thumb_w, thumb_h = 298, 422
    columns = min(3, len(pages))
    rows = (len(pages) + columns - 1) // columns
    sheet = Image.new('RGB', (columns * (thumb_w + 20), rows * (thumb_h + 40)), '#dce1e6')
    draw = ImageDraw.Draw(sheet)
    for index, page_file in enumerate(pages):
        page_image = Image.open(page_file).convert('RGB'); page_image.thumbnail((thumb_w, thumb_h))
        x, y = (index % columns) * (thumb_w + 20) + 10, (index // columns) * (thumb_h + 40) + 10
        sheet.paste(page_image, (x, y)); draw.text((x, y + thumb_h + 4), f'{file.stem} / {index + 1}', fill='#111111')
    sheet.save(target / (file.stem + '-overview.jpg'))
(target / 'evidence.json').write_text(json.dumps(evidence, indent=2), encoding='utf8')
print(json.dumps(evidence))
