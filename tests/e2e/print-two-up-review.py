"""Check and render cut-ready PDF pages; visual approval remains manual."""
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
manifest = json.loads((source / 'manifest.json').read_text(encoding='utf8'))
evidence = []
for item in manifest:
    file = source / item['name']
    paired = item['artifactType'] in ['team-sheets', 'organizer-sheets']
    private = item['artifactType'] in ['organizer-sheets', 'answer-key']
    counts = [0, 0]
    with pdfplumber.open(file) as pdf:
        full_text = '\n'.join(page.extract_text() or '' for page in pdf.pages)
        assert 'PRIVATE_CONTACT' not in full_text and '@example.test' not in full_text
        assert 'NEPUBLIKOVANÝ NADPIS' not in full_text
        assert ('SOUKROMÁ_' in full_text) == private
        for index, page in enumerate(pdf.pages):
            assert abs(min(page.width, page.height) - 595.28) < .1
            assert abs(max(page.width, page.height) - 841.89) < .1
            if paired:
                assert page.width > page.height
                for side in [0, 1]:
                    x0, x1 = side * page.width / 2, (side + 1) * page.width / 2
                    half = page.crop((x0, 0, x1, page.height))
                    text = half.extract_text() or ''
                    if not text.strip():
                        assert item.get('mode') == 'all', (file.name, index, 'unexpected empty half')
                        continue
                    assert 'arch' in text.lower() and re.search(r'Strana \d+ / \d+', text)
                    if private:
                        assert 'PRO ORGANIZÁTORA' in text and 'SPRÁVNÉ ODPOVĚDI' in text and 'NEDÁVAT HRÁČŮM' in text
                    else:
                        assert 'SPRÁVNÉ ODPOVĚDI' not in text
                    # Number columns have fixed left edges in either layout.
                    number_columns = [x0 + 27, x0 + 27 + ((page.width / 2 - 48 - 16) / 2 + 16)]
                    counts[side] += sum(1 for word in half.extract_words() if re.fullmatch(r'\d{2,3}', word['text']) and any(abs(word['x0'] - column) < .2 for column in number_columns))
                    for char in half.chars:
                        assert char['x0'] >= x0 + 23 and char['x1'] <= x1 - 23, (file.name, index, char)
                        assert char['top'] >= 15 and char['bottom'] <= page.height - 18, (file.name, index, char)
                cut = [line for line in page.lines if abs(line['x0'] - page.width / 2) < .1 and abs(line['x1'] - page.width / 2) < .1]
                assert cut, (file.name, index, 'cut guide absent')
            else:
                for char in page.chars:
                    assert char['x0'] >= 40 and char['x1'] <= page.width - 40
                    assert char['top'] >= 25 and char['bottom'] <= page.height - 35
        if paired:
            if item.get('mode') == 'all':
                assert full_text.count('REZERVNÍ ARCH') == 1, (file.name, 'universal reserve count')
                assert sum(counts) == item['questions'] * item['teamCount'] + item['largestRoundQuestions'], (file.name, counts)
            else:
                assert counts == [item['questions']] * 2, (file.name, counts)
        if item['artifactType'] == 'score-table':
            assert 'Celkem' in full_text and 'Kolo 6' in full_text and 'Filmoví nadšenci' in full_text
        evidence.append({'name': file.name, 'pages': len(pdf.pages), 'pairedA4Landscape': paired, 'halfMm': [148.5, 210] if paired else None, 'questionsPerSide': counts if paired else None, 'privacy': True, 'margins': True})
    subprocess.run([os.environ['PRINT_PDFTOPPM'], '-png', '-r', '100', str(file), str(target / file.stem)], check=True, capture_output=True)
    pages = sorted(target.glob(file.stem + '-*.png'), key=lambda p: int(p.stem.rsplit('-', 1)[1]))
    thumb_w, thumb_h = (422, 299) if paired else (299, 422)
    columns = min(2, len(pages))
    rows = (len(pages) + columns - 1) // columns
    overview = Image.new('RGB', (columns * (thumb_w + 20), rows * (thumb_h + 35)), '#e1e5eb')
    draw = ImageDraw.Draw(overview)
    for index, image_file in enumerate(pages):
        page_image = Image.open(image_file).convert('RGB')
        if item['colorMode'] == 'grayscale':
            channels = page_image.split()
            assert channels[0].tobytes() == channels[1].tobytes() == channels[2].tobytes()
        page_image.thumbnail((thumb_w, thumb_h))
        x, y = index % columns * (thumb_w + 20) + 10, index // columns * (thumb_h + 35) + 10
        overview.paste(page_image, (x, y))
        draw.text((x, y + thumb_h + 3), str(index + 1), fill='#111111')
    overview.save(target / (file.stem + '-overview.jpg'))
(target / 'evidence.json').write_text(json.dumps(evidence, indent=2), encoding='utf8')
print(json.dumps(evidence))
