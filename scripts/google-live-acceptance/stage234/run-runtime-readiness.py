"""Independent authenticated stock API diagnostics; transport denies all writes."""
import argparse
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location('inventory_supervisor', Path(__file__).with_name('run-readiness.py'))
inventory = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inventory)
original_command = inventory.command

def command(opts, directory, state):
    args = original_command(opts, directory, state)
    overrides = {
        'PROVIDER_GOOGLE_ADS_WRITE_ENABLED': 'true',
        'PROVIDER_GOOGLE_ADS_STAGE2_WRITE_ENABLED': 'true',
        'V2_PREVIEW_ONLY': 'false', 'V2_CONFIRMED_WRITE_ENABLED': 'true',
        'API_PORT': '4000', 'STAGE234_RUNTIME_READINESS_PRELOAD': '1',
        'HOLYMEDIA_PUBLIC_BASE_URL': 'http://localhost:4402',
        'COOKIE_DOMAIN': '',
    }
    for index, value in enumerate(args):
        if index and args[index - 1] == '-e' and value.split('=', 1)[0] in overrides:
            key = value.split('=', 1)[0]
            args[index] = key + '=' + overrides.pop(key)
    for key, value in overrides.items():
        args[-2:-2] = ['-e', key + '=' + value]
    args[-1] = '/stage234/runtime-readiness-runner.mjs'
    return args

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ['head', 'harness-head', 'image', 'run-id', 'context-basename']:
        parser.add_argument('--' + key, required=True)
    parser.add_argument('--check-only', action='store_true')
    inventory.command = command
    inventory.execute(parser.parse_args())
