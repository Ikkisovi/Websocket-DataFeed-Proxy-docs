#!/usr/bin/env python3
"""Add scoped cache controls to the existing private static-origin config."""
import copy
import argparse
import json
import sys


HTML_PATHS = ['/', '/index.html', '/docs', '/docs/*']
SCRIPT_PATHS = ['/assets/token-page.js', '/assets/docs-page.js', '/language.js']
POLICY = [
    {
        'match': [{'path': HTML_PATHS}],
        'handle': [{
            'handler': 'headers',
            'request': {'delete': ['If-None-Match', 'If-Modified-Since']},
            'response': {'set': {
                'Cache-Control': ['no-store, max-age=0'],
                'Pragma': ['no-cache'],
                'Expires': ['0'],
            }},
        }],
    },
    {
        'match': [{'path': SCRIPT_PATHS}],
        'handle': [{
            'handler': 'headers',
            'response': {'set': {
                'Cache-Control': ['no-cache, max-age=0, must-revalidate'],
            }},
        }],
    },
]


def with_entry_cache_policy(config: dict) -> dict:
    """Preserve routing, TLS and API handling; change one static reader only."""
    result = copy.deepcopy(config)
    cache = result['apps']['http']['servers']['cache']
    matches = []

    def find(node):
        if isinstance(node, list):
            for index, item in enumerate(node):
                if isinstance(item, dict):
                    handlers = item.get('handle', [])
                    if len(handlers) == 1 and handlers[0].get('handler') == 'file_server' and handlers[0].get('root') == '/srv/site-public':
                        matches.append((node, index))
                find(item)
        elif isinstance(node, dict):
            for key, value in node.items():
                if key not in ('tls', 'transport'):
                    find(value)

    find(cache.get('routes', []))
    if len(matches) != 1:
        raise ValueError('Expected exactly one private static reader')
    routes, index = matches[0]
    if routes[max(0, index - len(POLICY)):index] != POLICY:
        routes[index:index] = copy.deepcopy(POLICY)
    return result


def with_public_entry_cache_policy(config: dict) -> dict:
    """Apply the same policy at the public website host, preserving API hosts."""
    result = copy.deepcopy(config)
    routes = result['apps']['http']['servers']['compat']['routes']
    website = [r for r in routes if r.get('match') == [{'host': ['leandata.uk']}]]
    if len(website) != 1:
        raise ValueError('Expected exactly one public website host')
    handlers = website[0].get('handle', [])
    if len(handlers) != 1 or handlers[0].get('handler') != 'subroute':
        raise ValueError('Unexpected public website route shape')
    chain = handlers[0]['routes']
    if chain[:len(POLICY)] != POLICY:
        chain[:0] = copy.deepcopy(POLICY)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--public-compat', action='store_true')
    args = parser.parse_args()
    transform = with_public_entry_cache_policy if args.public_compat else with_entry_cache_policy
    json.dump(transform(json.load(sys.stdin)), sys.stdout, indent=2)
    sys.stdout.write('\n')
