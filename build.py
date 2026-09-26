#!/usr/bin/env python3
"""Collapse www/ into one self-contained HTML file.

The single-file build is for sharing a link or opening from disk. It leaves out
onnxruntime and the model weights (26 MB of binaries cannot be inlined), so it
runs on the simulator. The full www/ directory is what goes into the APK.
"""
import re
import pathlib
import sys

ROOT = pathlib.Path(__file__).parent
WWW = ROOT / 'www'
OUT = ROOT / 'dist' / 'colproj.html'

SKIP = {'js/ort.wasm.min.js'}


def main():
    html = (WWW / 'index.html').read_text()

    # stylesheet
    css = (WWW / 'css' / 'app.css').read_text()
    html = html.replace('<link rel="stylesheet" href="css/app.css">',
                        '<style>\n' + css + '\n</style>')

    # drop things that only make sense as separate files
    html = html.replace('<link rel="manifest" href="manifest.webmanifest">\n', '')

    def inline(m):
        src = m.group(1)
        if src in SKIP:
            return ('<!-- onnxruntime omitted from the single-file build; '
                    'the simulator engine runs instead -->')
        code = (WWW / src).read_text()
        return '<script>\n' + code + '\n</script>'

    html = re.sub(r'<script src="([^"]+)"></script>', inline, html)

    # only flag real <script src>/<link href> tags, not src="..." inside JS strings
    leftover = re.findall(r'<(?:script[^>]+src|link[^>]+href)="([^"]+)"', html)
    if leftover:
        print('warning: unresolved external references:', leftover, file=sys.stderr)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(html)
    print(f'{OUT}  {len(html) / 1024:.0f} KB')


if __name__ == '__main__':
    main()
