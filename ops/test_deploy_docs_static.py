import unittest
from deploy_docs_static import FILES, scoped_files


class StaticScopeTests(unittest.TestCase):
    def manifest(self, names):
        return {'files': dict.fromkeys(names, {'before': 'a', 'after': 'b'})}

    def test_subset_preserves_unrelated_assets(self):
        names = ['docs/docs-site.jsx', 'assets/docs-page.js', 'assets/token-page.js',
                 'index.html', 'docs/index.html']
        actual = scoped_files(self.manifest(names))
        self.assertEqual(set(actual), set(names))
        self.assertNotIn('language.js', actual)
        self.assertNotIn('assets/register-page.js', actual)
        self.assertNotIn('skills/leandata-market-data/SKILL.md', actual)

    def test_full_legacy_manifest_remains_accepted(self):
        self.assertEqual(scoped_files(self.manifest(FILES)), FILES)

    def test_missing_core_or_unapproved_path_fails_closed(self):
        for names in [[], ['assets/docs-page.js'], [*FILES, '../server.js']]:
            with self.assertRaises(AssertionError):
                scoped_files(self.manifest(names))


if __name__ == '__main__':
    unittest.main()
