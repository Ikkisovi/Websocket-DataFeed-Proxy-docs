import copy
import unittest

from static_entry_cache import POLICY, with_entry_cache_policy, with_public_entry_cache_policy


class StaticEntryCacheTests(unittest.TestCase):
    def setUp(self):
        self.reader = {'handle': [{'handler': 'file_server', 'root': '/srv/site-public'}]}
        self.config = {
            'admin': {'disabled': True},
            'apps': {'http': {'servers': {
                'cache': {'routes': [
                    {'match': [{'path': ['/internal/*']}], 'handle': [{'handler': 'reverse_proxy', 'upstreams': [{'dial': 'cache:18085'}]}]},
                    {'handle': [{'handler': 'subroute', 'routes': [
                        {'handle': [{'handler': 'rewrite', 'uri': '/account.html'}]},
                        copy.deepcopy(self.reader),
                    ]}]},
                ]},
                'portal-origin': {'routes': [{'handle': [{'handler': 'reverse_proxy', 'upstreams': [{'dial': 'portal-ui:3000'}]}]}]},
        }}}}

    def test_only_static_reader_chain_changes(self):
        original = copy.deepcopy(self.config)
        result = with_entry_cache_policy(self.config)
        routes = result['apps']['http']['servers']['cache']['routes'][1]['handle'][0]['routes']
        self.assertEqual(routes[-1], self.reader)
        self.assertEqual(routes[1:3], POLICY)
        del routes[1:3]
        self.assertEqual(result, original)
        self.assertEqual(self.config, original)

    def test_idempotent_without_duplicate_handlers(self):
        result = with_entry_cache_policy(self.config)
        self.assertEqual(with_entry_cache_policy(result), result)

    def test_unknown_or_ambiguous_reader_fails_closed(self):
        routes = self.config['apps']['http']['servers']['cache']['routes'][1]['handle'][0]['routes']
        routes.pop()
        with self.assertRaises(ValueError):
            with_entry_cache_policy(self.config)
        routes.extend([self.reader, self.reader])
        with self.assertRaises(ValueError):
            with_entry_cache_policy(self.config)

    def test_public_website_preserves_api_hosts_and_routing(self):
        config = {'apps': {'http': {'servers': {'compat': {'routes': [
            {'match': [{'host': ['leandata.uk']}], 'handle': [{'handler': 'subroute', 'routes': [
                {'match': [{'path': ['/api/*']}], 'handle': [{'handler': 'reverse_proxy', 'upstreams': [{'dial': 'portal-ui:3000'}]}]},
                copy.deepcopy(self.reader),
            ]}]},
            {'match': [{'host': ['rt-api.leandata.uk']}], 'handle': [{'handler': 'reverse_proxy', 'upstreams': [{'dial': 'edge:443'}]}]},
        ]}}}}}
        result = with_public_entry_cache_policy(config)
        self.assertEqual(with_public_entry_cache_policy(result), result)
        chain = result['apps']['http']['servers']['compat']['routes'][0]['handle'][0]['routes']
        self.assertEqual(chain[:2], POLICY)
        del chain[:2]
        self.assertEqual(result, config)

    def test_missing_public_website_fails_closed(self):
        with self.assertRaises(ValueError):
            with_public_entry_cache_policy({'apps': {'http': {'servers': {'compat': {'routes': []}}}}})


if __name__ == '__main__':
    unittest.main()
