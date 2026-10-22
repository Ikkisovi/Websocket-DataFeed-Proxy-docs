import copy
import unittest

from deploy_entry_cache import DeploymentInvariantError, assert_container_invariants


class DeploymentInvariantTests(unittest.TestCase):
    def setUp(self):
        self.before = {
            'Id': 'container-1', 'Image': 'sha256:pinned',
            'Config': {'Env': ['MODE=static'], 'Cmd': ['caddy', 'run']},
            'Mounts': [
                {'Type': 'bind', 'Source': '/srv/site', 'Destination': '/srv/site-public', 'RW': False},
                {'Type': 'bind', 'Source': '/etc/site.json', 'Destination': '/etc/caddy/caddy.json', 'RW': False},
            ],
            'HostConfig': {
                'Memory': 128, 'MemorySwap': 128, 'NanoCpus': 200,
                'PidsLimit': 64, 'ReadonlyRootfs': True,
                'SecurityOpt': ['no-new-privileges'], 'PortBindings': {},
            },
        }

    def check_rejected(self, after, reason):
        with self.assertRaises(DeploymentInvariantError) as caught:
            assert_container_invariants(self.before, after)
        self.assertEqual(caught.exception.reason, reason)

    def test_docker_mount_reordering_is_accepted(self):
        after = copy.deepcopy(self.before)
        after['Mounts'].reverse()
        assert_container_invariants(self.before, after)

    def test_real_mount_drift_still_rejects(self):
        for field, value in [('Source', '/srv/other'), ('RW', True), ('Destination', '/other')]:
            with self.subTest(field=field):
                after = copy.deepcopy(self.before)
                after['Mounts'][0][field] = value
                self.check_rejected(after, 'container_mount_changed')

    def test_extra_or_removed_mount_still_rejects(self):
        for add in [True, False]:
            after = copy.deepcopy(self.before)
            if add:
                after['Mounts'].append({'Type': 'bind', 'Source': '/extra', 'Destination': '/extra', 'RW': True})
            else:
                after['Mounts'].pop()
            self.check_rejected(after, 'container_mount_changed')

    def test_identity_and_image_changes_still_reject(self):
        for key, reason in [('Id', 'container_identity_changed'), ('Image', 'container_image_changed')]:
            after = copy.deepcopy(self.before)
            after[key] = 'changed'
            self.check_rejected(after, reason)

    def test_runtime_configuration_still_rejects(self):
        after = copy.deepcopy(self.before)
        after['Config']['Env'] = ['MODE=unexpected']
        self.check_rejected(after, 'container_configuration_changed')

    def test_resource_or_security_changes_still_reject(self):
        for field, value in [('MemorySwap', -1), ('Memory', 256), ('SecurityOpt', [])]:
            with self.subTest(field=field):
                after = copy.deepcopy(self.before)
                after['HostConfig'][field] = value
                self.check_rejected(after, 'container_limits_changed')


if __name__ == '__main__':
    unittest.main()
