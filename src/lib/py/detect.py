# Sent by the Tiny Tapeout demo configurator: report what this board is and how its
# demo mode is set up, as one line "DETECT:<json>". Read-only.
def _tt_demo_detect():
    import gc, json, os, sys
    gc.collect()
    r = {'errors': []}

    def text(path):
        # read() allocates only the file's size; a fixed read(N) allocates N bytes up
        # front, which fails once the demo module is loaded on a busy heap
        try:
            with open(path) as f:
                return f.read()
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
    # The ui_in DIP switches: each one that is on holds its input high and beats the RP2350,
    # so the demo's inputs never reach the design. The SDK's own test: an input that reads
    # high is a switch that is on (and it then leaves that pin undriven). Pins the RP2350 is
    # driving are released for a moment to read them, then driven again, unless the switch
    # turns out to be on, in which case they stay inputs as the SDK would leave them.
    r['mode'] = None
    r['dip_on'] = None
    if tt is not None:
        try:
            r['mode'] = tt.mode_str
        except Exception as e:
            r['errors'].append('no mode: %s' % e)
        try:
            from ttboard.pins.upython import Pin
            on = []
            for i in range(8):
                p = getattr(tt.pins, 'ui_in%d' % i)
                if p.is_input:
                    high = bool(p())
                else:
                    was = p()
                    p.mode = Pin.IN
                    high = bool(p())
                    if not high:
                        p.mode = Pin.OUT
                        p(was)
                if high:
                    on.append(i)
            r['dip_on'] = on
        except Exception as e:
            r['errors'].append('could not read the DIP switches: %s' % e)
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
