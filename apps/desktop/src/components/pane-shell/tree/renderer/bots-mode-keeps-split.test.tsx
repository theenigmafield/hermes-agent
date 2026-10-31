/**
 * Bot Mode must not collapse a column's top zone (#bots-mode-split).
 *
 * The persisted layout docks Bot Mode's Routines pane to the right of the
 * workspace zone, which sits at the top of a column (dock-enforce puts it in a
 * row beside its anchor). Routines arrives minimized, as a 28px vertical rail
 * in that row. Outside Bot Mode the pane is unregistered, so the row is just
 * the workspace zone. When the Bots tab is shown the pane registers and the
 * rail appears.
 *
 * The rail is minimized ALONG ITS ROW: it is 28px wide and full height. The
 * column above it still has to size the row by height, and the row's height
 * is not the rail's width. Treating the rail as a fixed 1.75rem track along
 * the column folded the whole top zone to its tab strip, and the sash between
 * the two zones then resized nothing.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { registry } from '@/contrib/registry'
import { $paneStates } from '@/store/panes'

import { group, type LayoutNode, split, type SplitNode } from '../model'
import { $hiddenTreePanes, $layoutTree } from '../store'

import { fixedTrackSize, type TrackContext } from './track-model'
import { TreeSplit } from './tree-split'

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const ROUTINES = 'hermes-bots:routines'
const TOP_TILES = ['session-tile:review-fathom', 'session-tile:gaia-proposal']
const BOTTOM_TILES = ['session-tile:prewedding', 'session-tile:set-up-repo', 'session-tile:support-annie']
const RIGHT_TILES = ['session-tile:alibaba', 'session-tile:support-bob']

const disposers: (() => void)[] = []

function registerPane(id: string, data: Record<string, unknown>) {
  disposers.push(registry.register({ area: 'panes', data, id, render: () => null, title: id }))
}

/** What Bot Mode's plugin registers on entry (plugin.tsx registerRoutinesPane). */
function registerRoutines() {
  const dispose = registry.register({
    area: 'panes',
    data: {
      placement: 'main',
      dock: { pane: 'workspace', pos: 'right', enforce: true },
      defaultCollapsed: true,
      width: '250px'
    },
    id: ROUTINES,
    render: () => null,
    title: 'Scheduled jobs'
  })

  disposers.push(dispose)

  return dispose
}

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', TestResizeObserver)
  vi.stubGlobal('CSS', { ...globalThis.CSS, escape: (value: string) => value })
  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('cancelAnimationFrame', () => undefined)
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.setPointerCapture ??= () => undefined
  Element.prototype.releasePointerCapture ??= () => undefined
})

beforeEach(() => {
  window.localStorage.clear()
  $hiddenTreePanes.set(new Set())
  $paneStates.set({})

  registerPane('hermes-bots:pane', { placement: 'left', width: '237px', hideOnly: true })
  registerPane('sessions', { placement: 'left', width: '237px', hideOnly: true })
  registerPane('terminal', { placement: 'bottom', height: '38vh' })
  registerPane('workspace', { placement: 'main', uncloseable: true })

  for (const id of [...TOP_TILES, ...BOTTOM_TILES, ...RIGHT_TILES]) {
    registerPane(id, { placement: 'main' })
  }
})

afterEach(() => {
  cleanup()
  $layoutTree.set(null)
  $paneStates.set({})
  disposers.splice(0).forEach(dispose => dispose())
})

const MID_COLUMN = 's-mid-column'
const COLUMN_WEIGHTS = [1.7391914248672078, 2.755155351644957]

/** Nick's persisted Advanced tree, reduced to its shape: the sidebar zone
 *  (Bots | Sessions | Terminal), a middle column whose top is a row holding
 *  the workspace zone beside the minimized Routines rail, and a right zone. */
function nicksTree(): SplitNode {
  return split(
    'row',
    [
      group(['hermes-bots:pane', 'sessions', 'terminal'], { id: 'g-sidebar', active: 'sessions' }),
      split(
        'column',
        [
          split(
            'row',
            [
              group(['workspace', ...TOP_TILES], { id: 'g-top', active: TOP_TILES[0], tabStrip: 'always' }),
              group([ROUTINES], { id: 'g-routines', minimized: true })
            ],
            [0.5, 0.5],
            's-top-row'
          ),
          group(BOTTOM_TILES, { id: 'g-bottom', active: BOTTOM_TILES[2] })
        ],
        COLUMN_WEIGHTS,
        MID_COLUMN
      ),
      group(RIGHT_TILES, { id: 'g-right' })
    ],
    [0.2112, 14.61, 16.52],
    's-root'
  )
}

