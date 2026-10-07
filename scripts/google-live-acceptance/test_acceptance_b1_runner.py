"""No Docker/network calls: pin the acceptance container identity during preflight."""
import ast
import json
import re
from pathlib import Path
from types import SimpleNamespace
import unittest


class AcceptanceB1RunnerTest(unittest.TestCase):
    def test_harness_head_accepts_exact_sha_only(self):
        tree = ast.parse(Path(__file__).with_name('run-acceptance-b1.py').read_text(encoding='utf-8'))
        function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'parse_head')
        scope = {'re': re}
        exec(compile(ast.Module(body=[function], type_ignores=[]), '<runner-head>', 'exec'), scope)
        expected = 'e6e8cfcf9fd6b28678dc536b69ff6e56827c805f'
        self.assertEqual(scope['parse_head'](['runner', expected]), expected)
        for args in [['runner'], ['runner', 'main'], ['runner', expected, 'extra']]:
            with self.assertRaises(RuntimeError): scope['parse_head'](args)

    def test_existing_api_identity_is_not_changed_by_phase_rename(self):
        source = Path(__file__).with_name('run-acceptance-b1.py').read_text(encoding='utf-8')
        tree = ast.parse(source)
        function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'api_identity')
        calls = []

        def run(command, **options):
            calls.append(command)
            self.assertTrue(options['capture_output'])
            self.assertTrue(options['check'])
            return SimpleNamespace(stdout=json.dumps([{'Id': 'container', 'Image': 'image', 'State': {'StartedAt': 'timestamp'}, 'RestartCount': 0}]))

        scope = {'subprocess': SimpleNamespace(run=run), 'json': json}
        exec(compile(ast.Module(body=[function], type_ignores=[]), '<runner-identity>', 'exec'), scope)
        self.assertEqual(scope['api_identity'](), ['container', 'image', 'timestamp', 0])
        self.assertEqual(calls, [['docker', 'inspect', 'holymedia-google-acceptance-api-1']])
        self.assertNotIn('acceptance-b1pi', source)


if __name__ == '__main__':
    unittest.main()
