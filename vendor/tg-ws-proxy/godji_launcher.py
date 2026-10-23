"""Godji launcher for the unmodified Flowseal TG WS Proxy v1.11.1 engine."""
import json
import sys
from pathlib import Path
from proxy.tg_ws_proxy import main

def bounded_int(config, name, default, minimum, maximum):
    try:
        return max(minimum, min(maximum, int(config.get(name, default))))
    except (ValueError, TypeError):
        return default

if __name__ == '__main__':
    config_path = Path(sys.argv[1])
    config = json.loads(config_path.read_text(encoding='utf-8'))
    args = [
        'godji-telegram-proxy', '--host', str(config['host']),
        '--port', str(config['port']), '--secret', config['secret'],
        '--log-file', str(config_path.parent / 'proxy.log'),
        '--pool-size', str(bounded_int(config, 'pool_size', 1, 0, 16)),
        '--buf-kb', str(bounded_int(config, 'buf_kb', 64, 4, 1024)),
    ]
    for dc in config.get('dc_ip', []):
        args += ['--dc-ip', dc]
    for flag, enabled in [('--verbose', config.get('verbose')), ('--no-cfproxy', config.get('cfproxy') is False), ('--no-h2', config.get('h2') is False)]:
        if enabled:
            args.append(flag)
    sys.argv = args
    main()
