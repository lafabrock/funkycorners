#!/usr/bin/env python3
"""Rebuild data/shows.json for the Funky Corners archive site.

Single source: every upload of the Mixcloud profile "FunkyCorners".
Tracklists come from Mixcloud's tracklist data (GraphQL sections).
Incremental by default: shows already in data/shows.json are reused, only new
uploads are fetched in full. The 8 most recent shows are always refreshed
(late tracklist edits, play counts). Use --full to refetch everything.

Usage:  python3 tools/update_data.py [--full]     (needs: pip install requests)
"""
import json, os, re, sys, time, concurrent.futures as cf
import requests

USER = 'FunkyCorners'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'shows.json')
API = 'https://api.mixcloud.com'
GQL = 'https://app.mixcloud.com/graphql'
H = {'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.mixcloud.com/'}
Q = ('query($u:String!,$s:String!){ cloudcastLookup(lookup:{username:$u,slug:$s}) { sections { __typename '
     '... on TrackSection { artistName songName startSeconds } ... on ChapterSection { chapter startSeconds } } } }')
S = requests.Session()


def get(url):
    for i in range(4):
        try:
            r = S.get(url, timeout=30)
            r.raise_for_status()
            return r.json()
        except Exception:
            time.sleep(2 + i * 3)
    raise RuntimeError('failed: ' + url)


def paged(url):
    out = []
    while url:
        d = get(url)
        out += d.get('data', [])
        url = d.get('paging', {}).get('next')
    return out


def tracklist(slug):
    for i in range(4):
        try:
            r = S.post(GQL, json={'query': Q, 'variables': {'u': USER, 's': slug}}, headers=H, timeout=30).json()
            return (r['data']['cloudcastLookup'] or {}).get('sections') or []
        except Exception:
            time.sleep(2 + i * 3)
    return []


def ts(sec):
    if sec is None:
        return ''
    sec = int(sec)
    h, m, s = sec // 3600, sec % 3600 // 60, sec % 60
    return f'{h}:{m:02d}:{s:02d}' if h else f'{m}:{s:02d}'


def clean(t):
    t = (t or '').replace('\r\n', '\n').replace('\r', '\n').replace('﻿', '')
    return t.strip()


def number(name):
    m = re.search(r'#\s*(\d{1,4})', name)
    return int(m.group(1)) if m else None


def category(name, minutes):
    n = name.lower()
    if minutes and minutes > 150: return 'Marathon'
    if 'anniversary' in n: return 'Anniversary'
    if re.search(r'\b(tribute|r\.i\.p|rip|in memory)\b', n): return 'Tribute'
    if re.search(r'\b(special|extra|bonus|mix(tape)?)\b', n): return 'Special'
    if number(name) is not None: return 'Weekly show'
    return 'Other'


def guests(desc):
    m = re.search(r'featuring ([^\n.]+)', desc or '', re.I)
    return clean(m.group(1))[:120] if m else ''


def build(d, secs):
    name = re.sub(r'\s+', ' ', clean(d['name']))
    minutes = round(d['audio_length'] / 60) if d.get('audio_length') else None
    tracks = []
    for x in secs:
        if x['__typename'] == 'TrackSection':
            a, t = re.sub(r'\s+', ' ', clean(x['artistName'])), re.sub(r'\s+', ' ', clean(x['songName']))
            seg = a.lower() in ('funky corners', 't_wheels', 't wheels') and re.search(r'\b(intro|outro|mix|set|selections?|drop)\b', t, re.I)
            tracks.append(['segment' if seg else 'track', a, t, ts(x.get('startSeconds'))])
        else:
            tracks.append(['segment', '', clean(x['chapter']).strip(' -'), ts(x.get('startSeconds'))])
    desc = clean(d.get('description'))
    return dict(
        key=d['key'], name=name, number=number(name), category=category(name, minutes),
        date=d['created_time'][:10], duration=minutes, plays=d.get('play_count'),
        favorites=d.get('favorite_count'), tags=[t['name'] for t in d.get('tags', [])],
        description=desc[:3000], url=d['url'],
        cover=next((d.get('pictures', {}).get(k) for k in ('640wx640h', 'extra_large', 'large') if d.get('pictures', {}).get(k)), ''),
        hosts=[h.get('username') for h in (d.get('hosts') or []) if h.get('username')],
        tracks=tracks)


def main():
    full = '--full' in sys.argv
    old = {}
    if os.path.exists(OUT) and not full:
        old = {s['key']: s for s in json.load(open(OUT, encoding='utf-8'))['shows'] if s.get('key')}
    print('Listing shows…')
    items = paged(f'{API}/{USER}/cloudcasts/?limit=100')
    items.sort(key=lambda o: o['created_time'], reverse=True)
    recent = {o['key'] for o in items[:8]}
    todo = [o for o in items if o['key'] not in old or o['key'] in recent]
    print(f'{len(items)} shows on Mixcloud, {len(todo)} to fetch.')

    def detail(o):
        d = get(API + o['key'])
        return build(d, tracklist(o['slug']))

    fresh = {}
    with cf.ThreadPoolExecutor(6) as ex:
        for s in ex.map(detail, todo):
            fresh[s['key']] = s
    shows = [fresh.get(o['key']) or old[o['key']] for o in items]
    shows.sort(key=lambda s: (s['date'], s['number'] or 0, s['name']))
    for i, s in enumerate(shows):
        s['id'] = i + 1
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(dict(updated=time.strftime('%Y-%m-%d'), shows=shows), f, ensure_ascii=False, separators=(',', ':'))
    n = sum(1 for s in shows for t in s['tracks'] if t[0] == 'track')
    print(f'Done: {len(shows)} shows, {n} tracks -> data/shows.json')


if __name__ == '__main__':
    sys.exit(main())
