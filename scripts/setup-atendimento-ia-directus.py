#!/usr/bin/env python3
"""Adiciona campos de atendimento IA em cadastro_motorista no Directus GMX."""
import json
import os
import sys
import urllib.error
import urllib.request

BASE = os.environ.get('DIRECTUS_URL', 'https://gmx.sanjaworks.com/api').rstrip('/')
EMAIL = os.environ.get('DIRECTUS_ADMIN_EMAIL', 'gmx@gmx.com')
PASSWORD = os.environ.get('DIRECTUS_ADMIN_PASSWORD', 'admin123')

CAMPOS = [
    ('ia_pausada', 'boolean'),
    ('ia_pausa_motivo', 'text'),
    ('precisa_atendimento', 'boolean'),
    ('precisa_atendimento_motivo', 'text'),
    ('ultima_intencao_whatsapp', 'string'),
    ('ultima_intencao_em', 'timestamp'),
]


def req(method, path, token=None, data=None):
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    body = json.dumps(data).encode() if data is not None else None
    request = urllib.request.Request(BASE + path, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=60) as res:
            return res.status, json.loads(res.read().decode() or '{}')
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or '{}')


def main():
    _, login = req('POST', '/auth/login', data={'email': EMAIL, 'password': PASSWORD})
    token = login.get('data', {}).get('access_token')
    if not token:
        print('Login falhou:', login)
        sys.exit(1)

    for field, ftype in CAMPOS:
        st, resp = req('GET', f'/fields/cadastro_motorista/{field}', token)
        if st == 200:
            print(f'  {field} já existe')
            continue
        st2, resp2 = req('POST', '/fields/cadastro_motorista', token, {
            'field': field,
            'type': ftype,
            'schema': {},
            'meta': {
                'interface': 'input' if ftype == 'string' else ('boolean' if ftype == 'boolean' else ('input-multiline' if ftype == 'text' else 'datetime')),
                'width': 'half',
            },
        })
        if st2 in (200, 204):
            print(f'  {field} criado')
        else:
            print(f'  {field} erro {st2}:', resp2)

    print('cadastro_motorista campos IA OK')


if __name__ == '__main__':
    main()
