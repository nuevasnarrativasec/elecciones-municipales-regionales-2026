#!/usr/bin/env python3
"""Genera assets/data/reg_names.json: índice ligero [nombre, índiceDepto]
para la búsqueda directa por nombre de regidores sin elegir región.
Se cargan a demanda solo los archivos de departamento con coincidencias.

Uso:  python3 tools/build_reg_names.py
"""
import json, glob, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REG_DIR = os.path.join(ROOT, 'assets', 'data', 'reg')
OUT = os.path.join(ROOT, 'assets', 'data', 'reg_names.json')

files = sorted(glob.glob(os.path.join(REG_DIR, '*.json')))
deps = [os.path.splitext(os.path.basename(f))[0] for f in files]
idx = {d: i for i, d in enumerate(deps)}

rows = []
for f in files:
    slug = os.path.splitext(os.path.basename(f))[0]
    di = idx[slug]
    for r in json.load(open(f, encoding='utf-8')):
        rows.append([r['nom'], di])

json.dump({'deps': deps, 'r': rows}, open(OUT, 'w', encoding='utf-8'),
          ensure_ascii=False, separators=(',', ':'))
print(f'{len(rows)} regidores · {len(deps)} deptos · {os.path.getsize(OUT)/1e6:.1f} MB -> {OUT}')
