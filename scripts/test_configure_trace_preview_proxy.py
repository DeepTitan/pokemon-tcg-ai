"""Offline tests: no Vercel auth, network or real credentials."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('preview_proxy', Path(__file__).with_name('configure-trace-preview-proxy.py'))
helper = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(helper)
SYNTHETIC = 'offline-test-only-' + 'x' * 48


class PreviewProxyTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.root = Path(self.folder.name)
        (self.root / '.vercel').mkdir()
        (self.root / '.vercel/project.json').write_text(json.dumps({'projectId': helper.PROJECT, 'orgId': helper.TEAM}))

    def tearDown(self):
        self.folder.cleanup()

    def test_default_neither_reads_stdin_nor_calls_provider(self):
        class Unreadable:
            def read(self, *_):
                raise AssertionError('stdin read')
        with patch.object(helper, 'configure', side_effect=AssertionError('provider call')), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(helper.main([], stdin=Unreadable()), 0)

    def test_key_is_only_in_private_stdin_and_target_is_preview_sensitive(self):
        def runner(command, **kwargs):
            self.assertNotIn(SYNTHETIC, ' '.join(command))
            self.assertNotIn('upsert', ' '.join(command))
            self.assertEqual(command[2], f'/v10/projects/{helper.PROJECT}/env?teamId={helper.TEAM}')
            self.assertEqual(json.loads(kwargs['input']), {'key': helper.KEY, 'value': SYNTHETIC, 'type': 'sensitive', 'target': ['preview']})
            self.assertTrue(kwargs['capture_output'])
            return subprocess.CompletedProcess(command, 0, json.dumps({'created': {'key': helper.KEY, 'type': 'sensitive', 'target': ['preview'], 'value': SYNTHETIC}, 'failed': []}), '')
        result = helper.configure(SYNTHETIC, runner=runner, root=self.root)
        self.assertNotIn(SYNTHETIC, json.dumps(result))

    def test_invalid_key_and_wrong_project_stop_before_provider(self):
        def forbidden(*_, **__):
            raise AssertionError('provider call')
        for value in ['', 'x' * 42, 'x' * 513, SYNTHETIC + '\n', ' ' + SYNTHETIC]:
            with self.assertRaises(ValueError):
                helper.configure(value, runner=forbidden, root=self.root)
        (self.root / '.vercel/project.json').write_text(json.dumps({'projectId': 'wrong', 'orgId': helper.TEAM}))
        with self.assertRaises(ValueError):
            helper.configure(SYNTHETIC, runner=forbidden, root=self.root)

    def test_partial_failure_and_wrong_target_cannot_report_success(self):
        for payload in [
            {'created': None, 'failed': [{'error': {'value': SYNTHETIC}}]},
            {'created': {'key': helper.KEY, 'type': 'sensitive', 'target': ['production']}, 'failed': []},
            {'created': {'key': helper.KEY, 'type': 'encrypted', 'target': ['preview']}, 'failed': []},
        ]:
            with self.assertRaises(RuntimeError):
                helper.configure(SYNTHETIC, root=self.root, runner=lambda *args, **kwargs: subprocess.CompletedProcess(args, 0, json.dumps(payload), SYNTHETIC))

    def test_main_redacts_provider_exception(self):
        output = io.StringIO()
        with patch.object(helper, 'configure', side_effect=RuntimeError(SYNTHETIC)), contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
            self.assertEqual(helper.main(['--execute'], stdin=io.StringIO(SYNTHETIC)), 1)
        self.assertNotIn(SYNTHETIC, output.getvalue())

    def test_timeout_never_exposes_stdin_or_retries(self):
        calls = []
        def timeout(command, **kwargs):
            calls.append(command)
            raise subprocess.TimeoutExpired(command, 45, output=SYNTHETIC, stderr=SYNTHETIC)
        with self.assertRaisesRegex(RuntimeError, 'unconfirmed result') as result:
            helper.configure(SYNTHETIC, root=self.root, runner=timeout)
        self.assertNotIn(SYNTHETIC, str(result.exception))
        self.assertEqual(len(calls), 1)


if __name__ == '__main__':
    unittest.main()
