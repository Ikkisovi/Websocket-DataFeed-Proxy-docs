#!/usr/bin/env python3
"""Add scoped cache controls to the existing private static-origin config."""
import copy
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


if __name__ == '__main__':
    json.dump(with_entry_cache_policy(json.load(sys.stdin)), sys.stdout, indent=2)
    sys.stdout.write('\n')
