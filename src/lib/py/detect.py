# Sent by the Tiny Tapeout demo configurator: report what this board is and how its
# demo mode is set up, as one line "DETECT:<json>". Read-only.
def _tt_demo_detect():
    import json, os, sys
    r = {'errors': []}

    def text(path, limit=65536):
        try:
            with open(path) as f:
                return f.read(limit)
        except OSError:
            return None

    r['machine'] = getattr(sys.implementation, '_machine', '')
    r['release'] = None
    try:
        for f in os.listdir('/'):
            if f.startswith('release_v'):
                r['release'] = f[len('release_v'):]
    except OSError:
        pass
    tt = None
    try:
        from ttboard.demoboard import DemoBoard
        tt = DemoBoard.get()
    except Exception as e:
        r['errors'].append('no DemoBoard: %s' % e)
    r['sdk'] = getattr(tt, 'version', None) if tt else None
    r['shuttle'] = None
    r['rom'] = None
    r['projects'] = None
    if tt is not None:
        try:
            r['shuttle'] = tt.shuttle.run
        except Exception as e:
            r['errors'].append('no shuttle: %s' % e)
        try:
            c = tt.chip_ROM.contents
            r['rom'] = {k: str(v) for k, v in c.items()} if isinstance(c, dict) else str(c)
        except Exception as e:
            r['errors'].append('no chip ROM: %s' % e)
        try:
            r['projects'] = len(tt.shuttle)
        except Exception as e:
            r['errors'].append('no project count: %s' % e)
    try:
        import ttboard.demo
        r['firmware_demo'] = True
    except ImportError:
        r['firmware_demo'] = False
    d = getattr(tt, 'demo', None) if tt else None
    r['demo_running'] = bool(d is not None and getattr(d, 'running', False))
    r['demo_errors'] = [str(e) for e in getattr(d, 'errors', [])] if d is not None else []
    try:
        from ttboard.config.parser import ConfigParser
        conf = ConfigParser()
        conf.read('config.ini')
        r['demo_setting'] = conf.get('DEFAULT', 'demo') is True
    except Exception as e:
        r['demo_setting'] = False
        r['errors'].append('config.ini: %s' % e)
    for key, path in (('main', '/main.py'), ('main_stock', '/main_stock.py'), ('config_ini', '/config.ini'),
                      ('demo_json', '/demo.json'), ('demo_py', '/demo.py'), ('vga_cycle', '/vga_cycle.py')):
        r[key] = text(path)
    print('DETECT:' + json.dumps(r))

_tt_demo_detect()
del _tt_demo_detect
