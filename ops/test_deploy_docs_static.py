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

    def test_reading_layer_is_scoped_and_published_before_html(self):
        names = ['docs/docs-site.jsx', 'assets/docs-page.js', 'assets/token-page.js',
                 'index.html', 'docs/index.html', 'docs/code-block.jsx', 'docs/reading.css']
        actual = scoped_files(self.manifest(names))
        self.assertLess(actual.index('docs/reading.css'), actual.index('docs/index.html'))
        self.assertLess(actual.index('docs/code-block.jsx'), actual.index('docs/docs-site.jsx'))
        self.assertNotIn('language.js', actual)

    def test_brand_logo_is_allowlisted_and_published_before_html(self):
        names = ['docs/docs-site.jsx', 'assets/docs-page.js', 'assets/token-page.js',
                 'index.html', 'docs/index.html', 'logo.jpg']
        actual = scoped_files(self.manifest(names))
        self.assertIn('logo.jpg', actual)
        self.assertLess(actual.index('logo.jpg'), actual.index('docs/index.html'))
        self.assertNotIn('server.js', actual)

    def test_embedded_reference_and_supplied_mark_are_scoped(self):
        names = ['docs/docs-site.jsx', 'assets/docs-page.js', 'assets/token-page.js',
                 'index.html', 'docs/index.html', 'docs/embedded-docs.jsx',
                 'assets/brand/leandata-mark.png']
        actual = scoped_files(self.manifest(names))
        self.assertLess(actual.index('assets/brand/leandata-mark.png'), actual.index('docs/index.html'))
        self.assertLess(actual.index('docs/embedded-docs.jsx'), actual.index('docs/index.html'))

    def test_full_legacy_manifest_remains_accepted(self):
        self.assertEqual(scoped_files(self.manifest(FILES)), FILES)

    def test_missing_core_or_unapproved_path_fails_closed(self):
        for names in [[], ['assets/docs-page.js'], [*FILES, '../server.js']]:
            with self.assertRaises(AssertionError):
                scoped_files(self.manifest(names))


if __name__ == '__main__':
    unittest.main()
