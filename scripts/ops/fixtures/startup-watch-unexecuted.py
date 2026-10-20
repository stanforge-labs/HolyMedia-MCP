#!/usr/bin/env python3
"""Release-local resource watchdog spanning the production Web replacement."""

from collections import deque
import json
import os
from pathlib import Path
import sys
import time


def sample():
    mem = {}
    for line in Path('/proc/meminfo').read_text().splitlines():
        if line.startswith(('MemAvailable:', 'SwapFree:')):
            key, value, *_ = line.split()
            mem[key[:-1]] = int(value)
    vm = {}
    for line in Path('/proc/vmstat').read_text().splitlines():
        if line.startswith(('pswpout ', 'pswpin ', 'pgmajfault ', 'oom_kill ')):
            key, value = line.split()
            vm[key] = int(value)
    psi = {}
    for line in Path('/proc/pressure/memory').read_text().splitlines():
        parts = line.split()
        if parts and parts[0] in ('full', 'some'):
            psi[parts[0]] = float(parts[1].split('=')[1])
    disk = os.statvfs('/')
    return dict(mem=mem['MemAvailable'], swapfree=mem['SwapFree'],
                disk=disk.f_bavail * disk.f_frsize // 1048576,
                full=psi['full'], some=psi['some'], **vm)


def main():
    if os.geteuid() != 0 or len(sys.argv) != 2:
        raise SystemExit('root and one evidence directory required')
    directory = Path(sys.argv[1])
    first = sample()
    start = time.monotonic()
    window = deque([(start, first)])
    low = {key: first[key] for key in ('mem', 'swapfree', 'disk')}
    high = {key: first[key] for key in ('full', 'some')}
    peak60 = {key: 0 for key in ('pswpout', 'pswpin', 'pgmajfault')}
    (directory / 'startup-watch.ready').write_text(str(os.getpid()))
    reason = None
    current = first
    while time.monotonic() - start < 180:
        now = time.monotonic()
        current = sample()
        for key in low: low[key] = min(low[key], current[key])
        for key in high: high[key] = max(high[key], current[key])
        window.append((now, current))
        while len(window) > 1 and window[1][0] <= now - 60:
            window.popleft()
        for key in peak60:
            peak60[key] = max(peak60[key], current[key] - window[0][1][key])
        if current['mem'] < 819200: reason = 'mem_floor'
        elif current['swapfree'] < 262144: reason = 'swap_floor'
        elif current['disk'] < 10240: reason = 'disk_floor'
        elif current['full'] >= 1.5: reason = 'psi_full'
        elif current['some'] >= 2.0: reason = 'psi_some'
        elif current['oom_kill'] != first['oom_kill']: reason = 'oom'
        elif current['pswpout'] - first['pswpout'] > 64 or peak60['pswpout'] > 32: reason = 'swap_out'
        elif current['pswpin'] - first['pswpin'] > 64 or peak60['pswpin'] > 32: reason = 'swap_in'
        elif current['pgmajfault'] - first['pgmajfault'] > 256 or peak60['pgmajfault'] > 64: reason = 'major_faults'
        if reason:
            (directory / 'startup-watch.fail').write_text(reason)
            break
        time.sleep(1)
    result = dict(status='FAIL' if reason else 'PASS', reason=reason,
                  duration_s=round(time.monotonic() - start, 1), minimum=low,
                  peak=high, peak60=peak60,
                  delta={key: current[key] - first[key] for key in
                         ('pswpout', 'pswpin', 'pgmajfault', 'oom_kill')})
    (directory / 'startup-watch.json').write_text(json.dumps(result, sort_keys=True))
    print(json.dumps(result, sort_keys=True), flush=True)
    if reason: raise SystemExit(1)


if __name__ == '__main__':
    main()
