import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('remove',Path(__file__).with_name('run-audience-remove.py'))
remove=importlib.util.module_from_spec(spec);spec.loader.exec_module(remove)
class RemovalStartupTests(unittest.TestCase):
    def test_only_no_preview_no_validation_no_write_startup_failure_is_recoverable(self):
        blocked={'failure_stage':'stock_api_ready','real_provider_write_call_count':0,'validate_only_call_count':0}
        self.assertTrue(remove.startup_recovery_allowed(blocked,['blocked-evidence.json','calls.jsonl']))
        for name in ['i-remove-preview.claim','validation.claim','validation.json','protected-preview-context.json','evidence.json']:
            self.assertFalse(remove.startup_recovery_allowed(blocked,[name]))
        for edit in [{'real_provider_write_call_count':1},{'validate_only_call_count':1},{'failure_stage':'I_REMOVE_JIT_PREVIEW'}]:
            self.assertFalse(remove.startup_recovery_allowed({**blocked,**edit},[]))
    def test_gateway_is_explicitly_enabled_in_preview_only_launcher(self):
        text=Path(remove.__file__).read_text()
        self.assertIn("'STAGE234_APPROVAL_GATEWAY':'true'",text)
        self.assertIn("'V2_CONFIRMED_WRITE_ENABLED':'false'",text)
        self.assertIn('i_remove_recovery_after_possible_preview_denied',text)
        self.assertNotIn('commit_preview',text)
if __name__=='__main__':unittest.main()
