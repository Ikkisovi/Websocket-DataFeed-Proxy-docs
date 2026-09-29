"""No network or SMTP is used by these safety-contract tests."""

from concurrent.futures import ThreadPoolExecutor
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location('mail_cli', Path(__file__).with_name('email_site_announcement.py'))
mail = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mail)

ROW = {
    'id': 'update_example', 'title': '我们的下一步目标', 'date': '2026-09-29',
    'body': '即将上线的新数据。', 'body_en': '', 'version': 6, 'status': 'published',
    'body_html': '<h2>更新</h2><p><strong>即将上线</strong>的新数据。</p><ul><li>列表</li></ul>',
}


class FakeAPI:
    def __init__(self):
        self.row = copy.deepcopy(ROW)
        self.calls = []
        self.send_error = False
        self.failed = False
        self.incomplete = False
        self.html = '<html><body><h1>Announcement</h1><strong>Bold</strong></body></html>'

    def call(self, path, payload=None):
        self.calls.append((path, payload))
        if path in {'/api/admin/product-updates', '/api/product-updates'}:
            return {'updates': [self.row]}
        if path.endswith('/recipients'):
            return {'smtp_configured': True}
        if payload.get('confirm'):
            if self.send_error:
                raise TimeoutError('secret@example.com')
            results = [{'email': 'private@example.com', 'status': 'sent'}]
            if not self.incomplete:
                results += [{'email': 'private2@example.com', 'status': 'failed' if self.failed else 'sent'}]
            return {'success': not self.failed, 'results': results}
        return {
            'success': True, 'dry_run': True, 'reachable': [{}, {}],
            'format': 'multipart/alternative', 'html': self.html,
            'skipped': [{'reason': 'no_email'}, {'reason': 'test_user'}],
            'duplicate_recipients': [{}], 'recipient_snapshot': 'frozen-recipients',
        }

    def sends(self):
        return [payload for path, payload in self.calls if path == mail.SEND_PATH and payload.get('confirm')]


class EmailContractTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.site = Path(self.temp.name)
        self.state = self.site / 'data/announcement-email-jobs'
        for target, value in [('SITE', self.site), ('STATE', self.state)]:
            patcher = patch.object(mail, target, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.launch = patch.object(mail, 'launch', return_value='runner-hash').start()
        self.addCleanup(patch.stopall)
        self.api = FakeAPI()

    def queue(self):
        return mail.queue_send(self.api, ROW['id'])

    def deliver(self):
        return mail.deliver(mail.job_key(ROW['id']), lambda: self.api)

    def test_preview_uses_published_content_without_sending_or_creating_jobs(self):
        summary, payload = mail.preview(self.api, 'latest')
        self.assertIn(ROW['body'], payload['body'])
        self.assertEqual(summary['recipient_count'], 2)
        self.assertEqual(summary['duplicates'], 1)
        self.assertFalse(self.api.sends())
        self.assertFalse(self.state.exists())
        self.assertNotIn('email', summary)

    def test_latest_cannot_be_sent_without_resolving_id(self):
        with self.assertRaises(mail.OperationError):
            mail.queue_send(self.api, 'latest')
        self.assertFalse(self.api.calls)

    def test_bilingual_rich_html_is_sent_without_flattening(self):
        self.api.row.update(title_en='New <Data>', body_en='Details', body_en_html='<h3>Details</h3><p><b>New</b></p>')
        summary, payload = mail.preview(self.api, ROW['id'])
        self.assertIn(ROW['body_html'], payload['body_html'])
        self.assertIn('<h2>New &lt;Data&gt;</h2>', payload['body_html'])
        self.assertIn('<h3>Details</h3><p><b>New</b></p>', payload['body_html'])
        self.assertEqual(summary['html'], self.api.html)
        self.queue()
        self.deliver()
        self.assertEqual(self.api.sends()[0]['body_html'], payload['body_html'])

    def test_server_without_html_capability_cannot_queue_plaintext_by_accident(self):
        self.api.html = None
        with self.assertRaises(mail.OperationError):
            self.queue()
        self.launch.assert_not_called()
        self.assertFalse(self.api.sends())

    def test_changed_html_template_blocks_before_send(self):
        self.queue()
        self.api.html = '<html>A different template</html>'
        self.assertEqual(self.deliver()['state'], 'blocked_before_send')
        self.assertFalse(self.api.sends())

    def test_formatting_only_edit_changes_content_fingerprint(self):
        self.queue()
        self.api.row['body_html'] = '<p>即将上线的新数据。</p>'
        self.assertEqual(self.deliver()['state'], 'blocked_before_send')
        self.assertFalse(self.api.sends())

    def test_drafts_cannot_be_emailed(self):
        self.api.row['status'] = 'draft'
        with self.assertRaises(mail.OperationError):
            self.queue()
        self.assertFalse(self.api.sends())

    def test_completed_job_cannot_send_twice_even_after_edit(self):
        self.queue()
        result = self.deliver()
        self.assertEqual((result['state'], result['smtp_accepted']), ('completed', 2))
        self.assertEqual(self.api.sends()[0]['recipient_snapshot'], 'frozen-recipients')
        self.api.row['version'] += 1
        self.assertTrue(self.queue()['already_submitted'])
        self.deliver()
        self.assertEqual(len(self.api.sends()), 1)
        self.assertNotIn('private@example.com', json.dumps(result))

    def test_changed_content_or_version_blocks_queued_send(self):
        self.queue()
        self.api.row['body'] = 'Changed text'
        self.assertEqual(self.deliver()['state'], 'blocked_before_send')
        self.assertFalse(self.api.sends())

    def test_archived_announcement_blocks_queued_send(self):
        self.queue()
        self.api.row['status'] = 'archived'
        self.assertEqual(self.deliver()['state'], 'blocked_before_send')
        self.assertFalse(self.api.sends())

    def test_timeout_is_unknown_and_never_retried(self):
        self.queue()
        self.api.send_error = True
        result = self.deliver()
        self.assertEqual(result['state'], 'unknown')
        self.assertNotIn('secret@example.com', json.dumps(result))
        self.queue()
        self.deliver()
        self.assertEqual(len(self.api.sends()), 1)

    def test_partial_failure_preserves_counts_without_retry(self):
        self.queue()
        self.api.failed = True
        result = self.deliver()
        self.assertEqual((result['state'], result['smtp_accepted'], result['failed']), ('partial', 1, 1))
        self.deliver()
        self.assertEqual(len(self.api.sends()), 1)

    def test_truncated_response_is_unknown(self):
        self.queue()
        self.api.incomplete = True
        self.assertEqual(self.deliver()['state'], 'unknown')

    def test_history_of_previous_send_blocks_new_job(self):
        (self.site / 'data').mkdir()
        (self.site / 'data/announce-log.jsonl').write_text(json.dumps({
            'subject': mail.message(ROW)['subject'], 'results': [{'status': 'sent'}],
        }) + '\n')
        with self.assertRaises(mail.OperationError):
            self.queue()
        self.launch.assert_not_called()

    def test_new_history_between_queue_and_delivery_blocks(self):
        self.queue()
        (self.site / 'data/announce-log.jsonl').write_text(json.dumps({
            'subject': mail.message(ROW)['subject'], 'results': [{'status': 'sent'}],
        }) + '\n')
        self.assertEqual(self.deliver()['state'], 'blocked_before_send')
        self.assertFalse(self.api.sends())

    def test_concurrent_submissions_launch_only_once(self):
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: self.queue(), range(2)))
        self.launch.assert_called_once()
        self.assertEqual(sum(r.get('already_submitted', False) for r in results), 1)

    def test_launch_failure_preserves_job_and_prevents_second_launch(self):
        self.launch.side_effect = mail.OperationError('Launch failed')
        with self.assertRaises(mail.OperationError):
            self.queue()
        self.assertTrue(self.queue()['already_submitted'])
        self.launch.assert_called_once()
        self.assertFalse(self.api.sends())

    def test_job_files_are_private_and_do_not_store_secrets_or_addresses(self):
        self.queue()
        path = self.state / (mail.job_key(ROW['id']) + '.json')
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.state.stat().st_mode & 0o777, 0o700)
        data = path.read_text()
        self.assertNotIn('@example.com', data)
        self.assertNotIn('token', data)
        self.assertNotIn('password', data)


if __name__ == '__main__':
    unittest.main()