function splitIn(node: LayoutNode | null, id: string): null | SplitNode {
  if (node?.type !== 'split') {
    return null
  }

  return node.id === id ? node : (node.children.map(child => splitIn(child, id)).find(Boolean) ?? null)
}

function findSplit(node: LayoutNode | null, id: string): SplitNode {
  const found = splitIn(node, id)

  if (!found) {
    throw new Error(`split ${id} not found`)
  }

  return found
}

function rect(height: number): DOMRect {
  return {
    bottom: height,
    height,
    left: 0,
    right: 1000,
    toJSON: () => ({}),
    top: 0,
    width: 1000,
    x: 0,
    y: 0
  } as DOMRect
}

function setHeight(element: Element, height: number) {
  Object.defineProperty(element, 'getBoundingClientRect', { configurable: true, value: () => rect(height) })
}

function middleColumn() {
  const column = window.document.querySelector<HTMLElement>(`[data-tree-split="${MID_COLUMN}"]`)

  if (!column) {
    throw new Error('middle column not rendered')
  }

  const [top, bottom] = [...column.children] as HTMLElement[]

  return { bottom, column, top }
}

const topGrow = () => COLUMN_WEIGHTS[0] / (COLUMN_WEIGHTS[0] + COLUMN_WEIGHTS[1])

describe('Bot Mode keeps the middle column split', () => {
  it('a rail minimized along its row is not a fixed track for the column above it', () => {
    const ctx: TrackContext = {
      overrides: {},
      paneFor: id => registry.getArea('panes').find(pane => pane.id === id),
      paneGone: id => !registry.getArea('panes').some(pane => pane.id === id)
    }

    registerRoutines()
    const topRow = findSplit(nicksTree(), 's-top-row')

    // Across the column the row must stay flex: the rail stretches to the
    // row's height, and the workspace zone beside it declares no height.
    expect(fixedTrackSize(topRow, 'column', ctx)).toBeNull()
    // Along its own row the rail is still its 28px strip.
    expect(fixedTrackSize(topRow.children[1], 'row', ctx)).toBe('1.75rem')
  })

  it('showing the Bots tab leaves the top zone at its share of the column', () => {
    const tree = nicksTree()
    $layoutTree.set(tree)
    render(<TreeSplit node={tree} root rootRow />)

    // Sessions: Routines is unregistered, so the row is just the workspace zone.
    const before = middleColumn().top.style
    expect(before.display).not.toBe('none')
    expect(Number(before.flexGrow)).toBeCloseTo(topGrow(), 5)
    expect(before.flexBasis).toBe('0px')

    // Bots tab shown: the plugin registers Routines and its minimized rail appears.
    act(() => {
      registerRoutines()
    })

    const after = middleColumn().top.style
    expect(after.display).not.toBe('none')
    expect(after.flexBasis).toBe('0px')
    expect(Number(after.flexGrow)).toBeCloseTo(topGrow(), 5)
    expect(window.document.querySelector('[data-tree-group="g-routines"]')).not.toBeNull()
    expect(findSplit($layoutTree.get(), 's-top-row').children[1]).toMatchObject({ minimized: true })
  })

  it('in Bot Mode the sash between the two zones still resizes them', () => {
    const tree = nicksTree()
    $layoutTree.set(tree)
    registerRoutines()
    render(<TreeSplit node={tree} root rootRow />)

    const { bottom, column, top } = middleColumn()
    setHeight(column, 900)
    setHeight(top, 350)
    setHeight(bottom, 550)

    const sash = bottom.querySelector(':scope > [role="separator"]')

    if (!sash) {
      throw new Error('no sash between the top and bottom zones')
    }

    expect(sash.className).not.toContain('pointer-events-none')

    // Drag the seam 200px down: the top zone grows from 350px to 550px.
    fireEvent.pointerDown(sash, { button: 0, clientY: 350, pointerId: 1, pointerType: 'mouse' })
    fireEvent.pointerMove(window, { clientY: 550, pointerId: 1, pointerType: 'mouse' })
    fireEvent.pointerUp(window, { clientY: 550, pointerId: 1, pointerType: 'mouse' })

    const weights = findSplit($layoutTree.get(), MID_COLUMN).weights
    expect(weights[0] / (weights[0] + weights[1])).toBeCloseTo(550 / 900, 3)
    // And the drag landed on screen: the top zone is still a flex track.
    expect(middleColumn().top.style.flexBasis).toBe('0px')
    // The Routines rail is untouched by a seam it does not sit on.
    expect($paneStates.get()[ROUTINES]?.heightOverride).toBeUndefined()
  })
})
