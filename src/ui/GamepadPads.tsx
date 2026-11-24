// SPDX-License-Identifier: Apache-2.0
// A "gamepad" step's value: the controllers plugged into the emulated Gamepad Pmod, each a
// row of its 12 buttons (click to hold or release), with player 2 plugged in or out.
import { For, Show } from 'solid-js';
import { BUTTON_LABEL, GAMEPAD_BUTTONS, type GamepadButton, type GamepadController, inButtonOrder } from '~/lib/gamepad';

/** Labels short enough for a row of 12 in a step row. */
const SHORT: Partial<Record<GamepadButton, string>> = { select: 'Sel', start: 'Sta' };

const chip = (on: boolean) =>
  ({
    border: `1px solid ${on ? '#2e7d32' : '#cfd8cf'}`,
    'border-radius': '4px',
    padding: '1px 0',
    cursor: 'pointer',
    background: on ? '#2e7d32' : '#fff',
    color: on ? '#fff' : '#333',
    'min-width': 0,
    overflow: 'hidden',
    font: 'inherit',
    'font-size': '11px',
    'font-weight': 600,
    'line-height': 1.3,
  }) as const;

const link = { border: 'none', background: 'none', cursor: 'pointer', color: '#544ead', padding: '0 2px', font: 'inherit', 'font-size': '11px', 'white-space': 'nowrap' } as const;

export function GamepadPads(props: { value: GamepadController[]; onChange: (v: GamepadController[]) => void }) {
  const toggle = (player: number, b: GamepadButton) =>
    props.onChange(
      props.value.map((c, j) => {
        if (j !== player) return c;
        return { buttons: c.buttons.includes(b) ? c.buttons.filter((x) => x !== b) : inButtonOrder([...c.buttons, b]) };
      }),
    );
  const plug = () => props.onChange([...props.value, { buttons: [] }]);
  const unplug = () => props.onChange(props.value.slice(0, -1));
  const GRID = { display: 'grid', 'grid-template-columns': '1.6em repeat(12, minmax(0, 1fr)) 3.6em', gap: '2px', 'align-items': 'center' } as const;
  return (
    <div style={{ display: 'flex', 'flex-direction': 'column', gap: '2px', 'min-width': 0 }}>
      <For each={props.value}>
        {(c, j) => (
          <div style={GRID}>
            <span style={{ 'font-size': '10px', opacity: 0.7 }} title={`player ${j() + 1}'s controller`}>
              P{j() + 1}
            </span>
            <For each={[...GAMEPAD_BUTTONS]}>
              {(b) => {
                const on = () => c.buttons.includes(b);
                return (
                  <button type="button" title={`player ${j() + 1} ${BUTTON_LABEL[b]}: ${on() ? 'held' : 'released'} (click to flip)`} onClick={() => toggle(j(), b)} style={chip(on())}>
                    {SHORT[b] ?? BUTTON_LABEL[b]}
                  </button>
                );
              }}
            </For>
            <span>
              <Show when={j() === props.value.length - 1}>
                <Show when={props.value.length < 2}>
                  <button type="button" style={link} title="plug in player 2's controller" onClick={plug}>
                    +P2
                  </button>
                </Show>
                <button type="button" style={link} title={`unplug player ${j() + 1}'s controller`} onClick={unplug}>
                  −
                </button>
              </Show>
            </span>
          </div>
        )}
      </For>
      <Show when={!props.value.length}>
        <div style={{ 'font-size': '11px' }}>
          <span style={{ opacity: 0.7 }}>no controllers plugged in</span>
          <button type="button" style={link} title="plug in player 1's controller" onClick={plug}>
            +P1
          </button>
        </div>
      </Show>
    </div>
  );
}
